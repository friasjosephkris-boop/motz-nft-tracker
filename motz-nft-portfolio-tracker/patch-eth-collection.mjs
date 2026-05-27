// Generic patcher for an Ethereum-side tracked collection. Pulls
// holdings + cost basis (transferrer-aware) + per-tier floors from
// OpenSea and writes a collection block into the snapshot.
//
// Usage:
//   node patch-eth-collection.mjs <slug> <contract> <mintPriceEth> <mintDateISO> [traitName]
//
// Examples:
//   node patch-eth-collection.mjs cambriaislands 0xd479cc...c049 0.1 2025-10-23 "Size Class"
//   node patch-eth-collection.mjs fableborne-primordials-20 0xd355cd...f98d 0.02428968 2023-10-04 Rarity
import fs from "node:fs";

for (const line of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].trim();
}

const KEY = process.env.OPENSEA_API_KEY;
if (!KEY) throw new Error("Missing OPENSEA_API_KEY");

const [, , SLUG, CONTRACT, MINT_PRICE_STR, MINT_DATE, TRAIT_NAME = "Rarity"] =
  process.argv;
if (!SLUG || !CONTRACT || !MINT_PRICE_STR || !MINT_DATE) {
  console.error(
    "Usage: node patch-eth-collection.mjs <slug> <contract> <mintPriceEth> <mintDateISO> [traitName]",
  );
  process.exit(1);
}

const MINT_PRICE_ETH = Number(MINT_PRICE_STR);
const MINT_DATE_TS = Math.floor(
  new Date(`${MINT_DATE}T00:00:00Z`).getTime() / 1000,
);

const WALLETS = [
  "0x37cedb10dfa478ce14423e24f745fd640b4cd989", // primary
  "0x535b02b47d5d0d8b08ce93066c0660f717694998", // secondary primary (33 CI)
  "0x466e70f677b3ebd99ff027ec13cc040f19978abc", // markofthezeal
  "0x8f6ab5bac76a285f90079ad754ef18e9ab5d6873", // masterofcoin
  "0x62101fdf7d454a6f4dc1474580c6af8bd7171ca4", // motzvault
  "0x27f4cea185af16f6cf784359e203e0125bea4ffb",
];

const SNAPSHOT_PATHS = [
  "data/motz-snapshot.json",
  "src/data/motz-snapshot.json",
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function os(pathRel) {
  const res = await fetch(`https://api.opensea.io/api/v2${pathRel}`, {
    headers: { "x-api-key": KEY, accept: "application/json" },
  });
  if (!res.ok) throw new Error(`OS ${res.status}: ${pathRel} — ${await res.text()}`);
  return res.json();
}

// Collection-wide floor.
const stats = await os(`/collections/${SLUG}/stats`);
const collectionFloor = stats.total?.floor_price ?? null;
console.log(`Collection floor: ${collectionFloor} ETH`);

// Per-tier floor discovery via cheapest-first listing walk.
const floorByTier = {};
async function discoverFloors(maxListings = 200) {
  let next;
  let scanned = 0;
  for (let page = 0; page < 10; page++) {
    const qs = new URLSearchParams({ limit: "50" });
    if (next) qs.set("next", next);
    const data = await os(
      `/listings/collection/${SLUG}/best?${qs.toString()}`,
    );
    for (const l of data.listings ?? []) {
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
          (t) => t.trait_type === TRAIT_NAME,
        )?.value;
        if (!tier) continue;
        if (!(tier in floorByTier) || priceEth < floorByTier[tier]) {
          floorByTier[tier] = priceEth;
          console.log(`  ${tier}: ${priceEth} ETH (token #${tokenId})`);
        }
      } catch (err) {
        console.warn(`  trait #${tokenId} failed:`, err.message);
      }
      await sleep(300);
      scanned++;
      if (scanned >= maxListings) return;
      if (Object.keys(floorByTier).length >= 5) return;
    }
    if (!data.next) return;
    next = data.next;
  }
}
console.log("Discovering per-tier floors…");
await discoverFloors();

// ETH/USD lookup from bundled history.
const ethHistory = JSON.parse(
  fs.readFileSync("src/data/eth-usd-history.json", "utf8"),
);
const sortedKeys = Object.keys(ethHistory).sort((a, b) => {
  const [da, ma, ya] = a.split("-").map(Number);
  const [db, mb, yb] = b.split("-").map(Number);
  return Date.UTC(yb, mb - 1, db) - Date.UTC(ya, ma - 1, da);
});
const currentEthUsd = ethHistory[sortedKeys[0]];
console.log(`Current ETH/USD: $${currentEthUsd}`);

function ddmmyyyy(ts) {
  const d = new Date(ts * 1000);
  return `${String(d.getUTCDate()).padStart(2, "0")}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${d.getUTCFullYear()}`;
}
function ethUsdAt(ts) {
  return ethHistory[ddmmyyyy(ts)] ?? null;
}

const tierMarketSale = {};
const rows = [];

