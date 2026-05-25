// Client wrappers for the server-authoritative energy endpoints.
// The local localStorage value (core/energy.ts) is now just a display cache;
// every actual deduction must succeed server-side first.

import { loadSession } from "./session";
import { setEnergy } from "../core/energy";

export interface EnergyState { amount: number; max: number; msUntilRefill?: number; }

function token(): string | null { return loadSession()?.token ?? null; }

/** GET /api/energy. Updates the local cache on success. Fails soft to null. */
export async function fetchServerEnergy(): Promise<EnergyState | null> {
  const tok = token();
  if (!tok) return null;
  try {
    const r = await fetch("/api/energy", { headers: { Authorization: `Bearer ${tok}` } });
    if (!r.ok) return null;
    const data = await r.json() as EnergyState;
    if (typeof data?.amount === "number") setEnergy(data.amount);
    return data;
  } catch { return null; }
}

export type ConsumeResult =
  | { ok: true; amount: number; max: number }
  | { ok: false; amount: number; max: number }
  | { ok: false; error: "network" };

/** Admin only: grant N energy server-side. Returns the new balance, or null on failure. */
export async function adminGrantServerEnergy(delta: number): Promise<number | null> {
  const tok = token();
  if (!tok) return null;
  try {
    const r = await fetch("/api/run/floor-cleared", {
      method: "POST",
      headers: { Authorization: `Bearer ${tok}`, "Content-Type": "application/json" },
      body: JSON.stringify({ op: "admin_grant_energy", delta }),
    });
    if (!r.ok) return null;
    const data = await r.json() as { amount: number };
    if (typeof data.amount === "number") setEnergy(data.amount);
    return data.amount;
  } catch { return null; }
}

/** Admin only: grant bRON vouchers to the caller's own wallet (server enforces
 *  admin gate AND that the grant target is the caller — there's no `target`
 *  param, so a non-admin can't redirect this). Used for shop UI testing.
 *  Returns the updated voucher counts, or null on network / auth failure. */
export async function adminGrantSampleVouchers(
  v: { t1?: number; t2?: number; t3?: number; t4?: number; t5?: number },
): Promise<{ t1: number; t2: number; t3: number; t4: number; t5: number } | null> {
  const tok = token();
  if (!tok) return null;
  try {
    const r = await fetch("/api/run/floor-cleared", {
      method: "POST",
      headers: { Authorization: `Bearer ${tok}`, "Content-Type": "application/json" },
      body: JSON.stringify({ op: "admin_grant_vouchers", ...v }),
    });
    if (!r.ok) return null;
    const data = await r.json() as { ok?: boolean; vouchers?: { t1?: number; t2?: number; t3?: number; t4?: number; t5?: number } };
    if (!data.ok || !data.vouchers) return null;
    return {
      t1: data.vouchers.t1 ?? 0,
      t2: data.vouchers.t2 ?? 0,
      t3: data.vouchers.t3 ?? 0,
      t4: data.vouchers.t4 ?? 0,
      t5: data.vouchers.t5 ?? 0,
    };
  } catch { return null; }
}

/** Admin only: fill server energy to MAX. Returns the new balance. */
export async function adminFillServerEnergy(): Promise<number | null> {
  const tok = token();
  if (!tok) return null;
  try {
    const r = await fetch("/api/run/floor-cleared", {
      method: "POST",
      headers: { Authorization: `Bearer ${tok}`, "Content-Type": "application/json" },
      body: JSON.stringify({ op: "admin_fill_energy" }),
    });
    if (!r.ok) return null;
    const data = await r.json() as { amount: number };
    if (typeof data.amount === "number") setEnergy(data.amount);
    return data.amount;
  } catch { return null; }
}

/** Admin + dev-only: wipe every server key under the current KEY_PREFIX.
 *  Server hard-refuses if KEY_PREFIX is empty (production safety). */
export async function adminWipeDevServerData(): Promise<{ ok: boolean; scanned?: number; deleted?: number; error?: string }> {
  const tok = token();
  if (!tok) return { ok: false, error: "not signed in" };
  try {
    const r = await fetch("/api/run/floor-cleared", {
      method: "POST",
      headers: { Authorization: `Bearer ${tok}`, "Content-Type": "application/json" },
      body: JSON.stringify({ op: "admin_wipe_dev" }),
    });
    const data = await r.json().catch(() => ({} as { error?: string; scanned?: number; deleted?: number }));
    if (!r.ok) return { ok: false, error: data.error ?? `http ${r.status}` };
    return { ok: true, scanned: data.scanned, deleted: data.deleted };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "network" };
  }
}

