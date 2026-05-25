import { NextRequest, NextResponse } from "next/server";
import { TRACKED_COLLECTIONS, TrackedCollection } from "@/lib/contracts";
import { looksLikeRnsName, resolveRnsName } from "@/lib/rns";
import {
  HoldingToken,
  listHoldings,
  lastAcquisition,
  weiToRon,
  blockTimestampForTx,
  floorPriceForTrait,
  userAcquisitionsFor,
  ownerOf,
  tokenMetadata,
  userStakingDepositsFor,
} from "@/lib/marketplace";
import { ronUsdAt, ronUsdNow } from "@/lib/coingecko";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export type HoldingRow = {
  tokenId: string;
  name?: string | null;
  image?: string | null;
  acquiredAt: number | null;
  acquiredTxHash: string | null;
  acquiredVia: "sale" | "mint" | "transfer" | null;
  rarity: string | null;
  /** Display-formatted rarity (e.g. "Tier 1" for Cambria). */
  rarityLabel: string | null;
  costRon: number | null;
  ronUsdAtPurchase: number | null;
  costUsd: number | null;
  currentRonUsd: number | null;
  floorRon: number | null;
  floorUsd: number | null;
  pnlUsd: number | null;
};

export type CollectionHoldings = {
  contract: string;
  name: string;
  symbol: string;
  slug: string;
  rows: HoldingRow[];
};

async function resolveInput(
  input: string,
): Promise<{ address: string; resolvedFrom: string | null } | { error: string; status: number }> {
  if (looksLikeRnsName(input)) {
    const resolved = await resolveRnsName(input);
    if (!resolved) {
      return {
        error: `Could not resolve ${input} to a Ronin address`,
        status: 404,
      };
    }
    return { address: resolved, resolvedFrom: input };
  }
  if (/^0x[a-fA-F0-9]{40}$/.test(input)) {
    return { address: input, resolvedFrom: null };
  }
  return { error: "Address must be 0x… or a .ron name", status: 400 };
}

