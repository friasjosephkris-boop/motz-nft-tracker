// Client wrapper around the survival leaderboard backend.
// Calls fail soft: if the server is unreachable, the run continues locally —
// we just won't have a leaderboard entry for it.

import { loadSession } from "../auth/session";
import { loadSettings } from "../ui/settings";

export interface LbEntry {
  rank: number;
  address: string;
  ign: string | null;
  floor: number;
  ms: number;
}

export type LbMode = "survival" | "boss_raid";

export interface LiveRun {
  runId: string;
  token: string;
  startedAt: number; // local clock, for UI timer only
  highestFloor: number;
  mode: LbMode;
}

let live: LiveRun | null = null;

export function getLiveRun(): LiveRun | null { return live; }

function sessionToken(): string | null {
  return loadSession()?.token ?? null;
}

export async function startRun(mode: LbMode = "survival", party: string[] = []): Promise<LiveRun | null> {
  const sess = sessionToken();
  if (!sess) return null;
  try {
    const r = await fetch("/api/run/start", {
      method: "POST",
      headers: { Authorization: `Bearer ${sess}`, "Content-Type": "application/json" },
      body: JSON.stringify({ mode, party }),
    });
    if (!r.ok) return null;
    const data = await r.json() as { runId: string; token: string };
    live = { runId: data.runId, token: data.token, startedAt: Date.now(), highestFloor: 0, mode };
    return live;
  } catch {
    return null;
  }
}

export async function reportFloor(floor: number): Promise<boolean> {
  if (!live) return false;
  try {
    const r = await fetch("/api/run/floor", {
      method: "POST",
      headers: { Authorization: `Bearer ${live.token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ runId: live.runId, floor }),
    });
    if (!r.ok) return false;
    live.highestFloor = floor;
    return true;
  } catch { return false; }
}

export async function endRun(replay?: unknown): Promise<{ floor: number; totalMs: number } | null> {
  if (!live) return null;
  const cur = live;
  live = null;
  try {
    const ign = loadSettings().playerName;
    const r = await fetch("/api/run/end", {
      method: "POST",
      headers: { Authorization: `Bearer ${cur.token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ runId: cur.runId, ign, ...(replay ? { replay } : {}) }),
    });
    if (!r.ok) return null;
    return await r.json() as { floor: number; totalMs: number };
  } catch { return null; }
}

export function abortLiveRun(): void { live = null; }

/** Single-floor (non-leaderboard) battle completed. Tells the server to credit
 *  the wallet's anti-cheat XP ceiling. For floor 50, also submits clear time
 *  to the Fastest World Ender leaderboard and (optionally) the recorded replay
 *  blob. Fail-soft. */