/** Admin: PRODUCTION wipe of EVERY game-related Redis key (progress, energy,
 *  leaderboards, runs, shop inventory, vouchers, analytics, season state...).
 *  Requires a magic confirm token so a stray devtools call can't fire it.
 *  Caller MUST chain at least 3 confirmation prompts before invoking. */
export async function adminWipeAllProdData(): Promise<{ ok: boolean; scanned?: number; deleted?: number; error?: string }> {
  const tok = token();
  if (!tok) return { ok: false, error: "not signed in" };
  try {
    const r = await fetch("/api/run/floor-cleared", {
      method: "POST",
      headers: { Authorization: `Bearer ${tok}`, "Content-Type": "application/json" },
      body: JSON.stringify({ op: "admin_wipe_all_data", confirm: "WIPE EVERYTHING NOW" }),
    });
    const data = await r.json().catch(() => ({} as { error?: string; scanned?: number; deleted?: number }));
    if (!r.ok) return { ok: false, error: data.error ?? `http ${r.status}` };
    return { ok: true, scanned: data.scanned, deleted: data.deleted };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "network" };
  }
}

/** Admin: bump the caller's server-side XP cap by `delta`. Lets the dev-build
 *  "+ Level" button raise the ceiling before pushing the new level state, so
 *  the server's anti-cheat validator doesn't reject the claim as overshooting
 *  legitimate play. Idempotency: each call adds delta to whatever the cap
 *  currently is — call once per level grant, not in a loop. */
export async function adminBumpXpCap(delta: number): Promise<{ ok: boolean; newCap?: number; error?: string }> {
  const tok = token();
  if (!tok) return { ok: false, error: "not signed in" };
  try {
    const r = await fetch("/api/run/floor-cleared", {
      method: "POST",
      headers: { Authorization: `Bearer ${tok}`, "Content-Type": "application/json" },
      body: JSON.stringify({ op: "admin_bump_xp_cap", delta }),
    });
    const data = await r.json().catch(() => ({} as { error?: string; newCap?: number }));
    if (!r.ok) return { ok: false, error: data.error ?? `http ${r.status}` };
    return { ok: true, newCap: data.newCap };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "network" };
  }
}

/** Admin: grant energy to a SPECIFIC wallet (different from
 *  adminGrantServerEnergy which adds to the caller's own). Use for comp
 *  grants when a player paid for the wrong bundle. Delta is clamped to ±999. */
export async function adminGrantEnergyToWallet(wallet: string, delta: number): Promise<{ ok: boolean; amount?: number; error?: string }> {
  const tok = token();
  if (!tok) return { ok: false, error: "not signed in" };
  try {
    const r = await fetch("/api/run/floor-cleared", {
      method: "POST",
      headers: { Authorization: `Bearer ${tok}`, "Content-Type": "application/json" },
      body: JSON.stringify({ op: "admin_grant_energy_to", wallet, delta }),
    });
    const data = await r.json().catch(() => ({} as { ok?: boolean; amount?: number; error?: string }));
    if (!r.ok) return { ok: false, error: data.error ?? `http ${r.status}` };
    return { ok: true, amount: data.amount };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "network" };
  }
}

/** Admin: smoke-test the on-chain daily check-in. Fires `checkIn(wallet)`
 *  on the Daily Check-In contract WITHOUT touching the in-game daily lock
 *  or granting energy — purely to verify env-var wiring (contract addr /
 *  chain id / relayer pk) end-to-end. */
export async function adminTestOnChainCheckIn(wallet: string): Promise<{ ok: boolean; enabled?: boolean; hasCheckedInToday?: boolean; currentStreak?: number; reason?: string; error?: string }> {
  const tok = token();
  if (!tok) return { ok: false, error: "not signed in" };
  try {
    const r = await fetch("/api/run/floor-cleared", {
      method: "POST",
      headers: { Authorization: `Bearer ${tok}`, "Content-Type": "application/json" },
      body: JSON.stringify({ op: "admin_test_onchain_checkin", wallet }),
    });
    const data = await r.json().catch(() => ({} as { ok?: boolean; enabled?: boolean; hasCheckedInToday?: boolean; currentStreak?: number; reason?: string; error?: string }));
    if (!r.ok) return { ok: false, error: data.error ?? `http ${r.status}` };
    return { ok: !!data.ok, enabled: data.enabled, hasCheckedInToday: data.hasCheckedInToday, currentStreak: data.currentStreak, reason: data.reason };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "network" };
  }
}

