import dns from "node:dns";
dns.setDefaultResultOrder("ipv4first");
const KEY = process.env.SKY_MAVIS_API_KEY;
const RPC = "https://api-gateway.skymavis.com/rpc";
const CAMBRIA = "0x17f93440990354a442369d56baeb20ab56e73ab1";
const USER = "0x8f6ab5bac76a285f90079ad754ef18e9ab5d6873";
const STAKING = new Set([
  "0x036dce26656e7c4308da764176229f6d9ca7f157",
  "0x85405d9078876e5f9f580a48f5774bea2c0047a6",
]);

async function ownerOf(tokenId) {
  const data = "0x6352211e" + BigInt(tokenId).toString(16).padStart(64, "0");
  const r = await fetch(RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-API-Key": KEY },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "eth_call",
      params: [{ to: CAMBRIA, data }, "latest"],
    }),
  });
  const j = await r.json();
  return j.result && j.result !== "0x" ? "0x" + j.result.slice(-40) : null;
}

// Spot-check the 104 tokenIds from the route response
const routeIds = [
  137, 259, 513, 567, 615, 628, 630, 632, 633, 634, 854, 1021, 1073, 1121,
  1145, 1346, 1543, 2015, 2105, 2130, 2231, 2331, 2332, 2334, 2376, 2429,
  2430, 2433, 2441, 2442, 2445, 2486, 2488, 2641, 2845, 2899, 2901, 2926,
  2945, 2946, 2951, 2959, 3099, 3184, 3214, 3268, 3270, 3278, 3346, 3455,
  3789, 3814, 3816, 3864, 3898, 3902, 3903, 3904, 3905, 4042, 4062, 4143,
  4276, 4277, 4302, 4315, 4338, 4391, 4428, 4429, 4448, 4523, 4537, 4538,
  4540, 4624, 4732, 4783, 4882, 4887, 4935, 4953, 5055, 5075, 5077, 5105,
  5112, 5118, 5248, 5249, 5252, 5480, 5614, 5872, 7819, 9138, 9145, 9545,
  9648, 9757, 9818, 9899, 9947, 9948,
];

let staked = 0, notStaked = 0, userOwned = 0, other = 0;
const wrongRows = [];

await Promise.all(
  routeIds.map(async (id) => {
    const o = (await ownerOf(id))?.toLowerCase();
    if (!o) return;
    if (STAKING.has(o)) staked++;
    else if (o === USER) userOwned++;
    else {
      other++;
      wrongRows.push({ id, owner: o });
    }
  }),
);

console.log(`Sampled ${routeIds.length} tokenIds from route response:`);
console.log(`  At staking contract: ${staked}`);
console.log(`  Owned directly by user: ${userOwned}`);
console.log(`  Owned by someone else: ${other}`);
if (wrongRows.length > 0) {
  console.log("\nTokens shown in portfolio but NOT held by user or staking:");
  for (const w of wrongRows.slice(0, 15)) console.log(`  #${w.id} owner=${w.owner}`);
}
