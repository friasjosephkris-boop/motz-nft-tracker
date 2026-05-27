// Generic CryptoCompare daily-history fetcher.
// Populates src/data/<slug>-usd-history.json for any supported symbol.
//
// Usage:
//   node scripts/fetch-usd-history.mjs <SYMBOL> <slug> [startISO]
//   node scripts/fetch-usd-history.mjs RONIN ron
//   node scripts/fetch-usd-history.mjs ETH   eth
//   node scripts/fetch-usd-history.mjs WETH  weth
//
// Re-run anytime to refresh; only new days are added.
// Requires CRYPTOCOMPARE_API_KEY in env (or .env.local) for higher rate limit.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const [, , SYMBOL, SLUG, START_ISO] = process.argv;
if (!SYMBOL || !SLUG) {
  console.error("Usage: node scripts/fetch-usd-history.mjs <SYMBOL> <slug> [startISO]");
  process.exit(1);
}

const OUT_PATH = path.join(ROOT, "src", "data", `${SLUG}-usd-history.json`);

// Load .env.local if present.
const envPath = path.join(ROOT, ".env.local");
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}

const CC_KEY = process.env.CRYPTOCOMPARE_API_KEY?.trim();
const headers = CC_KEY ? { Authorization: `Apikey ${CC_KEY}` } : {};

const BASE = "https://min-api.cryptocompare.com/data";

function ddmmyyyy(unixSeconds) {
  const d = new Date(unixSeconds * 1000);
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const yyyy = d.getUTCFullYear();
  return `${dd}-${mm}-${yyyy}`;
}

async function fetchChunk(toTs) {
  const url = `${BASE}/v2/histoday?fsym=${SYMBOL}&tsym=USD&limit=90&toTs=${toTs}`;
  for (let i = 0; i < 6; i++) {
    const res = await fetch(url, { headers });
    if (res.status === 429 || res.status >= 500) {
      const delay = Math.min(16000, 1000 * 2 ** i);
      console.warn(`  ${res.status}, retry in ${delay}ms`);
      await new Promise((r) => setTimeout(r, delay));
      continue;
    }
    const json = await res.json();
    if (json.Response !== "Success") {
      if (/rate limit|upgrade your account/i.test(json.Message ?? "")) {
        console.warn(`  rate-limited: ${json.Message}, retry in 5s`);
        await new Promise((r) => setTimeout(r, 5000));
        continue;
      }
      throw new Error(`CC: ${json.Message}`);
    }
    return json.Data?.Data ?? [];
  }
  throw new Error("retries exhausted");
}

const existing = fs.existsSync(OUT_PATH)
  ? JSON.parse(fs.readFileSync(OUT_PATH, "utf8"))
  : {};
console.log(`[${SYMBOL}] existing entries: ${Object.keys(existing).length}`);

const START = Math.floor(
  new Date(START_ISO || "2024-01-01T00:00:00Z").getTime() / 1000,
);
const END = Math.floor(Date.now() / 1000);
const CHUNK = 90 * 86400;

let added = 0;
for (let toTs = END; toTs > START; toTs -= CHUNK) {
  console.log(
    `[${SYMBOL}] chunk ending ${new Date(toTs * 1000).toISOString().slice(0, 10)}`,
  );
  const candles = await fetchChunk(toTs);
  for (const c of candles) {
    if (c.close > 0) {
      const k = ddmmyyyy(c.time);
      if (!(k in existing)) added++;
      existing[k] = c.close;
    }
  }
  await new Promise((r) => setTimeout(r, 250));
}

fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
fs.writeFileSync(OUT_PATH, JSON.stringify(existing, null, 0));
console.log(`[${SYMBOL}] wrote ${OUT_PATH}`);
console.log(`[${SYMBOL}] total entries: ${Object.keys(existing).length} (added ${added})`);