/** Admin: close one-time offers on a target wallet by marking them as
 *  consumed. Use after a comp grant so the offer modal doesn't reappear. */
export async function adminConsumeOneTimeOffers(wallet: string, offers: ("first_energy" | "floor20" | "both")[]): Promise<{ ok: boolean; closed?: string[]; error?: string }> {
  const tok = token();
  if (!tok) return { ok: false, error: "not signed in" };
  try {
    const r = await fetch("/api/run/floor-cleared", {
      method: "POST",
      headers: { Authorization: `Bearer ${tok}`, "Content-Type": "application/json" },
      body: JSON.stringify({ op: "admin_consume_one_time_offers", wallet, offers }),
    });
    const data = await r.json().catch(() => ({} as { ok?: boolean; closed?: string[]; error?: string }));
    if (!r.ok) return { ok: false, error: data.error ?? `http ${r.status}` };
    return { ok: true, closed: data.closed };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "network" };
  }
}

/** Admin: targeted per-wallet reset. Nukes that wallet's server-side keys AND
 *  stamps a force-reset timestamp so their client clears localStorage + reloads
 *  on next session-check poll. Use when a global wipe isn't viable because
 *  other players are already mid-run on the fresh data. */
export async function adminForceResetWallet(wallet: string): Promise<{ ok: boolean; deleted?: Record<string, number>; error?: string }> {
  const tok = token();
  if (!tok) return { ok: false, error: "not signed in" };
  try {
    const r = await fetch("/api/run/floor-cleared", {
      method: "POST",
      headers: { Authorization: `Bearer ${tok}`, "Content-Type": "application/json" },
      body: JSON.stringify({ op: "admin_force_reset_wallet", wallet }),
    });
    const data = await r.json().catch(() => ({} as { error?: string; deleted?: Record<string, number> }));
    if (!r.ok) return { ok: false, error: data.error ?? `http ${r.status}` };
    return { ok: true, deleted: data.deleted };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "network" };
  }
}

/** Admin: reset every wallet that has data EXCEPT the allowlist. Use when
 *  most players need re-sync but a few legit fresh-start wallets must be
 *  preserved. Empty allowlist is rejected server-side (use the full wipe op
 *  with its 3-confirmation gauntlet for that). */
export async function adminForceResetExcept(keep: string[]): Promise<{ ok: boolean; totalWallets?: number; resetCount?: number; failCount?: number; results?: { wallet: string; ok: boolean; deleted: number; error?: string }[]; error?: string }> {
  const tok = token();
  if (!tok) return { ok: false, error: "not signed in" };
  try {
    const r = await fetch("/api/run/floor-cleared", {
      method: "POST",
      headers: { Authorization: `Bearer ${tok}`, "Content-Type": "application/json" },
      body: JSON.stringify({ op: "admin_force_reset_except", keep }),
    });
    const data = await r.json().catch(() => ({} as { error?: string }));
    if (!r.ok) return { ok: false, error: data.error ?? `http ${r.status}` };
    return { ok: true, ...data };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "network" };
  }
}

/** POST /api/energy/consume. Returns ok:false with the server's current amount on insufficient. */
export async function consumeServerEnergy(cost: number): Promise<ConsumeResult> {
  const tok = token();
  if (!tok) return { ok: false, error: "network" };
  try {
    const r = await fetch("/api/energy", {
      method: "POST",
      headers: { Authorization: `Bearer ${tok}`, "Content-Type": "application/json" },
      body: JSON.stringify({ cost }),
    });
    if (r.status === 402) {
      const data = await r.json().catch(() => ({})) as { amount?: number; max?: number };
      const amount = typeof data.amount === "number" ? data.amount : 0;
      const max = typeof data.max === "number" ? data.max : 20;
      setEnergy(amount);
      return { ok: false, amount, max };
    }
    if (!r.ok) return { ok: false, error: "network" };
    const data = await r.json() as { ok: boolean; amount: number; max: number };
    setEnergy(data.amount);
    return data.ok
      ? { ok: true, amount: data.amount, max: data.max }
      : { ok: false, amount: data.amount, max: data.max };
  } catch {
    return { ok: false, error: "network" };
  }
}
