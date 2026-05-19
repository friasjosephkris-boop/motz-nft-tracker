// Client wrappers for the one-time first-energy-bundle offer.
// Triggered by core/energy.ts when a consume call drops the player to 0
// energy. The modal lives in src/ui/firstEnergyOffer.ts.

import { loadSession } from "../auth/session";

export interface FirstOfferStatusResponse {
  ok: boolean;
  /** "available" — never shown, "shown" — opened at least once but no
   *  decision yet (refresh-safe), "consumed" — claimed or dismissed. */
  status?: "available" | "shown" | "consumed";
  /** Energy units granted on claim (server-defined, 35 today). */
  energy?: number;
  /** Price in whole RON (or whole bRON face value). */
  priceRon?: number;
  reason?: string;
}

function token(): string | null { return loadSession()?.token ?? null; }

export async function fetchFirstOfferStatus(): Promise<FirstOfferStatusResponse | null> {
  const tok = token();
  if (!tok) return null;
  try {
    const r = await fetch("/api/run/floor-cleared", {
      method: "POST",
      headers: { Authorization: `Bearer ${tok}`, "Content-Type": "application/json" },
      body: JSON.stringify({ op: "first_offer_status" }),
    });
    if (!r.ok) return null;
    return await r.json() as FirstOfferStatusResponse;
  } catch { return null; }
}

export async function dismissFirstOffer(): Promise<boolean> {
  const tok = token();
  if (!tok) return false;
  try {
    const r = await fetch("/api/run/floor-cleared", {
      method: "POST",
      headers: { Authorization: `Bearer ${tok}`, "Content-Type": "application/json" },
      body: JSON.stringify({ op: "first_offer_dismiss" }),
    });
    return r.ok;
  } catch { return false; }
}

/** Server takes the verified tx hash, validates payment + grants +35 energy. */
export async function claimFirstOfferWithRon(txHash: string): Promise<{ ok: boolean; energy?: number; pending?: boolean; reason?: string }> {
  const tok = token();
  if (!tok) return { ok: false, reason: "not signed in" };
  try {
    const r = await fetch("/api/run/floor-cleared", {
      method: "POST",
      headers: { Authorization: `Bearer ${tok}`, "Content-Type": "application/json" },
      body: JSON.stringify({ op: "first_offer_claim_ron", txHash }),
    });
    const data = await r.json().catch(() => ({} as { ok?: boolean; reason?: string; energy?: number; pending?: boolean }));
    if (r.status === 202) return { ok: false, pending: true, reason: data.reason };
    if (!r.ok) return { ok: false, reason: data.reason ?? `http ${r.status}` };
    return { ok: true, energy: data.energy };
  } catch (e) { return { ok: false, reason: e instanceof Error ? e.message : "network" }; }
}

/** Voucher path: server deducts 20 bRON face value from inventory + grants. */
export async function claimFirstOfferWithVouchers(): Promise<{ ok: boolean; energy?: number; deducted?: Record<string, number>; reason?: string }> {
  const tok = token();
  if (!tok) return { ok: false, reason: "not signed in" };
  try {
    const r = await fetch("/api/run/floor-cleared", {
      method: "POST",
      headers: { Authorization: `Bearer ${tok}`, "Content-Type": "application/json" },
      body: JSON.stringify({ op: "first_offer_claim_voucher" }),
    });
    const data = await r.json().catch(() => ({} as { ok?: boolean; reason?: string; energy?: number; deducted?: Record<string, number> }));
    if (!r.ok) return { ok: false, reason: data.reason ?? `http ${r.status}` };
    return { ok: true, energy: data.energy, deducted: data.deducted };
  } catch (e) { return { ok: false, reason: e instanceof Error ? e.message : "network" }; }
}
