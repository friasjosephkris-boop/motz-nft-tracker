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

const q = `query Hist($a: String!, $id: String!) {
  erc721Token(tokenAddress: $a, tokenId: $id) {
    transferHistory(size: 10) {
      results { txHash timestamp from to withPrice paymentToken }
    }
  }
}`;
const r = await fetch("https://marketplace-graphql.skymavis.com/graphql", {
  method: "POST",
  headers: { "Content-Type": "application/json", "X-API-Key": KEY },
  body: JSON.stringify({ query: q, variables: { a: MOTZ, id: "37" } }),
});
const j = await r.json();
const rows = j.data?.erc721Token?.transferHistory?.results;
if (!rows) { console.log("Raw:", JSON.stringify(j, null, 2)); process.exit(0); }
console.log(`#37 transferHistory (${rows.length} rows):`);
for (const x of rows) {
  console.log(`  ${new Date(x.timestamp*1000).toISOString().slice(0,10)} ${x.from.slice(0,10)}... → ${x.to.slice(0,10)}... withPrice=${x.withPrice} tx=${x.txHash.slice(0,12)}...`);
}

// Find the sale TO markofthezeal — address ending in ...2ad6bbcf7
const saleRow = rows.find(x => x.to.toLowerCase().endsWith("2ad6bbcf7") || (x.from.toLowerCase() !== "0x0000000000000000000000000000000000000000" && x.to.toLowerCase() !== "0x0000000000000000000000000000000000000000"));

if (!saleRow) { console.log("No marketplace sale row found"); process.exit(0); }
console.log(`\nProbing tx ${saleRow.txHash}:`);

const tx = await fetch("https://api-gateway.skymavis.com/rpc", {
  method: "POST",
  headers: { "Content-Type": "application/json", "X-API-Key": KEY },
  body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_getTransactionByHash", params: [saleRow.txHash] }),
}).then(r => r.json()).then(j => j.result);
console.log(`  tx.value = ${tx.value} (${Number(BigInt(tx.value))/1e18} RON)`);

const rcpt = await fetch("https://api-gateway.skymavis.com/rpc", {
  method: "POST",
  headers: { "Content-Type": "application/json", "X-API-Key": KEY },
  body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_getTransactionReceipt", params: [saleRow.txHash] }),
}).then(r => r.json()).then(j => j.result);
const TT = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const motzTransfers = rcpt.logs.filter(l => l.topics[0] === TT && l.address.toLowerCase() === MOTZ.toLowerCase());
console.log(`  MotZ NFT transfers in this tx: ${motzTransfers.length}`);
console.log(`  Verdict: ${motzTransfers.length === 1 ? "SINGLE — code uses " + (Number(BigInt(tx.value))/1e18) + " RON" : "BATCH — code returns null (shows —)"}`);
