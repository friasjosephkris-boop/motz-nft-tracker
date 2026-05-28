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

export interface LbDiagnosis {
  /** Raw zset score. Null when wallet isn't in this LB at all. */
  rawScore: number | null;
  /** Decoded floor reached on this LB. Null when not present. */
  floor: number | null;
  /** Decoded total run ms (survival/boss_raid only; null for Highest Floor). */
  ms: number | null;
  /** 1-indexed rank. Null when not present. */
  rank: number | null;
}

export interface WalletDiagnosis {
  /** Per-wallet maxfloor key — the source-of-truth for campaign progress. */
  serverMaxFloor: number;
  /** Highest Floor leaderboard entry (campaign-clear ranks). */
  highestFloor: LbDiagnosis;
  /** Survival leaderboard entry. */
  survival: LbDiagnosis;
  /** Boss Raid leaderboard entry. */
  bossRaid: LbDiagnosis;
  ign: string | null;
}

/** Admin only: read full progress diagnostics for a target wallet. Returns
 *  the per-wallet max-floor key AND the wallet's score on each leaderboard.
 *  Use to spot drift (Highest Floor LB vs maxfloor key) or "lost run"
 *  cases (survival LB doesn't reflect a run the player claims to have
 *  finished). */
export async function adminDiagnoseWallet(wallet: string): Promise<{ ok: boolean; wallet?: string; diag?: WalletDiagnosis; error?: string }> {
  const tok = token();
  if (!tok) return { ok: false, error: "not signed in" };
  try {
    const r = await fetch("/api/run/floor-cleared", {
      method: "POST",
      headers: { Authorization: `Bearer ${tok}`, "Content-Type": "application/json" },
      body: JSON.stringify({ op: "admin_diagnose_wallet", wallet }),
    });
    const data = await r.json().catch(() => ({} as { ok?: boolean; error?: string; wallet?: string } & Partial<WalletDiagnosis>));
    if (!r.ok || !data.ok) return { ok: false, error: data.error ?? `http ${r.status}` };
    const empty: LbDiagnosis = { rawScore: null, floor: null, ms: null, rank: null };
    return {
      ok: true,
      wallet: data.wallet,
      diag: {
        serverMaxFloor: data.serverMaxFloor ?? 0,
        highestFloor: data.highestFloor ?? empty,
        survival: data.survival ?? empty,
        bossRaid: data.bossRaid ?? empty,
        ign: data.ign ?? null,
      },
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "network" };
  }
}

/** Admin only: SET a wallet's max-cleared floor + Highest Floor LB score
 *  to exactly `floor`. Cap 1..500. ALWAYS OVERWRITES — including demoting
 *  from a higher current value. Returns the previous values so the UI can
 *  show what changed. Use to repair drift OR to pin a wallet to a chosen
 *  number (e.g. their official end-of-season standing). */
export async function adminSetMaxFloor(wallet: string, floor: number): Promise<{ ok: boolean; prevMax?: number; prevLb?: number | null; newMax?: number; diag?: WalletDiagnosis; error?: string }> {
  const tok = token();
  if (!tok) return { ok: false, error: "not signed in" };
  try {
    const r = await fetch("/api/run/floor-cleared", {
      method: "POST",
      headers: { Authorization: `Bearer ${tok}`, "Content-Type": "application/json" },
      body: JSON.stringify({ op: "admin_set_max_floor", wallet, floor }),
    });
    const data = await r.json().catch(() => ({} as { ok?: boolean; error?: string; newMax?: number; prevMax?: number; prevLb?: number | null } & Partial<WalletDiagnosis>));
    if (!r.ok || !data.ok) return { ok: false, error: data.error ?? `http ${r.status}` };
    const empty: LbDiagnosis = { rawScore: null, floor: null, ms: null, rank: null };
    return {
      ok: true,
      newMax: data.newMax,
      prevMax: data.prevMax,
      prevLb: data.prevLb ?? null,
      diag: {
        serverMaxFloor: data.serverMaxFloor ?? 0,
        highestFloor: data.highestFloor ?? empty,
        survival: data.survival ?? empty,
        bossRaid: data.bossRaid ?? empty,
        ign: data.ign ?? null,
      },
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "network" };
  }
}

export interface LbActivityEntry {
  rank: number;
  address: string;
  ign: string | null;
  floor: number;
  ms: number;
  lbSubmittedAt: number | null;
  replayRecordedAt: number | null;
  submittedToday: boolean | null;
}
export interface LbAttemptToday {
  address: string;
  ign: string | null;
  attempts: number;
}
export type ActivityLbMode = "survival" | "boss_raid" | "highest_floor";

export interface LbActivityReport {
  mode: ActivityLbMode;
  phDayBoundary: number;
  entries: LbActivityEntry[];
  attemptedToday: LbAttemptToday[];
}

export interface LbFreezeStatus {
  frozen: boolean;
  snapshot: {
    capturedAt: number;
    capturedBy: string;
    label: string;
    counts: { survival: number; bossRaid: number; highestFloor: number; worldEnder: number; firstConquer: number };
  } | null;
}

/** Admin only: read the current LB-freeze flag + summary of the captured snapshot. */
export async function adminLbFreezeStatus(): Promise<{ ok: boolean; status?: LbFreezeStatus; error?: string }> {
  const tok = token();
  if (!tok) return { ok: false, error: "not signed in" };
  try {
    const r = await fetch("/api/run/floor-cleared", {
      method: "POST",
      headers: { Authorization: `Bearer ${tok}`, "Content-Type": "application/json" },
      body: JSON.stringify({ op: "admin_lb_freeze_status" }),
    });
    const data = await r.json().catch(() => ({} as { ok?: boolean; error?: string } & Partial<LbFreezeStatus>));
    if (!r.ok || !data.ok) return { ok: false, error: data.error ?? `http ${r.status}` };
    return {
      ok: true,
      status: { frozen: data.frozen ?? false, snapshot: data.snapshot ?? null },
    };
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : "network" }; }
}

