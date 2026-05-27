import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { MOTZ_WALLETS, MOTZ_TRANSFERRERS } from "@/lib/motz-wallets";
import { ETH_TRACKED_COLLECTIONS } from "@/lib/contracts";
import {
  listHoldingsEth,
  saleHistoryEth,
  collectionFloorEth,
  tierFloorsEth,
  lastTierSaleEth,
  persistSalesSoon,
} from "@/lib/opensea";
import { ethUsdAt, ethUsdNow } from "@/lib/ethprice";
import type {
  ApiResponse,
  TaggedCollectionHoldings,
  TaggedHoldingRow,
} from "@/app/_components/shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Snapshot file lives in the gitignored data/ directory. Holds the most
// recent combined-portfolio render for the MoTZ project wallets — served
// as-is to any visitor of the MoTZ Dashboard / PnL tabs so they don't
// trigger expensive load chains on every page view.
// Two paths: writable local cache + bundled snapshot that ships with the
// build. On Vercel the filesystem is read-only at runtime, so writes are
// caught silently and reads fall through to the bundled snapshot. On
// localhost both work; the local cache "wins" because it's newer.
const SNAPSHOT_LOCAL_PATH = path.join(
  process.cwd(),
  "data",
  "motz-snapshot.json",
);
const SNAPSHOT_BUNDLED_PATH = path.join(
  process.cwd(),
  "src",
  "data",
  "motz-snapshot.json",
);
const SNAPSHOT_TTL_MS = 24 * 60 * 60 * 1000;

export type MotzSnapshot = {
  generatedAt: number;
  walletAddresses: string[];
  resolvedAddresses: string[];
  /**
   * Persistent input → resolved-address map. Built incrementally over
   * refreshes: a wallet's resolution is recorded once it resolves
   * successfully (even on a refresh where its load fails), so the
   * merge-protection logic can look up its previous resolved address
   * even when the failure prevents it from appearing in this run's
   * `resolvedAddresses`. Optional for backwards compatibility with
   * older snapshot files.
   */
  walletResolutions?: Record<string, string>;
  collections: TaggedCollectionHoldings[];
  currentRonUsd: number | null;
  walletCount: number;
  /** Per-wallet failures from the most recent refresh. Empty when all
   * configured wallets loaded successfully. Snapshot is still written
   * with whatever did load — partial > nothing. */
  failures?: { input: string; error: string }[];
  /** Per-wallet partial loads: wallet responded successfully but with
   * internal rate-limit catches that left some data incomplete. The
   * tokens count + warnings detail what came through and what didn't. */
  partials?: { input: string; tokens: number; warnings: string[] }[];
};

function readSnapshot(): MotzSnapshot | null {
  // Prefer the local writable cache (newer); fall back to bundled snapshot.
  for (const p of [SNAPSHOT_LOCAL_PATH, SNAPSHOT_BUNDLED_PATH]) {
    try {
      if (!fs.existsSync(p)) continue;
      return JSON.parse(fs.readFileSync(p, "utf8")) as MotzSnapshot;
    } catch {
      // try next path
    }
  }
  return null;
}

function writeSnapshot(snap: MotzSnapshot): void {
  try {
    fs.mkdirSync(path.dirname(SNAPSHOT_LOCAL_PATH), { recursive: true });
    fs.writeFileSync(SNAPSHOT_LOCAL_PATH, JSON.stringify(snap));
  } catch {
    // Read-only fs on Vercel runtime — silently skip. Bundled snapshot
    // stays as the served data; updates require a redeploy with the
    // regenerated src/data/motz-snapshot.json committed.
  }
}

// In-flight guard: if a refresh is already running, return its promise so
// concurrent requests don't trigger overlapping loads (which would just
// rate-limit themselves into oblivion).
let refreshInFlight: Promise<MotzSnapshot> | null = null;

