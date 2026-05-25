// One-shot script to populate src/data/ron-usd-history.json with RON/USD daily
// closes from CryptoCompare. Re-run anytime to refresh; only new days are added.
//
// Usage:
//   node scripts/fetch-ron-history.mjs
//
// Requires CRYPTOCOMPARE_API_KEY in env (or .env.local) for higher rate limit.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const OUT_PATH = path.join(ROOT, "src", "data", "ron-usd-history.json");

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
const SYMBOL = "RONIN";

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
console.log(`existing entries: ${Object.keys(existing).length}`);

// Ronin launched ~Feb 2021; cover from Jan 2024 to today (covers all tracked mints).
const START = Math.floor(new Date("2024-01-01T00:00:00Z").getTime() / 1000);
const END = Math.floor(Date.now() / 1000);
const CHUNK = 90 * 86400;

let added = 0;
for (let toTs = END; toTs > START; toTs -= CHUNK) {
  console.log(`fetching chunk ending ${new Date(toTs * 1000).toISOString().slice(0, 10)}`);
  const candles = await fetchChunk(toTs);
  for (const c of candles) {
    if (c.close > 0) {
      const k = ddmmyyyy(c.time);
      if (!(k in existing)) added++;
      existing[k] = c.close;
    }
  }
  // Gentle pause between chunks.
  await new Promise((r) => setTimeout(r, 250));
}

fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
fs.writeFileSync(OUT_PATH, JSON.stringify(existing, null, 0));
console.log(`wrote ${OUT_PATH}`);
console.log(`total entries: ${Object.keys(existing).length} (added ${added})`);
