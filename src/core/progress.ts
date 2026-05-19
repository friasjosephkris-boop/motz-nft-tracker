import { Stats, ZERO_STATS } from "./stats";
import { CLASS_SKILLS, CHARACTER_SKILLS, getSkill } from "../skills/registry";

// Persistent per-unit progress, keyed by template id.
// Resets to defaults when there's no entry for that id.

export interface UnitProgress {
  level: number;
  xp: number;
  customStats: Stats;
  classId?: string;
  availablePoints: number;   // from leveling: +4 per level
  /** Skill ids the player has equipped for combat (max 4). idle is always implicitly available. */
  equippedSkills?: string[];
}

export const MAX_EQUIPPED_SKILLS = 4;

import { scopedKey } from "../auth/scope";
const KEY = () => scopedKey("stat-battler.progress.v1");

function defaults(): UnitProgress {
  return { level: 1, xp: 0, customStats: { ...ZERO_STATS }, availablePoints: 0 };
}

function loadAll(): Record<string, UnitProgress> {
  try {
    const raw = localStorage.getItem(KEY());
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    return parsed;
  } catch {
    return {};
  }
}

function saveAll(map: Record<string, UnitProgress>): void {
  try {
    localStorage.setItem(KEY(), JSON.stringify(map));
  } catch {
    // ignore
  }
}

export function getProgress(templateId: string): UnitProgress {
  const map = loadAll();
  const entry = map[templateId];
  if (!entry) return defaults();
  const result: UnitProgress = {
    level: entry.level ?? 1,
    xp: entry.xp ?? 0,
    customStats: { ...ZERO_STATS, ...(entry.customStats ?? {}) },
    classId: entry.classId,
    availablePoints: entry.availablePoints ?? 0,
    equippedSkills: Array.isArray(entry.equippedSkills) ? entry.equippedSkills.slice(0, MAX_EQUIPPED_SKILLS) : [],
  };
  // Lazy heal: strip skills now locked behind a higher unlockLevel (e.g. after
  // an admin Reset Level dropped the unit back to Lv1), and only auto-fill
  // when the loadout is fully empty — partial top-ups happen at battle start
  // so the user can intentionally run with fewer than MAX skills.
  const before = result.equippedSkills ?? [];
  const trimmed = before.filter(id => {
    const s = getSkill(id);
    return (s.unlockLevel ?? 1) <= result.level;
  });
  const next = trimmed.length === 0
    ? autoEquipNewlyUnlocked(templateId, result.classId, result.level, trimmed)
    : trimmed;
  const changed = next.length !== before.length || next.some((id, i) => before[i] !== id);
  if (changed) {
    result.equippedSkills = next;
    map[templateId] = result;
    saveAll(map);
  }
  return result;
}

export function setProgress(templateId: string, p: UnitProgress): void {
  const map = loadAll();
  const priorLevel = map[templateId]?.level ?? 1;
  // ---- First-time-Lv2 onboarding hook ----
  // Mark a pending forced stat-allocation prompt if THIS write is the first
  // time any unit transitions from <2 to >=2 AND the player has never been
  // through the forced allocator before. The "first time per player" promise
  // is enforced by FORCED_ALLOC_SEEN_KEY — once true, we never set the
  // pending key again.
  if (!isForcedStatAllocSeen() && priorLevel < 2 && p.level >= 2 && p.availablePoints > 0) {
    try { localStorage.setItem(PENDING_ALLOC_UNIT_KEY(), templateId); } catch { /* ignore */ }
  }
  map[templateId] = p;
  saveAll(map);
  schedulePushProgress();
}

// ---- Forced-onboarding flags (post-tutorial gates) ----
// 1. Force a class pick on the first unit when player exits tutorial with all
//    units at Lv 1 and no class anywhere.
// 2. Force stat allocation the FIRST time any unit reaches Lv 2 (once per
//    player, not once per unit — subsequent level-ups are silent).
const FORCED_CLASS_PICK_SEEN_KEY  = (): string => scopedKey("toz.forced.classPickSeen.v1");
const FORCED_ALLOC_SEEN_KEY       = (): string => scopedKey("toz.forced.statAllocSeen.v1");
const PENDING_ALLOC_UNIT_KEY      = (): string => scopedKey("toz.forced.pendingAllocUnit.v1");

/** True if we should run the forced class-pick gate now. Conditions:
 *  - Player hasn't been through it before (one-shot)
 *  - No unit on the wallet has classId set
 *  - No unit has reached Lv 2+ (so we never block veterans loading a fresh
 *    device — they've earned past the gate already). */