async function refreshSnapshot(req: NextRequest): Promise<MotzSnapshot> {
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = (async () => {
    try {
      // Resolve absolute origin so we can call our own /api/holdings.
      // Next 16 puts the original host on req.nextUrl.
      const origin = req.nextUrl.origin;
      // Transferrers are now safe: /api/holdings uses userAcquisitionsForCached
      // (24h disk-cached scan per transferrer wallet). The first MoTZ snapshot
      // refresh after a cache miss runs all 6 transferrer scans once; every
      // subsequent /api/holdings call reads from disk → 0 transferrer API
      // calls. That makes 6 transferrers per wallet effectively free for the
      // throttle.
      const transferrerParams = MOTZ_TRANSFERRERS.map(
        (t) => `&transferrer=${encodeURIComponent(t)}`,
      ).join("");
      const byContract = new Map<string, TaggedCollectionHoldings>();
      const resolved: string[] = [];
      const failures: { input: string; error: string }[] = [];
      const partials: { input: string; tokens: number; warnings: string[] }[] =
        [];
      // Carry the previous snapshot's input→resolved map forward so a
      // failed wallet's resolution survives this refresh (used for
      // merge-protection lookup). New successful resolutions overwrite.
      const previousSnapForResolutions = readSnapshot();
      const walletResolutions: Record<string, string> = {
        ...(previousSnapForResolutions?.walletResolutions ?? {}),
      };
      let currentRonUsd: number | null = null;
      // Sequential — same reason as Load Combined: per-wallet shares a
      // server-side rate limiter, running in parallel just trips the breaker.
      // We catch per-wallet failures (so one rate-limited wallet doesn't
      // wipe out the whole snapshot) and pause between wallets long enough
      // that the breaker can FULLY drain its 60s cooldown — anything
      // shorter and later wallets start with a tripped breaker and bail
      // immediately. 60s is the worst-case full drain.
      const BETWEEN_WALLET_MS = 60_000;

      // Smart ordering: wallets that already have data in the previous
      // snapshot go LAST. They're already preserved by the merge logic and
      // tend to need less API (their tokens are cached). Wallets WITHOUT
      // previous data go FIRST so they get a fresh, unburdened API budget.
      // This biases each refresh toward filling in the missing wallets
      // rather than re-loading already-cached ones.
      const previousSnap = readSnapshot();
      const previousTokensPerInput = new Map<string, number>();
      if (previousSnap) {
        const tokensByResolved = new Map<string, number>();
        for (const c of previousSnap.collections) {
          for (const r of c.rows) {
            const t = r.walletTag ?? "";
            tokensByResolved.set(t, (tokensByResolved.get(t) ?? 0) + 1);
          }
        }
        for (let pi = 0; pi < previousSnap.walletAddresses.length; pi++) {
          const input = previousSnap.walletAddresses[pi];
          const resolvedAddr = previousSnap.resolvedAddresses[pi];
          if (input && resolvedAddr) {
            previousTokensPerInput.set(
              input,
              tokensByResolved.get(resolvedAddr) ?? 0,
            );
          }
        }
      }
      const orderedWallets = [...MOTZ_WALLETS].sort((a, b) => {
        // Ascending by previous token count — 0 tokens first, then small,
        // then large. Ties keep MOTZ_WALLETS' original ordering.
        const ac = previousTokensPerInput.get(a) ?? 0;
        const bc = previousTokensPerInput.get(b) ?? 0;
        return ac - bc;
      });
      console.log(
        "[motz-snapshot] wallet order:",
        orderedWallets
          .map((w) => `${w}(${previousTokensPerInput.get(w) ?? 0})`)
          .join(" → "),
      );

      for (let i = 0; i < orderedWallets.length; i++) {
        const w = orderedWallets[i];
        try {
          const url =
            `${origin}/api/holdings?address=${encodeURIComponent(w)}` +
            transferrerParams;
          const r = await fetch(url, { cache: "no-store" });
          const j = (await r.json()) as ApiResponse | { error: string };
          if (!r.ok || "error" in j) {
            throw new Error(
              "error" in j ? j.error : `HTTP ${r.status}`,
            );
          }
          const data = j as ApiResponse;
          resolved.push(data.address);
          // Record this wallet's resolution so failures on future
          // refreshes can still look up its resolved address.
          walletResolutions[w.toLowerCase()] = data.address.toLowerCase();
          if (data.currentRonUsd != null) currentRonUsd = data.currentRonUsd;
          const tokenCount = data.collections.reduce(
            (s, c) => s + c.rows.length,
            0,
          );
          // Only flag as PARTIAL if something STRUCTURAL failed: empty
          // token list AND warnings, OR warnings from the calls that
          // determine *which* tokens to show (listHoldings) or the wallet's
          // primary cost-basis sources (userAcquisitionsFor on the main
          // wallet, userStakingDepositsFor).
          //
          // Enrichment-only warnings (stakedLastAcq, stakedMetadata,
          // floor lookups, per-token lastAcquisition) DON'T make the load
          // partial — those tokens still show up, just with degraded cost
          // basis. Flagging on those produced false "PARTIAL" banners for
          // wallets that actually loaded correctly.
          const warnings = data.warnings ?? [];
          const hasStructuralWarning = warnings.some(
            (w) =>
              w.startsWith("listHoldings(") ||
              w.startsWith("userAcquisitionsFor(") ||
              w.startsWith("userStakingDepositsFor(") ||
              w.startsWith("ronUsdNow"),
          );
          const isStructurallyPartial =
            warnings.length > 0 &&
            (tokenCount === 0 || hasStructuralWarning);
          if (isStructurallyPartial) {
            partials.push({
              input: w,
              tokens: tokenCount,
              warnings,
            });
          }
          for (const c of data.collections) {
            const existing = byContract.get(c.contract);
            const taggedRows: TaggedHoldingRow[] = c.rows.map((row) => ({
              ...row,
              walletTag: data.address,
            }));
            if (existing) {
              existing.rows.push(...taggedRows);
            } else {
              byContract.set(c.contract, {
                contract: c.contract,
                name: c.name,
                symbol: c.symbol,
                slug: c.slug,
                rows: taggedRows,
              });
            }
          }
        } catch (err) {
          console.warn(
            `[motz-snapshot] wallet ${w} failed; continuing:`,
            (err as Error).message,
          );
          failures.push({ input: w, error: (err as Error).message });
        }
        // Cool-down between wallets — gives the gqlLimiter / breaker
        // breathing room before slamming Sky Mavis with the next wallet's
        // userActivities pagination.
        if (i < orderedWallets.length - 1) {
          await new Promise((r) => setTimeout(r, BETWEEN_WALLET_MS));
        }
      }
      // -------------------------------------------------------------
      // Auto-retry pass: any wallet that came back STRUCTURALLY partial
      // (listHoldings / userAcquisitionsFor / userStakingDepositsFor
      // failed) gets retried after a long cool-down. Repeats until no
      // structural partials remain or MAX_RETRY_ROUNDS exhausted.
      // -------------------------------------------------------------
      const MAX_RETRY_ROUNDS = 3;
      const RETRY_COOLDOWN_MS = 120_000; // 2 min — full breaker drain + buffer
      for (let round = 1; round <= MAX_RETRY_ROUNDS; round++) {
        const structurallyPartial = partials.filter((p) =>
          p.warnings.some(
            (w) =>
              w.startsWith("listHoldings(") ||
              w.startsWith("userAcquisitionsFor(") ||
              w.startsWith("userStakingDepositsFor("),
          ),
        );
        if (structurallyPartial.length === 0) break;
        console.log(
          `[motz-snapshot] retry round ${round}/${MAX_RETRY_ROUNDS}: ${structurallyPartial.length} structurally partial wallets — cooling down ${RETRY_COOLDOWN_MS / 1000}s`,
        );
        await new Promise((r) => setTimeout(r, RETRY_COOLDOWN_MS));
        for (const p of structurallyPartial) {
          const w = p.input;
          try {
            const url =
              `${origin}/api/holdings?address=${encodeURIComponent(w)}` +
              transferrerParams;
            const r = await fetch(url, { cache: "no-store" });
            const j = (await r.json()) as ApiResponse | { error: string };
            if (!r.ok || "error" in j) continue;
            const data = j as ApiResponse;
            // Replace any previous rows for this wallet's resolved
            // address with the fresh load.
            const tag = data.address.toLowerCase();
            for (const col of byContract.values()) {
              col.rows = col.rows.filter((row) => row.walletTag !== tag);
            }
            for (const c of data.collections) {
              const existing = byContract.get(c.contract);
              const tagged: TaggedHoldingRow[] = c.rows.map((row) => ({
                ...row,
                walletTag: tag,
              }));
              if (existing) existing.rows.push(...tagged);
              else
                byContract.set(c.contract, {
                  contract: c.contract,
                  name: c.name,
                  symbol: c.symbol,
                  slug: c.slug,
                  rows: tagged,
                });
            }
            // Update partial / failure status for this wallet.
            const warnings = data.warnings ?? [];
            const stillStructural = warnings.some(
              (w) =>
                w.startsWith("listHoldings(") ||
                w.startsWith("userAcquisitionsFor(") ||
                w.startsWith("userStakingDepositsFor("),
            );
            const tokenCount = data.collections.reduce(
              (s, c) => s + c.rows.length,
              0,
            );
            const idx = partials.findIndex((q) => q.input === w);
            if (stillStructural || (tokenCount === 0 && warnings.length > 0)) {
              if (idx >= 0)
                partials[idx] = { input: w, tokens: tokenCount, warnings };
              else partials.push({ input: w, tokens: tokenCount, warnings });
            } else if (idx >= 0) {
              partials.splice(idx, 1);
              console.log(
                `[motz-snapshot] retry round ${round}: ${w} recovered (${tokenCount} tokens)`,
              );
            }
          } catch (err) {
            console.warn(
              `[motz-snapshot] retry round ${round} for ${w} threw:`,
              (err as Error).message,
            );
          }
        }
      }

      // -------------------------------------------------------------
      // Ethereum-side collections (OpenSea pipeline)
      // -------------------------------------------------------------
      // Iterates ETH_TRACKED_COLLECTIONS × resolved wallet addresses,
      // pulls holdings + cost basis + floor from OpenSea, and merges
      // into byContract alongside the Ronin rows. Per-wallet errors
      // are isolated so an OpenSea hiccup never wipes Ronin data.
      const currentEthUsd = ethUsdNow();
      const ethWallets = resolved.length > 0 ? resolved : [];
      // Transferrer set: all MoTZ holder wallets + any transferrer-only
      // wallet that's already a hex address. If a currently-held token
      // has a prior sale where ANY of these wallets was the buyer, that
      // sale's price = cost basis — regardless of whether the current
      // owner is the direct buyer or received it via inter-wallet
      // transfer later.
      const motzHexSet = new Set(ethWallets.map((a) => a.toLowerCase()));
      for (const t of MOTZ_TRANSFERRERS) {
        const lc = t.toLowerCase();
        if (/^0x[a-f0-9]{40}$/.test(lc)) motzHexSet.add(lc);
        else {
          // RNS name — try the previous-snapshot resolution map.
          const resolved = walletResolutions[lc];
          if (resolved) motzHexSet.add(resolved.toLowerCase());
        }
      }
      for (const c of ETH_TRACKED_COLLECTIONS) {
        let collectionFloor: number | null = null;
        try {
          collectionFloor = await collectionFloorEth(c.slug);
        } catch (err) {
          console.warn(
            `[motz-snapshot] OS floor ${c.slug} failed:`,
            (err as Error).message,
          );
        }
        // Per-tier floors via listing walk (Size Class for Cambria Islands).
        let floorsByTier: Record<string, number> = {};
        try {
          floorsByTier = await tierFloorsEth(c.slug, c.address, c.traitName);
        } catch (err) {
          console.warn(
            `[motz-snapshot] OS per-tier floor ${c.slug} failed:`,
            (err as Error).message,
          );
        }
        // For any tier we HOLD but couldn't find a listing for (e.g. T5
        // with no active sales), fall back to the most recent SALE price
        // for that tier. Better signal than the collection floor since
        // rare tiers trade at very different prices from the median.
        // We populate this lazily after we've discovered which tiers our
        // wallets actually hold (below in the per-wallet loop).
        const rows: TaggedHoldingRow[] = [];
        for (const addr of ethWallets) {
          let nfts: Awaited<ReturnType<typeof listHoldingsEth>> = [];
          try {
            nfts = await listHoldingsEth(addr, c.slug);
          } catch (err) {
            console.warn(
              `[motz-snapshot] OS holdings ${addr.slice(0, 8)}/${c.slug} failed:`,
              (err as Error).message,
            );
            continue;
          }
          for (const n of nfts) {
            // Transferrer-aware cost basis:
            //   1. Pull the token's sale history (cached on disk).
            //   2. Walk newest-to-oldest, find the FIRST sale whose buyer
            //      is any MoTZ wallet. That's our cost basis even if the
            //      token was later transferred between MoTZ wallets.
            //   3. If no such sale exists, fall back to mint price + date.
            const history = await saleHistoryEth(c.address, n.tokenId);
            let acquiredAt: number | null = null;
            let acquiredVia: "sale" | "mint" | "transfer" = "mint";
            let costEth = c.mintPriceRon; // 0.1 ETH for Cambria Islands
            let acquiredTxHash: string | null = null;
            const transferrerSale = history.find(
              (s) => s.toAddress && motzHexSet.has(s.toAddress),
            );
            if (transferrerSale) {
              acquiredAt = transferrerSale.eventTimestamp;
              costEth = Number(BigInt(transferrerSale.priceWei)) / 1e18;
              acquiredTxHash = transferrerSale.txHash;
              // Direct-purchase by current owner = "sale". If the buying
              // wallet is a DIFFERENT MoTZ wallet, the token was transferred
              // in afterwards — mark as "transfer" but keep the original
              // cost basis preserved from the transferrer's purchase.
              acquiredVia =
                transferrerSale.toAddress === addr.toLowerCase()
                  ? "sale"
                  : "transfer";
            } else {
              // No MoTZ-wallet purchase in history → token was minted by
              // the current owner.
              acquiredAt = Math.floor(
                new Date(`${c.mintDate}T00:00:00Z`).getTime() / 1000,
              );
            }
            const ronUsdAtPurchase = acquiredAt
              ? ethUsdAt(acquiredAt)
              : null;
            const costUsd =
              ronUsdAtPurchase != null ? costEth * ronUsdAtPurchase : null;
            const rarity = n.attributes[c.traitName]?.[0] ?? null;
            // Floor lookup chain:
            //   1. Active listing floor for this exact tier
            //   2. Most recent SALE price for this tier (lazy, cached)
            //   3. Collection-wide floor as last resort
            let floorEth: number | null = collectionFloor;
            if (rarity) {
              if (floorsByTier[rarity] != null) {
                floorEth = floorsByTier[rarity];
              } else {
                try {
                  const lastSale = await lastTierSaleEth(
                    c.slug,
                    c.address,
                    c.traitName,
                    rarity,
                  );
                  if (lastSale != null) {
                    floorsByTier[rarity] = lastSale; // memoize
                    floorEth = lastSale;
                  }
                } catch (err) {
                  console.warn(
                    `[motz-snapshot] lastTierSale ${c.slug}/${rarity} failed:`,
                    (err as Error).message,
                  );
                }
              }
            }
            const floorUsd =
              floorEth != null && currentEthUsd != null
                ? floorEth * currentEthUsd
                : null;
            const pnlUsd =
              costUsd != null && floorUsd != null
                ? floorUsd - costUsd
                : null;
            rows.push({
              tokenId: n.tokenId,
              name: n.name,
              image: n.imageUrl,
              acquiredAt,
              acquiredTxHash,
              acquiredVia,
              rarity,
              rarityLabel: rarity
                ? (c.formatTrait?.(rarity) ?? rarity)
                : null,
              costRon: costEth,
              ronUsdAtPurchase,
              costUsd,
              currentRonUsd: currentEthUsd,
              floorRon: floorEth,
              floorUsd,
              pnlUsd,
              walletTag: addr.toLowerCase(),
              currencySymbol: "ETH",
            });
          }
        }
        if (rows.length > 0) {
          byContract.set(c.address.toLowerCase(), {
            contract: c.address.toLowerCase(),
            name: c.name,
            symbol: c.symbol,
            slug: c.slug,
            rows,
          });
        }
      }
      // Flush OpenSea sale cache to disk.
      persistSalesSoon();

      // If literally nothing loaded, surface the failure (no point writing
      // an empty snapshot over a previously-good one).
      if (resolved.length === 0) {
        const detail = failures.map((f) => `${f.input}: ${f.error}`).join("; ");
        throw new Error(
          `All ${MOTZ_WALLETS.length} MoTZ wallets failed to load: ${detail}`,
        );
      }

      // Merge with existing snapshot: for any wallet whose fresh load came
      // back EMPTY (0 tokens with internal warnings) OR outright FAILED,
      // preserve the previous snapshot's rows for that wallet rather than
      // wiping them. A wallet that legitimately owns no MoTZ NFTs returns
      // 0 with no warnings — those are fine to overwrite. Only suspected
      // rate-limited zeros and failures get preserved.
      const previous = readSnapshot();
      if (previous) {
        // Build a quick map: per-wallet row count in the fresh load.
        const freshRowsByTag = new Map<string, number>();
        for (const c of byContract.values()) {
          for (const r of c.rows) {
            const tag = r.walletTag ?? "";
            freshRowsByTag.set(tag, (freshRowsByTag.get(tag) ?? 0) + 1);
          }
        }
        // Helper: pull previous rows for one wallet tag into the new
        // byContract map. Fresh rows always WIN — we only splice in
        // previous rows whose (contract, tokenId) doesn't already exist
        // in the fresh load for that wallet. That way a structurally
        // partial wallet (loaded some tokens but a structural call
        // failed) doesn't lose the staked tokens that didn't make the
        // round-trip, but its fresh, more-accurate rows stay primary.
        function preservePreviousFor(addr: string): number {
          let preserved = 0;
          for (const prevCol of previous!.collections) {
            const prevRows = prevCol.rows.filter(
              (r) => r.walletTag === addr,
            );
            if (prevRows.length === 0) continue;
            const target = byContract.get(prevCol.contract);
            if (target) {
              const freshIds = new Set(
                target.rows
                  .filter((r) => r.walletTag === addr)
                  .map((r) => r.tokenId),
              );
              const novel = prevRows.filter((r) => !freshIds.has(r.tokenId));
              target.rows.push(...novel);
              preserved += novel.length;
            } else {
              byContract.set(prevCol.contract, {
                contract: prevCol.contract,
                name: prevCol.name,
                symbol: prevCol.symbol,
                slug: prevCol.slug,
                rows: [...prevRows],
              });
              preserved += prevRows.length;
            }
          }
          if (preserved > 0) {
            console.log(
              `[motz-snapshot] preserved ${preserved} previous rows for ${addr.slice(0, 12)}...`,
            );
          }
          return preserved;
        }
        // Helper: resolve a wallet input (RNS or hex) to its resolved
        // 0x address using the previous snapshot's input→resolved map.
        // Falls back to the legacy parallel-arrays lookup for snapshots
        // written before walletResolutions was introduced.
        function resolveInputFromPrevious(input: string): string | null {
          // Narrow against the outer `if (previous)` guard.
          const prev = previous!;
          const inputLc = input.toLowerCase();
          const fromMap = prev.walletResolutions?.[inputLc];
          if (fromMap) return fromMap;
          // Legacy fallback — only correct if walletAddresses and
          // resolvedAddresses are the same length (i.e. no failures in
          // the previous refresh).
          if (
            prev.walletAddresses.length === prev.resolvedAddresses.length
          ) {
            const prevIdx = prev.walletAddresses.findIndex(
              (w) => w.toLowerCase() === inputLc,
            );
            return prevIdx >= 0 ? prev.resolvedAddresses[prevIdx] : null;
          }
          // Last resort: if the input itself is a hex address, use it.
          if (/^0x[a-fA-F0-9]{40}$/.test(inputLc)) return inputLc;
          return null;
        }

        // 1) Partial wallets — structural failure during the load. ALWAYS
        // run preservation (even when some tokens loaded successfully),
        // because a structural failure typically means an entire pipeline
        // dropped: e.g. userStakingDepositsFor failing means all that
        // wallet's STAKED tokens never got included this run. The fresh
        // rows still win on (contract, tokenId); previous-only rows get
        // spliced in to cover the gap. Without this we silently lose
        // hundreds of staked tokens on every flaky refresh.
        for (const p of partials) {
          const prevResolved = resolveInputFromPrevious(p.input);
          if (prevResolved) {
            preservePreviousFor(prevResolved);
            if (!resolved.includes(prevResolved)) resolved.push(prevResolved);
          }
        }
        // 2) Failed wallets — never made it into `resolved`. Map the
        // failure input back to its previously-known resolved address
        // then splice in those rows so we don't lose them on flaky refresh.
        for (const f of failures) {
          const prevResolved = resolveInputFromPrevious(f.input);
          if (prevResolved && !freshRowsByTag.get(prevResolved)) {
            preservePreviousFor(prevResolved);
            if (!resolved.includes(prevResolved)) resolved.push(prevResolved);
          }
        }
      }

      const snap: MotzSnapshot = {
        generatedAt: Date.now(),
        walletAddresses: [...MOTZ_WALLETS],
        resolvedAddresses: resolved,
        walletResolutions,
        collections: [...byContract.values()],
        currentRonUsd,
        walletCount: resolved.length,
        failures,
        partials,
      };
      writeSnapshot(snap);
      return snap;
    } finally {
      refreshInFlight = null;
    }
  })();
  return refreshInFlight;
}