/** Admin only: capture the CURRENT live LB state into the frozen-snapshot
 *  blob. Does NOT enable freeze mode by itself — call adminLbFreezeToggle
 *  after capturing. `label` is a short string shown to players (e.g.
 *  "Season 1 Final"). */
export async function adminLbFreezeSnapshot(label: string): Promise<{ ok: boolean; capturedAt?: number; label?: string; counts?: LbFreezeStatus["snapshot"] extends infer T ? T extends { counts: infer C } ? C : never : never; error?: string }> {
  const tok = token();
  if (!tok) return { ok: false, error: "not signed in" };
  try {
    const r = await fetch("/api/run/floor-cleared", {
      method: "POST",
      headers: { Authorization: `Bearer ${tok}`, "Content-Type": "application/json" },
      body: JSON.stringify({ op: "admin_lb_freeze_snapshot", label }),
    });
    const data = await r.json().catch(() => ({} as Record<string, unknown>));
    if (!r.ok || !data.ok) return { ok: false, error: typeof data.error === "string" ? data.error : `http ${r.status}` };
    return {
      ok: true,
      capturedAt: typeof data.capturedAt === "number" ? data.capturedAt : undefined,
      label: typeof data.label === "string" ? data.label : undefined,
      counts: data.counts as LbFreezeStatus["snapshot"] extends infer T ? T extends { counts: infer C } ? C : never : never,
    };
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : "network" }; }
}

/** Admin only: flip LB freeze on/off. When on, /api/leaderboard/top serves
 *  the captured snapshot. Server rejects "on" if no snapshot has been
 *  captured yet. */
export async function adminLbFreezeToggle(on: boolean): Promise<{ ok: boolean; frozen?: boolean; error?: string }> {
  const tok = token();
  if (!tok) return { ok: false, error: "not signed in" };
  try {
    const r = await fetch("/api/run/floor-cleared", {
      method: "POST",
      headers: { Authorization: `Bearer ${tok}`, "Content-Type": "application/json" },
      body: JSON.stringify({ op: "admin_lb_freeze_toggle", on }),
    });
    const data = await r.json().catch(() => ({} as { ok?: boolean; error?: string; frozen?: boolean }));
    if (!r.ok || !data.ok) return { ok: false, error: data.error ?? `http ${r.status}` };
    return { ok: true, frozen: data.frozen };
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : "network" }; }
}

/** Admin only: read an activity audit for one of the three leaderboards
 *  (Survival, Boss Raid, or Highest Floor / campaign). For each top-N
 *  entry returns whatever submission timestamp we have (replay recordedAt
 *  for top-3 survival/boss_raid; submission-hash timestamp for all modes
 *  going forward). Plus a separate "active today" list:
 *    - survival/boss_raid → daily attempts counter
 *    - highest_floor      → submission-hash entries dated >= today's 8am PH
 *  Answers "who was active on this LB today" precisely. */
export async function adminLbActivity(
  mode: ActivityLbMode,
  topN = 10,
): Promise<{ ok: boolean; report?: LbActivityReport; error?: string }> {
  const tok = token();
  if (!tok) return { ok: false, error: "not signed in" };
  try {
    const r = await fetch("/api/run/floor-cleared", {
      method: "POST",
      headers: { Authorization: `Bearer ${tok}`, "Content-Type": "application/json" },
      body: JSON.stringify({ op: "admin_lb_activity", mode, topN }),
    });
    const data = await r.json().catch(() => ({} as { ok?: boolean; error?: string } & Partial<LbActivityReport>));
    if (!r.ok || !data.ok) return { ok: false, error: data.error ?? `http ${r.status}` };
    return {
      ok: true,
      report: {
        mode: data.mode ?? mode,
        phDayBoundary: data.phDayBoundary ?? 0,
        entries: data.entries ?? [],
        attemptedToday: data.attemptedToday ?? [],
      },
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "network" };
  }
}

/** Admin only: submit a Survival or Boss Raid leaderboard score on behalf
 *  of a wallet (repair for a "lost run" where /api/run/end didn't land).
 *  Raises only — if the wallet already has a better score it stays put.
 *  `ms` is the total run time to record alongside the floor (used as the
 *  tiebreak). 1..500 floor; 0..1e9 ms. */
export async function adminSubmitLbScore(
  wallet: string,
  mode: "survival" | "boss_raid",
  floor: number,
  ms: number,
): Promise<{ ok: boolean; improved?: boolean; diag?: WalletDiagnosis; error?: string }> {
  const tok = token();
  if (!tok) return { ok: false, error: "not signed in" };
  try {
    const r = await fetch("/api/run/floor-cleared", {
      method: "POST",
      headers: { Authorization: `Bearer ${tok}`, "Content-Type": "application/json" },
      body: JSON.stringify({ op: "admin_submit_lb_score", wallet, mode, floor, ms }),
    });
    const data = await r.json().catch(() => ({} as { ok?: boolean; error?: string; improved?: boolean; diag?: WalletDiagnosis }));
    if (!r.ok || !data.ok) return { ok: false, error: data.error ?? `http ${r.status}` };
    return { ok: true, improved: data.improved, diag: data.diag };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "network" };
  }
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
