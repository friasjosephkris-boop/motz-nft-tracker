// Oracle Energy — a repeatable 50/50 RON gamble in the shop's energy section.
//
// The player pays 1.5 RON; the server flips a crypto-RNG coin:
//   win  → +3 energy   (added directly to the pool)
//   lose → +1 energy
// Capped at ORACLE_DAILY_CAP plays per PH-day per wallet.
//
// Devtools-proof: the coin flip lives entirely server-side (Node crypto RNG),
// and the energy grant only happens after verifyShopPayment confirms a real
// 1.5 RON transfer to the treasury. Nothing on the client can fix the outcome
// or skip the payment.

import { getNumber, incrByWithExpire, setNxWithExpire } from "./redis.js";
import { adminGrantEnergy } from "./energy.js";
import { randomInt } from "node:crypto";

/** Per-play RON cost. Mirrors ITEM_PRICES_WEI["oracle_energy"] (1.5 RON). */
export const ORACLE_PRICE_RON = 1.5;
/** Energy granted on a winning flip. */
export const ORACLE_WIN_ENERGY = 3;
/** Energy granted on a losing flip (still a small consolation grant). */
export const ORACLE_LOSE_ENERGY = 1;
/** Max plays per wallet per PH-day. */
export const ORACLE_DAILY_CAP = 10;

const PH_OFFSET_MS = 8 * 60 * 60 * 1000;
const RESET_HOUR = 8;

/** Most recent past 08:00 PH boundary, in UTC ms — the daily-counter epoch. */
function phDayBoundary(now = Date.now()): number {
  const phNow = new Date(now + PH_OFFSET_MS);
  const phY = phNow.getUTCFullYear();
  const phM = phNow.getUTCMonth();
  const phD = phNow.getUTCDate();
  const phH = phNow.getUTCHours();
  const dayOffset = phH < RESET_HOUR ? -1 : 0;
  return Date.UTC(phY, phM, phD + dayOffset, RESET_HOUR) - PH_OFFSET_MS;
}

function playsKey(address: string): string {
  return `oracle:plays:${address.toLowerCase()}:${phDayBoundary()}`;
}

/** Plays this wallet has already spent since the last 08:00 PH boundary. */
export async function readOraclePlaysToday(address: string): Promise<number> {
  return await getNumber(playsKey(address));
}

/** Atomically claim a payment tx hash for a single Oracle play. Returns false
 *  if the hash was already claimed — this is the airtight replay guard: even
 *  if two concurrent requests both pass payment verification with the SAME
 *  tx hash, only one wins the SETNX and gets to roll. The other is rejected,
 *  so one 1.5 RON payment can never buy more than one roll.
 *  TTL is a year — far longer than needed, but gives a clean audit trail. */
export async function claimOracleTx(txHash: string): Promise<boolean> {
  return await setNxWithExpire(`oracle:tx:${txHash.toLowerCase()}`, "1", 60 * 60 * 24 * 365);
}

/** Atomically bump the daily play counter, returns the post-increment count.
 *  TTL is set to expire at the next PH boundary so the counter self-clears. */
async function bumpOraclePlays(address: string): Promise<number> {
  const remainingMs = phDayBoundary() + 24 * 60 * 60 * 1000 - Date.now();
  const ttl = Math.max(60, Math.floor(remainingMs / 1000));
  return await incrByWithExpire(playsKey(address), 1, ttl);
}

export interface OracleResult {
  ok: boolean;
  reason?: string;
  /** True on a winning flip. */
  won?: boolean;
  /** Energy units added to the pool (3 on win, 1 on loss). */
  energyGranted?: number;
  /** New total energy balance after the grant. */
  balance?: number;
  /** Plays used today after this play. */
  playsToday?: number;
  /** Plays still available today. */
  playsRemaining?: number;
}

/** Roll the oracle, bump the daily counter, and grant the energy.
 *  The CALLER must have already verified the 1.5 RON payment — this function
 *  assumes the play is paid for and unconditionally grants energy. */
export async function rollOracle(address: string): Promise<OracleResult> {
  const count = await bumpOraclePlays(address);
  // 50/50 — randomInt(2) is 0 or 1 with equal probability (crypto RNG).
  const won = randomInt(2) === 0;
  const grant = won ? ORACLE_WIN_ENERGY : ORACLE_LOSE_ENERGY;
  const balance = await adminGrantEnergy(address, grant);
  return {
    ok: true,
    won,
    energyGranted: grant,
    balance,
    playsToday: count,
    playsRemaining: Math.max(0, ORACLE_DAILY_CAP - count),
  };
}
