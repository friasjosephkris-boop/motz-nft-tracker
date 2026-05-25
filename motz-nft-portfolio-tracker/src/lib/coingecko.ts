import "server-only";
import dns from "node:dns";
import fs from "node:fs";
import path from "node:path";

// IPv4-first DNS to dodge a known IPv6 ECONNRESET on this host.
dns.setDefaultResultOrder("ipv4first");

// CryptoCompare's free public endpoints support RONIN/USD daily history.
// Anonymous tier ~100k calls/month (per IP). Authenticated free tier (signup
// at cryptocompare.com → My API Keys) bumps that to ~250k/month and is much
// less likely to throttle. Set CRYPTOCOMPARE_API_KEY in .env.local to use.
const BASE = "https://min-api.cryptocompare.com/data";
const SYMBOL = "RONIN";
const CC_KEY = process.env.CRYPTOCOMPARE_API_KEY?.trim();

function ccHeaders(): HeadersInit {
  return CC_KEY ? { Authorization: `Apikey ${CC_KEY}` } : {};
}

const histCache = new Map<string, number>();
const inflightHist = new Map<string, Promise<number>>();

// ---------------------------------------------------------------------------
// Disk persistence (two-layer)
//   1. Bundled snapshot at src/data/ron-usd-history.json — read once at startup,
//      ships with the build so Vercel cold starts hit zero CryptoCompare calls
//      for historical dates. Regenerate with `node scripts/fetch-ron-history.mjs`.
//   2. Local write-through cache at <cwd>/data/ron-usd-history.json — only used
//      in dev (Vercel's filesystem is read-only at runtime). Newly-fetched days
//      are appended so a server restart doesn't re-burn CryptoCompare quota.
// Both fall through silently on any I/O error.
// ---------------------------------------------------------------------------
const SNAPSHOT_PATH = path.join(process.cwd(), "src", "data", "ron-usd-history.json");
const LOCAL_CACHE_PATH = path.join(process.cwd(), "data", "ron-usd-history.json");

function seedFromDisk(): void {
  for (const p of [SNAPSHOT_PATH, LOCAL_CACHE_PATH]) {
    try {
      if (!fs.existsSync(p)) continue;
      const raw = fs.readFileSync(p, "utf8");
      const obj = JSON.parse(raw) as Record<string, number>;
      let n = 0;
      for (const [k, v] of Object.entries(obj)) {
        if (typeof v === "number" && v > 0) {
          histCache.set(k, v);
          n++;
        }
      }
      if (n > 0) console.log(`[coingecko] seeded ${n} RON/USD entries from ${path.basename(p)}`);
    } catch {
      // silent
    }
  }
}
seedFromDisk();

let persistTimer: NodeJS.Timeout | null = null;
function persistHistCacheSoon(): void {
  if (persistTimer) return;
  persistTimer = setTimeout(() => {
    persistTimer = null;
    try {
      fs.mkdirSync(path.dirname(LOCAL_CACHE_PATH), { recursive: true });
      const obj: Record<string, number> = {};
      for (const [k, v] of histCache) obj[k] = v;
      fs.writeFileSync(LOCAL_CACHE_PATH, JSON.stringify(obj));
    } catch {
      // read-only fs on Vercel — silently skip.
    }
  }, 2000);
}

let currentCache: { price: number; at: number } | null = null;
let inflightCurrent: Promise<number> | null = null;

function ddmmyyyy(unixSeconds: number): string {
  const d = new Date(unixSeconds * 1000);
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const yyyy = d.getUTCFullYear();
  return `${dd}-${mm}-${yyyy}`;
}

// Concurrency limiter for CryptoCompare — free tier rate-limits aggressively.
const MAX_CC_CONCURRENT = 2;
let ccInFlight = 0;
const ccWaiters: Array<() => void> = [];
async function acquireCcSlot(): Promise<void> {
  if (ccInFlight < MAX_CC_CONCURRENT) {
    ccInFlight++;
    return;
  }
  await new Promise<void>((resolve) => ccWaiters.push(resolve));
  ccInFlight++;
}
function releaseCcSlot(): void {
  ccInFlight--;
  const next = ccWaiters.shift();
  if (next) next();
}

// Sentinel error used so callers can distinguish "fetch broke" (still throw)
// from "rate limit, try again later" (silent null is acceptable).
class RateLimitedError extends Error {}

async function fetchOrThrow(url: string): Promise<Response> {
  await acquireCcSlot();
  try {
    return await fetchOrThrowInner(url);
  } finally {
    releaseCcSlot();
  }
}