export function isForcedClassPickPending(): boolean {
  try { if (localStorage.getItem(FORCED_CLASS_PICK_SEEN_KEY())) return false; } catch { /* fallthrough */ }
  const map = loadAll();
  for (const id of Object.keys(map)) {
    if (map[id].classId) return false;
    if ((map[id].level ?? 1) >= 2) return false;
  }
  return true;
}
export function markForcedClassPickComplete(): void {
  try { localStorage.setItem(FORCED_CLASS_PICK_SEEN_KEY(), "1"); } catch { /* ignore */ }
}

/** Returns the templateId of the unit that triggered the forced stat-alloc
 *  prompt, or null if no prompt is pending. Self-heals invalid states:
 *  if the pending key points to a unit that no longer has any available
 *  points (e.g. after a server wipe reset their progress), the key is
 *  cleared so the player isn't trapped on a screen with a disabled button. */
export function getPendingForcedStatAllocUnit(): string | null {
  let pending: string | null = null;
  try { pending = localStorage.getItem(PENDING_ALLOC_UNIT_KEY()); } catch { return null; }
  if (!pending) return null;
  // Self-heal #1: gate is one-shot per player. If they've already been
  // through it before, PENDING shouldn't fire again — clear and bail.
  if (isForcedStatAllocSeen()) {
    try { localStorage.removeItem(PENDING_ALLOC_UNIT_KEY()); } catch { /* ignore */ }
    return null;
  }
  // Self-heal #2: the unit actually has points to allocate. If progress
  // was reset (post-wipe) the unit may be back at Lv 1 / 0 points — the
  // forced screen would render with a disabled Allocate button and trap
  // the player. Clear the flag instead.
  const map = loadAll();
  const entry = map[pending];
  if (!entry || (entry.availablePoints ?? 0) <= 0) {
    try { localStorage.removeItem(PENDING_ALLOC_UNIT_KEY()); } catch { /* ignore */ }
    return null;
  }
  return pending;
}
export function clearPendingForcedStatAllocUnit(): void {
  try { localStorage.removeItem(PENDING_ALLOC_UNIT_KEY()); } catch { /* ignore */ }
}
export function markForcedStatAllocSeen(): void {
  try { localStorage.setItem(FORCED_ALLOC_SEEN_KEY(), "1"); } catch { /* ignore */ }
}
function isForcedStatAllocSeen(): boolean {
  try { return !!localStorage.getItem(FORCED_ALLOC_SEEN_KEY()); } catch { return false; }
}

/** Debounce coalescing multiple setProgress calls in the same tick into a
 *  single /api/progress_sync POST. The server's response can roll back our
 *  localStorage if the merged claim doesn't validate. */
let pushTimer: ReturnType<typeof setTimeout> | null = null;
function schedulePushProgress(): void {
  if (pushTimer !== null) return;
  pushTimer = setTimeout(() => {
    pushTimer = null;
    void pushProgress();
  }, 500);
}

/** Non-destructive auto-equip — called on every level-up and class change.
 *  Keeps existing manual picks, only ADDS newly-unlocked skills if there's
 *  room (slots < MAX_EQUIPPED_SKILLS). Never reorders, never removes a
 *  manually-equipped low-tier skill in favor of a high-tier one.
 *
 *  Players who specifically want to rebuild to "strongest-N" use the
 *  Auto-Equip button on the Units screen, which calls
 *  rebuildLoadoutToStrongest(...) instead. */
export function autoEquipNewlyUnlocked(
  templateId: string,
  classId: string | undefined,
  level: number,
  current: string[],
): string[] {
  const equipped = [...current];
  // Drop stale ids (e.g. skills no longer in the unit's class after a
  // class change) so the slot accounting is accurate.
  const validForUnit = new Set<string>();
  for (const id of (CHARACTER_SKILLS[templateId] ?? [])) validForUnit.add(id);
  if (classId) for (const id of (CLASS_SKILLS[classId] ?? [])) validForUnit.add(id);
  for (let i = equipped.length - 1; i >= 0; i--) {
    if (!validForUnit.has(equipped[i])) equipped.splice(i, 1);
  }
  // Fill empty slots with newly-unlocked skills, ordered by unlockLevel
  // ascending so the unit always has its earliest unlocks first.
  const candidates: { id: string; tier: number }[] = [];
  for (const id of validForUnit) {
    if (equipped.includes(id)) continue;
    const skill = getSkill(id);
    const unlockAt = skill.unlockLevel ?? 1;
    if (level >= unlockAt) candidates.push({ id, tier: unlockAt });
  }
  candidates.sort((a, b) => a.tier - b.tier);
  for (const c of candidates) {
    if (equipped.length >= MAX_EQUIPPED_SKILLS) break;
    equipped.push(c.id);
  }
  return equipped;
}

/** Rebuild a unit's loadout to the strongest MAX_EQUIPPED_SKILLS skills
 *  available at the current level + class. Called by the Auto-Equip button
 *  in the Units screen when the player explicitly opts in to a rebuild.
 *  Ranks by unlockLevel descending (higher = stronger). */
