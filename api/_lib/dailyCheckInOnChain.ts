// LEGACY shim — kept only to satisfy the admin smoke-test endpoint, which
// used to fire a server-signed relayer `checkIn(address)` call. The contract
// migrated to the Voyages-compatible `checkIn()` (msg.sender) pattern in
// commit 95d51b0, which makes a server-side write impossible: the contract
// would record the server's wallet as the user, not the player.
//
// What this file now does: a READ-ONLY `hasCheckedInToday(player)` query
// against the new contract. The admin smoke-test panel uses this to verify
// "does this wallet have an on-chain check-in today?" without trying to
// write anything.
//
// The actual write path now lives in:
//   - src/auth/dailyCheckInChain.ts  (client signs from player's wallet)
//   - api/_lib/dailyCheckInVerify.ts  (server verifies the player's tx hash)

import type { Address } from "viem";

const ENABLED = process.env.DAILY_CHECKIN_ENABLED === "1";
const CONTRACT_ADDR_RAW = process.env.DAILY_CHECKIN_CONTRACT_ADDR ?? "";
const CHAIN_ID = Number(process.env.DAILY_CHECKIN_CHAIN_ID ?? 2020);
const DEFAULT_RPC_FOR_CHAIN: Record<number, string> = {
  2020: "https://api.roninchain.com/rpc",
  2021: "https://saigon-testnet.roninchain.com/rpc",
};
const RPC_URL = process.env.DAILY_CHECKIN_RPC_URL ?? DEFAULT_RPC_FOR_CHAIN[CHAIN_ID] ?? DEFAULT_RPC_FOR_CHAIN[2020];

/** keccak256("hasCheckedInToday(address)") first 4 bytes. The contract's
 *  read function: returns bool. */
const HAS_CHECKED_IN_TODAY_SELECTOR = "0xdd14d9b8";

/** keccak256("getCurrentStreak(address)") first 4 bytes. Returns uint256.
 *  Zero when the player missed today (matches the Ronin template semantic). */
const GET_CURRENT_STREAK_SELECTOR = "0xb9d23c87";

export interface CheckInResult {
  ok: boolean;
  /** True if the player has an on-chain check-in for today. */
  hasCheckedInToday?: boolean;
  /** Current streak as reported by the contract (0 if today was missed). */
  currentStreak?: number;
  /** Convenience: the most recent on-chain tx hash sent by this player to
   *  the DailyCheckIn contract, if findable. Currently unused — placeholder
   *  for future enrichment. */
  txHash?: string;
  reason?: string;
}

export function isOnChainCheckInEnabled(): boolean {
  return ENABLED && /^0x[0-9a-fA-F]{40}$/.test(CONTRACT_ADDR_RAW);
}

interface JsonRpcResponse<T> { result?: T; error?: { message: string } }

async function ethCall(to: string, data: string): Promise<string | null> {
  try {
    const r = await fetch(RPC_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "eth_call",
        params: [{ to, data }, "latest"],
      }),
    });
    if (!r.ok) return null;
    const j = await r.json() as JsonRpcResponse<string>;
    if (j.error) return null;
    return typeof j.result === "string" ? j.result : null;
  } catch { return null; }
}

/** Pad a 20-byte address to a 32-byte ABI argument (left-pad with zeros). */
function encodeAddress(addr: string): string {
  const hex = addr.toLowerCase().replace(/^0x/, "");
  return hex.padStart(64, "0");
}

/** Read-only check: "does `player` have an on-chain check-in for today?"
 *  Used by the admin smoke-test panel to verify env-var wiring + contract
 *  reachability + the player's claim status WITHOUT trying to write
 *  (impossible with the new msg.sender contract design). */
export async function callOnChainCheckIn(player: Address): Promise<CheckInResult> {
  if (!isOnChainCheckInEnabled()) {
    return { ok: true, reason: "on-chain integration not configured (no-op)" };
  }
  // 1. hasCheckedInToday(player) → bool
  const hasData = HAS_CHECKED_IN_TODAY_SELECTOR + encodeAddress(player);
  const hasRaw = await ethCall(CONTRACT_ADDR_RAW, hasData);
  if (hasRaw === null) {
    return { ok: false, reason: "RPC call failed (contract unreachable or wrong network)" };
  }
  // bool encoding: 0x000...001 for true, 0x000...000 for false
  const hasCheckedInToday = /[1-9a-f]/.test(hasRaw.slice(2));

  // 2. getCurrentStreak(player) → uint256 (zero if today was missed)
  const streakData = GET_CURRENT_STREAK_SELECTOR + encodeAddress(player);
  const streakRaw = await ethCall(CONTRACT_ADDR_RAW, streakData);
  let currentStreak = 0;
  if (streakRaw !== null && /^0x[0-9a-fA-F]+$/.test(streakRaw)) {
    try { currentStreak = parseInt(streakRaw, 16); } catch { /* leave 0 */ }
  }

  return {
    ok: true,
    hasCheckedInToday,
    currentStreak,
    reason: hasCheckedInToday
      ? `${player} has checked in today (streak = ${currentStreak})`
      : `${player} has NOT checked in today (last streak = ${currentStreak})`,
  };
}