async function fetchOrThrowInner(url: string): Promise<Response> {
  const MAX = 8;
  let lastErr: unknown;
  for (let i = 0; i < MAX; i++) {
    try {
      const res = await fetch(url, {
        cache: "no-store",
        headers: ccHeaders(),
      });
      if (res.status === 429 || res.status >= 500) {
        if (i < MAX - 1) {
          const delay = Math.min(16000, 1000 * 2 ** i) + Math.random() * 500;
          await new Promise((r) => setTimeout(r, delay));
          continue;
        }
        throw new RateLimitedError(
          `CryptoCompare ${res.status} after ${MAX} attempts`,
        );
      }
      return res;
    } catch (err) {
      lastErr = err;
      const isRetryable =
        (err as { code?: string })?.code === "ECONNRESET" ||
        (err as Error)?.message?.includes("ECONNRESET") ||
        (err as Error)?.message?.includes("fetch failed") ||
        (err as Error)?.message?.includes("CryptoCompare");
      if (!isRetryable || i === MAX - 1) {
        throw err;
      }
      const delay = Math.min(16000, 500 * 2 ** i) + Math.random() * 500;
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

// Bulk-fetch chunks: one API call returns up to ~90 days of prices, dramatically
// reducing the number of CryptoCompare requests for wallets with acquisitions
// spread across many months.
const CHUNK_DAYS = 90;
const inflightChunk = new Map<string, Promise<void>>();

// Chunk key = "YYYY-MM-rounded" identifier for a 90-day window ending at the
// nearest later chunk boundary. Different timestamps within the same chunk
// dedupe to a single fetch.
function chunkKey(unixSeconds: number): string {
  const chunkSeconds = CHUNK_DAYS * 86400;
  const aligned = Math.floor(unixSeconds / chunkSeconds) * chunkSeconds;
  return String(aligned);
}

async function fetchChunk(unixSeconds: number): Promise<void> {
  // Request 90 days ending at the chunk's upper boundary so any timestamp
  // inside the chunk gets the full window cached.
  const chunkSeconds = CHUNK_DAYS * 86400;
  const aligned =
    Math.floor(unixSeconds / chunkSeconds) * chunkSeconds + chunkSeconds;
  const url = `${BASE}/v2/histoday?fsym=${SYMBOL}&tsym=USD&limit=${CHUNK_DAYS}&toTs=${aligned}`;
  const res = await fetchOrThrow(url);
  if (!res.ok) {
    throw new Error(`CryptoCompare histoday chunk -> ${res.status}`);
  }
  const json = (await res.json()) as {
    Response?: string;
    Message?: string;
    Data?: { Data?: Array<{ time: number; close: number }> };
  };
  if (json.Response !== "Success") {
    const msg = json.Message ?? "unknown error";
    // CryptoCompare returns the free-tier monthly cap message as a 200 OK
    // with this body. Treat it as a rate limit so the caller can degrade
    // gracefully instead of failing the whole route.
    if (/rate limit|upgrade your account/i.test(msg)) {
      throw new RateLimitedError(`CryptoCompare histoday chunk: ${msg}`);
    }
    throw new Error(`CryptoCompare histoday chunk: ${msg}`);
  }
  const candles = json.Data?.Data ?? [];
  // Cache every candle in the response. CryptoCompare returns 0 for dates
  // before the token existed — skip those so a future authoritative result
  // can fill them in.
  let added = 0;
  for (const c of candles) {
    if (c.close > 0) {
      const k = ddmmyyyy(c.time);
      if (!histCache.has(k)) added++;
      histCache.set(k, c.close);
    }
  }
  if (added > 0) persistHistCacheSoon();
}

/**
 * Daily close price (USD) for the UTC day containing `unixSeconds`.
 * Backed by a 90-day bulk-fetch cache: the first request for any day in a
 * chunk fetches the whole window, future calls in that window are cache hits.
 * Throws on persistent fetch failure.
 */
export async function ronUsdAt(unixSeconds: number): Promise<number | null> {
  const dayKey = ddmmyyyy(unixSeconds);
  if (histCache.has(dayKey)) return histCache.get(dayKey)!;

  const ck = chunkKey(unixSeconds);
  let chunkPromise = inflightChunk.get(ck);
  if (!chunkPromise) {
    chunkPromise = fetchChunk(unixSeconds);
    inflightChunk.set(ck, chunkPromise);
    chunkPromise.finally(() => inflightChunk.delete(ck));
  }
  try {
    await chunkPromise;
  } catch (err) {
    // Rate-limited / API exhaustion: degrade gracefully — return null so the
    // route still surfaces holdings + floors. The user can retry to fill in
    // USD figures once CryptoCompare lets us through.
    if (err instanceof RateLimitedError) return null;
    throw err;
  }

  if (histCache.has(dayKey)) return histCache.get(dayKey)!;
  // Chunk loaded but this specific date had no data (e.g. before token existed).
  return null;
}

export async function ronUsdNow(): Promise<number | null> {
  const TTL_MS = 60_000;
  if (currentCache && Date.now() - currentCache.at < TTL_MS) {
    return currentCache.price;
  }
  if (inflightCurrent) return inflightCurrent;
  inflightCurrent = (async (): Promise<number> => {
    const url = `${BASE}/price?fsym=${SYMBOL}&tsyms=USD`;
    const res = await fetchOrThrow(url);
    if (!res.ok) {
      throw new Error(`CryptoCompare price/now -> ${res.status}`);
    }
    const json = (await res.json()) as {
      USD?: number;
      Response?: string;
      Message?: string;
    };
    const usd = typeof json.USD === "number" ? json.USD : null;
    if (usd == null) {
      const msg = json.Message ?? "no USD field";
      if (/rate limit|upgrade your account/i.test(msg)) {
        throw new RateLimitedError(`CryptoCompare price/now: ${msg}`);
      }
      throw new Error(`CryptoCompare price/now: ${msg}`);
    }
    currentCache = { price: usd, at: Date.now() };
    return usd;
  })();
  try {
    return await inflightCurrent;
  } catch (err) {
    if (err instanceof RateLimitedError) {
      // Return the stale cache if we have one; otherwise null.
      return currentCache?.price ?? (null as unknown as number);
    }
    throw err;
  } finally {
    inflightCurrent = null;
  }
}
