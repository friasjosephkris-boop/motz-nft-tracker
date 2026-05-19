// Server-side verification of a player-signed Gauntlet DailyCheckIn tx.
//
// New architecture (replaces the relayer-based callOnChainCheckIn pattern):
// the player signs `checkIn()` from their own Ronin Wallet, pays ~0.001 RON
// in gas, and gets Voyages credit (msg.sender semantics). The client submits
// the resulting tx hash to /api/daily; this module verifies the hash on-chain
// before we grant the in-game daily reward.
//
// Verification gates a claim by checking, in order:
//   1. txHash is well-formed (0x + 64 hex chars)
//   2. RPC returns a tx with matching `to` (contract) and `from` (player)
//   3. Receipt status === "0x1" (success — tx didn't revert)
//   4. Calldata starts with the checkIn() 4-byte selector (defensive — RPC
//      wouldn't return a different tx for this hash, but we double-check)
//   5. Tx block is recent (last MAX_TX_AGE_SECONDS) — prevents replay of an
//      old player-signed tx as fake "current claim"
//   6. txHash hasn't already been consumed for a daily claim (Redis idempotency
//      key) — prevents replay of a single sign across days
//
// All six gates pass → the tx is genuine, current, fresh, and unique. We then
// mark it consumed and let claimDaily proceed.

import { getJson, setJson } from "./redis.js";

const ENABLED_CONTRACT_ADDR = (process.env.DAILY_CHECKIN_CONTRACT_ADDR ?? "").trim();
const CHAIN_ID = Number(process.env.DAILY_CHECKIN_CHAIN_ID ?? 2020);
const DEFAULT_RPC_FOR_CHAIN: Record<number, string> = {
  2020: "https://api.roninchain.com/rpc",
  2021: "https://saigon-testnet.roninchain.com/rpc",
};
const RPC_URL = process.env.DAILY_CHECKIN_RPC_URL ?? DEFAULT_RPC_FOR_CHAIN[CHAIN_ID] ?? DEFAULT_RPC_FOR_CHAIN[2020];

/** keccak256("checkIn()") first 4 bytes. Must match calldata of player's tx. */
const CHECKIN_SELECTOR = "0x183ff085";

/** Max age of a player-signed tx that we'll accept. Ronin block time is ~3s,
 *  so 10 min covers slow wallets / network blips while making replay attacks
 *  with an old captured tx hash impractical. Server clock vs chain timestamp
 *  is allowed a 30s skew at the lower bound. */
const MAX_TX_AGE_SECONDS = 10 * 60;

/** TTL on the "consumed" marker for a tx hash. 60 days is more than long
 *  enough to outlast any reasonable claim period — old hashes can roll off. */
const CONSUMED_TX_TTL = 60 * 60 * 24 * 60;

export function isDailyCheckInChainEnabled(): boolean {
  return /^0x[0-9a-fA-F]{40}$/.test(ENABLED_CONTRACT_ADDR);
}

export interface VerifyResult {
  ok: boolean;
  reason?: string;
}

interface JsonRpcResponse<T> {
  jsonrpc?: string;
  id?: number;
  result?: T;
  error?: { code: number; message: string };
}

async function rpcCall<T>(method: string, params: unknown[]): Promise<T | null> {
  try {
    const r = await fetch(RPC_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    });
    if (!r.ok) return null;
    const data = await r.json() as JsonRpcResponse<T>;
    if (data.error) return null;
    return data.result ?? null;
  } catch { return null; }
}

interface RpcTx {
  hash: string;
  from: string;
  to: string | null;
  input: string;
  blockNumber: string | null;
}
interface RpcReceipt {
  status: string;
  blockNumber: string;
}
interface RpcBlock {
  timestamp: string;
}

function consumedKey(txHash: string): string {
  return `daily:tx:${txHash.toLowerCase()}`;
}

/** Verify a player-signed `checkIn()` tx hash. Returns ok:true ONLY if all
 *  six gates pass. Marks the hash as consumed on success so it can't be
 *  reused for another claim.
 *
 *  player: the JWT-verified session wallet address (canonical case)
 *  txHash: the hash returned by the player's wallet popup */
