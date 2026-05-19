// Client wrappers for the daily-bonus endpoints.

import { loadSession } from "../auth/session";
import { setEnergy } from "./energy";

export interface DailyReward { energy: number; multiplier: number; }
export interface DailyStatus {
  streak: number;
  claimedToday: boolean;
  todayReward: DailyReward;
  multiplier: number;
}
export interface DailyClaimResult {
  ok: boolean;
  reason?: "already_claimed" | "onchain_failed";
  /** Detail string when reason === "onchain_failed" (RPC error, revert reason, etc.). */
  onchainError?: string;
  /** Transaction hash of the on-chain checkIn when the integration succeeded. */
  txHash?: string;
  streak: number;
  reward: DailyReward;
  energy: number;
  multiplier: number;
}

let cachedMultiplier = 1.0;
export function getCachedDailyMultiplier(): number { return cachedMultiplier; }
export function setCachedDailyMultiplier(n: number): void {
  cachedMultiplier = Number.isFinite(n) && n >= 1 ? n : 1.0;
}

function token(): string | null { return loadSession()?.token ?? null; }

export async function fetchDailyStatus(): Promise<DailyStatus | null> {
  const tok = token();
  if (!tok) return null;
  try {
    const r = await fetch("/api/daily", { headers: { Authorization: `Bearer ${tok}` } });
    if (!r.ok) return null;
    const data = await r.json() as DailyStatus;
    setCachedDailyMultiplier(data.multiplier);
    return data;
  } catch { return null; }
}

export async function claimDailyBonus(): Promise<DailyClaimResult | null> {
  const tok = token();
  if (!tok) return null;
  try {
    const r = await fetch("/api/daily", {
      method: "POST",
      headers: { Authorization: `Bearer ${tok}`, "Content-Type": "application/json" },
    });
    const data = await r.json() as DailyClaimResult;
    if (data.ok) {
      setEnergy(data.energy);
      setCachedDailyMultiplier(data.multiplier);
    }
    return data;
  } catch { return null; }
}
