// Client wrappers for the daily-bonus endpoints.

import { loadSession } from "../auth/session";
import { setEnergy } from "./energy";
import { signDailyCheckIn, isDailyCheckInChainEnabled } from "../auth/dailyCheckInChain";

export interface DailyReward { energy: number; multiplier: number; }
export interface DailyStatus {
  streak: number;
  claimedToday: boolean;
  todayReward: DailyReward;
  multiplier: number;
}
export interface DailyClaimResult {
  ok: boolean;
  reason?: "already_claimed" | "onchain_failed" | "onchain_required" | "user_cancelled";
  /** Detail string when reason === "onchain_failed" / "onchain_required"
   *  (RPC error, revert reason, malformed hash, etc.) — surface verbatim to
   *  the player so they know what to fix. */
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

/** Optional callback invoked when the on-chain signature step starts /
 *  finishes — UI uses it to show a "Signing daily check-in…" overlay
 *  during the wallet popup + tx submission. Phases:
 *    "signing"   — wallet popup is open, awaiting player approval
 *    "submitted" — tx submitted, server-side verification + grant in flight
 *    "done"      — claim flow complete (success or failure) */
export type DailyClaimPhase = "signing" | "submitted" | "done";

export async function claimDailyBonus(onPhase?: (phase: DailyClaimPhase) => void): Promise<DailyClaimResult | null> {
  const tok = token();
  if (!tok) return null;

  // ---- Phase 1: on-chain signature (if enabled) ----
  // The new contract uses msg.sender semantics, so the player MUST sign from
  // their own Ronin Wallet to get Voyages credit. No relayer fallback —
  // skipping the signature would skip Voyages eligibility, which defeats
  // the whole point of switching to this template.
  let txHash: string | undefined;
  if (isDailyCheckInChainEnabled()) {
    onPhase?.("signing");
    const signed = await signDailyCheckIn();
    if (!signed.ok) {
      onPhase?.("done");
      return {
        ok: false,
        reason: signed.cancelled ? "user_cancelled" : "onchain_failed",
        onchainError: signed.reason,
        streak: 0,
        reward: { energy: 0, multiplier: 1.0 },
        energy: 0,
        multiplier: 1.0,
      };
    }
    txHash = signed.txHash;
    onPhase?.("submitted");
  }

  // ---- Phase 2: POST to /api/daily ----
  // Server verifies the tx hash on-chain (from/to/status/freshness/idempotency)
  // and grants the in-game reward. If on-chain is disabled, txHash is just
  // omitted and the server falls through to a direct grant.
  try {
    const r = await fetch("/api/daily", {
      method: "POST",
      headers: { Authorization: `Bearer ${tok}`, "Content-Type": "application/json" },
      body: JSON.stringify(txHash ? { txHash } : {}),
    });
    const data = await r.json() as DailyClaimResult;
    if (data.ok) {
      setEnergy(data.energy);
      setCachedDailyMultiplier(data.multiplier);
    }
    onPhase?.("done");
    return data;
  } catch {
    onPhase?.("done");
    return null;
  }
}
