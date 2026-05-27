import "server-only";
import fs from "node:fs";
import path from "node:path";

/**
 * Minimal OpenSea API v2 client for Ethereum-side tracked collections.
 * Mirrors the disk-caching + rate-limiting patterns used by `marketplace.ts`
 * but targets OpenSea's REST endpoints. All call sites assume the caller
 * has set OPENSEA_API_KEY in .env.local (Vercel env in production).
 *
 * Docs: https://docs.opensea.io/reference/api-overview
 */

const BASE = "https://api.opensea.io/api/v2";

function osHeaders(): HeadersInit {
  const key = process.env.OPENSEA_API_KEY?.trim();
  const h: Record<string, string> = { accept: "application/json" };
  if (key) h["x-api-key"] = key;
  return h;
}

// Free Developer tier allows ~4 req/sec. We pace at 3 to leave headroom.
const MIN_INTERVAL_MS = 350;
let lastReleaseAt = 0;
const waiters: Array<() => void> = [];
let pumping = false;

async function acquire(): Promise<void> {
  if (waiters.length === 0 && Date.now() - lastReleaseAt >= MIN_INTERVAL_MS) {
    lastReleaseAt = Date.now();
    return;
  }
  await new Promise<void>((resolve) => {
    waiters.push(resolve);
    pump();
  });
}

function pump(): void {
  if (pumping) return;
  pumping = true;
  const tick = (): void => {
    const next = waiters.shift();
    if (!next) {
      pumping = false;
      return;
    }
    const wait = Math.max(0, MIN_INTERVAL_MS - (Date.now() - lastReleaseAt));
    setTimeout(() => {
      lastReleaseAt = Date.now();
      next();
      tick();
    }, wait);
  };
  tick();
}