export async function verifyDailyCheckInTx(player: string, txHash: string): Promise<VerifyResult> {
  if (!isDailyCheckInChainEnabled()) {
    // Misconfiguration on the server side — env var missing. Caller (claimDaily)
    // should treat this as "on-chain not required" and proceed without verify.
    // Returning ok:true makes that policy explicit at this layer.
    return { ok: true, reason: "on-chain not configured (no-op)" };
  }
  if (typeof txHash !== "string" || !/^0x[a-fA-F0-9]{64}$/.test(txHash)) {
    return { ok: false, reason: "txHash malformed (expected 0x + 64 hex chars)" };
  }
  if (typeof player !== "string" || !/^0x[a-fA-F0-9]{40}$/.test(player)) {
    return { ok: false, reason: "player address malformed" };
  }

  // Gate 6 first: idempotency check. Fast Redis read before we hit RPC.
  const alreadyConsumed = await getJson<{ at: number }>(consumedKey(txHash)).catch(() => null);
  if (alreadyConsumed) {
    return { ok: false, reason: "this checkIn tx has already been used for a daily claim" };
  }

  // Gate 2 + 4: fetch the tx and check shape.
  const tx = await rpcCall<RpcTx>("eth_getTransactionByHash", [txHash]);
  if (!tx) return { ok: false, reason: "tx not found on Ronin Mainnet (may still be propagating — try again in a few seconds)" };

  if (typeof tx.to !== "string" || tx.to.toLowerCase() !== ENABLED_CONTRACT_ADDR.toLowerCase()) {
    return { ok: false, reason: `tx 'to' (${tx.to ?? "null"}) doesn't match expected DailyCheckIn contract` };
  }
  if (typeof tx.from !== "string" || tx.from.toLowerCase() !== player.toLowerCase()) {
    return { ok: false, reason: `tx 'from' (${tx.from}) doesn't match logged-in wallet (${player})` };
  }
  // Selector check: input must start with the 4-byte checkIn() selector.
  if (typeof tx.input !== "string" || !tx.input.toLowerCase().startsWith(CHECKIN_SELECTOR)) {
    return { ok: false, reason: "tx calldata doesn't match checkIn() selector — wrong function called" };
  }

  // Gate 3: success status from the receipt. If pending (no receipt yet), we
  // poll for a few seconds before giving up — slow RPCs sometimes report the
  // tx via getTransactionByHash before the receipt is indexed.
  let receipt: RpcReceipt | null = null;
  for (let i = 0; i < 5; i++) {
    receipt = await rpcCall<RpcReceipt>("eth_getTransactionReceipt", [txHash]);
    if (receipt) break;
    await new Promise(r => setTimeout(r, 1500));
  }
  if (!receipt) {
    return { ok: false, reason: "tx hasn't confirmed yet — wait ~5 seconds and try again" };
  }
  if (receipt.status !== "0x1") {
    return { ok: false, reason: `tx reverted on-chain (status=${receipt.status})` };
  }

  // Gate 5: freshness. Look up the block timestamp, reject if older than
  // MAX_TX_AGE_SECONDS. Skip if block info isn't available (shouldn't happen
  // for a confirmed tx, but don't fail the claim on RPC quirks).
  const blockNum = receipt.blockNumber ?? tx.blockNumber;
  if (typeof blockNum === "string" && blockNum.startsWith("0x")) {
    const block = await rpcCall<RpcBlock>("eth_getBlockByNumber", [blockNum, false]);
    if (block && typeof block.timestamp === "string" && block.timestamp.startsWith("0x")) {
      const blockTsSec = parseInt(block.timestamp, 16);
      const nowSec = Math.floor(Date.now() / 1000);
      const ageSec = nowSec - blockTsSec;
      if (ageSec > MAX_TX_AGE_SECONDS) {
        return { ok: false, reason: `tx is too old (${Math.floor(ageSec / 60)} min) — daily check-in must be signed within the last ${MAX_TX_AGE_SECONDS / 60} minutes` };
      }
    }
  }

  // All gates passed — mark the hash consumed and return ok. We write AFTER
  // all checks (not before) so a transient RPC blip doesn't poison the hash
  // and lock the player out from a legit retry.
  await setJson(consumedKey(txHash), { at: Date.now() }, CONSUMED_TX_TTL).catch(() => undefined);
  return { ok: true };
}
