// Direct, paced metadata + floor fetch for the 40 null-rarity Fableborne
// rows in the bundled snapshot. Writes back to both data/ and src/data/.
// Run: `node patch-fableborne-nulls.mjs`
import fs from "node:fs";
import path from "node:path";

// Tiny env loader (avoids adding dotenv as a dep).
for (const line of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2];
}

const SKY_MAVIS_API_KEY = process.env.SKY_MAVIS_API_KEY;
if (!SKY_MAVIS_API_KEY) throw new Error("Missing SKY_MAVIS_API_KEY");

const GQL =
  process.env.SKY_MAVIS_GRAPHQL_URL ||
  "https://marketplace-graphql.skymavis.com/graphql";
const FABLEBORNE = "0x727b7ff568e7173134eb02517c4a87eac390a77b";
const TRAIT = "Rarity";

const SNAPSHOT_PATHS = [
  "data/motz-snapshot.json",
  "src/data/motz-snapshot.json",
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function gql(query, variables) {
  const res = await fetch(GQL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": SKY_MAVIS_API_KEY,
    },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
  const json = await res.json();
  if (json.errors) throw new Error(JSON.stringify(json.errors));
  return json.data;
}

async function tokenMetadata(contract, tokenId) {
  const q = `
    query OneToken($tokenAddress: String!, $tokenId: String!) {
      erc721Token(tokenAddress: $tokenAddress, tokenId: $tokenId) {
        tokenId
        attributes
      }
    }`;
  const d = await gql(q, { tokenAddress: contract.toLowerCase(), tokenId });
  // `attributes` is returned as a JSON scalar { [key]: string[] }.
  return d.erc721Token?.attributes ?? {};
}

// Floor by trait: cheapest active listing whose token has that attribute.
async function floorFor(traitValue) {
  const q = `
    query FloorByTrait($from: Int!, $size: Int!, $tokenAddress: String!, $criteria: [SearchCriteria!]) {
      erc721Tokens(
        from: $from
        size: $size
        sort: PriceAsc
        tokenAddress: $tokenAddress
        criteria: $criteria
        auctionType: Sale
      ) { results { order { currentPrice } } }
    }`;
  const d = await gql(q, {
    from: 0,
    size: 1,
    tokenAddress: FABLEBORNE,
    criteria: [{ name: TRAIT, values: [traitValue] }],
  });
  const wei = d.erc721Tokens?.results?.[0]?.order?.currentPrice;
  if (!wei) return null;
  return Number(BigInt(wei)) / 1e18;
}

async function main() {
  // Read whichever copy of the snapshot is freshest.
  const snap = JSON.parse(fs.readFileSync(SNAPSHOT_PATHS[0], "utf8"));
  const fk = snap.collections.find((c) => c.slug === "fableborne-kingdoms");
  const targets = fk.rows.filter((r) => !r.rarity);
  console.log(`Found ${targets.length} null-rarity Fableborne rows.`);
  if (targets.length === 0) return;

  const floorCache = new Map();
  let fixed = 0;
  let failed = 0;

  for (let i = 0; i < targets.length; i++) {
    const r = targets[i];
    const label = `${i + 1}/${targets.length} (#${r.tokenId})`;
    try {
      const attrs = await tokenMetadata(FABLEBORNE, r.tokenId);
      const rarity = attrs[TRAIT]?.[0] ?? null;
      if (!rarity) {
        console.log(`${label} no rarity attr — skipping`);
        failed++;
        await sleep(600);
        continue;
      }
      if (!floorCache.has(rarity)) {
        floorCache.set(rarity, await floorFor(rarity));
        await sleep(400);
      }
      const floorRon = floorCache.get(rarity);
      const currentRonUsd = r.currentRonUsd ?? snap.currentRonUsd;
      r.rarity = rarity;
      r.rarityLabel = rarity;
      r.floorRon = floorRon;
      r.floorUsd =
        floorRon != null && currentRonUsd != null
          ? floorRon * currentRonUsd
          : null;
      r.pnlUsd =
        r.costUsd != null && r.floorUsd != null
          ? r.floorUsd - r.costUsd
          : null;
      fixed++;
      console.log(
        `${label} -> rarity=${rarity}, floor=${floorRon} RON, pnl=${r.pnlUsd?.toFixed(2)}`,
      );
    } catch (err) {
      failed++;
      console.error(`${label} FAILED:`, err.message);
      // Back off harder on errors.
      await sleep(2000);
      continue;
    }
    await sleep(600);
  }

  // Write to both locations.
  for (const p of SNAPSHOT_PATHS) {
    fs.writeFileSync(p, JSON.stringify(snap, null, 2));
    console.log(`Wrote ${p}`);
  }
  console.log(`Done — fixed: ${fixed}, failed: ${failed}`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