export async function GET(req: NextRequest) {
  const input = req.nextUrl.searchParams.get("address")?.trim();
  if (!input) {
    return NextResponse.json({ error: "Missing ?address" }, { status: 400 });
  }
  const resolvedAddr = await resolveInput(input);
  if ("error" in resolvedAddr) {
    return NextResponse.json(
      { error: resolvedAddr.error },
      { status: resolvedAddr.status },
    );
  }
  const { address, resolvedFrom } = resolvedAddr;

  // Optional transferrer wallets: ANY number of upstream wallets that may
  // have originally minted/bought tokens before transferring them to the
  // searched address. When set, rows that would otherwise be "transferred"
  // get upgraded to the first transferrer with a mint/sale record for that
  // tokenId. Accept comma-separated or repeated `?transferrer=` params.
  const rawTransferrers = req.nextUrl.searchParams
    .getAll("transferrer")
    .flatMap((s) => s.split(","))
    .map((s) => s.trim())
    .filter(Boolean);
  const transferrers: string[] = [];
  for (const t of rawTransferrers) {
    const r = await resolveInput(t);
    if ("error" in r) {
      return NextResponse.json(
        { error: `Transferrer ${t}: ${r.error}` },
        { status: r.status },
      );
    }
    const addr = r.address.toLowerCase();
    if (!transferrers.includes(addr)) transferrers.push(addr);
  }

  try {
    // Holdings + current RON price up front, in parallel across all collections.
    const [currentRonUsd, ...tokensPerCollection] = await Promise.all([
      ronUsdNow(),
      ...TRACKED_COLLECTIONS.map((c) => listHoldings(address, c.address)),
    ]);

    // Per-token marketplace acquisition lookup (fast path).
    const marketAcqsPerCollection = await Promise.all(
      tokensPerCollection.map((tokens, ci) =>
        Promise.all(
          tokens.map((t) =>
            lastAcquisition(TRACKED_COLLECTIONS[ci].address, t.tokenId),
          ),
        ),
      ),
    );

    // Walk userActivities for Mint+Sale (cost-basis) AND Transfer-to-staking
    // (staking detection) IN PARALLEL — they hit the same endpoint with
    // different filters, no reason to do them serially.
    const sinceTs = Math.min(
      ...TRACKED_COLLECTIONS.map(
        (c) =>
          Math.floor(Date.parse(`${c.mintDate}T00:00:00Z`) / 1000) - 30 * 86400,
      ),
    );
    // Map: nft contract (lc) → Set of staking contract addresses (lc).
    const stakingByContract = new Map<string, Set<string>>();
    for (const c of TRACKED_COLLECTIONS) {
      if (c.stakingContracts && c.stakingContracts.length > 0) {
        stakingByContract.set(
          c.address.toLowerCase(),
          new Set(c.stakingContracts.map((s) => s.toLowerCase())),
        );
      }
    }
    const [userAcqs, stakingDeposits, transferrerAcqs] = await Promise.all([
      userAcquisitionsFor(
        address,
        TRACKED_COLLECTIONS.map((c) => c.address),
        sinceTs,
        200,
      ),
      stakingByContract.size > 0
        ? userStakingDepositsFor(address, stakingByContract, sinceTs, 200)
        : Promise.resolve(new Map()),
      // For each transferrer wallet, walk THEIR Mint+Sale activity so we can
      // upgrade transferred rows. Merge them — first match wins per tokenId.
      transferrers.length > 0
        ? Promise.all(
            transferrers.map((t) =>
              userAcquisitionsFor(
                t,
                TRACKED_COLLECTIONS.map((c) => c.address),
                sinceTs,
                200,
              ),
            ),
          ).then((maps) => {
            const merged: Awaited<
              ReturnType<typeof userAcquisitionsFor>
            > = new Map();
            for (const m of maps) {
              for (const [k, v] of m) {
                if (!merged.has(k)) merged.set(k, v);
              }
            }
            return merged;
          })
        : Promise.resolve(
            new Map() as Awaited<ReturnType<typeof userAcquisitionsFor>>,
          ),
    ]);

    // For each detected staking deposit, verify the staking contract STILL
    // holds the token (user may have since unstaked + sold/transferred).
    type StakedToken = { contract: string; tokenId: string };
    // ownerOf throws on persistent failure — we let that bubble up so the
    // user sees an error instead of a silently-incomplete portfolio.
    const stakedChecks = await Promise.all(
      Array.from(stakingDeposits.values()).map(async (d) => ({
        d,
        currentOwner: await ownerOf(d.contract, d.tokenId),
      })),
    );
    const stakedByContract = new Map<string, StakedToken[]>();
    for (const { d, currentOwner } of stakedChecks) {
      const expected = stakingByContract.get(d.contract);
      if (!expected || !expected.has(currentOwner.toLowerCase())) continue;
      const arr = stakedByContract.get(d.contract) ?? [];
      arr.push({ contract: d.contract, tokenId: d.tokenId });
      stakedByContract.set(d.contract, arr);
    }

    // For each staked token, fetch its metadata AND the marketplace's last
    // acquisition record (so we can correctly classify bought-then-staked
    // tokens with the real sale price even when userActivities didn't reach
    // back far enough). Done in parallel.
    const stakedMetadata = new Map<string, HoldingToken>();
    const stakedMarketAcq = new Map<
      string,
      Awaited<ReturnType<typeof lastAcquisition>>
    >();
    const allStaked = Array.from(stakedByContract.values()).flat();
    await Promise.all(
      allStaked.flatMap((s) => {
        const key = `${s.contract}:${s.tokenId}`;
        return [
          tokenMetadata(s.contract, s.tokenId).then((meta) => {
            if (meta) stakedMetadata.set(key, meta);
          }),
          lastAcquisition(s.contract, s.tokenId).then((acq) => {
            if (acq) stakedMarketAcq.set(key, acq);
          }),
        ];
      }),
    );

    // Rarity floor lookup, parallel per collection × distinct trait value.
    // Include staked tokens' rarities so their floor is filled too.
    const floorByCollectionAndTrait = new Map<string, Map<string, number | null>>();
    await Promise.all(
      TRACKED_COLLECTIONS.map(async (c, ci) => {
        const contractLc = c.address.toLowerCase();
        const ownedTraits = tokensPerCollection[ci].map(
          (t) => t.attributes?.[c.traitName]?.[0],
        );
        const stakedTraits = (stakedByContract.get(contractLc) ?? []).map(
          (s) =>
            stakedMetadata.get(`${contractLc}:${s.tokenId}`)?.attributes?.[
              c.traitName
            ]?.[0],
        );
        const distinct = Array.from(
          new Set(
            [...ownedTraits, ...stakedTraits].filter(
              (v): v is string => !!v,
            ),
          ),
        );
        const m = new Map<string, number | null>();
        await Promise.all(
          distinct.map(async (v) => {
            m.set(v, await floorPriceForTrait(c.address, c.traitName, v));
          }),
        );
        floorByCollectionAndTrait.set(contractLc, m);
      }),
    );

    // Lowercase set of transferrer addresses for bundle-buy fallback detection.
    const transferrerAddrs = new Set(transferrers.map((t) => t.toLowerCase()));

    const collections: CollectionHoldings[] = await Promise.all(
      TRACKED_COLLECTIONS.map(async (c, ci) => {
        const contractLc = c.address.toLowerCase();
        const stakedHere = stakedByContract.get(contractLc) ?? [];
        const stakedTokens: HoldingToken[] = stakedHere
          .map(
            (s) =>
              stakedMetadata.get(`${contractLc}:${s.tokenId}`) ?? {
                tokenId: s.tokenId,
                tokenAddress: contractLc,
                name: null,
                image: null,
                cdnImage: null,
                attributes: null,
              },
          );
        return buildCollectionHoldings(
          c,
          tokensPerCollection[ci],
          marketAcqsPerCollection[ci],
          userAcqs,
          floorByCollectionAndTrait.get(contractLc) ?? new Map(),
          address,
          currentRonUsd,
          stakedTokens,
          stakedMarketAcq,
          transferrerAcqs,
          transferrerAddrs,
        );
      }),
    );

    return NextResponse.json({
      address,
      resolvedFrom,
      transferrers,
      currentRonUsd,
      collections,
    });
  } catch (err) {
    console.error("[/api/holdings]", err);
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 },
    );
  }
}

