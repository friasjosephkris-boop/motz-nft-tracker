// Retry script: loads each MoTZ wallet that came back empty in the snapshot,
// one at a time with a 90s wait between each (gives the breaker its full
// 60s drain + buffer). Merges each successful load into the snapshot file
// directly so partial progress survives.
import fs from "node:fs";
import dns from "node:dns";
dns.setDefaultResultOrder("ipv4first");

const SNAPSHOT_PATH = "D:/Claude files/motz-nft-portfolio-tracker/data/motz-snapshot.json";
const ORIGIN = "http://localhost:3000";

const PRIMARIES = [
  "markofthezeal.ron",
  "masterofcoin.ron",
  "0x27f4cea185af16f6cf784359e203e0125bea4ffb",
  "motzvault.ron",
];
const TRANSFERRERS = [
  "markofthezeal.ron",
  "masterofcoin.ron",
  "0x27f4cea185af16f6cf784359e203e0125bea4ffb",
  "motzvault.ron",
  "0xb7ea94f09f680eb246d3cfcf47d9b4b8acdf23be",
  "0xf885cc3880dfac0d4a7abb4a9d4cf772ad6bbcf7",
];

const WAIT_MS_BETWEEN = 90_000;
const MAX_PASSES = 4;

function wait(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function readSnap() {
  return JSON.parse(fs.readFileSync(SNAPSHOT_PATH, "utf8"));
}

function writeSnap(s) {
  fs.writeFileSync(SNAPSHOT_PATH, JSON.stringify(s));
}

function countTokensByTag(snap) {
  const counts = new Map();
  for (const c of snap.collections) {
    for (const r of c.rows) {
      const tag = r.walletTag || "?";
      counts.set(tag, (counts.get(tag) || 0) + 1);
    }
  }
  return counts;
}

// Resolves RNS to address via /api/holdings's resolution (cheap: just makes
// the call return early with the resolved address even if downstream fails).
async function loadWallet(input) {
  const params = new URLSearchParams();
  params.set("address", input);
  for (const t of TRANSFERRERS) params.append("transferrer", t);
  const url = `${ORIGIN}/api/holdings?${params}`;
  console.log(`  GET ${input} ...`);
  const t0 = Date.now();
  const r = await fetch(url);
  const j = await r.json();
  const sec = ((Date.now() - t0) / 1000).toFixed(1);
  if (!r.ok || j.error) {
    console.log(`    FAILED in ${sec}s: ${j.error || `HTTP ${r.status}`}`);
    return null;
  }
  const tokenCount = (j.collections || []).reduce(
    (s, c) => s + c.rows.length,
    0,
  );
  const warnCount = (j.warnings || []).length;
  console.log(
    `    OK in ${sec}s — ${tokenCount} tokens, ${warnCount} internal warnings`,
  );
  return j;
}

function mergeIntoSnapshot(snap, data) {
  const tag = data.address;
  // Strip out any previous rows from this wallet so we don't double-count.
  for (const c of snap.collections) {
    c.rows = c.rows.filter((r) => r.walletTag !== tag);
  }
  const byContract = new Map(snap.collections.map((c) => [c.contract, c]));
  for (const c of data.collections) {
    const taggedRows = c.rows.map((row) => ({ ...row, walletTag: tag }));
    const existing = byContract.get(c.contract);
    if (existing) {
      existing.rows.push(...taggedRows);
    } else {
      snap.collections.push({
        contract: c.contract,
        name: c.name,
        symbol: c.symbol,
        slug: c.slug,
        rows: taggedRows,
      });
      byContract.set(c.contract, snap.collections[snap.collections.length - 1]);
    }
  }
  // Ensure resolvedAddresses includes this wallet.
  if (!snap.resolvedAddresses.includes(tag)) snap.resolvedAddresses.push(tag);
  if (data.currentRonUsd != null) snap.currentRonUsd = data.currentRonUsd;
  snap.generatedAt = Date.now();
  // Drop any partial/failure entries for this wallet — it just succeeded
  // (or returned 0 with warnings which we'll re-track on the new partials).
  snap.failures = (snap.failures || []).filter((f) => f.input !== data.address);
  snap.partials = (snap.partials || []).filter((p) => p.input !== data.address);
  if (data.warnings && data.warnings.length > 0) {
    const tokenCount = data.collections.reduce(
      (s, c) => s + c.rows.length,
      0,
    );
    snap.partials.push({
      input: data.address,
      tokens: tokenCount,
      warnings: data.warnings,
    });
  }
}

async function resolveInput(input) {
  // Use /api/holdings to resolve RNS to address — it returns resolvedAddr
  // even if downstream fails. Cheaper would be a dedicated /api/resolve but
  // we don't have one. So just call full load.
  if (/^0x[a-fA-F0-9]{40}$/.test(input)) return input.toLowerCase();
  // Use the load endpoint just to get the address out.
  const r = await fetch(
    `${ORIGIN}/api/holdings?address=${encodeURIComponent(input)}`,
  );
  const j = await r.json();
  return j.address?.toLowerCase() ?? null;
}

async function main() {
  // Map primary RNS → resolved address so we can identify by walletTag.
  const resolvedMap = new Map();
  for (const p of PRIMARIES) {
    if (/^0x[a-fA-F0-9]{40}$/.test(p)) {
      resolvedMap.set(p, p.toLowerCase());
    }
  }
  // Resolution from RNS uses a quick load — but to be safe, just try
  // resolving via direct lookup. Skip if already mapped.
  // (We'll figure out resolved addrs lazily from snapshot data.)

  for (let pass = 1; pass <= MAX_PASSES; pass++) {
    console.log(`\n=== Pass ${pass} ===`);
    let snap = readSnap();
    const tokensByTag = countTokensByTag(snap);
    console.log("Current token counts by walletTag:");
    for (const [tag, n] of tokensByTag) {
      console.log(`  ${tag.slice(0, 10)}... = ${n}`);
    }

    // Figure out which PRIMARY wallets have NO tokens in the snapshot.
    // We have the resolved address list — match each primary to its
    // resolved counterpart.
    const empties = [];
    for (const p of PRIMARIES) {
      // Try to match by checking if any resolvedAddress that came from this
      // primary has zero tokens.
      const candidate = snap.resolvedAddresses.find((a) => {
        // If primary is a 0x address, direct match
        if (/^0x[a-fA-F0-9]{40}$/.test(p)) return a.toLowerCase() === p.toLowerCase();
        // Otherwise just check partials/failures for matching input
        return false;
      });
      if (candidate && tokensByTag.get(candidate) > 0) {
        continue; // Already loaded with data
      }
      // Otherwise mark as needing reload
      empties.push(p);
    }

    if (empties.length === 0) {
      console.log("\nAll wallets have token data — done!");
      return;
    }
    console.log(`\nWallets needing reload (${empties.length}):`);
    for (const e of empties) console.log(`  ${e}`);

    for (let i = 0; i < empties.length; i++) {
      const wallet = empties[i];
      console.log(`\n[${i + 1}/${empties.length}] Loading ${wallet}`);
      const data = await loadWallet(wallet);
      if (data) {
        snap = readSnap(); // Re-read in case it changed during load
        mergeIntoSnapshot(snap, data);
        writeSnap(snap);
        const newCounts = countTokensByTag(snap);
        console.log(
          `    Merged. Total tokens for ${data.address.slice(0, 10)}... = ${newCounts.get(data.address) || 0}`,
        );
      }
      if (i < empties.length - 1) {
        console.log(`  Waiting ${WAIT_MS_BETWEEN / 1000}s before next wallet...`);
        await wait(WAIT_MS_BETWEEN);
      }
    }
  }
  console.log(`\nFinished ${MAX_PASSES} passes. Final state:`);
  const snap = readSnap();
  for (const [tag, n] of countTokensByTag(snap)) {
    console.log(`  ${tag.slice(0, 10)}... = ${n}`);
  }
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
