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
  "0x466e70f677b3ebd99ff027ec13cc040f19978abc", // markofthezeal
  "0x8f6ab5bac76a285f90079ad754ef18e9ab5d6873", // masterofcoin
  "0x62101fdf7d454a6f4dc1474580c6af8bd7171ca4", // motzvault
  "0x27f4cea185af16f6cf784359e203e0125bea4ffb", // kris
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
// Per-tier floors filled in lazily once we discover which tiers our
// wallets actually own.
const floorByTier = {};
async function getTierFloor(tier) {
  if (tier in floorByTier) return floorByTier[tier];
  try {
    const data = await os(
      `/listings/collection/${SLUG}/best?` +
        new URLSearchParams({
          limit: "1",
          "trait[Size Class]": tier,
        }).toString(),
    );
    const listing = data.listings?.[0];
    const wei = listing?.price?.current?.value ?? null;
    floorByTier[tier] = wei != null ? Number(BigInt(wei)) / 1e18 : null;
  } catch (err) {
    console.warn(`  tier ${tier} floor failed:`, err.message);
    floorByTier[tier] = null;
  }
  console.log(`  tier "${tier}" floor: ${floorByTier[tier]} ETH`);
  await sleep(400);
  return floorByTier[tier];
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
