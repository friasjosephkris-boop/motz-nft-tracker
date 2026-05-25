import fs from "node:fs";
import path from "node:path";

// Load .env.local
const envPath = "D:/Claude files/motz-nft-portfolio-tracker/.env.local";
const env = Object.fromEntries(
  fs.readFileSync(envPath, "utf8").split("\n")
    .filter(l => l.includes("="))
    .map(l => l.split("=").map(s => s.trim()))
);
const KEY = env.SKY_MAVIS_API_KEY;
const MOTZ = "0x712b0029a1763ef2aac240a39091bada6bdae4f8";
const USER = "0xf885cc382d9aa3462ce06f536e2ad6bbcf7"; // markofthezeal.ron — need to resolve

// Resolve markofthezeal first
async function rns(name) {
  const r = await fetch("https://api-gateway.skymavis.com/rpc", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-API-Key": KEY },
    body: JSON.stringify({
      jsonrpc: "2.0", id: 1, method: "eth_call",
      params: [{
        to: "0x4f7b9b6d3e8a3aa57f1c2b6cb5e0a3a2bfa1d8b9", // RNS resolver (placeholder)
        data: "0x0178b8bf" + "0".padStart(64, "0"),
      }, "latest"],
    }),
  });
  return (await r.json());
}

// Actually just hardcode the address — we know it from previous sessions
// markofthezeal.ron = 0xf885cc382d9aa3462ce06f536e2ad6bbcf7 (let me check known data)
// Better: just query the transferHistory for #37 and grab the price
async function transferHistory() {
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
  return j.data?.erc721Token?.transferHistory?.results ?? j;
}

const hist = await transferHistory();
console.log("MotZ Coin #37 transferHistory:");
for (const r of hist) {
  console.log(`  ${new Date(r.timestamp * 1000).toISOString().slice(0,10)} ${r.from.slice(0,8)}... → ${r.to.slice(0,8)}... withPrice=${r.withPrice} token=${r.paymentToken}`);
  console.log(`    tx ${r.txHash}`);
}

// Now get the sale tx receipt to count NFT transfers
const saleRow = hist.find(r => r.to.toLowerCase().endsWith("2ad6bbcf7"));
if (saleRow) {
  console.log(`\nProbing sale tx ${saleRow.txHash}:`);
  const r = await fetch("https://api-gateway.skymavis.com/rpc", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-API-Key": KEY },
    body: JSON.stringify({
      jsonrpc: "2.0", id: 1, method: "eth_getTransactionByHash",
      params: [saleRow.txHash],
    }),
  });
  const tx = (await r.json()).result;
  console.log(`  tx.value = ${tx.value} (= ${Number(BigInt(tx.value)) / 1e18} RON)`);

  const r2 = await fetch("https://api-gateway.skymavis.com/rpc", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-API-Key": KEY },
    body: JSON.stringify({
      jsonrpc: "2.0", id: 1, method: "eth_getTransactionReceipt",
      params: [saleRow.txHash],
    }),
  });
  const rcpt = (await r2.json()).result;
  const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
  const motzTransfers = rcpt.logs.filter(l => l.topics[0] === TRANSFER_TOPIC && l.address.toLowerCase() === MOTZ.toLowerCase());
  console.log(`  MotZ NFT transfers in this tx: ${motzTransfers.length}`);
  if (motzTransfers.length > 1) {
    console.log(`  → BATCH purchase: tx.value (${Number(BigInt(tx.value)) / 1e18} RON) is for all ${motzTransfers.length} NFTs`);
    console.log(`  → Our code will correctly show "—" for individual token price`);
  } else {
    console.log(`  → Single NFT: tx.value IS the price for #37 — code uses ${Number(BigInt(tx.value)) / 1e18} RON`);
  }
}