async function buildCollectionHoldings(
  c: TrackedCollection,
  tokens: HoldingToken[],
  marketAcqs: Awaited<ReturnType<typeof lastAcquisition>>[],
  userAcqs: Map<
    string,
    {
      source: "mint" | "sale";
      contract: string;
      tokenId: string;
      timestamp: number;
      txHash: string | null;
    }
  >,
  floorByTrait: Map<string, number | null>,
  address: string,
  currentRonUsd: number | null,
  stakedTokens: HoldingToken[] = [],
  stakedMarketAcq: Map<
    string,
    Awaited<ReturnType<typeof lastAcquisition>>
  > = new Map(),
  /** Optional transferrer's userActivities — used to upgrade "transfer" rows. */
  transferrerAcqs: Map<
    string,
    {
      source: "mint" | "sale";
      contract: string;
      tokenId: string;
      timestamp: number;
      txHash: string | null;
    }
  > = new Map(),
  /**
   * Lowercase set of transferrer wallet addresses. Used to detect bundle-buy
   * sales that don't appear in userActivities: if the token's last marketplace
   * event was a SALE and the buyer is one of these addresses, treat it as a
   * transferrer "sale" and use the recorded price as the cost basis.
   */
  transferrerAddrs: Set<string> = new Set(),
): Promise<CollectionHoldings> {
  const mintTs = Math.floor(Date.parse(`${c.mintDate}T00:00:00Z`) / 1000);
  const contractLc = c.address.toLowerCase();

  // Resolve the marketplace sale event for a tokenId that the TRANSFERRER once
  // bought. This gives us the actual sale price (priceWei + paymentToken).
  async function transferrerSalePrice(tokenId: string) {
    const acq = await lastAcquisition(contractLc, tokenId);
    if (!acq) return null;
    return acq;
  }

  const rows: HoldingRow[] = await Promise.all(
    tokens.map(async (t, i): Promise<HoldingRow> => {
      const acq = marketAcqs[i];
      const userAcq = userAcqs.get(`${contractLc}:${t.tokenId}`);
      const userIsRecipient =
        !!acq && acq.buyer?.toLowerCase() === address.toLowerCase();
      // Classification priority:
      //  1. Most recent marketplace event was a sale/mint TO this user → use it.
      //  2. userActivities has a Mint/Sale for this token → use it.
      //     (Catches "bought → sent away → received back" — the most recent
      //     marketplace event is a plain transfer, but the user's activity log
      //     still has the original purchase.)
      //  3. Fall back to "transfer" ($0 cost).
      let via: "sale" | "mint" | "transfer" | null =
        acq && userIsRecipient && acq.source !== "transfer"
          ? acq.source
          : userAcq
            ? userAcq.source
            : acq && !userIsRecipient
              ? "transfer"
              : "transfer";

      // Transferrer upgrade: if this row would be "transfer" but the transferrer
      // wallet has a Mint or Sale acquisition for this tokenId, use THAT as the
      // effective acquisition (the searched wallet received it from someone who
      // originally minted/bought it, so the real cost basis lives there).
      //
      // Two sources checked in order:
      //  1. transferrerAcqs (from userActivities Mint/Sale events) — works for
      //     normal marketplace transactions.
      //  2. acq.buyer check — catches bundle-buy sales that don't appear in
      //     userActivities: the token's transferHistory shows the buyer, and if
      //     it's a transferrer wallet we can use that sale price directly.
      const transferrerAcq =
        via === "transfer"
          ? transferrerAcqs.get(`${contractLc}:${t.tokenId}`)
          : undefined;

      // Bundle-buy fallback: the token's last marketplace event was a SALE and
      // the buyer is one of the transferrer wallets (not in userActivities).
      const acqBuyerIsTransferrer =
        via === "transfer" &&
        !transferrerAcq &&
        acq?.source === "sale" &&
        transferrerAddrs.has(acq.buyer?.toLowerCase() ?? "");

      let transferrerSale: Awaited<ReturnType<typeof lastAcquisition>> | null =
        null;
      if (transferrerAcq?.source === "sale") {
        transferrerSale = await transferrerSalePrice(t.tokenId);
      }
      if (transferrerAcq) {
        via = transferrerAcq.source;
      } else if (acqBuyerIsTransferrer) {
        // acq IS the transferrer's purchase — promote to "sale" and use it.
        via = "sale";
        transferrerSale = acq;
      }

      // Whether the "sale" classification came from the direct marketplace record
      // (acq) vs. the user's activity log (userAcq). In the latter case acq has
      // no price (its most recent event is a plain transfer), so we cannot use
      // acq.priceWei for cost — cost falls back to null (displayed as "—").
      const saleFromDirectAcq =
        via === "sale" &&
        acq &&
        acq.source === "sale" &&
        userIsRecipient &&
        !acqBuyerIsTransferrer;

      const costRon =
        saleFromDirectAcq
          ? weiToRon(acq!.priceWei)
          : via === "sale" && transferrerSale
            ? weiToRon(transferrerSale.priceWei)
            : via === "mint"
              ? c.mintPriceRon
              : via === "transfer"
                ? 0
                : null; // "sale" via userAcq only — price unknown, show "—"

      const relevantTxHash =
        via === "transfer"
          ? null
          : (userAcq?.txHash ??
              transferrerAcq?.txHash ??
              transferrerSale?.txHash ??
              acq?.txHash ??
              null);
      let acqTs =
        via === "transfer"
          ? 0
          : userAcq?.timestamp ||
            transferrerAcq?.timestamp ||
            transferrerSale?.timestamp ||
            acq?.timestamp ||
            0;
      if (relevantTxHash && !acqTs) {
        acqTs = (await blockTimestampForTx(relevantTxHash)) || 0;
      }
      if (!acqTs && via === "mint") acqTs = mintTs;

      const ronUsdAtPurchase = acqTs ? await ronUsdAt(acqTs) : null;
      const costUsd =
        via === "transfer"
          ? 0
          : costRon != null && ronUsdAtPurchase != null
            ? costRon * ronUsdAtPurchase
            : null;

      const rarity = t.attributes?.[c.traitName]?.[0] ?? null;
      const rarityLabel = rarity
        ? (c.formatTrait?.(rarity) ?? rarity)
        : null;
      const floorRon = rarity ? (floorByTrait.get(rarity) ?? null) : null;
      const floorUsd =
        floorRon != null && currentRonUsd != null
          ? floorRon * currentRonUsd
          : null;
      const pnlUsd =
        costUsd != null && floorUsd != null ? floorUsd - costUsd : null;

      return {
        tokenId: t.tokenId,
        name: t.name ?? null,
        image: t.cdnImage ?? t.image ?? null,
        acquiredAt: acqTs || null,
        acquiredTxHash: relevantTxHash,
        acquiredVia: via,
        rarity,
        rarityLabel,
        costRon,
        ronUsdAtPurchase,
        costUsd,
        currentRonUsd,
        floorRon,
        floorUsd,
        pnlUsd,
      };
    }),
  );

  // Staked rows: tokens the user originally acquired and that are now held
  // by the staking contract. Classify by the user's original acquisition
  // (mint / sale / transfer — never "staked"), and apply the rarity floor.
  const stakedRows: HoldingRow[] = await Promise.all(
    stakedTokens.map(async (t): Promise<HoldingRow> => {
      const key = `${contractLc}:${t.tokenId}`;
      const userAcq = userAcqs.get(key);
      const marketAcq = stakedMarketAcq.get(key);
      // The marketplace's transferHistory tells us the token's most recent
      // marketplace event (sale or mint). If it's a sale to our address, the
      // user bought it. Otherwise fall back to userAcq, then to "mint" as
      // last resort.
      const marketSaleByUser =
        !!marketAcq &&
        marketAcq.source === "sale" &&
        marketAcq.buyer?.toLowerCase() === address.toLowerCase();
      const marketMintByUser =
        !!marketAcq &&
        marketAcq.source === "mint" &&
        marketAcq.buyer?.toLowerCase() === address.toLowerCase();
      // Classification priority: positive evidence wins. When NOTHING confirms
      // the user minted or bought the token, default to "transfer" ($0 cost)
      // — never silently assume mint. Order of preference for evidence:
      //   1. marketplace shows sale to user           → "sale"
      //   2. marketplace shows mint to user           → "mint"
      //   3. userActivities recorded a sale for them  → "sale" (price unknown)
      //   4. userActivities recorded a mint for them  → "mint"
      //   5. nothing                                  → "transfer" ($0 cost)
      // Try the transferrer as a final source before defaulting to "transfer".
      const transferrerAcq = transferrerAcqs.get(key);
      // Bundle-buy fallback: if the token's last marketplace event was a SALE
      // to a transferrer wallet (bundle buys don't appear in userActivities),
      // treat it as a transferrer sale.
      const stakedAcqBuyerIsTransferrer =
        !marketSaleByUser &&
        !marketMintByUser &&
        !userAcq &&
        !transferrerAcq &&
        marketAcq?.source === "sale" &&
        transferrerAddrs.has(marketAcq.buyer?.toLowerCase() ?? "");
      const via: "sale" | "mint" | "transfer" = marketSaleByUser
        ? "sale"
        : marketMintByUser
          ? "mint"
          : userAcq?.source === "sale"
            ? "sale"
            : userAcq?.source === "mint"
              ? "mint"
              : transferrerAcq?.source === "sale"
                ? "sale"
                : transferrerAcq?.source === "mint"
                  ? "mint"
                  : stakedAcqBuyerIsTransferrer
                    ? "sale"
                    : "transfer";

      // Timestamp + tx hash: prefer marketplace's record (has exact sale tx),
      // then user activity. For "transfer" rows we have no source event.
      const acqTxHash =
        via === "transfer"
          ? null
          : ((marketSaleByUser || marketMintByUser || stakedAcqBuyerIsTransferrer
              ? marketAcq?.txHash
              : userAcq?.txHash) ??
              transferrerAcq?.txHash ??
              null);
      let acqTs =
        via === "transfer"
          ? 0
          : (marketSaleByUser || marketMintByUser || stakedAcqBuyerIsTransferrer
              ? marketAcq?.timestamp
              : userAcq?.timestamp) ||
            transferrerAcq?.timestamp ||
            0;
      if (acqTxHash && !acqTs) {
        acqTs = (await blockTimestampForTx(acqTxHash)) || 0;
      }
      if (!acqTs && via === "mint") acqTs = mintTs;
      const ronUsdAtPurchase = acqTs ? await ronUsdAt(acqTs) : null;

      // For transferrer-sourced "sale" rows, the marketplace's last sale on
      // this token IS the transferrer's purchase (both userActivities and
      // bundle-buy paths). Use the recorded price.
      const transferrerSaleAcq =
        via === "sale" && !marketSaleByUser &&
          (transferrerAcq?.source === "sale" || stakedAcqBuyerIsTransferrer)
          ? marketAcq
          : null;

      const costRon =
        via === "sale" && marketSaleByUser && marketAcq
          ? weiToRon(marketAcq.priceWei)
          : transferrerSaleAcq
            ? weiToRon(transferrerSaleAcq.priceWei)
            : via === "mint"
              ? c.mintPriceRon
              : via === "transfer"
                ? 0
                : null;
      const costUsd =
        via === "transfer"
          ? 0
          : costRon != null && ronUsdAtPurchase != null
            ? costRon * ronUsdAtPurchase
            : null;
      const rarity = t.attributes?.[c.traitName]?.[0] ?? null;
      const rarityLabel = rarity ? (c.formatTrait?.(rarity) ?? rarity) : null;
      const floorRon = rarity ? (floorByTrait.get(rarity) ?? null) : null;
      const floorUsd =
        floorRon != null && currentRonUsd != null
          ? floorRon * currentRonUsd
          : null;
      const pnlUsd =
        costUsd != null && floorUsd != null ? floorUsd - costUsd : null;
      return {
        tokenId: t.tokenId,
        name: t.name ?? null,
        image: t.cdnImage ?? t.image ?? null,
        acquiredAt: acqTs || null,
        acquiredTxHash: acqTxHash,
        acquiredVia: via,
        rarity,
        rarityLabel,
        costRon,
        ronUsdAtPurchase,
        costUsd,
        currentRonUsd,
        floorRon,
        floorUsd,
        pnlUsd,
      };
    }),
  );

  return {
    contract: c.address,
    name: c.name,
    symbol: c.symbol,
    slug: c.slug,
    rows: [...rows, ...stakedRows],
  };
}
