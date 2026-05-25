import "server-only";
import dns from "node:dns";
import fs from "node:fs";
import path from "node:path";

// Some Windows + Node 24 setups (this one included) get ECONNRESET when the
// AAAA record is preferred. Force IPv4 lookups first for outbound fetches.
dns.setDefaultResultOrder("ipv4first");

// Public marketplace endpoint. Override via env if/when you want to use the
// authenticated API gateway (https://api-gateway.skymavis.com/graphql/marketplace)
// — that one requires X-API-Key.
const ENDPOINT =
  process.env.SKY_MAVIS_GRAPHQL_URL ||
  "https://marketplace-graphql.skymavis.com/graphql";

// api.roninchain.com/rpc drops older historical txs; drpc.org's free tier
// times out. If a Sky Mavis key is present, use their authenticated archive RPC.
const RPC_URL =
  process.env.RONIN_RPC_URL ||
  (process.env.SKY_MAVIS_API_KEY
    ? "https://api-gateway.skymavis.com/rpc"
    : "https://api.roninchain.com/rpc");

function rpcHeaders() {
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (process.env.SKY_MAVIS_API_KEY) h["X-API-Key"] = process.env.SKY_MAVIS_API_KEY;
  return h;
}

function headers() {
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (process.env.SKY_MAVIS_API_KEY) h["X-API-Key"] = process.env.SKY_MAVIS_API_KEY;
  return h;
}

// Concurrency limiters — two separate pools so RPC calls (ownerOf,
// blockTimestampForTx) never starve GraphQL calls and vice-versa.
//
// GraphQL: 8 concurrent — Sky Mavis authenticated endpoint handles this well.
// RPC:     10 concurrent — separate pool for eth_call / eth_getTransaction.
function makeLimiter(max: number) {
  let inFlight = 0;
  const waiters: Array<() => void> = [];
  return {
    async acquire() {
      if (inFlight < max) { inFlight++; return; }
      await new Promise<void>((r) => waiters.push(r));
      inFlight++;
    },
    release() {
      inFlight--;
      waiters.shift()?.();
    },
  };
}
// 6 concurrent GraphQL calls: 3× speedup over the old cap of 2, while
// staying comfortably within Sky Mavis's authenticated-endpoint limits.
// 10 concurrent RPC calls: separate pool so eth_call / eth_getTransaction
// never starve (or are starved by) marketplace GraphQL calls.
const gqlLimiter = makeLimiter(6);
const rpcLimiter = makeLimiter(10);

// Circuit breaker: when Sky Mavis's daily quota is exhausted, every call
// 429s. Without short-circuiting, a 300-NFT load would retry 900 × 6 times
// (~37 min) before giving up. Once we've seen N consecutive 429s with NO
// successful call in between, trip the breaker and fail subsequent calls
// instantly with a clear "quota exhausted" error.
//
// The breaker resets automatically after BREAKER_COOLDOWN_MS so the next
// load attempt gets a fresh probe — handy when quota resets mid-session.
class QuotaExhaustedError extends Error {
  constructor() {
    super(
      "Sky Mavis API quota exhausted. Try again later (typically resets on a rolling 24h window).",
    );
    this.name = "QuotaExhaustedError";
  }
}
class RetryableError extends Error {}

let consecutive429s = 0;
let gqlBreakerTrippedAt = 0;
const BREAKER_TRIP_THRESHOLD = 5;
const BREAKER_COOLDOWN_MS = 60_000;

function isBreakerTripped(): boolean {
  if (!gqlBreakerTrippedAt) return false;
  if (Date.now() - gqlBreakerTrippedAt > BREAKER_COOLDOWN_MS) {
    // Cooldown elapsed — auto-reset so the next load can re-probe the API.
    gqlBreakerTrippedAt = 0;
    consecutive429s = 0;
    return false;
  }
  return true;
}

// One raw HTTP attempt — no retry, no concurrency gate. Updates breaker.
async function gqlFetch<T>(
  query: string,
  variables: Record<string, unknown>,
): Promise<T> {
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ query, variables }),
    cache: "no-store",
  });
  if (res.status === 429) {
    consecutive429s++;
    if (consecutive429s >= BREAKER_TRIP_THRESHOLD) {
      gqlBreakerTrippedAt = Date.now();
    }
    const txt = await res.text().catch(() => "");
    throw new RetryableError(
      `Marketplace GraphQL 429 (rate-limited): ${txt.slice(0, 200)}`,
    );
  }
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`Marketplace GraphQL ${res.status}: ${txt.slice(0, 300)}`);
  }
  const json = (await res.json()) as { data?: T; errors?: unknown };
  if (json.errors) {
    throw new Error(
      `Marketplace GraphQL errors: ${JSON.stringify(json.errors).slice(0, 400)}`,
    );
  }
  if (!json.data) throw new Error("Marketplace GraphQL: empty data");
  // Successful call — reset breaker counter so isolated 429s don't trip it.
  consecutive429s = 0;
  return json.data;
}

