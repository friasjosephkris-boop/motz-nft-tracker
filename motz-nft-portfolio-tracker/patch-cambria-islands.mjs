// Direct OpenSea fetch for Cambria Islands holdings across the 4 MoTZ
// wallets. Writes a new collection block into the snapshot.
// Run: `node patch-cambria-islands.mjs`
import fs from "node:fs";

for (const line of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].trim();
}

const KEY = process.env.OPENSEA_API_KEY;
if (!KEY) throw new Error("Missing OPENSEA_API_KEY");

const SLUG = "cambriaislands";
const CONTRACT = "0xd479cc4b52a692b4dd82ead6ae082e161ac7c049";
const MINT_PRICE_ETH = 0.1;
const MINT_DATE_TS = Math.floor(new Date("2025-10-23T00:00:00Z").getTime() / 1000);

const WALLETS = [
  "0x37cedb10dfa478ce14423e24f745fd640b4cd989", // primary
  "0x466e70f677b3ebd99ff027ec13cc040f19978abc", // markofthezeal
  "0x8f6ab5bac76a285f90079ad754ef18e9ab5d6873", // masterofcoin
  "0x62101fdf7d454a6f4dc1474580c6af8bd7171ca4", // motzvault
  "0x27f4cea185af16f6cf784359e203e0125bea4ffb",
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function os(path) {
  const r = await fetch(`https://api.opensea.io/api/v2${path}`, {
    headers: { "x-api-key": KEY, accept: "application/json" },
  });
  if (!r.ok) throw new Error(`OS ${r.status}: ${path} — ${await r.text()}`);
  return r.json();
}

// Collection-wide floor as fallback.
const stats = await os(`/collections/${SLUG}/stats`);
const collectionFloor = stats.total?.floor_price ?? null;
console.log(`Collection floor: ${collectionFloor} ETH`);

// Per-tier floors — OpenSea's /best endpoint ignores trait filters, so
// we paginate through cheapest-first listings and look up each token's
// Size Class. First listing for each tier = tier floor. Stop when we
// either have all 5 tiers or exhaust a reasonable scan window.
console.log("Discovering per-tier floors via listing walk…");
const floorByTier = {};
const TIER_VALUES = new Set();
// Seed expected tier count from what we'll see across our wallets.
// We'll add discovered tiers in the loop and exit once they're all priced.
async function discoverFloors(maxListings = 200) {
  let next;
  let scanned = 0;
  for (let page = 0; page < 10; page++) {
    const qs = new URLSearchParams({ limit: "50" });
    if (next) qs.set("next", next);
    const data = await os(
      `/listings/collection/${SLUG}/best?${qs.toString()}`,
    );
    const listings = data.listings ?? [];
    for (const l of listings) {
      const tokenId =
        l.protocol_data?.parameters?.offer?.[0]?.identifierOrCriteria;
      const wei = l.price?.current?.value;
      if (!tokenId || !wei) continue;
      const priceEth = Number(BigInt(wei)) / 1e18;
      try {
        const detail = await os(
          `/chain/ethereum/contract/${CONTRACT}/nfts/${tokenId}`,
        );
        const tier = detail.nft?.traits?.find(
          (t) => t.trait_type === "Size Class",
        )?.value;
        if (!tier) continue;
        TIER_VALUES.add(tier);
        if (!(tier in floorByTier) || priceEth < floorByTier[tier]) {
          floorByTier[tier] = priceEth;
          console.log(`  ${tier}: ${priceEth} ETH (token #${tokenId})`);
        }
      } catch (err) {
        console.warn(`  trait lookup #${tokenId} failed:`, err.message);
      }
      await sleep(300);
      scanned++;
      if (scanned >= maxListings) return;
      // Early exit: if we've already priced 5 tiers (expected total) stop.
      if (Object.keys(floorByTier).length >= 5) return;
    }
    if (!data.next) return;
    next = data.next;
  }
}
await discoverFloors();
console.log(`Discovered floors:`, floorByTier);

// Lazy fallback: most-recent SALE price for a tier with no active listings.
const lastSaleByTier = {};
async function getLastTierSale(tier) {
  if (tier in lastSaleByTier) return lastSaleByTier[tier];
  console.log(`  scanning recent sales for ${tier} fallback…`);
  let next;
  let found = null;
  outer: for (let page = 0; page < 6; page++) {
    const qs = new URLSearchParams({ event_type: "sale", limit: "50" });
    if (next) qs.set("next", next);
    const data = await os(`/events/collection/${SLUG}?${qs.toString()}`);
    for (const ev of data.asset_events ?? []) {
      const tokenId = ev.nft?.identifier;
      const wei = ev.payment?.quantity;
      if (!tokenId || !wei) continue;
      try {
        const detail = await os(
          `/chain/ethereum/contract/${CONTRACT}/nfts/${tokenId}`,
        );
        const t = detail.nft?.traits?.find(
          (x) => x.trait_type === "Size Class",
        )?.value;
        if (t === tier) {
          found = Number(BigInt(wei)) / 1e18;
          console.log(`    found ${tier} sale: ${found} ETH (#${tokenId})`);
          break outer;
        }
      } catch {}
      await sleep(250);
    }
    if (!data.next) break;
    next = data.next;
  }
  lastSaleByTier[tier] = found;
  return found;
}

async function getTierFloor(tier) {
  if (tier in floorByTier) return floorByTier[tier];
  // No active listing for this tier — fall back to most recent SALE.
  const sale = await getLastTierSale(tier);
  if (sale != null) {
    floorByTier[tier] = sale;
    return sale;
  }
  return collectionFloor;
}

// ETH USD: load bundled history, find most recent.
const ethHistory = JSON.parse(
  fs.readFileSync("src/data/eth-usd-history.json", "utf8"),
);
const keys = Object.keys(ethHistory).sort((a, b) => {
  const [da, ma, ya] = a.split("-").map(Number);
  const [db, mb, yb] = b.split("-").map(Number);
  return Date.UTC(yb, mb - 1, db) - Date.UTC(ya, ma - 1, da);
});
const currentEthUsd = ethHistory[keys[0]];
console.log(`  ETH/USD: $${currentEthUsd}`);

function ddmmyyyy(ts) {
  const d = new Date(ts * 1000);
  return `${String(d.getUTCDate()).padStart(2, "0")}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${d.getUTCFullYear()}`;
}
function ethUsdAt(ts) {
  return ethHistory[ddmmyyyy(ts)] ?? null;
}


const rows = [];
for (const addr of WALLETS) {
  console.log(`\nWallet ${addr.slice(0, 8)}…`);
  await sleep(400);
  const data = await os(
    `/chain/ethereum/account/${addr}/nfts?collection=${SLUG}&limit=200`,
  );
  const nfts = data.nfts ?? [];
  console.log(`  holds ${nfts.length} Cambria Islands`);

  for (const n of nfts) {
    await sleep(400);
    // Transferrer-aware cost basis: walk sale history newest-to-oldest
    // and find the first sale where the BUYER was any MoTZ wallet. That
    // sale's price is our cost basis even if the token was later moved
    // between MoTZ wallets without an on-chain sale.
    let costEth = MINT_PRICE_ETH;
    let acquiredAt = MINT_DATE_TS;
    let acquiredVia = "mint";
    let acquiredTxHash = null;
    try {
      const ev = await os(
        `/events/chain/ethereum/contract/${CONTRACT}/nfts/${n.identifier}?event_type=sale&limit=20`,
      );
      const sales = ev.asset_events ?? [];
      const motzSet = new Set(WALLETS.map((w) => w.toLowerCase()));
      const transferrerSale = sales.find((s) =>
        motzSet.has(s.to_address?.toLowerCase()),
      );
      if (transferrerSale) {
        acquiredAt = transferrerSale.event_timestamp;
        costEth =
          Number(BigInt(transferrerSale.payment?.quantity ?? "0")) / 1e18;
        acquiredTxHash = transferrerSale.transaction ?? null;
        acquiredVia =
          transferrerSale.to_address?.toLowerCase() === addr.toLowerCase()
            ? "sale"
            : "transfer";
      }
    } catch (err) {
      console.warn(`  sale lookup #${n.identifier} failed:`, err.message);
    }

    const ronUsdAtPurchase = ethUsdAt(acquiredAt);
    const costUsd =
      ronUsdAtPurchase != null ? costEth * ronUsdAtPurchase : null;

    // Per-token detail fetch — /account/{addr}/nfts strips traits in bulk
    // mode, so we hit the single-NFT endpoint to get Size Class.
    let rarity = null;
    try {
      const detail = await os(
        `/chain/ethereum/contract/${CONTRACT}/nfts/${n.identifier}`,
      );
      const traits = detail.nft?.traits ?? [];
      const sizeClass = traits.find(
        (t) => t.trait_type === "Size Class",
      );
      rarity = sizeClass?.value ?? null;
    } catch (err) {
      console.warn(`  trait lookup #${n.identifier} failed:`, err.message);
    }
    await sleep(400);
    const floorEth = rarity
      ? ((await getTierFloor(rarity)) ?? collectionFloor)
      : collectionFloor;
    const floorUsd =
      floorEth != null && currentEthUsd != null
        ? floorEth * currentEthUsd
        : null;
    const pnlUsd =
      costUsd != null && floorUsd != null ? floorUsd - costUsd : null;

    rows.push({
      tokenId: n.identifier,
      name: n.name ?? null,
      image: n.image_url ?? null,
      acquiredAt,
      acquiredTxHash,
      acquiredVia,
      rarity,
      rarityLabel: rarity,
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
    console.log(
      `  #${n.identifier} ${rarity ?? "?"} cost=${costEth}ETH floor=${floorEth}ETH pnl=${pnlUsd?.toFixed(2)}`,
    );
  }
}

console.log(`\nTotal rows: ${rows.length}`);

// Splice into both snapshot copies.
for (const p of ["data/motz-snapshot.json", "src/data/motz-snapshot.json"]) {
  const s = JSON.parse(fs.readFileSync(p, "utf8"));
  s.collections = s.collections.filter((c) => c.slug !== SLUG);
  if (rows.length > 0) {
    s.collections.push({
      contract: CONTRACT,
      name: "Cambria Islands",
      symbol: "CI",
      slug: SLUG,
      rows,
    });
  }
  fs.writeFileSync(p, JSON.stringify(s));
  console.log(`wrote ${p}`);
}