export function rebuildLoadoutToStrongest(
  templateId: string,
  classId: string | undefined,
  level: number,
): string[] {
  const candidates = new Set<string>();
  for (const id of (CHARACTER_SKILLS[templateId] ?? [])) candidates.add(id);
  if (classId) for (const id of (CLASS_SKILLS[classId] ?? [])) candidates.add(id);
  const unlocked: { id: string; tier: number }[] = [];
  for (const id of candidates) {
    const skill = getSkill(id);
    const unlockAt = skill.unlockLevel ?? 1;
    if (level >= unlockAt) unlocked.push({ id, tier: unlockAt });
  }
  unlocked.sort((a, b) => b.tier - a.tier);
  return unlocked.slice(0, MAX_EQUIPPED_SKILLS).map(u => u.id);
}

export function resetAllProgress(): void {
  try { localStorage.removeItem(KEY()); } catch { /* ignore */ }
}

/** Snapshot the entire progress blob for this wallet (or null if empty). */
export function snapshotAllProgress(): string | null {
  try { return localStorage.getItem(KEY()); } catch { return null; }
}

/** Restore a previously snapshotted blob. Pass null to clear. */
export function restoreAllProgress(snapshot: string | null): void {
  try {
    if (snapshot === null) localStorage.removeItem(KEY());
    else localStorage.setItem(KEY(), snapshot);
  } catch { /* ignore */ }
}

// ---- Server-canonical progress sync ----
// The localStorage map is a cache. The server holds the canonical record
// and validates every claim — if the client's localStorage was tampered with
// (level/XP/customStats edited directly), the server rejects the claim and
// returns the canonical state, which we then write back into localStorage
// to undo the tampering. This is the devtool-proofing layer for XP and stats.

import { loadSession } from "../auth/session";

interface ProgressSyncResponse {
  ok: boolean;
  canonical: { units: Record<string, UnitProgress> };
  /** Optional on progress_get: server-canonical highest stage cleared. The
   *  client uses this to reconcile localStorage stage-unlock state after a
   *  wipe. Older server builds omit this field. */
  maxFloor?: number;
  reason?: string;
}

/** Fetch the server's canonical progress and write it into localStorage,
 *  replacing whatever was there. Call at app init / home-screen entry so
 *  any device-side tampering is undone on every visit. */
export async function pullCanonicalProgress(): Promise<{ ok: boolean; reason?: string } | null> {
  const sess = loadSession();
  if (!sess) return null;
  try {
    const r = await fetch("/api/run/floor-cleared", {
      method: "POST",
      headers: { Authorization: `Bearer ${sess.token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ op: "progress_get" }),
    });
    if (!r.ok) return null;
    const data = await r.json() as ProgressSyncResponse;
    if (data.canonical && data.canonical.units) {
      // Always overwrite from the server canonical, even when it's empty.
      // The previous "skip overwrite when empty" guard was meant to protect
      // first-time wallets but it made post-wipe recovery impossible —
      // players' stale localStorage would survive a server wipe forever.
      // The server is authoritative; if it says empty, we go empty.
      saveAll(data.canonical.units);
    }
    // Reconcile stage-unlock cache. The unlock list is keyed off the max
    // stage cleared, which lives in localStorage. Post-wipe the server says
    // 0 but localStorage still shows e.g. 50, so every stage stays unlocked
    // until we explicitly overwrite. typeof check keeps us compatible with
    // older server builds that don't return maxFloor.
    if (typeof data.maxFloor === "number") {
      const { setMaxClearedFromServer } = await import("./clears");
      setMaxClearedFromServer(data.maxFloor);
    }
    return { ok: true };
  } catch { return null; }
}

/** Push the local progress map up to the server. The server validates, then:
 *    - if valid: persists the claim as the new canonical → returns ok=true
 *    - if invalid: returns the existing canonical → we overwrite localStorage,
 *      effectively rolling back any tampering since the last sync.
 *  Call after every legitimate progress write (battle XP, stat allocation,
 *  class change, skill equip). */
export async function pushProgress(): Promise<{ ok: boolean; reason?: string } | null> {
  const sess = loadSession();
  if (!sess) return null;
  const claimed = loadAll();
  try {
    const r = await fetch("/api/run/floor-cleared", {
      method: "POST",
      headers: { Authorization: `Bearer ${sess.token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ op: "progress_sync", claimed }),
    });
    if (!r.ok) return null;
    const data = await r.json() as ProgressSyncResponse;
    if (!data.ok && data.canonical && data.canonical.units) {
      // Tampering detected — overwrite localStorage with the server canonical
      // so further reads pick up the rolled-back state.
      saveAll(data.canonical.units);
      return { ok: false, reason: data.reason };
    }
    return { ok: true };
  } catch { return null; }
}