// Retry wrapper: acquires a concurrency slot per attempt and RELEASES it
// before sleeping so rate-limited requests don't hold slots during backoff.
async function gql<T>(
  query: string,
  variables: Record<string, unknown>,
): Promise<T> {
  if (isBreakerTripped()) throw new QuotaExhaustedError();
  let lastErr: unknown;
  const MAX_ATTEMPTS = 6;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    if (isBreakerTripped()) throw new QuotaExhaustedError();
    await gqlLimiter.acquire();
    try {
      return await gqlFetch<T>(query, variables);
    } catch (err) {
      lastErr = err;
      const isRetryable =
        err instanceof RetryableError ||
        (err as { code?: string })?.code === "ECONNRESET" ||
        (err as Error)?.message?.includes("ECONNRESET") ||
        (err as Error)?.message?.includes("fetch failed");
      if (!isRetryable) break;
      // fall through to sleep — slot already released by finally
    } finally {
      gqlLimiter.release();
    }
    if (attempt < MAX_ATTEMPTS - 1) {
      // Exponential backoff with jitter: 0.5s, 1s, 2s, 4s, 8s.
      // Slot is FREE during this sleep so other queued calls can proceed.
      const base = 500 * 2 ** attempt;
      await new Promise((r) => setTimeout(r, base + Math.random() * 250));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

export type HoldingToken = {
  tokenId: string;
  tokenAddress: string;
  name?: string | null;
  image?: string | null;
  cdnImage?: string | null;
  attributes?: Record<string, string[]> | null;
};

export async function listHoldings(
  owner: string,
  contract: string,
): Promise<HoldingToken[]> {
  // Sky Mavis caps page size at 50 — paginate by `from` offset until we
  // either get fewer results than the page size or hit the reported total.
  const PAGE_SIZE = 50;
  const MAX_PAGES = 40; // safety: 2000 tokens max
  const query = /* GraphQL */ `
    query Erc721Tokens(
      $owner: String!
      $tokenAddress: String!
      $from: Int!
      $size: Int!
    ) {
      erc721Tokens(
        owner: $owner
        tokenAddress: $tokenAddress
        from: $from
        size: $size
      ) {
        total
        results {
          tokenId
          tokenAddress
          name
          image
          cdnImage
          attributes
        }
      }
    }
  `;
  type R = {
    erc721Tokens: { total: number; results: HoldingToken[] };
  };
  // Pagination contract: keep going until we have `total` distinct tokens or
  // a page comes back fully empty. Sky Mavis's marketplace indexer can return
  // a SHORT page mid-walk (e.g. 26 rows instead of 50) even when there are
  // more tokens at higher offsets, so we no longer treat "short page = end".
  // We track the highest reported `total` so flapping doesn't cut us off.
  const seen = new Map<string, HoldingToken>();
  let maxTotal = 0;
  for (let page = 0; page < MAX_PAGES; page++) {
    const data = await gql<R>(query, {
      owner: owner.toLowerCase(),
      tokenAddress: contract.toLowerCase(),
      from: page * PAGE_SIZE,
      size: PAGE_SIZE,
    });
    const rows = data.erc721Tokens?.results ?? [];
    const total = data.erc721Tokens?.total ?? 0;
    if (total > maxTotal) maxTotal = total;
    // Dedup by tokenId — indexer flux can make the same id appear on two pages.
    for (const r of rows) seen.set(r.tokenId, r);
    // Stop conditions:
    //   - empty page (real end of cursor)
    //   - reached / exceeded the highest total seen so far
    if (rows.length === 0) break;
    if (maxTotal > 0 && seen.size >= maxTotal) break;
  }
  return Array.from(seen.values());
}

/**
 * Lowest active listing price (in RON) for tokens matching the given trait,
 * e.g. floorPriceForTrait(contract, "Rarity", "Common").
 * Returns null if no active listing matches.
 */
// Per-collection-trait floor price cache with TTL. Floors don't move minute
// to minute, so caching cheaply for a few minutes saves us from rate limits
// on rapid re-loads and the occasional 429.
const floorCache = new Map<string, { value: number; at: number }>();
const inflightFloor = new Map<string, Promise<number | null>>();
const FLOOR_TTL_MS = 5 * 60 * 1000;

export async function floorPriceForTrait(
  contract: string,
  traitName: string,
  traitValue: string,
): Promise<number | null> {
  const key = `${contract.toLowerCase()}|${traitName}|${traitValue}`;
  const cached = floorCache.get(key);
  if (cached && Date.now() - cached.at < FLOOR_TTL_MS) return cached.value;
  const inflight = inflightFloor.get(key);
  if (inflight) return inflight;

  const promise = floorPriceForTraitImpl(contract, traitName, traitValue).then(
    (v) => {
      if (v != null) floorCache.set(key, { value: v, at: Date.now() });
      return v;
    },
  );
  inflightFloor.set(key, promise);
  try {
    return await promise;
  } finally {
    inflightFloor.delete(key);
  }
}

async function floorPriceForTraitImpl(
  contract: string,
  traitName: string,
  traitValue: string,
): Promise<number | null> {
  const query = /* GraphQL */ `
    query FloorByTrait(
      $tokenAddress: String!
      $criteria: [SearchCriteria!]
    ) {
      erc721Tokens(
        tokenAddress: $tokenAddress
        auctionType: Sale
        criteria: $criteria
        sort: PriceAsc
        from: 0
        size: 1
      ) {
        total
        results {
          tokenId
          order {
            currentPrice
          }
        }
      }
    }
  `;
  type R = {
    erc721Tokens: {
      total: number;
      results: Array<{ tokenId: string; order: { currentPrice: string } | null }>;
    };
  };
  try {
    const data = await gql<R>(query, {
      tokenAddress: contract.toLowerCase(),
      criteria: [{ name: traitName, values: [traitValue] }],
    });
    const row = data.erc721Tokens?.results?.[0];
    if (!row?.order?.currentPrice) return null;
    return weiToRon(row.order.currentPrice);
  } catch (err) {
    console.warn(
      `[marketplace] floorPriceForTrait(${traitName}=${traitValue}) failed:`,
      (err as Error).message,
    );
    return null;
  }
}

export type SaleEvent = {
  txHash: string;
  timestamp: number; // unix seconds (0 if marketplace returned 0; resolve via blockTimestampForTx)
  priceWei: string;
  buyer: string;
  seller: string;
  paymentToken: string;
};

export type AcquisitionEvent = SaleEvent & {
  source: "sale" | "mint" | "transfer";
};

export type StakingDeposit = {
  contract: string; // lowercased nft contract
  tokenId: string;
  stakingContract: string; // lowercased staking contract
  timestamp: number;
  txHash: string | null;
};

/**
 * Walk the user's Transfer activities and return any deposit into a known
 * staking contract. Returns the MOST RECENT deposit per (contract, tokenId)
 * — caller still needs to verify on-chain that the staking contract still
 * owns the token (a later unstake transfer would invalidate it).
 */
export async function userStakingDepositsFor(
  userAddress: string,
  stakingByContract: Map<string, Set<string>>, // nftContract(lc) → set of staking contracts (lc)
  sinceTs = 0,
  maxPages = 30,
): Promise<Map<string, StakingDeposit>> {
  if (stakingByContract.size === 0) return new Map();

  const userLc = userAddress.toLowerCase();
  const stakingAddrs = new Set<string>();
  for (const set of stakingByContract.values()) {
    for (const a of set) stakingAddrs.add(a);
  }
  const deposits = new Map<string, StakingDeposit>();
  let cursorId: number | undefined = undefined;
  let consecutiveEmptyPages = 0;
  // Bumped to 200 (~6,000 activities) to handle active traders who have
  // hundreds of pages of unrelated activity between their tracked-contract
  // mints/sales/stakes. We still hard-cap via `maxPages` and the date cutoff,
  // so a wallet that truly has no relevant activity exits within ~minutes.
  const EMPTY_PAGE_LIMIT = 200;

  for (let page = 0; page < maxPages; page++) {
    const query = /* GraphQL */ `
      query Transfers($u: String!, $filters: UserActivityFilter!, $size: Int!) {
        userActivities(userAddress: $u, filters: $filters, size: $size) {
          results {
            id
            activityType
            timestamp
            txHash
            from
            to
            activityEventData {
              __typename
              ... on Asset {
                address
                id
                erc
              }
            }
          }
        }
      }
    `;
    type Row = {
      id: number;
      timestamp: number;
      txHash: string | null;
      from: string;
      to: string;
      activityEventData:
        | { __typename: "Asset"; address: string; id: string; erc: string }
        | { __typename: string }
        | null;
    };
    type R = { userActivities: { results: Row[] } };
    // Propagate persistent errors instead of silently returning partial
    // data — partial staking results are MUCH worse than a clean error
    // that the user can react to (reload).
    const data = await gql<R>(query, {
      u: userLc,
      size: 30,
      filters: {
        userActivityTypes: ["Transfer"],
        ...(sinceTs > 0 ? { timestampRange: { from: sinceTs } } : {}),
        ...(cursorId != null ? { cursorId } : {}),
      },
    });
    const rows = data.userActivities?.results ?? [];
    if (rows.length === 0) break;

    let oldestOnPage = Infinity;
    const sizeBefore = deposits.size;
    for (const r of rows) {
      oldestOnPage = Math.min(oldestOnPage, r.timestamp);
      const asset = r.activityEventData;
      if (!asset || asset.__typename !== "Asset") continue;
      const a = asset as { address: string; id: string };
      if (r.from?.toLowerCase() !== userLc) continue;
      const toLc = r.to?.toLowerCase();
      if (!toLc || !stakingAddrs.has(toLc)) continue;
      const nftContract = a.address.toLowerCase();
      const expectedStaking = stakingByContract.get(nftContract);
      if (!expectedStaking || !expectedStaking.has(toLc)) continue;
      const key = `${nftContract}:${a.id}`;
      const existing = deposits.get(key);
      if (!existing || existing.timestamp < r.timestamp) {
        deposits.set(key, {
          contract: nftContract,
          tokenId: a.id,
          stakingContract: toLc,
          timestamp: r.timestamp,
          txHash: r.txHash,
        });
      }
    }

    if (oldestOnPage <= sinceTs) break;
    if (deposits.size === sizeBefore) {
      consecutiveEmptyPages++;
      if (consecutiveEmptyPages >= EMPTY_PAGE_LIMIT) break;
    } else {
      consecutiveEmptyPages = 0;
    }
    const lastId = rows[rows.length - 1].id;
    if (cursorId === lastId) break;
    cursorId = lastId;
  }

  return deposits;
}

// Token metadata is essentially static for the lifetime of an NFT — cache
// indefinitely (per server instance) to drastically cut request volume on
// repeat loads of the same wallet.
const tokenMetadataCache = new Map<string, HoldingToken | null>();

/** Fetch one token's marketplace metadata (name/image/attributes). */
export async function tokenMetadata(
  contract: string,
  tokenId: string,
): Promise<HoldingToken | null> {
  const key = `${contract.toLowerCase()}:${tokenId}`;
  if (tokenMetadataCache.has(key)) return tokenMetadataCache.get(key)!;
  const result = await tokenMetadataImpl(contract, tokenId);
  tokenMetadataCache.set(key, result);
  return result;
}

async function tokenMetadataImpl(
  contract: string,
  tokenId: string,
): Promise<HoldingToken | null> {
  const query = /* GraphQL */ `
    query OneToken($tokenAddress: String!, $tokenId: String!) {
      erc721Token(tokenAddress: $tokenAddress, tokenId: $tokenId) {
        tokenId
        tokenAddress
        name
        image
        cdnImage
        attributes
      }
    }
  `;
  type R = { erc721Token: HoldingToken | null };
  try {
    const data = await gql<R>(query, {
      tokenAddress: contract.toLowerCase(),
      tokenId,
    });
    return data.erc721Token;
  } catch (err) {
    console.warn(`[marketplace] tokenMetadata ${contract}/${tokenId} failed:`, (err as Error).message);
    return null;
  }
}

/**
 * Returns the most recent transfer event for this token, classified as:
 *  - "sale"     — most recent transfer was a marketplace sale (withPrice > 0)
 *  - "mint"     — most recent transfer was from 0x0 (the mint itself)
 *  - "transfer" — most recent transfer was a non-sale transfer (gift / wallet move)
 *                priceWei is "0" for mint and transfer; the caller substitutes
 *                TrackedCollection.mintPriceRon for "mint" and 0 for "transfer".
 */
// Cache the last sale/mint per token. A token's history can grow (new sales),
// but a TTL keeps us roughly fresh while saving most repeat queries.
const lastAcquisitionCache = new Map<
  string,
  { value: AcquisitionEvent | null; at: number }
>();
const LAST_ACQ_TTL_MS = 5 * 60 * 1000;

// Raw transfer history rows cached alongside the processed result so that
// lastBuyerSale() can scan the full history without an extra API call.
const transferHistoryCache = new Map<
  string,
  { rows: TransferRow[]; at: number }
>();

type TransferRow = {
  txHash: string;
  timestamp: number;
  from: string;
  to: string;
  withPrice: string;
  paymentToken: string;
};

// ---------------------------------------------------------------------------
// Disk persistence for token-history caches.
//
// Two-layer pattern matching CryptoCompare's RON/USD cache:
//   - SNAPSHOT_PATH: bundled snapshot (committed to git, ships with build)
//   - LOCAL_CACHE_PATH: gitignored write-through cache populated at runtime
//
// Why this is safe: NFT transferHistory is append-only on-chain. Once we
// cache a token's history, the only thing that can change is "new transfers
// added on top." We detect that via ownership verification in
// lastAcquisitionVerified() — if the cache's most recent event sent the
// token to the address we expect to currently own it, no later transfer
// can exist.
// ---------------------------------------------------------------------------
const MKT_SNAPSHOT_PATH = path.join(
  process.cwd(),
  "src",
  "data",
  "marketplace-history.json",
);
const MKT_LOCAL_CACHE_PATH = path.join(
  process.cwd(),
  "data",
  "marketplace-history.json",
);

type MktDiskRecord = {
  /** Computed acquisition event (most-recent transfer, classified). */
  a: AcquisitionEvent | null;
  /** Raw transferHistory rows used by lastBuyerSale(). */
  r: TransferRow[];
};

function seedMarketplaceCacheFromDisk(): void {
  for (const p of [MKT_SNAPSHOT_PATH, MKT_LOCAL_CACHE_PATH]) {
    try {
      if (!fs.existsSync(p)) continue;
      const raw = fs.readFileSync(p, "utf8");
      const obj = JSON.parse(raw) as Record<string, MktDiskRecord>;
      let n = 0;
      const now = Date.now();
      for (const [k, v] of Object.entries(obj)) {
        if (!v || !Array.isArray(v.r)) continue;
        // Local cache (loaded second) overrides snapshot — it's newer.
        transferHistoryCache.set(k, { rows: v.r, at: now });
        lastAcquisitionCache.set(k, { value: v.a ?? null, at: now });
        n++;
      }
      if (n > 0) {
        console.log(
          `[marketplace] seeded ${n} token histories from ${path.basename(p)}`,
        );
      }
    } catch {
      // Corrupt cache shouldn't break startup — silently fall through.
    }
  }
}
seedMarketplaceCacheFromDisk();

// Persist strategy: write to disk on whichever happens first —
//   - 500ms of inactivity since the last update (trailing-edge debounce), OR
//   - every 25 cache updates (force flush so big loads can't lose progress
//     to a dev-server hot-reload that happens before the next debounce fires)
// Reads the full cache each time; cheap even at thousands of tokens.
let mktPersistTimer: NodeJS.Timeout | null = null;
let mktPendingUpdates = 0;
const MKT_PERSIST_DEBOUNCE_MS = 500;
const MKT_PERSIST_FORCE_EVERY = 25;

function flushMarketplaceCache(): void {
  if (mktPersistTimer) {
    clearTimeout(mktPersistTimer);
    mktPersistTimer = null;
  }
  mktPendingUpdates = 0;
  try {
    fs.mkdirSync(path.dirname(MKT_LOCAL_CACHE_PATH), { recursive: true });
    const obj: Record<string, MktDiskRecord> = {};
    for (const [k, entry] of transferHistoryCache) {
      const acq = lastAcquisitionCache.get(k)?.value ?? null;
      obj[k] = { a: acq, r: entry.rows };
    }
    fs.writeFileSync(MKT_LOCAL_CACHE_PATH, JSON.stringify(obj));
  } catch {
    // Read-only filesystem on Vercel runtime — silently skip.
  }
}

function persistMarketplaceCacheSoon(): void {
  mktPendingUpdates++;
  // Force flush every N updates so a long load can't lose its tail to a
  // hot-reload that interrupts the debounce window.
  if (mktPendingUpdates >= MKT_PERSIST_FORCE_EVERY) {
    flushMarketplaceCache();
    return;
  }
  if (mktPersistTimer) return;
  mktPersistTimer = setTimeout(() => {
    flushMarketplaceCache();
  }, MKT_PERSIST_DEBOUNCE_MS);
}

export async function lastAcquisition(
  contract: string,
  tokenId: string,
): Promise<AcquisitionEvent | null> {
  const key = `${contract.toLowerCase()}:${tokenId}`;
  const cached = lastAcquisitionCache.get(key);
  if (cached && Date.now() - cached.at < LAST_ACQ_TTL_MS) return cached.value;
  const value = await lastAcquisitionImpl(contract, tokenId);
  lastAcquisitionCache.set(key, { value, at: Date.now() });
  persistMarketplaceCacheSoon();
  return value;
}

/**
 * Ownership-verified lastAcquisition. Skips the API call when the cached
 * transferHistory's most recent event sent the token to `expectedRecipient`
 * — at that point no later transfer can exist (the recipient must still
 * hold it for us to be asking about it).
 *
 * Use this when you already know who currently owns the token (e.g. the
 * wallet returned from listHoldings, or the staking contract that holds a
 * deposited token). The miss path falls through to a normal fetch.
 *
 * For a 300-NFT wallet on warm-cache reload this turns ~300 GraphQL calls
 * into 0.
 */
export async function lastAcquisitionVerified(
  contract: string,
  tokenId: string,
  expectedRecipient: string,
): Promise<AcquisitionEvent | null> {
  const key = `${contract.toLowerCase()}:${tokenId}`;
  const histCached = transferHistoryCache.get(key);
  const acqCached = lastAcquisitionCache.get(key);
  if (histCached && acqCached && histCached.rows.length > 0) {
    // Locate the most-recent row by timestamp — the API doesn't guarantee
    // order, so don't trust positional indexing.
    let latestTo: string | null = null;
    let latestTs = -1;
    for (const r of histCached.rows) {
      const ts = Number(r.timestamp) || 0;
      if (ts > latestTs) {
        latestTs = ts;
        latestTo = r.to;
      }
    }
    if (
      latestTo &&
      latestTo.toLowerCase() === expectedRecipient.toLowerCase()
    ) {
      // Ownership match — cache verified fresh. Zero API calls.
      return acqCached.value;
    }
  }
  // Cache miss OR ownership mismatch — fall through to full fetch.
  return lastAcquisition(contract, tokenId);
}

async function lastAcquisitionImpl(
  contract: string,
  tokenId: string,
): Promise<AcquisitionEvent | null> {
  const query = /* GraphQL */ `
    query TokenActivity($tokenAddress: String!, $tokenId: String!) {
      erc721Token(tokenAddress: $tokenAddress, tokenId: $tokenId) {
        tokenId
        transferHistory(from: 0, size: 50) {
          results {
            txHash
            timestamp
            from
            to
            withPrice
            paymentToken
          }
        }
      }
    }
  `;
  type Row = {
    txHash: string;
    timestamp: number;
    from: string;
    to: string;
    withPrice: string;
    paymentToken: string;
  };
  type R = {
    erc721Token: {
      tokenId: string;
      transferHistory: { results: Row[] };
    } | null;
  };

  const data = await gql<R>(query, {
    tokenAddress: contract.toLowerCase(),
    tokenId,
  });
  const rows = data.erc721Token?.transferHistory?.results ?? [];
  // Cache raw rows for lastBuyerSale() so it never needs a second fetch,
  // and schedule a debounced disk write (no-op on read-only filesystems).
  const key = `${contract.toLowerCase()}:${tokenId}`;
  transferHistoryCache.set(key, { rows, at: Date.now() });
  persistMarketplaceCacheSoon();
  if (rows.length === 0) return null;

  // Most recent transfer wins, regardless of type — the holder's cost basis
  // depends on HOW they got the token, not on whether it ever sold before.
  const sorted = [...rows].sort(
    (a, b) => (b.timestamp || 0) - (a.timestamp || 0),
  );
  const latest = sorted[0];
  const ZERO = "0x0000000000000000000000000000000000000000";
  const isSale = latest.withPrice && latest.withPrice !== "0";
  const isMint = latest.from?.toLowerCase() === ZERO;
  const source: AcquisitionEvent["source"] = isSale
    ? "sale"
    : isMint
      ? "mint"
      : "transfer";

  return {
    source,
    txHash: latest.txHash,
    timestamp: Number(latest.timestamp) || 0,
    priceWei: isSale ? latest.withPrice : "0",
    buyer: latest.to,
    seller: latest.from,
    paymentToken: latest.paymentToken,
  };
}

/**
 * Returns the most recent SALE event for this token where the buyer is
 * `buyerAddress`. Used when the token was bought, sent away, then received
 * back — lastAcquisition() would see the plain transfer-back and report no
 * price. This function scans the full cached transferHistory instead.
 *
 * Returns null if no such sale is found (token was never bought by this
 * address, or history window doesn't reach it).
 */
export async function lastBuyerSale(
  contract: string,
  tokenId: string,
  buyerAddress: string,
): Promise<AcquisitionEvent | null> {
  const key = `${contract.toLowerCase()}:${tokenId}`;
  const buyerLc = buyerAddress.toLowerCase();

  // Ensure the history is in cache (lastAcquisition populates it as a side
  // effect — call it if not yet cached).
  if (!transferHistoryCache.has(key)) {
    await lastAcquisition(contract, tokenId);
  }
  const cached = transferHistoryCache.get(key);
  const rows = cached?.rows ?? [];

  // Find the most recent sale where this address was the buyer.
  const ZERO = "0x0000000000000000000000000000000000000000";
  const sales = rows
    .filter(
      (r) =>
        r.to?.toLowerCase() === buyerLc &&
        r.withPrice &&
        r.withPrice !== "0" &&
        r.from?.toLowerCase() !== ZERO,
    )
    .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

  if (sales.length === 0) return null;
  const s = sales[0];
  return {
    source: "sale",
    txHash: s.txHash,
    timestamp: Number(s.timestamp) || 0,
    priceWei: s.withPrice,
    buyer: s.to,
    seller: s.from,
    paymentToken: s.paymentToken,
  };
}

export function weiToRon(wei: string | bigint): number {
  const n = typeof wei === "bigint" ? wei : BigInt(wei);
  return Number(n) / 1e18;
}

const blockTsCache = new Map<string, number>();
// Cached tx value (native RON in hex) from eth_getTransactionByHash.
// Populated as a free by-product of blockTimestampForTx — lets us recover
// purchase price for sales where transferHistory.withPrice is missing.
const txValueHexCache = new Map<string, string | null>();

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const TRANSFER_TOPIC =
  "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

/**
 * Pad a decimal tokenId string to a 32-byte hex topic.
 * "445" → "0x000…00001bd"
 */
function tokenIdToTopic(tokenId: string): string {
  return "0x" + BigInt(tokenId).toString(16).padStart(64, "0");
}

export type ChainTransfer = {
  txHash: string;
  blockNumber: number;
  logIndex: number;
  from: string; // lowercased
  to: string; // lowercased
};

/**
 * Returns all ERC721 Transfer events for a given tokenId, sorted oldest→newest.
 * Uses eth_getLogs on the contract address.
 */
export async function chainTransferHistory(
  contract: string,
  tokenId: string,
): Promise<ChainTransfer[]> {
  // Sky Mavis's archive RPC rejects fromBlock="0x0" / "earliest". Use a
  // numeric starting block. The MoTZ contract was deployed in Jan 2025;
  // block 38000000 (Dec 2024) is safely before any of its events.
  const FROM_BLOCK = process.env.RONIN_FROM_BLOCK || "0x243d600"; // 38,000,000
  const res = await fetch(RPC_URL, {
    method: "POST",
    headers: rpcHeaders(),
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "eth_getLogs",
      params: [
        {
          fromBlock: FROM_BLOCK,
          toBlock: "latest",
          address: contract.toLowerCase(),
          topics: [TRANSFER_TOPIC, null, null, tokenIdToTopic(tokenId)],
        },
      ],
    }),
    cache: "no-store",
  });
  if (!res.ok) {
    console.warn(`[marketplace] eth_getLogs #${tokenId} -> ${res.status}`);
    return [];
  }
  const json = (await res.json()) as {
    result?: Array<{
      transactionHash: string;
      blockNumber: string;
      logIndex: string;
      topics: string[];
    }>;
    error?: { message: string };
  };
  if (json.error) {
    console.warn(`[marketplace] eth_getLogs #${tokenId} error:`, json.error.message);
    return [];
  }
  const logs = json.result ?? [];
  const transfers: ChainTransfer[] = logs.map((l) => ({
    txHash: l.transactionHash,
    blockNumber: parseInt(l.blockNumber, 16),
    logIndex: parseInt(l.logIndex, 16),
    from: "0x" + l.topics[1].slice(-40).toLowerCase(),
    to: "0x" + l.topics[2].slice(-40).toLowerCase(),
  }));
  transfers.sort((a, b) =>
    a.blockNumber === b.blockNumber
      ? a.logIndex - b.logIndex
      : a.blockNumber - b.blockNumber,
  );
  return transfers;
}

