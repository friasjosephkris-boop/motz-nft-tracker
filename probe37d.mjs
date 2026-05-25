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

// From explorer: the sale to markofthezeal (9 months ago) was tx 0x66b1...fb0429
// Let me search recent Ronin txs for the user — actually just try matching prefix
// In the previous screenshot the tx was "0x66b1...fb0429"
// I can find it by querying eth_getLogs for Transfer events from MOTZ to markofthezeal
// But we know markofthezeal.ron resolves to some address ending in 2ad6bbcf7

// Simpler: try a few candidate hashes from previous context. Actually I'll
// fetch by searching the MOTZ contract logs for tokenId=37 transfers.
const FROM_BLOCK = "0x243d600"; // 38,000,000

// Topic for Transfer(address,address,uint256), filtered by tokenId=37
const tokenTopic = "0x" + (37).toString(16).padStart(64, "0");
const TT = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

const logs = await fetch("https://api-gateway.skymavis.com/rpc", {
  method: "POST",
  headers: { "Content-Type": "application/json", "X-API-Key": KEY },
  body: JSON.stringify({
    jsonrpc: "2.0", id: 1, method: "eth_getLogs",
    params: [{
      fromBlock: FROM_BLOCK, toBlock: "latest",
      address: MOTZ,
      topics: [TT, null, null, tokenTopic],
    }],
  }),
}).then(r => r.json());

console.log("Transfer logs for #37:");
const events = logs.result ?? [];
for (const ev of events) {
  console.log(`  block=${parseInt(ev.blockNumber,16)} tx=${ev.transactionHash}`);
  console.log(`    from=0x${ev.topics[1].slice(-40)} to=0x${ev.topics[2].slice(-40)}`);
}

// Look at the second event (after mint) — should be the sale
const saleEv = events[1]; // mint = [0], sale to markofthezeal = [1]
if (saleEv) {
  console.log(`\nProbing sale tx ${saleEv.transactionHash}:`);
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
  console.log(`  MotZ NFT transfers in this tx: ${motzTransfers.length}`);
  if (motzTransfers.length > 1) {
    console.log(`  Token IDs in this batch:`);
    for (const t of motzTransfers) {
      console.log(`    #${parseInt(t.topics[3], 16)}`);
    }
    console.log(`\n  VERDICT: BATCH — tx.value (${Number(BigInt(tx.value))/1e18} RON) is total for ${motzTransfers.length} NFTs`);
    console.log(`  Our code → txSingleNftPrice returns null → cost shows "—" for #37  ✓`);
  } else {
    console.log(`  VERDICT: SINGLE — code uses ${Number(BigInt(tx.value))/1e18} RON as #37's cost`);
  }
}
