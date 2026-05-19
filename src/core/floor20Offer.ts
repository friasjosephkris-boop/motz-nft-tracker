// Client wrappers for the one-time floor-20 clear offer.
// Triggered after the player clears campaign floor 20 for the first time.

import { loadSession } from "../auth/session";

export interface Floor20OfferStatusResponse {
  ok: boolean;
  status?: "pending" | "available" | "shown" | "consumed";
  priceRon?: number;
  reason?: string;
}

function token(): string | null { return loadSession()?.token ?? null; }

export async function fetchFloor20OfferStatus(): Promise<Floor20OfferStatusResponse | null> {
  const tok = token();
  if (!tok) return null;
  try {
    const r = await fetch("/api/run/floor-cleared", {
      method: "POST",
      headers: { Authorization: `Bearer ${tok}`, "Content-Type": "application/json" },
      body: JSON.stringify({ op: "floor20_offer_status" }),
    });
    if (!r.ok) return null;
    return await r.json() as Floor20OfferStatusResponse;
  } catch { return null; }
}

export async function dismissFloor20Offer(): Promise<boolean> {
  const tok = token();
  if (!tok) return false;
  try {
    const r = await fetch("/api/run/floor-cleared", {
      method: "POST",
      headers: { Authorization: `Bearer ${tok}`, "Content-Type": "application/json" },
      body: JSON.stringify({ op: "floor20_offer_dismiss" }),
    });
    return r.ok;
  } catch { return false; }
}

export async function claimFloor20WithRon(txHash: string): Promise<{ ok: boolean; pending?: boolean; reason?: string; grants?: Record<string, number> }> {
  const tok = token();
  if (!tok) return { ok: false, reason: "not signed in" };
  try {
    const r = await fetch("/api/run/floor-cleared", {
      method: "POST",
      headers: { Authorization: `Bearer ${tok}`, "Content-Type": "application/json" },
      body: JSON.stringify({ op: "floor20_offer_claim_ron", txHash }),
    });
    const data = await r.json().catch(() => ({} as { ok?: boolean; reason?: string; grants?: Record<string, number>; pending?: boolean }));
    if (r.status === 202) return { ok: false, pending: true, reason: data.reason };
    if (!r.ok) return { ok: false, reason: data.reason ?? `http ${r.status}` };
    return { ok: true, grants: data.grants };
  } catch (e) { return { ok: false, reason: e instanceof Error ? e.message : "network" }; }
}

export async function claimFloor20WithVouchers(): Promise<{ ok: boolean; reason?: string; grants?: Record<string, number>; deducted?: Record<string, number> }> {
  const tok = token();
  if (!tok) return { ok: false, reason: "not signed in" };
  try {
    const r = await fetch("/api/run/floor-cleared", {
      method: "POST",
      headers: { Authorization: `Bearer ${tok}`, "Content-Type": "application/json" },
      body: JSON.stringify({ op: "floor20_offer_claim_voucher" }),
    });
    const data = await r.json().catch(() => ({} as { ok?: boolean; reason?: string; grants?: Record<string, number>; deducted?: Record<string, number> }));
    if (!r.ok) return { ok: false, reason: data.reason ?? `http ${r.status}` };
    return { ok: true, grants: data.grants, deducted: data.deducted };
  } catch (e) { return { ok: false, reason: e instanceof Error ? e.message : "network" }; }
}
