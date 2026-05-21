// Client wrappers for Oracle Energy — the 50/50 RON gamble in the shop's
// energy section. The modal UI lives in src/ui/oracleEnergy.ts.
//
// All randomness + payment verification is server-side; this file only
// relays the player's tx hash and surfaces the server's coin-flip result.

import { loadSession } from "../auth/session";

function token(): string | null { return loadSession()?.token ?? null; }

export interface OracleStatus {
  /** Plays already used since the last 08:00 PH reset. */
  playsToday: number;
  /** Plays still available today. */
  playsRemaining: number;
  /** Daily play cap. */
  cap: number;
  /** RON cost per play (1.5). */
  priceRon: number;
  /** Energy granted on a win (3). */
  win: number;
  /** Energy granted on a loss (1). */
  lose: number;
}

export async function fetchOracleStatus(): Promise<OracleStatus | null> {
  const tok = token();
  if (!tok) return null;
  try {
    const r = await fetch("/api/run/floor-cleared", {
      method: "POST",
      headers: { Authorization: `Bearer ${tok}`, "Content-Type": "application/json" },
      body: JSON.stringify({ op: "oracle_status" }),
    });
    if (!r.ok) return null;
    return await r.json() as OracleStatus;
  } catch { return null; }
}

export interface OraclePlayResult {
  ok: boolean;
  /** True on a winning flip. */
  won?: boolean;
  /** Energy units added to the pool. */
  energyGranted?: number;
  /** New total energy balance after the grant. */
  balance?: number;
  /** Plays still available today after this play. */
  playsRemaining?: number;
  /** True when the server returned 202 — tx broadcast but not yet indexed. */
  pending?: boolean;
  reason?: string;
}

/** Submit a verified 1.5 RON payment tx; server flips the coin + grants energy. */
export async function playOracleWithRon(txHash: string): Promise<OraclePlayResult> {
  const tok = token();
  if (!tok) return { ok: false, reason: "not signed in" };
  try {
    const r = await fetch("/api/run/floor-cleared", {
      method: "POST",
      headers: { Authorization: `Bearer ${tok}`, "Content-Type": "application/json" },
      body: JSON.stringify({ op: "oracle_play", txHash }),
    });
    const data = await r.json().catch(() => ({} as OraclePlayResult));
    if (r.status === 202) return { ok: false, pending: true, reason: data.reason };
    if (r.status === 429) return { ok: false, reason: data.reason ?? "daily limit reached" };
    if (!r.ok) return { ok: false, reason: data.reason ?? `http ${r.status}` };
    return {
      ok: true,
      won: data.won,
      energyGranted: data.energyGranted,
      balance: data.balance,
      playsRemaining: data.playsRemaining,
    };
  } catch (e) { return { ok: false, reason: e instanceof Error ? e.message : "network" }; }
}