// GET — return cached snapshot. Caller can pass ?stale=ok to receive a
// stale snapshot even if it's beyond the TTL (useful when Sky Mavis is
// down and we'd rather show old data than nothing).
export async function GET(req: NextRequest) {
  const cached = readSnapshot();
  const stale =
    cached && Date.now() - cached.generatedAt > SNAPSHOT_TTL_MS;
  const allowStale = req.nextUrl.searchParams.get("stale") === "ok";
  if (cached && (!stale || allowStale)) {
    return NextResponse.json({ ...cached, stale: !!stale });
  }
  if (!cached) {
    try {
      const fresh = await refreshSnapshot(req);
      return NextResponse.json({ ...fresh, stale: false });
    } catch (err) {
      return NextResponse.json(
        { error: (err as Error).message },
        { status: 500 },
      );
    }
  }
  // Cached + stale + !allowStale → kick off refresh, return stale immediately.
  refreshSnapshot(req).catch((err) => {
    console.error("[motz-snapshot] background refresh failed:", err);
  });
  return NextResponse.json({ ...cached, stale: true });
}

// POST — force refresh now and return the fresh snapshot.
export async function POST(req: NextRequest) {
  try {
    const fresh = await refreshSnapshot(req);
    return NextResponse.json({ ...fresh, stale: false });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 },
    );
  }
}