for (const addr of WALLETS) {
  console.log(`\nWallet ${addr.slice(0, 8)}…`);
  await sleep(400);
  const data = await os(
    `/chain/ethereum/account/${addr}/nfts?collection=${SLUG}&limit=200`,
  );
  const nfts = data.nfts ?? [];
  console.log(`  holds ${nfts.length} tokens`);

  for (const n of nfts) {
    await sleep(400);

    // Transferrer-aware cost basis.
    let costEth = MINT_PRICE_ETH;
    let acquiredAt = MINT_DATE_TS;
    let acquiredVia = "mint";
    let acquiredTxHash = null;
    let saleHistory = [];
    try {
      const ev = await os(
        `/events/chain/ethereum/contract/${CONTRACT}/nfts/${n.identifier}?event_type=sale&limit=20`,
      );
      saleHistory = ev.asset_events ?? [];
      const motzSet = new Set(WALLETS.map((w) => w.toLowerCase()));
      const motzSale = saleHistory.find((s) =>
        motzSet.has(s.buyer?.toLowerCase()),
      );
      if (motzSale) {
        acquiredAt = motzSale.event_timestamp;
        costEth =
          Number(BigInt(motzSale.payment?.quantity ?? "0")) / 1e18;
        acquiredTxHash = motzSale.transaction ?? null;
        // Any MoTZ-tracked wallet bought it = "Bought" label, cost
        // preserved across inter-MoTZ transfers.
        acquiredVia = "sale";
      } else if (saleHistory.length > 0) {
        // Non-tracked buyer in history → transferred in privately,
        // cost = 0 per policy. Keep timestamp/tx for "when" signal.
        const latest = saleHistory[0];
        acquiredAt = latest.event_timestamp;
        costEth = 0;
        acquiredTxHash = latest.transaction ?? null;
        acquiredVia = "transfer";
      } else {
        // No sale history. Check the original minter.
        try {
          const tev = await os(
            `/events/chain/ethereum/contract/${CONTRACT}/nfts/${n.identifier}?event_type=transfer&limit=20`,
          );
          const mint = (tev.asset_events ?? []).find((e) =>
            /^0x0+$/i.test(e.from_address ?? ""),
          );
          if (
            mint &&
            mint.to_address &&
            mint.to_address.toLowerCase() !== addr.toLowerCase()
          ) {
            acquiredVia = "transfer";
            costEth = 0;
          }
        } catch (err) {
          console.warn(`  mint lookup #${n.identifier} failed:`, err.message);
        }
      }
    } catch (err) {
      console.warn(`  sale history #${n.identifier} failed:`, err.message);
    }

    // Token's traits for rarity.
    let rarity = null;
    try {
      const detail = await os(
        `/chain/ethereum/contract/${CONTRACT}/nfts/${n.identifier}`,
      );
      rarity = detail.nft?.traits?.find(
        (t) => t.trait_type === TRAIT_NAME,
      )?.value ?? null;
    } catch (err) {
      console.warn(`  trait lookup #${n.identifier} failed:`, err.message);
    }
    await sleep(400);

    // Floor lookup (per-tier or collection).
    const floorEth = rarity && floorByTier[rarity] != null
      ? floorByTier[rarity]
      : collectionFloor;
    const ronUsdAtPurchase = ethUsdAt(acquiredAt);
    const costUsd =
      ronUsdAtPurchase != null ? costEth * ronUsdAtPurchase : null;
    const floorUsd =
      floorEth != null && currentEthUsd != null
        ? floorEth * currentEthUsd
        : null;
    const pnlUsd =
      costUsd != null && floorUsd != null ? floorUsd - costUsd : null;

    // Market signal for tier floor fallback.
    if (rarity && saleHistory.length > 0) {
      const latest = saleHistory[0];
      const priceEth = Number(BigInt(latest.payment?.quantity ?? "0")) / 1e18;
      if (priceEth > 0) {
        const prev = tierMarketSale[rarity];
        if (!prev || latest.event_timestamp > prev.ts) {
          tierMarketSale[rarity] = {
            ts: latest.event_timestamp,
            price: priceEth,
          };
        }
      }
    }

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
      `  #${n.identifier} ${rarity ?? "?"} via=${acquiredVia} cost=${costEth}ETH floor=${floorEth}ETH pnl=$${pnlUsd?.toFixed(2)}`,
    );
  }
}

// Post-pass: tier-market-sale fallback for missing floors.
let patched = 0;
for (const r of rows) {
  if (!r.rarity || r.floorRon !== collectionFloor) continue;
  const m = tierMarketSale[r.rarity];
  if (!m) continue;
  r.floorRon = m.price;
  r.floorUsd =
    m.price != null && r.currentRonUsd != null
      ? m.price * r.currentRonUsd
      : null;
  r.pnlUsd =
    r.costUsd != null && r.floorUsd != null ? r.floorUsd - r.costUsd : null;
  patched++;
}
if (patched > 0) {
  console.log(`\nPatched ${patched} rows with tier-market-sale floor.`);
}

console.log(`\nTotal rows: ${rows.length}`);

// Splice into both snapshot copies.
for (const p of SNAPSHOT_PATHS) {
  const s = JSON.parse(fs.readFileSync(p, "utf8"));
  s.collections = s.collections.filter((c) => c.slug !== SLUG);
  if (rows.length > 0) {
    s.collections.push({
      contract: CONTRACT.toLowerCase(),
      name: rows[0].name?.replace(/ #\d+$/, "") ?? SLUG,
      symbol: "", // not displayed
      slug: SLUG,
      rows,
    });
  }
  fs.writeFileSync(p, JSON.stringify(s));
  console.log(`wrote ${p}`);
}