async function osFetch<T>(pathRel: string): Promise<T> {
  const MAX = 6;
  let lastErr: unknown;
  for (let i = 0; i < MAX; i++) {
    await acquire();
    try {
      const res = await fetch(`${BASE}${pathRel}`, {
        headers: osHeaders(),
        cache: "no-store",
      });
      if (res.status === 429 || res.status >= 500) {
        if (i < MAX - 1) {
          const delay = Math.min(16000, 1000 * 2 ** i) + Math.random() * 500;
          await new Promise((r) => setTimeout(r, delay));
          continue;
        }
        throw new Error(`OpenSea ${res.status} after ${MAX} attempts: ${pathRel}`);
      }
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`OpenSea ${res.status} ${pathRel}: ${text.slice(0, 200)}`);
      }
      return (await res.json()) as T;
    } catch (err) {
      lastErr = err;
      const retryable =
        (err as { code?: string })?.code === "ECONNRESET" ||
        (err as Error)?.message?.includes("fetch failed");
      if (!retryable || i === MAX - 1) throw err;
      await new Promise((r) => setTimeout(r, 500 * 2 ** i));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type OpenSeaNft = {
  tokenId: string;
  name: string | null;
  imageUrl: string | null;
  attributes: Record<string, string[]>;
};

export type OpenSeaSale = {
  eventTimestamp: number;
  priceWei: string;
  txHash: string | null;
  toAddress: string | null;
};

// ---------------------------------------------------------------------------
// Endpoints
// ---------------------------------------------------------------------------

/**
 * NFTs held by a wallet within a specific collection.
 * GET /api/v2/chain/ethereum/account/{address}/nfts?collection={slug}
 */
export async function listHoldingsEth(
  address: string,
  collectionSlug: string,
): Promise<OpenSeaNft[]> {
  const out: OpenSeaNft[] = [];
  let next: string | undefined;
  for (let page = 0; page < 50; page++) {
    const qs = new URLSearchParams({
      collection: collectionSlug,
      limit: "200",
    });
    if (next) qs.set("next", next);
    type Res = {
      nfts: Array<{
        identifier: string;
        name: string | null;
        image_url: string | null;
        traits?: Array<{ trait_type: string; value: string }>;
      }>;
      next?: string;
    };
    const data = await osFetch<Res>(
      `/chain/ethereum/account/${address}/nfts?${qs.toString()}`,
    );
    for (const n of data.nfts ?? []) {
      const attributes: Record<string, string[]> = {};
      for (const t of n.traits ?? []) {
        const k = t.trait_type;
        attributes[k] = attributes[k] ?? [];
        attributes[k].push(t.value);
      }
      out.push({
        tokenId: n.identifier,
        name: n.name,
        imageUrl: n.image_url,
        attributes,
      });
    }
    if (!data.next) break;
    next = data.next;
  }
  return out;
}

/**
 * Last sale event for a single token.
 * GET /api/v2/events/chain/ethereum/contract/{address}/nfts/{tokenId}?event_type=sale
 */
const lastSaleCache = new Map<string, OpenSeaSale | null>();

export async function lastSaleEth(
  contract: string,
  tokenId: string,
): Promise<OpenSeaSale | null> {
  const key = `${contract.toLowerCase()}:${tokenId}`;
  if (lastSaleCache.has(key)) return lastSaleCache.get(key)!;
  type Res = {
    asset_events?: Array<{
      event_timestamp: number;
      payment?: { quantity: string };
      transaction?: string;
      to_address?: string;
    }>;
  };
  try {
    const data = await osFetch<Res>(
      `/events/chain/ethereum/contract/${contract.toLowerCase()}/nfts/${tokenId}?event_type=sale&limit=1`,
    );
    const ev = data.asset_events?.[0];
    if (!ev) {
      lastSaleCache.set(key, null);
      return null;
    }
    const sale: OpenSeaSale = {
      eventTimestamp: ev.event_timestamp,
      priceWei: ev.payment?.quantity ?? "0",
      txHash: ev.transaction ?? null,
      toAddress: ev.to_address ?? null,
    };
    lastSaleCache.set(key, sale);
    return sale;
  } catch (err) {
    console.warn(
      `[opensea] lastSaleEth ${contract}/${tokenId} failed:`,
      (err as Error).message,
    );
    return null;
  }
}

/**
 * Full sale history for a token (most-recent first, up to `limit`).
 * Used for transferrer-aware cost basis: find the most recent sale where
 * the BUYER is one of our tracked MoTZ wallets. That sale's price is the
 * cost basis for whichever MoTZ wallet currently holds the token, even
 * if it was later transferred between wallets without an on-chain sale.
 */
const saleHistoryCache = new Map<string, OpenSeaSale[]>();

export async function saleHistoryEth(
  contract: string,
  tokenId: string,
  limit = 20,
): Promise<OpenSeaSale[]> {
  const key = `${contract.toLowerCase()}:${tokenId}`;
  if (saleHistoryCache.has(key)) return saleHistoryCache.get(key)!;
  type Res = {
    asset_events?: Array<{
      event_timestamp: number;
      payment?: { quantity: string };
      transaction?: string;
      to_address?: string;
    }>;
  };
  try {
    const data = await osFetch<Res>(
      `/events/chain/ethereum/contract/${contract.toLowerCase()}/nfts/${tokenId}?event_type=sale&limit=${limit}`,
    );
    const sales: OpenSeaSale[] = (data.asset_events ?? []).map((ev) => ({
      eventTimestamp: ev.event_timestamp,
      priceWei: ev.payment?.quantity ?? "0",
      txHash: ev.transaction ?? null,
      toAddress: ev.to_address?.toLowerCase() ?? null,
    }));
    saleHistoryCache.set(key, sales);
    return sales;
  } catch (err) {
    console.warn(
      `[opensea] saleHistoryEth ${contract}/${tokenId} failed:`,
      (err as Error).message,
    );
    return [];
  }
}

/**
 * Collection-wide floor price in ETH.
 * GET /api/v2/collections/{slug}/stats
 */
const floorCache = new Map<string, { price: number | null; at: number }>();
const FLOOR_TTL_MS = 15 * 60 * 1000;

export async function collectionFloorEth(
  slug: string,
): Promise<number | null> {
  const cached = floorCache.get(slug);
  if (cached && Date.now() - cached.at < FLOOR_TTL_MS) return cached.price;
  type Res = {
    total?: { floor_price?: number | null };
  };
  try {
    const data = await osFetch<Res>(`/collections/${slug}/stats`);
    const price = data.total?.floor_price ?? null;
    floorCache.set(slug, { price, at: Date.now() });
    return price;
  } catch (err) {
    console.warn(
      `[opensea] floor ${slug} failed:`,
      (err as Error).message,
    );
    return null;
  }
}

/**
 * Most recent SALE price for a given tier. Used as a fallback when a tier
 * has no active listings (most listing walks miss the rarest tiers). The
 * scan walks newest-first collection sales, fetches each token's traits,
 * and returns the first one matching the target tier value.
 *
 * Result cached for FLOOR_TTL_MS. Returns null if no sale found within
 * `maxScanned` events.
 */
const lastTierSaleCache = new Map<
  string,
  { priceEth: number | null; at: number }
>();

export async function lastTierSaleEth(
  slug: string,
  contract: string,
  traitName: string,
  tier: string,
  maxScanned = 100,
): Promise<number | null> {
  const cacheKey = `${slug}|${traitName}|${tier}`;
  const cached = lastTierSaleCache.get(cacheKey);
  if (cached && Date.now() - cached.at < FLOOR_TTL_MS) return cached.priceEth;

  type Ev = {
    event_timestamp: number;
    payment?: { quantity: string };
    nft?: { identifier?: string };
  };
  type Res = { asset_events?: Ev[]; next?: string };
  type NftRes = {
    nft?: { traits?: Array<{ trait_type?: string; value?: string }> };
  };

  let next: string | undefined;
  let scanned = 0;
  let foundPrice: number | null = null;
  outer: for (let page = 0; page < 10; page++) {
    const qs = new URLSearchParams({
      event_type: "sale",
      limit: "50",
    });
    if (next) qs.set("next", next);
    let data: Res;
    try {
      data = await osFetch<Res>(
        `/events/collection/${slug}?${qs.toString()}`,
      );
    } catch (err) {
      console.warn(
        `[opensea] lastTierSaleEth page ${page} failed:`,
        (err as Error).message,
      );
      break;
    }
    for (const ev of data.asset_events ?? []) {
      const tokenId = ev.nft?.identifier;
      const wei = ev.payment?.quantity;
      if (!tokenId || !wei) continue;
      try {
        const detail = await osFetch<NftRes>(
          `/chain/ethereum/contract/${contract.toLowerCase()}/nfts/${tokenId}`,
        );
        const t = detail.nft?.traits?.find(
          (x) => x.trait_type === traitName,
        )?.value;
        if (t === tier) {
          foundPrice = Number(BigInt(wei)) / 1e18;
          break outer;
        }
      } catch (err) {
        console.warn(
          `[opensea] lastTierSaleEth trait #${tokenId} failed:`,
          (err as Error).message,
        );
      }
      scanned++;
      if (scanned >= maxScanned) break outer;
    }
    if (!data.next) break;
    next = data.next;
  }

  lastTierSaleCache.set(cacheKey, { priceEth: foundPrice, at: Date.now() });
  return foundPrice;
}

/**
 * Per-tier floor discovery. OpenSea's /listings/.../best endpoint doesn't
 * accept trait filters, so we paginate through cheapest-first listings,
 * fetch each token's traits via /chain/.../nfts/{tokenId}, and bucket the
 * minimum price per tier value. Stops early once we've priced `expectedTiers`
 * distinct tiers or scanned `maxListings` records.
 *
 * Result is keyed by the exact attribute value (e.g. "Cove (T1)").
 * Cached for FLOOR_TTL_MS to keep API volume reasonable.
 */
const tierFloorCache = new Map<
  string,
  { byTier: Record<string, number>; at: number }
>();

export async function tierFloorsEth(
  slug: string,
  contract: string,
  traitName: string,
  options: { maxListings?: number; expectedTiers?: number } = {},
): Promise<Record<string, number>> {
  const cacheKey = `${slug}|${traitName}`;
  const cached = tierFloorCache.get(cacheKey);
  if (cached && Date.now() - cached.at < FLOOR_TTL_MS) return cached.byTier;

  const { maxListings = 200, expectedTiers = 5 } = options;
  const byTier: Record<string, number> = {};
  type ListRes = {
    listings?: Array<{
      price?: { current?: { value?: string } };
      protocol_data?: {
        parameters?: { offer?: Array<{ identifierOrCriteria?: string }> };
      };
    }>;
    next?: string;
  };
  type NftRes = {
    nft?: { traits?: Array<{ trait_type?: string; value?: string }> };
  };

  let next: string | undefined;
  let scanned = 0;
  outer: for (let page = 0; page < 10; page++) {
    const qs = new URLSearchParams({ limit: "50" });
    if (next) qs.set("next", next);
    let data: ListRes;
    try {
      data = await osFetch<ListRes>(
        `/listings/collection/${slug}/best?${qs.toString()}`,
      );
    } catch (err) {
      console.warn(
        `[opensea] tierFloorsEth page ${page} failed:`,
        (err as Error).message,
      );
      break;
    }
    for (const l of data.listings ?? []) {
      const tokenId =
        l.protocol_data?.parameters?.offer?.[0]?.identifierOrCriteria;
      const wei = l.price?.current?.value;
      if (!tokenId || !wei) continue;
      const priceEth = Number(BigInt(wei)) / 1e18;
      try {
        const detail = await osFetch<NftRes>(
          `/chain/ethereum/contract/${contract.toLowerCase()}/nfts/${tokenId}`,
        );
        const tier = detail.nft?.traits?.find(
          (t) => t.trait_type === traitName,
        )?.value;
        if (!tier) continue;
        if (!(tier in byTier) || priceEth < byTier[tier]) {
          byTier[tier] = priceEth;
        }
      } catch (err) {
        console.warn(
          `[opensea] tierFloorsEth trait #${tokenId} failed:`,
          (err as Error).message,
        );
      }
      scanned++;
      if (scanned >= maxListings) break outer;
      if (Object.keys(byTier).length >= expectedTiers) break outer;
    }
    if (!data.next) break;
    next = data.next;
  }

  tierFloorCache.set(cacheKey, { byTier, at: Date.now() });
  return byTier;
}

// ---------------------------------------------------------------------------
// Disk persistence — last-sale cache survives server restarts.
// ---------------------------------------------------------------------------

const SALE_CACHE_PATH = path.join(
  process.cwd(),
  "data",
  "opensea-sales.json",
);

function seedSalesFromDisk(): void {
  try {
    if (!fs.existsSync(SALE_CACHE_PATH)) return;
    const raw = fs.readFileSync(SALE_CACHE_PATH, "utf8");
    const obj = JSON.parse(raw) as Record<string, OpenSeaSale | null>;
    for (const [k, v] of Object.entries(obj)) lastSaleCache.set(k, v);
  } catch {
    // silent
  }
}
seedSalesFromDisk();

let persistTimer: NodeJS.Timeout | null = null;
export function persistSalesSoon(): void {
  if (persistTimer) return;
  persistTimer = setTimeout(() => {
    persistTimer = null;
    try {
      fs.mkdirSync(path.dirname(SALE_CACHE_PATH), { recursive: true });
      const obj: Record<string, OpenSeaSale | null> = {};
      for (const [k, v] of lastSaleCache) obj[k] = v;
      fs.writeFileSync(SALE_CACHE_PATH, JSON.stringify(obj));
    } catch {
      // read-only fs on Vercel — silently skip.
    }
  }, 2000);
}