export async function reportFloorCleared(stageId: number, ms?: number, replay?: unknown): Promise<void> {
  const sess = sessionToken();
  if (!sess) return;
  try {
    await fetch("/api/run/floor-cleared", {
      method: "POST",
      headers: { Authorization: `Bearer ${sess}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        stageId,
        op: "clear",
        ...(typeof ms === "number" ? { ms } : {}),
        ...(replay ? { replay } : {}),
      }),
    });
  } catch { /* ignore */ }
}

export async function fetchReplayBlob<T = unknown>(scope: string, address: string): Promise<T | null> {
  const sess = sessionToken();
  if (!sess) return null;
  try {
    const r = await fetch("/api/run/floor-cleared", {
      method: "POST",
      headers: { Authorization: `Bearer ${sess}`, "Content-Type": "application/json" },
      body: JSON.stringify({ op: "get_replay", scope, address }),
    });
    if (!r.ok) return null;
    const data = await r.json() as { blob: T | null };
    return data.blob ?? null;
  } catch { return null; }
}

export interface FloorRetryStatus { used: number; remaining: number; max: number; }

/** Read remaining defeat-refund slots for today. Returns null on network failure.
 *  (Internally still called "retry_status" — same daily counter, repurposed.) */
export async function fetchFloorRetryStatus(stageId: number): Promise<FloorRetryStatus | null> {
  const sess = sessionToken();
  if (!sess) return null;
  try {
    const r = await fetch("/api/run/floor-cleared", {
      method: "POST",
      headers: { Authorization: `Bearer ${sess}`, "Content-Type": "application/json" },
      body: JSON.stringify({ stageId, op: "retry_status" }),
    });
    if (!r.ok) return null;
    const data = await r.json() as { used: number; remaining: number; max: number };
    return data;
  } catch { return null; }
}

export type AdminLbScope = "survival" | "bossraid" | "we" | "conquer" | "floorclimb";

/** Admin: wipe a single leaderboard. */
export async function adminResetOneLeaderboard(scope: AdminLbScope): Promise<{ ok: boolean; cleared?: string[]; error?: string }> {
  const sess = sessionToken();
  if (!sess) return { ok: false, error: "no session" };
  try {
    const r = await fetch("/api/run/floor-cleared", {
      method: "POST",
      headers: { Authorization: `Bearer ${sess}`, "Content-Type": "application/json" },
      body: JSON.stringify({ op: "admin_reset_lb", scope }),
    });
    if (r.status === 403) return { ok: false, error: "admin only" };
    if (!r.ok) return { ok: false, error: `http ${r.status}` };
    const data = await r.json() as { cleared: string[] };
    return { ok: true, cleared: data.cleared };
  } catch { return { ok: false, error: "network" }; }
}

/** Atomically claim a defeat-refund: server bumps the daily counter and grants
 *  +1 energy, returning the new state. Returns { ok: false } on cap reached. */
export async function claimDefeatRefund(stageId: number): Promise<{ ok: boolean; remaining: number; energy?: number } | null> {
  const sess = sessionToken();
  if (!sess) return null;
  try {
    const r = await fetch("/api/run/floor-cleared", {
      method: "POST",
      headers: { Authorization: `Bearer ${sess}`, "Content-Type": "application/json" },
      body: JSON.stringify({ stageId, op: "defeat_refund" }),
    });
    const data = await r.json().catch(() => ({})) as { ok?: boolean; remaining?: number; energy?: number };
    if (r.status === 429) return { ok: false, remaining: 0 };
    if (!r.ok) return null;
    return {
      ok: !!data.ok,
      remaining: typeof data.remaining === "number" ? data.remaining : 0,
      energy: typeof data.energy === "number" ? data.energy : undefined,
    };
  } catch { return null; }
}

export async function fetchTop(mode: LbMode = "survival", limit = 50): Promise<LbEntry[]> {
  try {
    const r = await fetch(`/api/leaderboard/top?mode=${mode}&limit=${limit}`);
    if (!r.ok) return [];
    const data = await r.json() as { entries: LbEntry[] };
    return data.entries ?? [];
  } catch { return []; }
}

export interface FirstConquerPartyMember {
  templateId: string;
  classId?: string;
  level: number;
  customStats: Record<string, number>;
  equippedSkills: string[];
}

export interface FirstConquerEntry {
  address: string;
  ign: string | null;
  when: number;
  party?: FirstConquerPartyMember[];
}

export interface WorldEnderEntry { rank: number; address: string; ign: string | null; ms: number; }

export interface HighestFloorEntry { rank: number; address: string; ign: string | null; floor: number; }

export interface LeaderboardFetch {
  entries: LbEntry[];
  firstConquer: FirstConquerEntry | null;
  worldEnder: WorldEnderEntry[];
  highestFloor: HighestFloorEntry[];
  /** Total RON spent on the shop — the live prize pool for the floor board. */
  shopRevenue: number;
}

export async function fetchTopWithExtras(mode: LbMode = "survival", limit = 50): Promise<LeaderboardFetch> {
  const empty: LeaderboardFetch = { entries: [], firstConquer: null, worldEnder: [], highestFloor: [], shopRevenue: 0 };
  try {
    const r = await fetch(`/api/leaderboard/top?mode=${mode}&limit=${limit}&extras=1`);
    if (!r.ok) return empty;
    const data = await r.json() as {
      entries: LbEntry[]; firstConquer: FirstConquerEntry | null; worldEnder: WorldEnderEntry[];
      highestFloor?: HighestFloorEntry[]; shopRevenue?: number;
    };
    return {
      entries: data.entries ?? [],
      firstConquer: data.firstConquer ?? null,
      worldEnder: data.worldEnder ?? [],
      highestFloor: data.highestFloor ?? [],
      shopRevenue: typeof data.shopRevenue === "number" ? data.shopRevenue : 0,
    };
  } catch { return empty; }
}

export function formatMs(ms: number): string {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  return `${m}:${String(sec).padStart(2, "0")}`;
}
