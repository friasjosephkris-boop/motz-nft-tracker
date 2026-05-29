// End-of-season leaderboard freeze.
//
// The admin captures a snapshot of the current LB state and flips a flag;
// /api/leaderboard/top then returns the snapshot instead of live data for
// every read. New submissions still land in Redis (they don't disappear),
// but no one sees them until freeze is lifted. Designed for "Season 1
// over, this is the final board, lock it in" use cases.
//
// Storage:
//   lb:frozen:enabled:v1   "1" when frozen, key absent when live
//   lb:frozen:snapshot:v1  JSON blob of the captured state

import { getJson, setJson, del, setNxWithExpire, hmget, zrevrangeWithScores } from "./redis.js";
import {
  lbKeyFor, IGN_HASH_KEY, decodeScore,
  getFirstConquer, getWorldEnderTop, getHighestFloorTop,
  WorldEnderEntry, HighestFloorEntry,
} from "./runState.js";
import { readShopRevenue } from "./analytics.js";

const SNAPSHOT_KEY = "lb:frozen:snapshot:v1";
const FROZEN_FLAG_KEY = "lb:frozen:enabled:v1";
const SCHEDULED_KEY = "lb:frozen:scheduled:v1";
/** Short-lived lock so concurrent requests at the freeze moment can't
 *  both try to capture/flip. Whoever wins the SETNX does the work,
 *  everyone else skips cleanly. */
const SCHEDULED_LOCK_KEY = "lb:frozen:scheduled:lock:v1";
const SCHEDULED_LOCK_TTL = 30;
/** TTL for the freeze flag — 5 years. The snapshot lives indefinitely
 *  (re-snapshotted on next freeze). 5y is "effectively forever" in this
 *  game's lifecycle but still has a sane upper bound. */
const FROZEN_TTL = 60 * 60 * 24 * 365 * 5;

/** Shape returned by /api/leaderboard/top, normalized so the client can
 *  treat a frozen response identically to a live one. */
export interface LbSurvivalLikeEntry {
  rank: number;
  address: string;
  ign: string | null;
  floor: number;
  ms: number;
}

export interface FirstConquerSnap {
  address: string;
  ign: string | null;
  when: number;
  party?: unknown;
}

export interface FrozenSnapshot {
  /** ms epoch of when the snapshot was captured. */
  capturedAt: number;
  /** Admin wallet that captured the snapshot. */
  capturedBy: string;
  /** Friendly label shown to players when frozen (e.g. "Season 1 Final"). */
  label: string;
  survival: LbSurvivalLikeEntry[];
  bossRaid: LbSurvivalLikeEntry[];
  highestFloor: HighestFloorEntry[];
  worldEnder: WorldEnderEntry[];
  firstConquer: FirstConquerSnap | null;
  shopRevenue: number;
}

/** True when the freeze flag is set — /api/leaderboard/top should serve
 *  the snapshot in this case. */
export async function isFrozen(): Promise<boolean> {
  // Use getJson so a JSON-encoded "1" (as setJson writes) still reads true.
  const raw = await getJson<string | number | boolean>(FROZEN_FLAG_KEY);
  return raw !== null && raw !== false && raw !== 0 && raw !== "";
}

/** Read the captured snapshot. Null when none has ever been captured. */
export async function readSnapshot(): Promise<FrozenSnapshot | null> {
  return await getJson<FrozenSnapshot>(SNAPSHOT_KEY);
}

/** Flip the freeze flag on or off. Capturing a snapshot is a separate
 *  operation — admin can re-enable freeze on an older snapshot, or
 *  re-snapshot before re-enabling, depending on intent. */
export async function setFrozen(on: boolean): Promise<void> {
  if (on) await setJson(FROZEN_FLAG_KEY, 1, FROZEN_TTL);
  else await del(FROZEN_FLAG_KEY);
}

/** Capture the current state of every LB into a snapshot blob. Reads the
 *  top `limit` from survival + boss_raid (default 50 — enough headroom for
 *  any reasonable display), top 5 of world ender / highest floor (matches
 *  the UI's SLOT_COUNT), plus the first-conqueror record and shop revenue.
 *  Replays are NOT included — clients still fetch those live from their
 *  individual replay keys, which aren't time-sensitive.
 *  `by` is the admin wallet that triggered the capture (for audit). */
export async function captureSnapshot(
  by: string,
  label: string,
  limit = 50,
): Promise<FrozenSnapshot> {
  // Survival + boss raid top-N — same shape as the live endpoint produces.
  const buildList = async (mode: "survival" | "boss_raid"): Promise<LbSurvivalLikeEntry[]> => {
    const rows = await zrevrangeWithScores(lbKeyFor(mode), 0, limit - 1);
    if (rows.length === 0) return [];
    const igns = await hmget(IGN_HASH_KEY, rows.map(r => r.member));
    return rows.map((r, i) => {
      const { floor, ms } = decodeScore(r.score);
      return { rank: i + 1, address: r.member, ign: igns[i] ?? null, floor, ms };
    });
  };

  const [survival, bossRaid, worldEnder, highestFloor, firstConquerRec, shopRevenue] = await Promise.all([
    buildList("survival"),
    buildList("boss_raid"),
    getWorldEnderTop(5).catch(() => [] as WorldEnderEntry[]),
    getHighestFloorTop(5).catch(() => [] as HighestFloorEntry[]),
    getFirstConquer().catch(() => null),
    readShopRevenue().catch(() => 0),
  ]);

  let firstConquer: FirstConquerSnap | null = null;
  if (firstConquerRec) {
    const [ign] = await hmget(IGN_HASH_KEY, [firstConquerRec.address.toLowerCase()]).catch(() => [null] as (string | null)[]);
    firstConquer = {
      address: firstConquerRec.address,
      ign: ign ?? null,
      when: firstConquerRec.when,
      party: firstConquerRec.party,
    };
  }

  const snap: FrozenSnapshot = {
    capturedAt: Date.now(),
    capturedBy: by.toLowerCase(),
    label,
    survival,
    bossRaid,
    highestFloor,
    worldEnder,
    firstConquer,
    shopRevenue,
  };
  await setJson(SNAPSHOT_KEY, snap, FROZEN_TTL);
  return snap;
}

