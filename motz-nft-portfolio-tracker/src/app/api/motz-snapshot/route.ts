import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { MOTZ_WALLETS, MOTZ_TRANSFERRERS } from "@/lib/motz-wallets";
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
const SNAPSHOT_PATH = path.join(
  process.cwd(),
  "data",
  "motz-snapshot.json",
);
const SNAPSHOT_TTL_MS = 24 * 60 * 60 * 1000;

export type MotzSnapshot = {
  generatedAt: number;
  walletAddresses: string[];
  resolvedAddresses: string[];
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
  try {
    if (!fs.existsSync(SNAPSHOT_PATH)) return null;
    return JSON.parse(fs.readFileSync(SNAPSHOT_PATH, "utf8")) as MotzSnapshot;
  } catch {
    return null;
  }
}

function writeSnapshot(snap: MotzSnapshot): void {
  fs.mkdirSync(path.dirname(SNAPSHOT_PATH), { recursive: true });
  fs.writeFileSync(SNAPSHOT_PATH, JSON.stringify(snap));
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
      const transferrerParams = MOTZ_TRANSFERRERS.map(
        (t) => `&transferrer=${encodeURIComponent(t)}`,
      ).join("");
      const byContract = new Map<string, TaggedCollectionHoldings>();
      const resolved: string[] = [];
      const failures: { input: string; error: string }[] = [];
      const partials: { input: string; tokens: number; warnings: string[] }[] =
        [];
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
          if (data.currentRonUsd != null) currentRonUsd = data.currentRonUsd;
          const tokenCount = data.collections.reduce(
            (s, c) => s + c.rows.length,
            0,
          );
          // A wallet that responded successfully but loaded few/no tokens
          // probably hit internal rate-limit catches mid-load. Flag it so
          // the UI doesn't claim it as a "clean" success. Threshold: any
          // wallet whose response carries warnings is treated as partial.
          if (data.warnings && data.warnings.length > 0) {
            partials.push({
              input: w,
              tokens: tokenCount,
              warnings: data.warnings,
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
        // byContract map. Returns total rows preserved.
        function preservePreviousFor(addr: string): number {
          let preserved = 0;
          for (const prevCol of previous!.collections) {
            const prevRows = prevCol.rows.filter(
              (r) => r.walletTag === addr,
            );
            if (prevRows.length === 0) continue;
            const target = byContract.get(prevCol.contract);
            if (target) {
              target.rows.push(...prevRows);
            } else {
              byContract.set(prevCol.contract, {
                contract: prevCol.contract,
                name: prevCol.name,
                symbol: prevCol.symbol,
                slug: prevCol.slug,
                rows: [...prevRows],
              });
            }
            preserved += prevRows.length;
          }
          if (preserved > 0) {
            console.log(
              `[motz-snapshot] preserved ${preserved} previous rows for ${addr.slice(0, 12)}...`,
            );
          }
          return preserved;
        }
        // 1) Partial wallets — resolved but loaded 0 tokens with warnings.
        for (const p of partials) {
          if ((p.tokens ?? 0) > 0) continue;
          // partials carry the INPUT (RNS or hex), not the resolved addr.
          // The previous snapshot tags rows by resolved address, so find
          // any resolved addr from the previous run that matches by
          // walletAddresses[i] === p.input.
          const inputLc = p.input.toLowerCase();
          const prevIdx = previous.walletAddresses.findIndex(
            (w) => w.toLowerCase() === inputLc,
          );
          const prevResolved =
            prevIdx >= 0 ? previous.resolvedAddresses[prevIdx] : null;
          if (prevResolved && !freshRowsByTag.get(prevResolved)) {
            preservePreviousFor(prevResolved);
            if (!resolved.includes(prevResolved)) resolved.push(prevResolved);
          }
        }
        // 2) Failed wallets — never even made it into `resolved`. Same
        // lookup as above: map the failure input back to the resolved
        // address from the previous snapshot, then splice in those rows.
        for (const f of failures) {
          const inputLc = f.input.toLowerCase();
          const prevIdx = previous.walletAddresses.findIndex(
            (w) => w.toLowerCase() === inputLc,
          );
          const prevResolved =
            prevIdx >= 0 ? previous.resolvedAddresses[prevIdx] : null;
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
