// Daily login bonus + streak. Resets at 08:00 Asia/Manila to match the
// energy refill boundary. Claiming today extends the streak; missing a day
// resets to 1.

import { getJson, setJson, setNxWithExpire } from "./redis.js";
import { getEnergy, ENERGY_MAX } from "./energy.js";
import { verifyDailyCheckInTx, isDailyCheckInChainEnabled } from "./dailyCheckInVerify.js";

const PH_OFFSET_MS = 8 * 60 * 60 * 1000;
const RESET_HOUR = 8;
const TTL_SECONDS = 60 * 60 * 24 * 60; // 60d

export interface DailyReward { energy: number; multiplier: number; }

/** Reward for the day-N login (capped at 5+). */
export function rewardForStreak(streak: number): DailyReward {
  if (streak <= 1) return { energy: 3, multiplier: 1.0 };
  if (streak === 2) return { energy: 4, multiplier: 1.1 };
  if (streak === 3) return { energy: 5, multiplier: 1.2 };
  if (streak === 4) return { energy: 5, multiplier: 1.3 };
  return { energy: 5, multiplier: 1.5 };
}

interface DailyState {
  streak: number;
  /** UTC ms of the 08:00 PH boundary that began the most recently claimed day. */
  lastClaim: number;
  /** Multiplier active for the most recently claimed day. */
  multiplier: number;
}

function key(address: string): string { return `daily:${address.toLowerCase()}`; }

export function lastResetBoundary(now = Date.now()): number {
  const phNow = new Date(now + PH_OFFSET_MS);
  const phY = phNow.getUTCFullYear();
  const phM = phNow.getUTCMonth();
  const phD = phNow.getUTCDate();
  const phH = phNow.getUTCHours();
  const dayOffset = phH < RESET_HOUR ? -1 : 0;
  return Date.UTC(phY, phM, phD + dayOffset, RESET_HOUR) - PH_OFFSET_MS;
}

async function read(address: string): Promise<DailyState> {
  const raw = await getJson<DailyState>(key(address));
  if (raw && Number.isFinite(raw.streak) && Number.isFinite(raw.lastClaim)) {
    return {
      streak: Math.max(0, Math.floor(raw.streak)),
      lastClaim: raw.lastClaim,
      multiplier: typeof raw.multiplier === "number" ? raw.multiplier : 1.0,
    };
  }
  return { streak: 0, lastClaim: 0, multiplier: 1.0 };
}

async function write(address: string, s: DailyState): Promise<void> {
  await setJson(key(address), s, TTL_SECONDS);
}

// Energy storage is keyed in api/_lib/energy.ts. Claim writes the bonus
// directly into that key so we don't depend on a public setter.
const ENERGY_TTL = 60 * 60 * 24 * 30;
function energyKey(address: string): string { return `energy:${address.toLowerCase()}`; }
async function setEnergyAmount(address: string, amount: number, lastReset: number): Promise<void> {
  await setJson(energyKey(address), { amount, lastReset }, ENERGY_TTL);
}

export interface DailyStatus {
  streak: number;
  claimedToday: boolean;
  todayReward: DailyReward;     // what you'd get by claiming right now
  multiplier: number;            // active multiplier; 1.0 if not claimed today
}

export async function getDailyStatus(address: string): Promise<DailyStatus> {
  const cur = await read(address);
  const today = lastResetBoundary();
  const claimedToday = cur.lastClaim >= today;
  const multiplier = claimedToday ? cur.multiplier : 1.0;

  const yesterday = today - 24 * 60 * 60 * 1000;
  const wouldBeStreak = claimedToday
    ? cur.streak
    : (cur.lastClaim >= yesterday ? cur.streak + 1 : 1);
  const todayReward = rewardForStreak(wouldBeStreak);

  return { streak: cur.streak, claimedToday, todayReward, multiplier };
}

export interface DailyClaimResult {
  ok: boolean;
  reason?: "already_claimed" | "onchain_failed" | "onchain_required";
  /** Human-readable detail when reason === "onchain_failed" / "onchain_required".
   *  Surfaced to the player so they know exactly why the in-game claim was held
   *  back (tx not found, wrong sender, reverted, too old, already used, etc.). */
  onchainError?: string;
  /** Transaction hash of the player-signed on-chain checkIn that was verified. */
  txHash?: string;
  streak: number;
  reward: DailyReward;
  energy: number;       // new energy balance after the bonus
  multiplier: number;
}