// Re-export for callers that don't want to import the constant separately.
export { ZERO_ADDRESS };

/**
 * Call ERC-721 ownerOf(tokenId) on the contract via RPC, with retries on
 * transient failures. Throws on persistent failure (so callers don't silently
 * drop tokens from results).
 */
export async function ownerOf(
  contract: string,
  tokenId: string,
): Promise<string> {
  await rpcLimiter.acquire();
  try {
    return await ownerOfInner(contract, tokenId);
  } finally {
    rpcLimiter.release();
  }
}
async function ownerOfInner(
  contract: string,
  tokenId: string,
): Promise<string> {
  const tokenHex = BigInt(tokenId).toString(16).padStart(64, "0");
  const MAX = 6;
  let lastErr: unknown;
  for (let attempt = 0; attempt < MAX; attempt++) {
    try {
      const res = await fetch(RPC_URL, {
        method: "POST",
        headers: rpcHeaders(),
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "eth_call",
          params: [
            { to: contract.toLowerCase(), data: "0x6352211e" + tokenHex },
            "latest",
          ],
        }),
        cache: "no-store",
      });
      if (res.status === 429) {
        throw new RetryableError(`ownerOf 429 (rate-limited)`);
      }
      if (!res.ok) {
        throw new Error(`ownerOf ${contract}/${tokenId} -> ${res.status}`);
      }
      const json = (await res.json()) as { result?: string; error?: { message: string } };
      if (json.error) {
        throw new Error(
          `ownerOf ${contract}/${tokenId}: ${json.error.message}`,
        );
      }
      if (!json.result || json.result === "0x") {
        // Token doesn't exist / was burned — return zero address.
        return ZERO_ADDRESS;
      }
      return "0x" + json.result.slice(-40);
    } catch (err) {
      lastErr = err;
      const isRetryable =
        err instanceof RetryableError ||
        (err as { code?: string })?.code === "ECONNRESET" ||
        (err as Error)?.message?.includes("ECONNRESET") ||
        (err as Error)?.message?.includes("fetch failed");
      if (!isRetryable) break;
      if (attempt < MAX - 1) {
        const base = 500 * 2 ** attempt;
        await new Promise((r) => setTimeout(r, base + Math.random() * 250));
      }
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

export type UserAcquisition = {
  source: "mint" | "sale";
  contract: string; // lowercased contract address
  tokenId: string;
  timestamp: number;
  txHash: string | null;
};

/**
 * Returns every Mint+Sale activity for `userAddress` against `contractAddress`
 * (i.e. tokens the user acquired by minting them, or by buying them on the
 * marketplace as the buyer). Anything the user currently holds but is NOT in
 * this list must have been received via a plain wallet-to-wallet transfer.
 *
 * Paginates through userActivities (Sky Mavis caps page size at 30) until
 * either we run out of activities, hit `maxPages`, or pass `sinceTs`.
 */
export async function userAcquisitionsFor(
  userAddress: string,
  contractAddresses: string | string[],
  sinceTs = 0,
  maxPages = 30,
  /**
   * Optional set of "contract:tokenId" keys we care about (lowercased contract).
   * Pagination exits as soon as all targeted (contract, tokenId) pairs have
   * been resolved. Cuts wall-clock time on wallets where most held tokens
   * already have marketplace data.
   */
  targetKeys?: Set<string>,
): Promise<Map<string, UserAcquisition>> {
  const acquisitions = new Map<string, UserAcquisition>();
  let cursorId: number | undefined = undefined;
  const targets = (
    Array.isArray(contractAddresses) ? contractAddresses : [contractAddresses]
  ).map((c) => c.toLowerCase());
  const targetsSet = new Set(targets);
  const userLc = userAddress.toLowerCase();
  const wantedCount = targetKeys?.size ?? Infinity;
  // If we walk this many pages in a row without finding any acquisition for
  // the target contract, assume the user has no Mint/Sale activity here and
  // bail. Caps worst-case latency for "all transferred" wallets.
  // Bumped to 200 (~6,000 activities) to handle active traders who have
  // hundreds of pages of unrelated activity between their tracked-contract
  // mints/sales/stakes. We still hard-cap via `maxPages` and the date cutoff,
  // so a wallet that truly has no relevant activity exits within ~minutes.
  const EMPTY_PAGE_LIMIT = 200;
  let consecutiveEmptyPages = 0;

  for (let page = 0; page < maxPages; page++) {
    const query = /* GraphQL */ `
      query Acq($u: String!, $filters: UserActivityFilter!, $size: Int!) {
        userActivities(userAddress: $u, filters: $filters, size: $size) {
          results {
            id
            activityType
            timestamp
            txHash
            from
            to
            activityEventData {
              __typename
              ... on Asset {
                address
                id
                erc
              }
            }
          }
        }
      }
    `;
    type Row = {
      id: number;
      activityType: "Mint" | "Sale" | "Transfer" | string;
      timestamp: number;
      txHash: string | null;
      from: string;
      to: string;
      activityEventData:
        | { __typename: "Asset"; address: string; id: string; erc: string }
        | { __typename: string }
        | null;
    };
    type R = { userActivities: { results: Row[] } };

    // Propagate persistent errors (a partial cost-basis dataset would be
    // misleading — better to surface the failure so the caller can retry).
    const data = await gql<R>(query, {
      u: userLc,
      size: 30,
      filters: {
        userActivityTypes: ["Mint", "Sale"],
        ...(sinceTs > 0 ? { timestampRange: { from: sinceTs } } : {}),
        ...(cursorId != null ? { cursorId } : {}),
      },
    });
    const rows = data.userActivities?.results ?? [];
    if (rows.length === 0) break;

    let oldestOnPage = Infinity;
    const sizeBefore = acquisitions.size;
    for (const r of rows) {
      oldestOnPage = Math.min(oldestOnPage, r.timestamp);
      const asset = r.activityEventData;
      if (!asset || asset.__typename !== "Asset") continue;
      const a = asset as { address: string; id: string; erc: string };
      const contractLc = a.address.toLowerCase();
      if (!targetsSet.has(contractLc)) continue;
      if (r.to?.toLowerCase() !== userLc) continue;
      const src: "mint" | "sale" | null =
        r.activityType === "Mint"
          ? "mint"
          : r.activityType === "Sale"
            ? "sale"
            : null;
      if (!src) continue;
      const key = `${contractLc}:${a.id}`;
      // Skip tokens the caller doesn't care about.
      if (targetKeys && !targetKeys.has(key)) continue;
      // Most recent acquisition wins.
      const existing = acquisitions.get(key);
      if (!existing || existing.timestamp < r.timestamp) {
        acquisitions.set(key, {
          source: src,
          contract: contractLc,
          tokenId: a.id,
          timestamp: r.timestamp,
          txHash: r.txHash,
        });
      }
    }

    // Exit early once we've classified every token the caller asked about.
    if (acquisitions.size >= wantedCount) break;
    // Stop when we pass the cutoff.
    if (oldestOnPage <= sinceTs) break;
    // Bail if this contract clearly has no acquisitions for the user.
    if (acquisitions.size === sizeBefore) {
      consecutiveEmptyPages++;
      if (consecutiveEmptyPages >= EMPTY_PAGE_LIMIT) break;
    } else {
      consecutiveEmptyPages = 0;
    }
    // Set cursor for next page (Sky Mavis uses the last id as the next cursor).
    const lastId = rows[rows.length - 1].id;
    if (cursorId === lastId) break;
    cursorId = lastId;
  }

  return acquisitions;
}

async function rpcCallWithRetry<T>(
  body: object,
  label: string,
): Promise<T | null> {
  await rpcLimiter.acquire();
  try {
    return await rpcCallWithRetryInner<T>(body, label);
  } finally {
    rpcLimiter.release();
  }
}
async function rpcCallWithRetryInner<T>(
  body: object,
  label: string,
): Promise<T | null> {
  const MAX = 6;
  let lastErr: unknown;
  for (let attempt = 0; attempt < MAX; attempt++) {
    try {
      const res = await fetch(RPC_URL, {
        method: "POST",
        headers: rpcHeaders(),
        body: JSON.stringify(body),
        cache: "no-store",
      });
      if (res.status === 429) {
        throw new RetryableError(`${label} 429 (rate-limited)`);
      }
      if (!res.ok) {
        throw new Error(`${label} -> ${res.status}`);
      }
      const json = (await res.json()) as { result?: T; error?: { message: string } };
      if (json.error) {
        throw new Error(`${label}: ${json.error.message}`);
      }
      return json.result ?? null;
    } catch (err) {
      lastErr = err;
      const isRetryable =
        err instanceof RetryableError ||
        (err as { code?: string })?.code === "ECONNRESET" ||
        (err as Error)?.message?.includes("ECONNRESET") ||
        (err as Error)?.message?.includes("fetch failed");
      if (!isRetryable || attempt === MAX - 1) {
        throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
      }
      const base = 500 * 2 ** attempt;
      await new Promise((r) => setTimeout(r, base + Math.random() * 250));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

async function fetchTxDetails(
  txHash: string,
): Promise<{ blockNumber: string; value: string | null } | null> {
  return rpcCallWithRetry<{ blockNumber?: string; value?: string }>(
    {
      jsonrpc: "2.0",
      id: 1,
      method: "eth_getTransactionByHash",
      params: [txHash],
    },
    `fetchTxDetails ${txHash.slice(0, 10)}…`,
  ).then((tx) =>
    tx?.blockNumber
      ? { blockNumber: tx.blockNumber, value: tx.value ?? null }
      : null,
  );
}

export async function blockTimestampForTx(
  txHash: string,
): Promise<number | null> {
  if (blockTsCache.has(txHash)) return blockTsCache.get(txHash)!;
  const tx = await fetchTxDetails(txHash);
  if (!tx) {
    console.warn(`[marketplace] tx ${txHash} has no blockNumber`);
    return null;
  }
  // Cache value as a free by-product so txValueWei() never needs a 2nd call.
  if (!txValueHexCache.has(txHash)) txValueHexCache.set(txHash, tx.value);
  const blk = await rpcCallWithRetry<{ timestamp?: string }>(
    {
      jsonrpc: "2.0",
      id: 2,
      method: "eth_getBlockByNumber",
      params: [tx.blockNumber, false],
    },
    `blockTimestampForTx blk ${tx.blockNumber}`,
  );
  if (!blk?.timestamp) return null;
  const ts = parseInt(blk.timestamp, 16);
  blockTsCache.set(txHash, ts);
  return ts;
}

/**
 * Returns the native-RON purchase price (decimal wei string) for a
 * SINGLE-NFT marketplace sale tx by reading tx.value.
 *
 * For RON-denominated sales, tx.value = price the buyer paid.
 * For BATCH purchases (multiple NFTs in one tx) tx.value is the TOTAL
 * across all NFTs — unusable as an individual price — so this returns
 * null in that case. Batch detection is done via eth_getTransactionReceipt
 * by counting ERC721 Transfer events from the given contract.
 */
export async function txSingleNftPrice(
  txHash: string,
  nftContract: string,
): Promise<string | null> {
  // 1. Get the tx value — if zero, bail immediately (no RON paid on-chain).
  let hex = txValueHexCache.get(txHash);
  if (hex === undefined) {
    const tx = await fetchTxDetails(txHash);
    hex = tx?.value ?? null;
    txValueHexCache.set(txHash, hex);
  }
  if (!hex || hex === "0x" || hex === "0x0") return null;

  // 2. Fetch the receipt and count how many NFTs from this contract were
  //    transferred in the same tx. If > 1, it was a batch purchase and
  //    tx.value is the aggregate price — return null to avoid wrong data.
  await rpcLimiter.acquire();
  let receiptLogs: Array<{ address: string; topics: string[] }> = [];
  try {
    const receipt = await rpcCallWithRetryInner<{
      logs?: Array<{ address: string; topics: string[] }>;
    }>(
      { jsonrpc: "2.0", id: 1, method: "eth_getTransactionReceipt", params: [txHash] },
      `txSingleNftPrice receipt ${txHash.slice(0, 10)}…`,
    );
    receiptLogs = receipt?.logs ?? [];
  } finally {
    rpcLimiter.release();
  }

  const contractLc = nftContract.toLowerCase();
  const nftTransferCount = receiptLogs.filter(
    (l) =>
      l.topics[0] === TRANSFER_TOPIC &&
      l.address.toLowerCase() === contractLc,
  ).length;

  // Only use tx.value if exactly one NFT from this contract was transferred.
  if (nftTransferCount !== 1) return null;

  return BigInt(hex).toString();
}