/** If the LB is currently frozen, re-capture the snapshot from live data
 *  using the existing snapshot's label. Called from each admin mutation
 *  op (set max floor, submit LB score, remove entry, etc.) so changes
 *  push to the publicly-displayed frozen LB without the admin having to
 *  hit Snapshot Now after every edit. Returns true if a re-snapshot
 *  actually happened. */
export async function refreshSnapshotIfFrozen(by: string): Promise<boolean> {
  if (!(await isFrozen().catch(() => false))) return false;
  const prev = await readSnapshot().catch(() => null);
  // Reuse the existing label (e.g. "Season 1 Final"); fall back to a
  // sensible default if somehow no snapshot exists while frozen.
  const label = prev?.label ?? "Season Final";
  await captureSnapshot(by, label).catch(() => undefined);
  return true;
}

/** Scheduled freeze — pending automatic capture+flip at a specific moment. */
export interface ScheduledFreeze {
  /** ms epoch when the freeze should fire (UTC). */
  at: number;
  /** Label to write into the snapshot when it fires. */
  label: string;
  /** Admin wallet that scheduled it. */
  by: string;
  /** When the schedule was created (ms epoch). */
  scheduledAt: number;
}

export async function getScheduledFreeze(): Promise<ScheduledFreeze | null> {
  return await getJson<ScheduledFreeze>(SCHEDULED_KEY);
}

/** Pin a future automatic freeze. Overwrites any prior schedule. The
 *  actual capture+flip happens via checkAndExecuteScheduledFreeze() —
 *  triggered lazily from request handlers (no cron required). */
export async function scheduleFreeze(at: number, label: string, by: string): Promise<ScheduledFreeze> {
  const rec: ScheduledFreeze = {
    at: Math.floor(at),
    label: label.slice(0, 60) || "Season Final",
    by: by.toLowerCase(),
    scheduledAt: Date.now(),
  };
  await setJson(SCHEDULED_KEY, rec, FROZEN_TTL);
  return rec;
}

export async function cancelScheduledFreeze(): Promise<boolean> {
  const cur = await getJson<ScheduledFreeze>(SCHEDULED_KEY);
  if (!cur) return false;
  await del(SCHEDULED_KEY);
  return true;
}

/** Idempotent — check whether a scheduled freeze is due AND we're not
 *  already frozen, and if so, capture the snapshot and flip the flag.
 *  Wraps the work in a SETNX lock so concurrent callers at the freeze
 *  moment can't both try to fire. Safe to call from any request handler;
 *  designed for lazy-trigger (no cron job required). Returns a brief
 *  status describing what happened (or didn't). */
export async function checkAndExecuteScheduledFreeze(): Promise<
  | { action: "skipped"; reason: string }
  | { action: "fired"; capturedAt: number; label: string }
> {
  const sched = await getScheduledFreeze().catch(() => null);
  if (!sched) return { action: "skipped", reason: "no schedule" };
  if (Date.now() < sched.at) return { action: "skipped", reason: "scheduled time not reached" };
  // Don't refreeze if already frozen.
  if (await isFrozen().catch(() => false)) {
    // Clear the schedule so we don't keep re-evaluating it.
    await del(SCHEDULED_KEY).catch(() => undefined);
    return { action: "skipped", reason: "already frozen — schedule consumed" };
  }
  // Take the lock. If we don't win, somebody else is doing the work.
  const gotLock = await setNxWithExpire(SCHEDULED_LOCK_KEY, "1", SCHEDULED_LOCK_TTL);
  if (!gotLock) return { action: "skipped", reason: "another request is firing the freeze" };
  try {
    // Re-check after acquiring the lock so we don't double-fire if
    // another request slipped through and finished between our first
    // isFrozen() call and now.
    if (await isFrozen().catch(() => false)) {
      await del(SCHEDULED_KEY).catch(() => undefined);
      return { action: "skipped", reason: "already frozen (after lock)" };
    }
    const snap = await captureSnapshot(sched.by, sched.label);
    await setFrozen(true);
    await del(SCHEDULED_KEY).catch(() => undefined);
    return { action: "fired", capturedAt: snap.capturedAt, label: snap.label };
  } finally {
    await del(SCHEDULED_LOCK_KEY).catch(() => undefined);
  }
}

/** Suppress the unused-import warning. Some tools strip side-effect-free
 *  imports too aggressively — this keeps the linter quiet without forcing
 *  a runtime call. */
void setNxWithExpire;
