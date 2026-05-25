import fs from "node:fs";
import dns from "node:dns";
dns.setDefaultResultOrder("ipv4first");

const env = Object.fromEntries(
  fs.readFileSync("D:/Claude files/motz-nft-portfolio-tracker/.env.local", "utf8")
    .split("\n").filter(l => l.includes("=")).map(l => {
      const i = l.indexOf("="); return [l.slice(0,i).trim(), l.slice(i+1).trim()];
    })
);
const KEY = env.SKY_MAVIS_API_KEY;
const MOTZ = "0x712b0029a1763ef2aac240a39091bada6bdae4f8";
const TT = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const tokenTopic = "0x" + (37).toString(16).padStart(64, "0");

// Query from a much earlier block — MotZ deployed mid-2024
const logs = await fetch("https://api-gateway.skymavis.com/rpc", {
  method: "POST",
  headers: { "Content-Type": "application/json", "X-API-Key": KEY },
  body: JSON.stringify({
    jsonrpc: "2.0", id: 1, method: "eth_getLogs",
    params: [{
      fromBlock: "0x1c9c380", toBlock: "latest", // block 30,000,000
      address: MOTZ,
      topics: [TT, null, null, tokenTopic],
    }],
  }),
}).then(r => r.json());

if (logs.error) { console.log("RPC error:", logs.error); process.exit(0); }
const events = logs.result ?? [];
console.log(`Found ${events.length} Transfer events for #37`);
for (const ev of events) {
  console.log(`  block=${parseInt(ev.blockNumber,16)} tx=${ev.transactionHash}`);
  console.log(`    from=0x${ev.topics[1].slice(-40)} → to=0x${ev.topics[2].slice(-40)}`);
}

// Find the SALE — non-zero from, to markofthezeal (the second event chronologically)
if (events.length >= 2) {
  // Sort by block ascending
  events.sort((a,b) => parseInt(a.blockNumber,16) - parseInt(b.blockNumber,16));
  const saleEv = events[1]; // [0]=mint, [1]=first sale
  console.log(`\n=== Sale tx ${saleEv.transactionHash} ===`);

  const tx = await fetch("https://api-gateway.skymavis.com/rpc", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-API-Key": KEY },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_getTransactionByHash", params: [saleEv.transactionHash] }),
  }).then(r => r.json()).then(j => j.result);
  console.log(`  tx.value = ${tx.value} (${Number(BigInt(tx.value))/1e18} RON)`);

  const rcpt = await fetch("https://api-gateway.skymavis.com/rpc", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-API-Key": KEY },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_getTransactionReceipt", params: [saleEv.transactionHash] }),
  }).then(r => r.json()).then(j => j.result);
  const motzTransfers = rcpt.logs.filter(l => l.topics[0] === TT && l.address.toLowerCase() === MOTZ.toLowerCase());
  console.log(`  MotZ Transfer events in this tx: ${motzTransfers.length}`);
  if (motzTransfers.length > 1) {
    console.log(`  Token IDs:`);
    for (const t of motzTransfers) console.log(`    #${parseInt(t.topics[3], 16)}`);
    const perToken = (Number(BigInt(tx.value))/1e18) / motzTransfers.length;
    console.log(`\n  → BATCH purchase: ${motzTransfers.length} NFTs for ${Number(BigInt(tx.value))/1e18} RON total (avg ${perToken.toFixed(2)} RON / NFT)`);
    console.log(`  → Our txSingleNftPrice() returns NULL → costRon = null → UI shows "—"  ✓ CORRECT`);
  } else {
    console.log(`  → SINGLE NFT: ${Number(BigInt(tx.value))/1e18} RON is the price`);
    console.log(`  → Our code uses tx.value as #37's cost`);
  }
}
