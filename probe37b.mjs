import fs from "node:fs";
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
console.log("Raw response:", JSON.stringify(j, null, 2).slice(0, 2000));
