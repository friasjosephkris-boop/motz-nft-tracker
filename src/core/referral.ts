// Client wrappers for the referral system.
//
// Capture flow: a ?ref=CODE in the URL is stashed (unscoped localStorage —
// it's set before the wallet/scope is known) and submitted once, right after
// sign-in. The server decides eligibility (new wallet, not self, not already
// referred); the client just clears the pending code once it's resolved.

import { loadSession } from "../auth/session";

// Unscoped on purpose — written before auth, must survive a tab close so a
// player who bounces mid-signup still gets attributed on their next visit.
const PENDING_REF_KEY = "toz.pendingRef.v1";

export function setPendingRefCode(code: string): void {
  try { localStorage.setItem(PENDING_REF_KEY, code.trim().toUpperCase()); } catch { /* ignore */ }
}
export function getPendingRefCode(): string | null {
  try {
    const v = localStorage.getItem(PENDING_REF_KEY);
    return v && v.trim().length > 0 ? v.trim() : null;
  } catch { return null; }
}
export function clearPendingRefCode(): void {
  try { localStorage.removeItem(PENDING_REF_KEY); } catch { /* ignore */ }
}

function token(): string | null { return loadSession()?.token ?? null; }

export interface ReferralReferee {
  address: string;
  ign: string | null;
  joinedAt: number;
  energyEarned: number;
}
export interface ReferralStatus {
  code: string;
  referees: ReferralReferee[];
  totalEnergyEarned: number;
  referredBy: string | null;
  referredByIgn: string | null;
}

export async function fetchReferralStatus(): Promise<ReferralStatus | null> {
  const tok = token();
  if (!tok) return null;
  try {
    const r = await fetch("/api/run/floor-cleared", {
      method: "POST",
      headers: { Authorization: `Bearer ${tok}`, "Content-Type": "application/json" },
      body: JSON.stringify({ op: "referral_status" }),
    });
    if (!r.ok) return null;
    const data = await r.json() as ReferralStatus & { ok?: boolean };
    return data;
  } catch { return null; }
}

/** Submit a pending referral code. The server validates eligibility and
 *  returns { ok, reason? }. `reason` is "network" only on a transport error
 *  — every other rejection is definitive (don't retry it). */
export async function captureReferral(code: string): Promise<{ ok: boolean; reason?: string }> {
  const tok = token();
  if (!tok) return { ok: false, reason: "network" };
  try {
    const r = await fetch("/api/run/floor-cleared", {
      method: "POST",
      headers: { Authorization: `Bearer ${tok}`, "Content-Type": "application/json" },
      body: JSON.stringify({ op: "referral_capture", code }),
    });
    if (!r.ok && r.status >= 500) return { ok: false, reason: "network" };
    const data = await r.json().catch(() => ({} as { ok?: boolean; reason?: string }));
    return { ok: !!data.ok, reason: data.reason };
  } catch {
    return { ok: false, reason: "network" };
  }
}

/** Build the full shareable referral URL for a code, rooted at the current
 *  site origin so dev and main each produce their own links. */
export function referralLink(code: string): string {
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  return `${origin}/?ref=${encodeURIComponent(code)}`;
}
