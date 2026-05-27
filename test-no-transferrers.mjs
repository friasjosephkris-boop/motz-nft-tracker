import dns from "node:dns";
dns.setDefaultResultOrder("ipv4first");

const WALLETS = [
  "markofthezeal.ron",
  "masterofcoin.ron",
  "0x27f4cea185af16f6cf784359e203e0125bea4ffb",
  "motzvault.ron",
];

for (const w of WALLETS) {
  const t0 = Date.now();
  const r = await fetch(`http://localhost:3000/api/holdings?address=${encodeURIComponent(w)}`);
  const j = await r.json();
  const sec = ((Date.now() - t0) / 1000).toFixed(1);
  const total = (j.collections || []).reduce((s, c) => s + c.rows.length, 0);
  const warnings = j.warnings?.length ?? 0;
  console.log(`${w.padEnd(50)} HTTP ${r.status}  ${sec}s  ${total} tokens  ${warnings} warnings`);
  if (warnings > 0 && warnings <= 3) {
    for (const w of j.warnings) console.log(`    ${w.slice(0, 120)}`);
  }
  // Wait 30s between wallets (no transferrers means much less load, but be polite)
  if (w !== WALLETS[WALLETS.length - 1]) await new Promise(r => setTimeout(r, 30000));
}