/** Claim today's daily bonus.
 *
 *  When on-chain integration is enabled (DAILY_CHECKIN_CONTRACT_ADDR set),
 *  `txHash` is REQUIRED — the client must have already signed a `checkIn()`
 *  tx from the player's Ronin Wallet and submitted the hash here. We verify
 *  the hash on-chain (from = player, to = contract, status = success, not
 *  stale, not already used) before granting the in-game reward. This is the
 *  Voyages-compatible flow: the player's msg.sender is on-chain, so Ronin's
 *  Daily Check-In tracker recognizes it.
 *
 *  When on-chain integration is disabled (env var unset), `txHash` is ignored
 *  and we grant the reward unconditionally — useful for local dev / preview
 *  environments where you don't want to require a real wallet popup. */
export async function claimDaily(address: string, txHash?: string): Promise<DailyClaimResult> {
  const cur = await read(address);
  const today = lastResetBoundary();
  const yesterday = today - 24 * 60 * 60 * 1000;

  if (cur.lastClaim >= today) {
    const e = await getEnergy(address);
    return {
      ok: false,
      reason: "already_claimed",
      streak: cur.streak,
      reward: rewardForStreak(cur.streak),
      energy: e.amount,
      multiplier: cur.multiplier,
    };
  }

  // On-chain verification BEFORE the dedup lock so a missing/invalid txHash
  // doesn't burn the 30s lock window. The verify function is idempotent and
  // cheap to call.
  if (isDailyCheckInChainEnabled()) {
    if (!txHash || typeof txHash !== "string") {
      const e = await getEnergy(address);
      return {
        ok: false,
        reason: "onchain_required",
        onchainError: "this build requires a signed on-chain checkIn() tx before claiming. Please sign in your wallet.",
        streak: cur.streak,
        reward: rewardForStreak(cur.streak + 1),
        energy: e.amount,
        multiplier: cur.multiplier,
      };
    }
    const verify = await verifyDailyCheckInTx(address, txHash);
    if (!verify.ok) {
      const e = await getEnergy(address);
      return {
        ok: false,
        reason: "onchain_failed",
        onchainError: verify.reason,
        streak: cur.streak,
        reward: rewardForStreak(cur.streak + 1),
        energy: e.amount,
        multiplier: cur.multiplier,
      };
    }
  }

  // Atomic lock: only one request per (wallet, dayBoundary) tuple wins. The
  // lock TTL is 30s — long enough to let the rest of the claim finish, short
  // enough to self-clear if the function aborts mid-write.
  const lockKey = `daily:lock:${address.toLowerCase()}:${today}`;
  const acquired = await setNxWithExpire(lockKey, "1", 30);
  if (!acquired) {
    // Another concurrent request already claimed; reflect the latest state.
    const after = await read(address);
    const e = await getEnergy(address);
    return {
      ok: false,
      reason: "already_claimed",
      streak: after.streak,
      reward: rewardForStreak(after.streak),
      energy: e.amount,
      multiplier: after.multiplier,
    };
  }

  const newStreak = cur.lastClaim >= yesterday ? cur.streak + 1 : 1;
  const reward = rewardForStreak(newStreak);

  // Persist the state change first so a crash mid-claim doesn't double-grant.
  await write(address, { streak: newStreak, lastClaim: today, multiplier: reward.multiplier });

  // Add energy on top of current balance. Capped at ENERGY_MAX + reward so
  // the bonus is always meaningful even on a full pool.
  const e = await getEnergy(address);
  const newAmount = Math.min(ENERGY_MAX + reward.energy, e.amount + reward.energy);
  await setEnergyAmount(address, newAmount, e.lastReset);

  return { ok: true, streak: newStreak, reward, energy: newAmount, multiplier: reward.multiplier, txHash };
}

/** Currently-active XP multiplier for this wallet (1.0 if not claimed today). */
export async function getCurrentMultiplier(address: string): Promise<number> {
  const cur = await read(address);
  const today = lastResetBoundary();
  return cur.lastClaim >= today ? cur.multiplier : 1.0;
}
