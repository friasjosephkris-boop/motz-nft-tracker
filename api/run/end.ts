import type { VercelRequest, VercelResponse } from "@vercel/node";
import { verifyRun } from "../_lib/jwt.js";
import { getRun, saveRun, deleteRun, submitToLeaderboard, MIN_AVG_FLOOR_MS, sanitizeIgn, setIgnIfAllowed, syncTopReplays } from "../_lib/runState.js";
import { isSeasonHalted, SEASON_HALTED_RESPONSE } from "../_lib/season.js";

const MAX_PARTY_SIZE = 3;

/** Walk a submitted replay blob and reject if any battle has a party that
 *  exceeds the cap, contains duplicates, or has invalid entries. Returns
 *  true if the blob is safe to persist, false otherwise. Defensive — silently
 *  accepts anything we don't recognize as a battle list. */
function isReplayPartyValid(blob: unknown): boolean {
  if (!blob || typeof blob !== "object") return true;
  const battles = (blob as { battles?: unknown }).battles;
  if (!Array.isArray(battles)) return true;
  for (const battle of battles) {
    if (!battle || typeof battle !== "object") continue;
    const party = (battle as { party?: unknown }).party;
    if (!Array.isArray(party)) continue;
    if (party.length > MAX_PARTY_SIZE) return false;
    const ids = party
      .map(p => (p && typeof p === "object" ? (p as { templateId?: unknown }).templateId : null))
      .filter((x): x is string => typeof x === "string");
    if (new Set(ids).size !== ids.length) return false;
  }
  return true;
}

// Body: { runId: string }
// The server uses its own clock for totalMs — client-supplied times are ignored.
export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== "POST") { res.status(405).json({ error: "method" }); return; }
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith("Bearer ")) { res.status(401).json({ error: "no token" }); return; }

  const body = (req.body ?? {}) as { runId?: unknown; ign?: unknown; replay?: unknown };
  const runId = typeof body.runId === "string" ? body.runId : null;
  if (!runId) { res.status(400).json({ error: "bad body" }); return; }
  const ign = sanitizeIgn(body.ign);
  const replay = body.replay && typeof body.replay === "object" ? body.replay : null;
  // Reject replays that pack more than the legal party size — these would
  // place an unfair score on the leaderboard.
  const replayForSave = replay && isReplayPartyValid(replay) ? replay : null;

  let payload;
  try { payload = await verifyRun(auth.slice("Bearer ".length)); }
  catch { res.status(401).json({ error: "invalid run token" }); return; }
  if (payload.runId !== runId) { res.status(401).json({ error: "token mismatch" }); return; }

  try {
    // Season-halt gate — block all leaderboard submissions during off-season
    // so the LB freezes the moment admin presses Halt. The run already
    // happened, so its state is preserved — the player just can't submit
    // it for ranking until the next season opens.
    if (await isSeasonHalted()) {
      res.status(SEASON_HALTED_RESPONSE.status).json(SEASON_HALTED_RESPONSE.body);
      return;
    }
    // Lazy-trigger any scheduled auto-freeze BEFORE this submission lands.
    // If we're past the scheduled moment, this captures the snapshot using
    // the pre-submission zset state — so a run that finished the instant
    // after the cutoff doesn't sneak into the frozen view.
    await (await import("../_lib/lbFreeze.js")).checkAndExecuteScheduledFreeze().catch(() => undefined);
    const state = await getRun(runId);
    if (!state) { res.status(404).json({ error: "no run" }); return; }
    if (state.address.toLowerCase() !== payload.address.toLowerCase()) { res.status(401).json({ error: "address mismatch" }); return; }

    const totalMs = state.lastFloorAt - state.startedAt;
    const floor = state.currentFloor;

    // ---- Competitive thresholds ----
    // Survival LB only accepts runs that cleared at least MIN_SURVIVAL_FLOORS.
    // Boss Raid LB only accepts runs that cleared at least MIN_BOSS_RAID_BOSSES.
    // The run still completes and the player keeps any XP / rewards — they
    // just don't land on the public board with a sub-threshold score. Keeps
    // top entries meaningful and grindable instead of cluttered with
    // single-floor / single-boss attempts.
    const MIN_SURVIVAL_FLOORS = 25;
    const MIN_BOSS_RAID_BOSSES = 5;
    let submitted = false;
    let rejectedReason: string | null = null;
    if (floor > 0) {
      const avg = totalMs / floor;
      if (avg < MIN_AVG_FLOOR_MS) {
        rejectedReason = "average floor time below threshold";
      } else if (state.mode === "survival" && floor < MIN_SURVIVAL_FLOORS) {
        rejectedReason = `survival leaderboard requires at least ${MIN_SURVIVAL_FLOORS} floors cleared (you cleared ${floor})`;
      } else if (state.mode === "boss_raid" && floor < MIN_BOSS_RAID_BOSSES) {
        rejectedReason = `boss raid leaderboard requires at least ${MIN_BOSS_RAID_BOSSES} bosses defeated (you defeated ${floor})`;
      } else {
        await submitToLeaderboard(state.address, floor, totalMs, state.mode);
        // Cooldown is intentionally silent here — keep the old name on conflict.
        if (ign) await setIgnIfAllowed(state.address, ign);
        submitted = true;
        // Save the replay if this run lands inside the kept top-N, and prune
        // any replays that have fallen outside it (e.g., the player we just
        // pushed off rank 3). Runs through this on every submission, even when
        // ZADD didn't actually improve the score, so stale replays still get
        // cleaned up.
        await syncTopReplays(state.mode, state.address, replayForSave ?? null).catch(() => undefined);
      }
    }

    if (state.status === "live") {
      state.status = "ended";
      await saveRun(runId, state);
    }
    // Free the slot quickly; the leaderboard entry is what persists.
    await deleteRun(runId);

    res.status(200).json({ ok: true, floor, totalMs, submitted, rejectedReason });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : "server error" });
  }
}
