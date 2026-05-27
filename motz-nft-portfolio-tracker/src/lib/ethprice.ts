import "server-only";
import fs from "node:fs";
import path from "node:path";

/**
 * ETH/USD daily-close lookups. Read-only: relies on the bundled history
 * at src/data/eth-usd-history.json (regenerate via
 * `node scripts/fetch-usd-history.mjs ETH eth`). No live network calls —
 * a recent daily close is "close enough" for cost-basis math, and the
 * absence of live calls keeps this rock-solid on Vercel cold starts.
 *
 * If you ever need a live spot price, fall back to the CryptoCompare
 * pattern used in `coingecko.ts` for RONIN.
 */

const HISTORY_PATH = path.join(
  process.cwd(),
  "src",
  "data",
  "eth-usd-history.json",
);

let cache: Record<string, number> | null = null;
let mostRecent: { date: string; price: number } | null = null;

function load(): Record<string, number> {
  if (cache) return cache;
  try {
    const raw = fs.readFileSync(HISTORY_PATH, "utf8");
    cache = JSON.parse(raw) as Record<string, number>;
    // Find the most-recent entry once at load time.
    let bestDate = "";
    let bestTs = 0;
    for (const k of Object.keys(cache)) {
      const [dd, mm, yyyy] = k.split("-");
      const ts = Date.UTC(Number(yyyy), Number(mm) - 1, Number(dd));
      if (ts > bestTs) {
        bestTs = ts;
        bestDate = k;
      }
    }
    if (bestDate) mostRecent = { date: bestDate, price: cache[bestDate] };
  } catch {
    cache = {};
  }
  return cache;
}

function ddmmyyyy(unixSeconds: number): string {
  const d = new Date(unixSeconds * 1000);
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const yyyy = d.getUTCFullYear();
  return `${dd}-${mm}-${yyyy}`;
}

/** ETH/USD daily close for the UTC day containing `unixSeconds`. */
export function ethUsdAt(unixSeconds: number): number | null {
  const map = load();
  const k = ddmmyyyy(unixSeconds);
  return map[k] ?? null;
}

/**
 * Most recent ETH/USD price in the bundled history. Used as the "current"
 * ETH/USD when computing floor-USD on the snapshot. Lives data sources
 * could replace this later — for now, daily closes are accurate enough.
 */
export function ethUsdNow(): number | null {
  load();
  return mostRecent?.price ?? null;
}
