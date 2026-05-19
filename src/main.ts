import { Battle, startBattle, tickAccum, queueAction, surrenderBattle, persistPartyProgress, distributeEndOfBattleXp, BattleOptions, Combatant } from "./core/combat";
import { renderBattle, updateLive, PostBattleAction } from "./ui/battle";
import { getBattleSpeed, setBattleSpeed, isFastForwardAllowed } from "./core/battleSpeed";
import { renderSquadSelect, SquadResult } from "./ui/squadSelect";
import { renderHome, HomeAction } from "./ui/home";
import { renderStageSelect, StagePick, SURVIVAL_ENERGY_COST, BOSS_RAID_ENERGY_COST } from "./ui/stageSelect";

const SURVIVAL_XP_MULT = 1 / 50;
const BOSS_RAID_XP_MULT = 1 / 10;
import { renderUnitsScreen } from "./ui/unitsScreen";
import { renderSettings } from "./ui/settings";
import { getEnergy, setEnergy as setEnergyCache } from "./core/energy";
import { fetchServerEnergy, consumeServerEnergy } from "./auth/energyApi";
import { fetchDailyStatus, getCachedDailyMultiplier } from "./core/daily";
import { renderRunSummary, RunSummary, RunSummaryUnit, pickMvpId } from "./ui/runSummary";
import {
  getProgress, setProgress, pullCanonicalProgress, pushProgress,
  isForcedClassPickPending, markForcedClassPickComplete,
  getPendingForcedStatAllocUnit, clearPendingForcedStatAllocUnit, markForcedStatAllocSeen,
} from "./core/progress";
import { awardXp } from "./core/levels";
import {
  startReplayRecording, abortRecording, finalizeReplay,
  recordBattleStart, ReplayBlob, ReplayPlayer, REPLAY_VERSION,
  ReplayPartyMember,
} from "./core/replay";
import { ATB_FULL } from "./core/timeline";
import { recordClear } from "./core/clears";
import { installGlobalClickSounds } from "./core/audio";
import { mountWalletStatusBadge, refreshWalletStatusBadge } from "./ui/walletStatusBadge";
import { STAGE_DEFS, getStage, BOSS_RAID_FLOORS, PLAYER_ROSTER } from "./units/roster";
import { Stats } from "./core/stats";
import { loadSession, validateSession, clearSession, setVerifiedAddress, setVerifiedPerks, Session } from "./auth/session";
import { setUserScope } from "./auth/scope";
import { renderWalletGate } from "./ui/walletGate";
import { renderIgnGate } from "./ui/ignGate";
import { loadSettings, saveSettings } from "./ui/settings";
import { renderTutorial, isTutorialComplete } from "./ui/tutorial";
import { renderCodex } from "./ui/codex";
import { renderLeaderboard } from "./ui/leaderboard";
import { fetchServerIgn, saveServerIgn } from "./auth/ign";
import { showBossRaidReward, BossRaidReward } from "./ui/bossRaidReward";
import { playBgm, stopBgm, playBattleBgm } from "./core/bgm";
import { startRun, reportFloor, endRun, abortLiveRun, reportFloorCleared, getLiveRun, fetchFloorRetryStatus, claimDefeatRefund } from "./core/leaderboard";
import { isAllowedOnDev } from "./auth/devBuild";
import { confirmModal, alertModal } from "./ui/confirmModal";
import { playBattleStartAnimation } from "./ui/battleStartAnim";
import { fetchAttemptsStatus, claimAttempt, consumeShopItem, rollBron, ShopItemId } from "./core/shop";
import { renderShop } from "./ui/shop";
import { renderInventory } from "./ui/inventory";

const root = document.getElementById("app");
if (!root) throw new Error("#app not found");

let currentSession: Session | null = null;

void bootstrap();

async function bootstrap(): Promise<void> {
  const existing = loadSession();
  if (existing) {
    // Dev build: re-check allowlist on every boot so removing a tester actually
    // locks them out, even if they have a stored session.
    if (!isAllowedOnDev(existing.address)) {
      clearSession();
    } else {
      const v = await validateSession(existing.token);
      if (v) {
        currentSession = existing;
        setVerifiedAddress(v.address);
        setVerifiedPerks(v.perks);
        setUserScope(v.address);
        ensureWalletInSettings(v.address);
        startSessionRevalidator();
        refreshWalletStatusBadge();
        void proceedAfterAuth();
        return;
      }
      clearSession();
      refreshWalletStatusBadge();
    }
  }
  renderWalletGate(root!, async s => {
    currentSession = s;
    setVerifiedAddress(s.address);
    setUserScope(s.address);
    ensureWalletInSettings(s.address);
    // Fetch perks immediately after fresh auth so the gate is correct on first render.
    const v = await validateSession(s.token);
    if (v) setVerifiedPerks(v.perks);
    startSessionRevalidator();
    refreshWalletStatusBadge();
    void proceedAfterAuth();
  });
}

/** Periodic re-validation. The server's /api/auth/me re-checks both the JWT
 *  signature AND that the wallet still holds the gated NFT. If the player
 *  transfers/sells their NFT mid-session, this catches it within REVALIDATE_MS
 *  and forces them back to the wallet gate. Also catches server-side session
 *  revocation (e.g. JWT_SECRET rotation). */
const REVALIDATE_MS = 5 * 60 * 1000; // 5 min
let revalidateTimer: ReturnType<typeof setInterval> | null = null;
function startSessionRevalidator(): void {
  if (revalidateTimer) clearInterval(revalidateTimer);
  revalidateTimer = setInterval(async () => {
    if (!currentSession) return;
    const v = await validateSession(currentSession.token);
    if (v) {
      // Refresh perks in case key holding changed (sold/bought MoTZ Key).
      setVerifiedPerks(v.perks);
      return;
    }
    // Session invalidated server-side — wallet sold NFT, JWT expired, or
    // secret rotated. Hard-clear and route back to the gate.
    forceReauth();
  }, REVALIDATE_MS);
}

function forceReauth(): void {
  if (revalidateTimer) { clearInterval(revalidateTimer); revalidateTimer = null; }
  currentSession = null;
  clearSession();
  // Wipe screen state and force the wallet gate. Reload is the safest reset.
  location.reload();
}

async function proceedAfterAuth(): Promise<void> {
  // Seed the local energy cache from the server right after auth so devtools
  // edits made before login are immediately overwritten by the canonical value.
  void fetchServerEnergy();
  // Pre-fetch daily streak status so the cached multiplier is ready before
  // the first run starts.
  void fetchDailyStatus();
  const localIgn = loadSettings().playerName.trim();
  const serverIgn = await fetchServerIgn();

  if (localIgn && !serverIgn) {
    // Backfill: this wallet has a local IGN from before server-side persistence.
    // Save it up now so the leaderboard can display it. Cooldown doesn't apply
    // to the first-time set, so this is safe.
    void saveServerIgn(localIgn);
    runTutorialIfNeeded();
    return;
  }
  if (serverIgn) {
    if (serverIgn !== localIgn) {
      saveSettings({ ...loadSettings(), playerName: serverIgn });
    }
    runTutorialIfNeeded();
    return;
  }
  if (localIgn) { runTutorialIfNeeded(); return; }

  renderIgnGate(root!, runTutorialIfNeeded);
}

function runTutorialIfNeeded(): void {
  if (isTutorialComplete()) {
    startApp();
    return;
  }
  renderTutorial(root!, startApp);
}

function ensureWalletInSettings(address: string): void {
  const cur = loadSettings();
  if (cur.walletAddress !== address) {
    saveSettings({ ...cur, walletAddress: address });
  }
}

function startApp(): void {
  void currentSession;
  installGlobalClickSounds();
  mountWalletStatusBadge();
  showHome();
  requestAnimationFrame(t => { lastT = t; frame(t); });
}

type Screen = "home" | "stage_select" | "squad_select" | "battle" | "units" | "settings" | "leaderboard" | "run_summary" | "replay" | "codex" | "shop" | "inventory";

interface CarryEntry { hp: number; mp: number; xp: number; level: number; availablePoints: number; customStats: Stats; classId?: string; skillCooldowns?: Record<string, number>; gauge?: number; alive?: boolean; damageDealt?: number; damageTaken?: number; kills?: number; xpGainedTotal?: number }

let screen: Screen = "home";
let battle: Battle | null = null;
let lastT = performance.now();
let lastStateKind: string = "";
let lastCombatantCount: number = 0;
let lastAliveCount: number = 0;

// Mode state.
let currentStageId = 1;
let mode: "floor" | "survival" | "boss_raid" = "floor";
let survivalFloor = 1;
let survivalParty: SquadResult["players"] | null = null;
let survivalCarry: Record<string, CarryEntry> = {};
// ---- Shop buff staging ----
// When the player slots a buff in the Shop screen, we stash the id here.
// The next run-start consumes it (server-side) and arms the buff flags.
let pendingBuff: ShopItemId | null = null;
export function setPendingBuff(id: ShopItemId | null): void { pendingBuff = id; }
export function getPendingBuff(): ShopItemId | null { return pendingBuff; }

/** Per-run kill tally by tier — used for the server's RON roll at end of
 *  run. Server is the sole authority on drops; client-side counters just
 *  report what was killed. Server caps mob/boss/world-ender at 50/1/1 per
 *  roll, so a tampered client gains nothing meaningful vs. honest play. */
let runKillCount = 0;
let runBossKillCount = 0;
let runWorldEnderKillCount = 0;
function resetRunKills(): void {
  runKillCount = 0;
  runBossKillCount = 0;
  runWorldEnderKillCount = 0;
}
function mergeBattleKillsIntoRun(events: { killTier: "mob" | "boss" | "world_ender" }[]): void {
  for (const ev of events) {
    if (ev.killTier === "world_ender") runWorldEnderKillCount += 1;
    else if (ev.killTier === "boss")   runBossKillCount += 1;
    else                                runKillCount += 1;
  }
}

/** Buffs active for the CURRENT run. Reset when a new run starts (in
 *  startBattleFromSquad) and individual flags cleared as they're consumed. */
interface ActiveRunBuffs {
  /** Battle Cry — one-shot: consumed by the FIRST battle of the run only. */
  battleCry: boolean;
  /** Phoenix Embers — armed per battle in the run (first death per battle revives). */
  phoenixEmbers: boolean;
  /** Scholar's Insight — one-shot: applies +25% XP to the FIRST battle only.
   *  (Per the design spec, "current floor only" = the next battle that starts
   *  after slotting; subsequent floors of the run don't get the bonus.) */
  scholarsInsightArmed: boolean;
  /** Quickdraw — player ATB-speed multiplier, applied every battle of the run. */
  quickdrawAtbMul: number;
  /** Last Stand — outgoing damage multiplier when only one player ally is alive. */
  lastStandDmgMul: number;
}
let activeRunBuffs: ActiveRunBuffs = freshRunBuffs();
function freshRunBuffs(): ActiveRunBuffs {
  return { battleCry: false, phoenixEmbers: false, scholarsInsightArmed: false, quickdrawAtbMul: 1, lastStandDmgMul: 1 };
}
export function getActiveRunBuffs(): ActiveRunBuffs { return activeRunBuffs; }
/** Consume + return battle-cry flag (used by the build path for the first floor). */
export function consumeBattleCry(): boolean {
  if (!activeRunBuffs.battleCry) return false;
  activeRunBuffs.battleCry = false;
  return true;
}
/** Consume + return Scholar's Insight flag (one-shot, like Battle Cry). */
export function consumeScholarsInsight(): boolean {
  if (!activeRunBuffs.scholarsInsightArmed) return false;
  activeRunBuffs.scholarsInsightArmed = false;
  return true;
}
/** Map a slotted buff id onto the activeRunBuffs flags. Called once at run start. */
function armBuffOnRun(id: ShopItemId): void {
  switch (id) {
    case "buff_battle_cry":       activeRunBuffs.battleCry = true; break;
    case "buff_phoenix_embers":   activeRunBuffs.phoenixEmbers = true; break;
    case "buff_scholars_insight": activeRunBuffs.scholarsInsightArmed = true; break;
    case "buff_quickdraw":        activeRunBuffs.quickdrawAtbMul = 1.25; break;
    case "buff_last_stand":       activeRunBuffs.lastStandDmgMul = 2.0; break;
    default: break; // non-buff items don't arm anything
  }
}

// Floor mode state — used to power the defeat-refund flow.
// On a floor-mode loss the server grants +1 energy back, up to 3 times per
// PH day. The counter is enforced server-side so refreshing the page or
// editing localStorage can't farm extra refunds.
let floorParty: SquadResult["players"] | null = null;
let floorRefundsRemaining: number | null = null; // last known server value

/** Stage id of the floor currently being fought. Used by the slow-mo gate. */
let currentBattleStageId = 0;
/** Floors 31+ render in slow motion (75% speed) for added drama. */
const SLOWMO_STAGE_THRESHOLD = 31;
const SLOWMO_FACTOR = 0.75;
function isSlowMoStage(): boolean { return currentBattleStageId >= SLOWMO_STAGE_THRESHOLD; }


// Boss Raid state.
let brIndex = 0;                              // index into BOSS_RAID_FLOORS, 0 = first boss
let brParty: SquadResult["players"] | null = null;
let brCarry: Record<string, CarryEntry> = {};
let brBossStatReduction = 0;                  // stacking 5%-per-pick
let brPlayerStatBoost = 0;                    // stacking 10%-per-pick
let brPendingHeal = false;                    // one-shot 20% HP/MP at next floor start
let recordedThisBattle = false;
let battleConcluded = false;
/** Wall-clock ms when the current floor-mode battle started. Used for the
 *  Fastest World Ender leaderboard on floor-50 clears. */
let floorBattleStartedAt = 0;

/** Active replay playback (null when not in replay mode). */
let replayPlayer: ReplayPlayer | null = null;
let replayLabel = "";  // "Spectating: IGN" string for the header

/** Begin watching a recorded replay. Reconstructs a deterministic battle from
 *  the blob and switches to the replay screen. Multi-floor replays auto-advance
 *  through each battle in order. */
export function playReplay(blob: ReplayBlob): void {
  if (blob.v !== REPLAY_VERSION) {
    void alertModal({ kind: "warning", title: "Replay Unavailable", message: "This replay was recorded on a different game version and can't be played." });
    return;
  }
  if (!blob.battles || blob.battles.length === 0) {
    void alertModal({ kind: "warning", title: "Empty Replay", message: "This replay has no battles to play." });
    return;
  }

  // Stop any in-progress runs / recordings.
  abortLiveRun();
  abortRecording();

  replayPlayer = new ReplayPlayer(blob);
  replayLabel = blob.ign ? `Spectating: ${blob.ign}` : "Spectating replay";
  screen = "replay";
  stopBgm();
  recordedThisBattle = false;
  battleConcluded = false;

  if (!loadReplayBattle()) { showLeaderboard(); return; }
  showReplayBanner(replayLabel);
}

/** Set up the current battle from the active replay player. Returns false if
 *  the replay's stage / party can't be reconstructed. */
function loadReplayBattle(): boolean {
  if (!replayPlayer) return false;
  const rb = replayPlayer.currentBattle();
  if (!rb) return false;
  const stage = getStage(rb.stageId);
  if (!stage) {
    void alertModal({ kind: "error", title: "Replay Broken", message: "This replay references a stage that no longer exists." });
    return false;
  }

  const PLAYER_BY_ID = new Map(PLAYER_ROSTER.map(t => [t.id, t]));
  const players: SquadResult["players"] = [];
  const partyOverride: NonNullable<BattleOptions["partyOverride"]> = {};
  rb.party.forEach((m, i) => {
    const t = PLAYER_BY_ID.get(m.templateId);
    if (!t) return;
    players.push({ template: t, position: { row: i, col: 0 } });
    partyOverride[m.templateId] = {
      classId: m.classId,
      level: m.level,
      customStats: m.customStats,
      equippedSkills: m.equippedSkills,
      hp: m.hp,
      mp: m.mp,
      gauge: m.gauge,
      alive: m.alive,
      skillCooldowns: m.skillCooldowns,
    };
  });
  if (players.length === 0) {
    void alertModal({ kind: "error", title: "Replay Broken", message: "This replay's party is empty or invalid." });
    return false;
  }

  // For boss-raid replays, apply the same scaling/boons that were active when
  // the run was recorded. Without this the boss is unscaled, the fight diverges
  // from the recording, and units run out of recorded actions early.
  const startOpts: BattleOptions = {
    xpMultiplier: 1,
    partyOverride,
  };
  if (replayPlayer.blob.mode === "boss_raid") {
    const br = rb.bossRaid;
    startOpts.bossRaid = true;
    startOpts.bossStatReduction = br?.bossStatReduction ?? 0;
    startOpts.playerStatBoost = br?.playerStatBoost ?? 0;
    startOpts.pendingHeal = br?.pendingHeal ?? false;
  }
  battle = startBattle(players, stage.enemies, rb.seed, startOpts);
  battle.replayMode = true;
  currentBattleStageId = rb.stageId;
  lastStateKind = battle.state.kind;
  lastCombatantCount = battle.combatants.length;
  lastAliveCount = battle.combatants.filter(c => c.alive).length;
  playBattleBgm(
    rb.stageId,
    replayPlayer.blob.mode === "boss_raid" ? "boss_raid" : replayPlayer.blob.mode === "survival" ? "survival" : "floor",
    !!stage.soloBoss,
  );
  renderBattle(root!, battle, () => undefined, () => showLeaderboard(), {
    showPostBattleButtons: false,
    slowMo: isSlowMoStage(),
    stageId: currentBattleStageId,
  });
  return true;
}

function showReplayBanner(text: string): void {
  hideReplayBanner();
  const banner = document.createElement("div");
  banner.className = "replay-banner";
  banner.id = "replay-banner";
  banner.innerHTML = `<span class="replay-banner-text">${escapeHtmlReplay(text)}</span><button class="replay-banner-close" id="replay-banner-close">Stop watching</button>`;
  document.body.appendChild(banner);
  document.getElementById("replay-banner-close")?.addEventListener("click", () => showLeaderboard());
}

function hideReplayBanner(): void {
  document.getElementById("replay-banner")?.remove();
}

function escapeHtmlReplay(s: string): string {
  return s.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

/** During replay playback, look at every alive ready player and assign them
 *  the next recorded action so executeAction can resolve as if a player had queued it. */
function injectReplayActions(b: Battle): void {
  if (!replayPlayer) return;
  const players = b.combatants.filter(c => c.side === "player");
  const enemies = b.combatants.filter(c => c.side === "enemy");
  for (let i = 0; i < players.length; i++) {
    const c = players[i];
    if (!c.alive) continue;
    if (c.queuedAction) continue;
    if (c.gauge < ATB_FULL * 0.95) continue;  // wait until they're nearly ready
    const next = replayPlayer.pollAction(i);
    if (!next) {
      // No more recorded actions for this unit. Leave queuedAction null so
      // tick() skips them (it already does for players without a queue).
      // Forcing idle here used to spam the action — idle keeps 25% gauge, so
      // it'd refill in a few frames and spam the next idle, looking buggy.
      // The battle will still resolve via other actors / enemies as it did at
      // record time.
      continue;
    }
    let targetId = c.id;
    if (next.targetIdx >= 0 && next.targetIdx < enemies.length) {
      const t = enemies[next.targetIdx];
      if (t && t.alive) targetId = t.id;
      else {
        // Original target is dead — fallback to first alive enemy.
        const alive = enemies.find(e => e.alive);
        if (alive) targetId = alive.id;
      }
    }
    c.queuedAction = { skillId: next.skillId, targetId };
  }
}

/** Snapshot a survival/boss-raid run's per-unit aggregates from the active battle. */
function buildRunSummaryUnits(b: Battle): RunSummaryUnit[] {
  return b.combatants
    .filter(c => c.side === "player")
    .map(c => ({
      templateId: c.templateId,
      level: c.level,
      xpGained: c.xpGainedTotal,
      damageDealt: c.damageDealt,
      damageTaken: c.damageTaken,
      kills: c.kills,
    }));
}

async function showRunSummary(outcome: "victory" | "defeat", floorsCleared: number): Promise<void> {
  if (!battle) { showHome(); return; }
  // Fold this battle's kill events into the run tally. For floor mode this
  // is the only battle; for survival/boss raid, intermediate floors have
  // already been folded in by their respective transition handlers.
  if (battle.killEvents) mergeBattleKillsIntoRun(battle.killEvents);
  const runMode: RunSummary["mode"] = mode === "boss_raid" ? "boss_raid"
                                    : mode === "survival" ? "survival"
                                    : "floor";
  const units = buildRunSummaryUnits(battle);
  let totalMs = 0;
  let submitted = false;
  let floorLabel: string | undefined;

  if (runMode === "survival" || runMode === "boss_raid") {
    const startedAt = getLiveRun()?.startedAt ?? Date.now();
    // Finalize the multi-floor replay blob and ship it alongside the run-end
    // call. The server only persists it if this run actually beat the wallet's
    // prior best.
    const replay = finalizeReplay();
    const result = await endRun(replay ?? undefined);
    totalMs = result?.totalMs ?? Math.max(0, Date.now() - startedAt);
    submitted = !!result;
  } else {
    // Floor mode: use the per-battle wall-clock elapsed time we tracked when
    // the battle started, and surface the stage name in the headline.
    totalMs = floorBattleStartedAt > 0 ? Math.max(0, Date.now() - floorBattleStartedAt) : 0;
    const stage = getStage(currentStageId);
    if (stage) floorLabel = stage.name;
  }

  // MVP bonus: +20% XP to the unit with the highest damage+kills score.
  // Applied after the main run XP has been distributed and persisted, so the
  // bonus stacks on the level the MVP just earned. Skipped on defeat without
  // any earned XP to avoid awarding a zero bonus.
  const MVP_XP_BONUS = 0.2;
  const mvpId = pickMvpId(units);
  let mvpBonusXp = 0;
  if (mvpId) {
    const mvpUnit = units.find(u => u.templateId === mvpId);
    if (mvpUnit && mvpUnit.xpGained > 0) {
      const bonus = Math.floor(mvpUnit.xpGained * MVP_XP_BONUS);
      if (bonus > 0) {
        const cur = getProgress(mvpId);
        const lifted = { level: cur.level, xp: cur.xp };
        const gained = awardXp(lifted, bonus);
        setProgress(mvpId, {
          ...cur,
          level: lifted.level,
          xp: lifted.xp,
          availablePoints: cur.availablePoints + gained * 4,
        });
        mvpUnit.level = lifted.level;
        mvpUnit.xpGained += bonus;
        mvpBonusXp = bonus;
      }
    }
  }

  // Sync the post-battle progress to the server canonical record. If a
  // devtools-tampered claim was made before/during this run, the server will
  // overwrite localStorage with the canonical state when this returns.
  void pushProgress();

  // Ask the server to roll RON drops for this run's kills. Server uses its
  // own crypto RNG, caps mob kills at 50 and boss kills at 1 per call, and
  // credits the wallet itself — there's nothing on the client to tamper with
  // beyond the kill counts, and those caps make farming impractical.
  let ronSnapshot = { t1: 0, t2: 0, t3: 0, t4: 0, t5: 0, total: 0 };
  const rolled = await rollBron(runKillCount, runBossKillCount, runWorldEnderKillCount).catch(() => null);
  if (rolled) ronSnapshot = rolled.drops;

  const summary: RunSummary = {
    mode: runMode,
    outcome,
    floorsCleared,
    totalMs,
    units,
    submitted,
    floorLabel,
    mvpId,
    mvpBonusXp,
    battleLog: battle ? battle.log.slice() : undefined,
    playerNames: battle ? Array.from(new Set(battle.combatants.filter(c => c.side === "player").map(c => c.name))) : undefined,
    enemyNames: battle ? Array.from(new Set(battle.combatants.filter(c => c.side === "enemy").map(c => c.name))) : undefined,
    ronDrops: ronSnapshot,
  };

  abortLiveRun();
  screen = "run_summary";
  battle = null;
  playBgm();

  // Floor-mode defeats refund +1 energy server-side, up to 3× per PH day.
  // Counter lives in Redis (keyed to wallet + day) — devtools can't tamper
  // with it, and the actual energy add is server-authoritative too.
  if (runMode === "floor" && outcome === "defeat") {
    const status = await fetchFloorRetryStatus(currentStageId);
    const remainingBefore = status?.remaining ?? floorRefundsRemaining ?? 0;
    if (remainingBefore > 0) {
      const claim = await claimDefeatRefund(currentStageId);
      if (claim?.ok) {
        floorRefundsRemaining = claim.remaining;
        if (typeof claim.energy === "number") {
          setEnergyCache(claim.energy);
        }
        const left = claim.remaining;
        const notice = `+1 energy refunded for the loss · ${left} refund${left === 1 ? "" : "s"} left today`;
        const partyForReplay = floorParty;
        const replayStageId = currentStageId;
        renderRunSummary(root!, summary, showHome, {
          refundNotice: notice,
          onReplayFloor: partyForReplay ? async () => { await advanceToNextFloor(replayStageId, partyForReplay); } : undefined,
        });
        return;
      }
      // Claim failed (race or network): fall through to plain summary.
      floorRefundsRemaining = claim?.remaining ?? remainingBefore;
    } else {
      floorRefundsRemaining = 0;
    }
  }

  // Floor-mode: offer Replay (same floor, same party) on either outcome so
  // players can grind / re-attempt without bouncing through Home → Tower →
  // Squad Select. Costs 1 energy each time. Wins also get the Next Floor
  // button if there's a next floor unlocked.
  if (runMode === "floor" && floorParty) {
    const partyForRetry = floorParty;
    const replayStageId = currentStageId;
    const replayAction = async () => { await advanceToNextFloor(replayStageId, partyForRetry); };

    if (outcome === "victory" && currentStageId < 50) {
      const nextStageId = currentStageId + 1;
      const nextStage = getStage(nextStageId);
      if (nextStage) {
        renderRunSummary(root!, summary, showHome, {
          onNextFloor: async () => { await advanceToNextFloor(nextStageId, partyForRetry); },
          nextFloorLabel: `Next Floor → ${nextStage.name}`,
          onReplayFloor: replayAction,
        });
        return;
      }
    }
    // Victory on Floor 50, or any defeat: replay button alone (no Next Floor).
    renderRunSummary(root!, summary, showHome, { onReplayFloor: replayAction });
    return;
  }

  renderRunSummary(root!, summary, showHome);
}

/** Consume energy and start the next floor with the same party. Used by the
 *  run summary's "Next Floor" button. Mirrors the Begin Battle flow:
 *  confirmation modal → sword-clash transition → run starts. */
async function advanceToNextFloor(stageId: number, party: SquadResult["players"]): Promise<void> {
  const nextStage = getStage(stageId);
  const partyNames = party.map(p => p.template.name).join(", ");
  // Detect replay (same floor we just finished) so the modal title is accurate.
  const isReplay = stageId === currentStageId;
  const ok = await confirmModal({
    title: isReplay ? "Replay This Floor?" : "Begin Next Floor?",
    message: `${isReplay ? "Re-fight" : "Continue to"} <strong>Floor ${stageId}${nextStage ? ` · ${escapeHtmlSimple(nextStage.name)}` : ""}</strong> with <strong>${party.length}</strong> unit${party.length === 1 ? "" : "s"} — <strong>${escapeHtmlSimple(partyNames)}</strong>?<br><br>Costs <strong>1 energy</strong>.`,
    confirmLabel: isReplay ? "Replay" : "Begin",
    cancelLabel: "Cancel",
  });
  if (!ok) return;

  const r = await consumeServerEnergy(1);
  if (!r.ok) {
    if ("error" in r) await alertModal({ kind: "error", message: "Couldn't reach server. Try again." });
    else await alertModal({ kind: "warning", title: "Not Enough Energy", message: `Need <strong>1</strong> energy, you have <strong>${r.amount}</strong>.` });
    return;
  }
  currentStageId = stageId;
  // Sword-clash transition (same animation + skirmish SFX as initial Begin Battle).
  await playBattleStartAnimation();
  runFloor(party, stageId, 1.0);
}

/** Tiny local escaper — only used inside the Next Floor confirm message. */
function escapeHtmlSimple(s: string): string {
  return s.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

function handleAction(unitId: string, skillId: string, targetId: string): void {
  if (!battle) return;
  queueAction(battle, unitId, skillId, targetId);
}

function showHome(): void {
  // If abandoning a live survival/boss-raid run mid-flight, finalize it so any
  // floors already cleared count toward the leaderboard.
  if ((mode === "survival" || mode === "boss_raid") && battle && battle.state.kind !== "victory" && battle.state.kind !== "defeat") {
    // Ship whatever replay we have so floors already cleared get a playable blob.
    const partial = finalizeReplay();
    void endRun(partial ?? undefined);
  }
  abortLiveRun();
  abortRecording();
  hideReplayBanner();
  replayPlayer = null;
  // Returning home ends the active run — clear any leftover buff state.
  activeRunBuffs = freshRunBuffs();
  screen = "home";
  battle = null;
  playBgm();
  // ---- Forced onboarding gates ----
  // After tutorial, if no unit has a class AND no unit is past Lv 1, send
  // the player straight into the Units screen with the first unit's class
  // picker open and back button hidden. They MUST pick a class to escape.
  if (isForcedClassPickPending()) {
    screen = "units";
    renderUnitsScreen(root!, () => { /* back disabled — no-op */ }, {
      forceClassPickRequired: 3,
      hideBack: true,
      topBanner: `<strong>🎯 Pick a class for 3 units</strong> · Choose any three units from the roster to build your starting party. Each unit's class shapes growth and unlocks starting skills.`,
      // Navigate home immediately so the screen doesn't appear frozen during
      // the network round-trip. showHome() now sequences pushProgress() ->
      // pullCanonicalProgress() so the race that previously lost the 3rd
      // class is closed at the home-render level instead of here.
      onForcedComplete: () => {
        markForcedClassPickComplete();
        showHome();
      },
    });
    return;
  }
  // After the FIRST time any unit reaches Lv 2, send the player to the
  // Units screen with the allocator already open on that unit and back
  // button hidden. One-shot per player.
  const pendingAllocUnit = getPendingForcedStatAllocUnit();
  if (pendingAllocUnit) {
    screen = "units";
    renderUnitsScreen(root!, () => { /* back disabled — no-op */ }, {
      forceStatAllocFor: pendingAllocUnit,
      hideBack: true,
      topBanner: `<strong>⬆ First Level Up!</strong> · Allocate your stat points to continue. Spend at least one point to lock in your build.`,
      onForcedComplete: () => {
        markForcedStatAllocSeen();
        clearPendingForcedStatAllocUnit();
        showHome();
      },
    });
    return;
  }
  renderHome(root!, onHomeAction);
  // Push FIRST, then pull. Forces any pending debounced progress writes
  // (e.g. a just-completed forced stat alloc or class pick) to the server
  // before we read the canonical state back — otherwise the pull races
  // the 500ms-debounced push and can overwrite localStorage with stale
  // server data, "losing" the just-saved progress.
  void pushProgress().then(() => pullCanonicalProgress()).catch(() => undefined);
  // Safety-net poll for the one-time floor-20-clear offer. The post-battle
  // trigger fires immediately on the cleared floor, but this catches players
  // who already cleared 20 before this build deployed, or who missed the
  // initial popup (closed tab, etc.). Self-rate-limited; returns immediately
  // if the offer is consumed or floor 20 hasn't been cleared yet.
  void import("./ui/floor20Offer").then(m => m.maybeShowFloor20Offer()).catch(() => undefined);
}

function onHomeAction(a: HomeAction): void {
  if (a === "tower") showStageSelect();
  else if (a === "units") showUnits();
  else if (a === "settings") showSettings();
  else if (a === "tutorial") showTutorialReplay();
  else if (a === "leaderboard") showLeaderboard();
  else if (a === "codex") showCodex();
  else if (a === "shop") showShop();
  else if (a === "inventory") showInventory();
}

function showShop(): void {
  screen = "shop" as Screen;
  void renderShop(root!, showHome);
}

function showInventory(): void {
  screen = "inventory" as Screen;
  void renderInventory(root!, showHome);
}

function showCodex(): void {
  screen = "codex" as Screen;
  renderCodex(root!, showHome);
}

function showLeaderboard(): void {
  hideReplayBanner();
  replayPlayer = null;
  battle = null;
  screen = "leaderboard";
  renderLeaderboard(root!, showHome, playReplay);
}

function showTutorialReplay(): void {
  stopBgm();
  renderTutorial(root!, () => {
    showHome();
  }, { mode: "replay" });
}

function showStageSelect(): void {
  screen = "stage_select";
  playBgm();
  renderStageSelect(root!, onStagePicked, showHome);
}

async function onStagePicked(pick: StagePick): Promise<void> {
  if (pick.kind === "floor") {
    mode = "floor";
    currentStageId = pick.id;
    showSquadSelect();
  } else if (pick.kind === "survival") {
    if (getEnergy() < SURVIVAL_ENERGY_COST) {
      await alertModal({ kind: "warning", title: "Not Enough Energy", message: `Survival Mode requires <strong>${SURVIVAL_ENERGY_COST}</strong> energy.` });
      return;
    }
    // Daily-attempt cap check (3/day, server-enforced, can't be bypassed).
    const status = await fetchAttemptsStatus("survival");
    if (status && status.remaining <= 0) {
      await alertModal({ kind: "warning", title: "Daily Limit Reached", message: `You've used all <strong>${status.max}</strong> Survival attempts for today. Resets at <strong>8 AM PH</strong>.` });
      return;
    }
    mode = "survival";
    currentStageId = 1;
    survivalFloor = 1;
    survivalParty = null;
    survivalCarry = {};
    showSquadSelect();
  } else { // boss_raid
    if (getEnergy() < BOSS_RAID_ENERGY_COST) {
      await alertModal({ kind: "warning", title: "Not Enough Energy", message: `Boss Raid requires <strong>${BOSS_RAID_ENERGY_COST}</strong> energy.` });
      return;
    }
    const status = await fetchAttemptsStatus("boss_raid");
    if (status && status.remaining <= 0) {
      await alertModal({ kind: "warning", title: "Daily Limit Reached", message: `You've used all <strong>${status.max}</strong> Boss Raid attempts for today. Resets at <strong>8 AM PH</strong>.` });
      return;
    }
    mode = "boss_raid";
    currentStageId = BOSS_RAID_FLOORS[0]?.id ?? 1;
    brIndex = 0;
    brParty = null;
    brCarry = {};
    brBossStatReduction = 0;
    brPlayerStatBoost = 0;
    brPendingHeal = false;
    showSquadSelect();
  }
}

function showSquadSelect(): void {
  screen = "squad_select";
  battle = null;
  // Campaign buffs are floor-mode only — pass the active mode so the buff
  // selector is hidden on Survival / Boss Raid.
  const ssMode = mode === "survival" ? "survival"
              : mode === "boss_raid" ? "boss_raid"
              : "floor";
  renderSquadSelect(root!, currentStageId, startBattleFromSquad, showStageSelect, ssMode);
}

function showUnits(): void {
  screen = "units";
  playBgm();
  renderUnitsScreen(root!, showHome);
}

function showSettings(): void {
  screen = "settings";
  renderSettings(root!, showHome);
}

async function startBattleFromSquad(squad: SquadResult): Promise<void> {
  const cost = mode === "survival" ? SURVIVAL_ENERGY_COST
             : mode === "boss_raid" ? BOSS_RAID_ENERGY_COST
             : 1;
  // Daily-attempt cap for endless modes — claim BEFORE spending energy so we
  // don't burn energy on a denied run. Server returns 429 if the cap is hit.
  if (mode === "survival" || mode === "boss_raid") {
    const claim = await claimAttempt(mode);
    if (!claim) { await alertModal({ kind: "error", message: "Couldn't reach server. Try again." }); return; }
    if (!claim.ok) {
      await alertModal({ kind: "warning", title: "Daily Limit Reached", message: `You've used all your <strong>${mode === "survival" ? "Survival" : "Boss Raid"}</strong> attempts for today. Resets at <strong>8 AM PH</strong>.` });
      return;
    }
  }
  // Server-authoritative energy: localStorage edits no longer grant runs.
  // consumeServerEnergy() already writes the server's post-deduct amount into
  // localStorage on success — no further local consume needed.
  const r = await consumeServerEnergy(cost);
  if (!r.ok) {
    if ("error" in r) await alertModal({ kind: "error", message: "Couldn't reach server to start battle. Try again." });
    else await alertModal({ kind: "warning", title: "Not Enough Energy", message: `Need <strong>${cost}</strong> energy, you have <strong>${r.amount}</strong>.` });
    return;
  }
  // Fresh run begins — clear the kill tally that feeds the server's RON roll.
  resetRunKills();
  // Reset run-spanning buff state, then consume + arm any slotted buff —
  // EXCEPT when starting a campaign run that targets Floor 50 (World Ender):
  // buffs are disabled there, so we leave the charge in inventory and clear
  // the slot. (Survival/Boss Raid runs aren't gated here because they may
  // never reach Floor 50; if they do, runFloor strips the buffs per-battle.)
  activeRunBuffs = freshRunBuffs();
  if (pendingBuff) {
    const floor50Block = mode === "floor" && currentStageId === 50;
    if (floor50Block) {
      // Leave inventory untouched, just clear the slot.
      pendingBuff = null;
    } else {
      const consumed = await consumeShopItem(pendingBuff);
      if (consumed) {
        armBuffOnRun(pendingBuff);
      }
      pendingBuff = null;
    }
  }

  if (mode === "survival") {
    survivalParty = squad.players;
    survivalFloor = 1;
    survivalCarry = {};
    void startRun("survival", squad.players.map(p => p.template.id));
    startReplayRecording("survival", loadSettings().playerName || null);
    runFloor(squad.players, 1, SURVIVAL_XP_MULT);
  } else if (mode === "boss_raid") {
    brParty = squad.players;
    brIndex = 0;
    brCarry = {};
    void startRun("boss_raid", squad.players.map(p => p.template.id));
    startReplayRecording("boss_raid", loadSettings().playerName || null);
    const firstBoss = BOSS_RAID_FLOORS[0];
    if (firstBoss) runBossRaidFloor(squad.players, firstBoss.id);
  } else {
    floorParty = squad.players;
    runFloor(squad.players, currentStageId, 1.0);
  }
}

function applyBossRaidReward(r: BossRaidReward): void {
  if (r === "heal") brPendingHeal = true;
  else if (r === "boost") brPlayerStatBoost += 0.10;
  else if (r === "weaken") brBossStatReduction = Math.min(0.95, brBossStatReduction + 0.05);
}

function runBossRaidFloor(party: SquadResult["players"], floorId: number): void {
  const stage = getStage(floorId);
  if (!stage) { showHome(); return; }
  // Scholar's Insight: "current floor only" — consume only on the first
  // boss-raid floor (no carryover yet).
  const isFirstBrFloor = Object.keys(brCarry).length === 0;
  const xpFromScholars = isFirstBrFloor && consumeScholarsInsight() ? 1.25 : 1;
  const opts: BattleOptions = {
    xpMultiplier: BOSS_RAID_XP_MULT * getCachedDailyMultiplier() * xpFromScholars,
    bossRaid: true,
    bossStatReduction: brBossStatReduction,
    playerStatBoost: brPlayerStatBoost,
    pendingHeal: brPendingHeal,
  };
  if (Object.keys(brCarry).length > 0) opts.carryover = brCarry;
  // Battle Cry: fire only on the first boss-raid floor (no carryover yet).
  if (isFirstBrFloor && consumeBattleCry()) {
    opts.playerStartFullGauge = true;
  }
  // Per-battle run-buffs (re-applied every boss-raid floor).
  if (activeRunBuffs.phoenixEmbers)         opts.phoenixEmbers = true;
  if (activeRunBuffs.quickdrawAtbMul > 1)   opts.playerAtbSpeedMul = activeRunBuffs.quickdrawAtbMul;
  if (activeRunBuffs.lastStandDmgMul > 1)   opts.lastStandDamageMul = activeRunBuffs.lastStandDmgMul;
  // Snapshot the boon state BEFORE pendingHeal is consumed so the replay
  // can reproduce it exactly.
  const bossRaidSnapshot = {
    bossStatReduction: brBossStatReduction,
    playerStatBoost: brPlayerStatBoost,
    pendingHeal: brPendingHeal,
  };
  brPendingHeal = false; // consumed
  const seed = (Date.now() & 0xffffffff) >>> 0;
  battle = startBattle(party, stage.enemies, seed, opts);
  recordBattleStart({
    stageId: floorId,
    seed: battle.seed,
    enemies: stage.enemies.map(e => e.id),
    party: snapshotPartyForReplay(party, brCarry),
    bossRaid: bossRaidSnapshot,
  });
  screen = "battle";
  recordedThisBattle = false;
  battleConcluded = false;
  currentBattleStageId = floorId;
  // Reset fast-forward at every fresh battle start so an admin or player
  // can't carry 4x speed into floors 21+ where it's disallowed by policy.
  setBattleSpeed(1);
  lastStateKind = battle.state.kind;
  lastCombatantCount = battle.combatants.length;
  lastAliveCount = battle.combatants.filter(c => c.alive).length;
  playBattleBgm(floorId, "boss_raid", !!stage.soloBoss);
  renderBattle(root!, battle, handleAction, onPostBattle, { slowMo: isSlowMoStage(), stageId: floorId, mode });
}

function runFloor(party: SquadResult["players"], floorId: number, xpMultiplier: number): void {
  const stage = getStage(floorId);
  if (!stage) { showHome(); return; }
  // Floor 50 (World Ender) is a "fair fight" — campaign buffs are disabled
  // there regardless of run mode. XP multiplier reverts to base * daily only;
  // every other buff opt is intentionally NOT set on opts.
  const buffsAllowed = floorId !== 50;
  // Scholar's Insight is "current floor only" — consumed on the first battle
  // that runs after slotting. We compute the XP multiplier inline so it
  // applies only when armed AND allowed.
  const isFirstBattleOfRun =
    mode === "floor" || (mode === "survival" && Object.keys(survivalCarry).length === 0);
  const xpFromScholars = buffsAllowed && isFirstBattleOfRun && consumeScholarsInsight() ? 1.25 : 1;
  const opts: BattleOptions = {
    xpMultiplier: xpMultiplier * getCachedDailyMultiplier() * xpFromScholars,
  };
  if (mode === "survival" && Object.keys(survivalCarry).length > 0) {
    opts.carryover = survivalCarry;
  }
  // Shop buff: Battle Cry fires once at the START of the run (floor 1 of
  // survival; the picked floor for campaign/boss-raid). On survival floor 2+
  // we keep the natural carryover gauge so the buff isn't re-applied per floor.
  if (buffsAllowed && isFirstBattleOfRun && consumeBattleCry()) {
    opts.playerStartFullGauge = true;
  }
  // Per-battle run-buffs: armed once for the run, re-applied every floor —
  // except Floor 50, which strips them.
  if (buffsAllowed) {
    if (activeRunBuffs.phoenixEmbers)         opts.phoenixEmbers = true;
    if (activeRunBuffs.quickdrawAtbMul > 1)   opts.playerAtbSpeedMul = activeRunBuffs.quickdrawAtbMul;
    if (activeRunBuffs.lastStandDmgMul > 1)   opts.lastStandDamageMul = activeRunBuffs.lastStandDmgMul;
  }
  // Replay scope:
  //   - floor mode: only the floor-50 World Ender battle is recorded
  //   - survival: every floor recorded (recording was started in startBattleFromSquad)
  const recordThisBattle = (mode === "floor" && floorId === 50) || mode === "survival";
  if (mode === "floor" && floorId === 50) {
    // Floor-mode World Ender uses its own one-shot recording.
    startReplayRecording("floor", loadSettings().playerName || null);
  }
  const seed = recordThisBattle ? (Date.now() & 0xffffffff) >>> 0 : undefined;
  battle = startBattle(party, stage.enemies, seed, opts);
  if (recordThisBattle) {
    recordBattleStart({
      stageId: floorId,
      seed: battle.seed,
      enemies: stage.enemies.map(e => e.id),
      party: snapshotPartyForReplay(party, mode === "survival" ? survivalCarry : undefined),
    });
  }
  screen = "battle";
  recordedThisBattle = false;
  battleConcluded = false;
  currentBattleStageId = floorId;
  // Reset fast-forward at every fresh battle start so an admin or player
  // can't carry 4x speed into floors 21+ where it's disallowed by policy.
  setBattleSpeed(1);
  if (mode === "floor") floorBattleStartedAt = Date.now();
  lastStateKind = battle.state.kind;
  lastCombatantCount = battle.combatants.length;
  lastAliveCount = battle.combatants.filter(c => c.alive).length;
  playBattleBgm(floorId, mode, !!stage.soloBoss);
  renderBattle(root!, battle, handleAction, onPostBattle, { slowMo: isSlowMoStage(), stageId: floorId, mode });
}

/** Build per-template party state at floor start for the replay recorder.
 *  Pulls from carry if present (mid-run), else from getProgress(). */
function snapshotPartyForReplay(
  party: SquadResult["players"],
  carry?: Record<string, CarryEntry>,
): ReplayPartyMember[] {
  return party.map(p => {
    const prog = getProgress(p.template.id);
    const equippedSkills = [...(prog.equippedSkills ?? [])];
    const co = carry?.[p.template.id];
    if (co) {
      return {
        templateId: p.template.id,
        classId: co.classId ?? prog.classId,
        level: co.level,
        customStats: { ...co.customStats },
        equippedSkills,
        hp: co.hp,
        mp: co.mp,
        gauge: typeof co.gauge === "number" ? co.gauge : 0,
        alive: co.alive ?? true,
        skillCooldowns: { ...(co.skillCooldowns ?? {}) },
      };
    }
    // Fresh battle (no carry) — leave hp/mp undefined so the replay viewer
    // starts the unit at full HP/MP via makeCombatant defaults.
    return {
      templateId: p.template.id,
      classId: prog.classId,
      level: prog.level,
      customStats: { ...prog.customStats },
      equippedSkills,
    };
  });
}

function shouldShowPostButtons(b: Battle): boolean {
  // Run summary panel handles all post-battle navigation now.
  // Keep the action panel populated only while combat is ongoing.
  if (b.state.kind === "ticking") return true;
  return false;
}

function captureCarry(b: Battle): void {
  survivalCarry = captureCarryFrom(b);
}
function captureBrCarry(b: Battle): void {
  brCarry = captureCarryFrom(b);
}
function captureCarryFrom(b: Battle): Record<string, CarryEntry> {
  const out: Record<string, CarryEntry> = {};
  for (const c of b.combatants) {
    if (c.side !== "player") continue;
    out[c.templateId] = {
      hp: c.hp,
      mp: c.mp,
      xp: c.xp,
      level: c.level,
      availablePoints: c.availablePoints,
      customStats: c.statBreakdown.custom,
      classId: c.classId,
      skillCooldowns: { ...c.skillCooldowns },
      gauge: c.gauge,
      alive: c.alive,
      damageDealt: c.damageDealt,
      damageTaken: c.damageTaken,
      kills: c.kills,
      xpGainedTotal: c.xpGainedTotal,
    };
  }
  return out;
}

function onPostBattle(a: PostBattleAction): void {
  if (a === "surrender") {
    if (battle) surrenderBattle(battle);
    return;
  }
  if (a === "home") showHome();
  else if (a === "stages") showStageSelect();
}

function frame(t: number): void {
  const realDt = Math.min(0.1, (t - lastT) / 1000);
  lastT = t;
  // Slow-mo scaling for floors 31+. Affects gauge fill + actionLock decay so
  // animations and turn cadence both stretch proportionally to the CSS slowdown.
  // Fast-forward (2x / 4x) applies on top for stages 1-20 only — clamped to
  // 1x for any other context so high-floor pacing isn't affected.
  let dt = isSlowMoStage() ? realDt * SLOWMO_FACTOR : realDt;
  const ffMul = getBattleSpeed();
  if (ffMul > 1 && isFastForwardAllowed(currentStageId, mode)) {
    dt *= ffMul;
  }

  if (screen === "replay" && battle) {
    if (battle.state.kind === "ticking") {
      // Inject before every sim step so a unit that fires twice within a
      // single real frame (idle keeps 25% gauge → fast refill) still has its
      // next recorded action queued in time.
      tickAccum(battle, dt, injectReplayActions);
    }
    const aliveNow = battle.combatants.filter(c => c.alive).length;
    if (battle.state.kind !== lastStateKind || battle.combatants.length !== lastCombatantCount || aliveNow !== lastAliveCount) {
      renderBattle(root!, battle, () => undefined, () => showLeaderboard(), {
        showPostBattleButtons: false,
        slowMo: isSlowMoStage(),
        stageId: currentBattleStageId,
      });
      lastStateKind = battle.state.kind;
      lastCombatantCount = battle.combatants.length;
      lastAliveCount = aliveNow;

      // Multi-floor: when this battle resolves to a win and the recording has
      // more floors, auto-advance after a short pause so the viewer sees the
      // Victory banner before the next floor loads.
      if (battle.state.kind === "victory" && replayPlayer && replayPlayer.hasMoreBattles()) {
        setTimeout(() => {
          if (screen !== "replay" || !replayPlayer) return;
          replayPlayer.advanceBattle();
          loadReplayBattle();
        }, 1200);
      }
    } else {
      updateLive(root!, battle);
    }
  }

  if (screen === "battle" && battle) {
    if (battle.state.kind === "ticking") tickAccum(battle, dt);

    // Record clears + handle survival advancement once per battle conclusion.
    if (!battleConcluded && battle.state.kind === "victory") {
      battleConcluded = true;
      if (mode === "floor" && !recordedThisBattle) {
        recordClear(currentStageId);
        const elapsed = floorBattleStartedAt > 0 ? Date.now() - floorBattleStartedAt : 0;
        const replay = currentStageId === 50 ? finalizeReplay() : null;
        if (currentStageId !== 50) abortRecording();
        void reportFloorCleared(
          currentStageId,
          currentStageId === 50 ? elapsed : undefined,
          replay ?? undefined,
        );
        recordedThisBattle = true;
        const cleared = currentStageId;
        // After a floor-20 victory, the server-side recordFloorModeClear has
        // promoted the one-time campaign-buff-bundle offer from "pending" to
        // "available". Fire-and-forget poll → modal opens on top of the run
        // summary if the wallet just unlocked it. Self-rate-limited so it
        // can't double-fire.
        if (cleared === 20) {
          void import("./ui/floor20Offer").then(m => m.maybeShowFloor20Offer()).catch(() => undefined);
        }
        setTimeout(() => { void showRunSummary("victory", cleared); }, 1500);
      }
      if (mode === "survival") {
        captureCarry(battle);
        void reportFloor(survivalFloor);
        if (survivalFloor < STAGE_DEFS.length) {
          // Intermediate floor — fold kill events into the run tally now,
          // before the battle is replaced. The final battle's kills are
          // folded by showRunSummary itself.
          if (battle.killEvents) mergeBattleKillsIntoRun(battle.killEvents);
          survivalFloor += 1;
          // Brief delay before auto-advance so player can see the Victory banner.
          setTimeout(() => {
            if (mode !== "survival" || !survivalParty) return;
            runFloor(survivalParty, survivalFloor, SURVIVAL_XP_MULT);
          }, 1500);
        } else {
          recordClear(STAGE_DEFS.length);
          // Brief delay so the Victory banner reads before the summary.
          const cleared = STAGE_DEFS.length;
          setTimeout(() => { void showRunSummary("victory", cleared); }, 1500);
        }
      }
      if (mode === "boss_raid") {
        captureBrCarry(battle);
        brIndex += 1;
        void reportFloor(brIndex);
        if (brIndex < BOSS_RAID_FLOORS.length) {
          // Intermediate boss-raid floor — fold kill events before the
          // battle is replaced on transition. Final-battle kills are folded
          // by showRunSummary instead.
          if (battle.killEvents) mergeBattleKillsIntoRun(battle.killEvents);
          // Pause briefly to let the Victory banner read, then offer the boon picker.
          setTimeout(() => {
            if (mode !== "boss_raid" || !brParty) return;
            showBossRaidReward(root!, (reward) => {
              applyBossRaidReward(reward);
              const nextBoss = BOSS_RAID_FLOORS[brIndex];
              if (mode !== "boss_raid" || !brParty || !nextBoss) return;
              runBossRaidFloor(brParty, nextBoss.id);
            });
          }, 1200);
        } else {
          const cleared = brIndex;
          setTimeout(() => { void showRunSummary("victory", cleared); }, 1500);
        }
      }
    }

    if (!battleConcluded && battle.state.kind === "defeat") {
      battleConcluded = true;
      // Keep the recording alive — survival/boss-raid submit a leaderboard
      // entry on defeat for the floors that WERE cleared, and we want a
      // replay to accompany that entry. The server still decides whether
      // to persist via its PB-improved gate.
      if (mode === "survival" || mode === "boss_raid") {
        const cleared = mode === "survival" ? Math.max(0, survivalFloor - 1) : brIndex;
        setTimeout(() => { void showRunSummary("defeat", cleared); }, 1800);
      } else if (mode === "floor") {
        const cleared = currentStageId;
        setTimeout(() => { void showRunSummary("defeat", cleared); }, 1800);
      }
      // Persisted by combat.ts already.
    }

    const aliveNow = battle.combatants.filter(c => c.alive).length;
    if (battle.state.kind !== lastStateKind || battle.combatants.length !== lastCombatantCount || aliveNow !== lastAliveCount) {
      renderBattle(root!, battle, handleAction, onPostBattle, { showPostBattleButtons: shouldShowPostButtons(battle), slowMo: isSlowMoStage(), stageId: currentBattleStageId, mode });
      lastStateKind = battle.state.kind;
      lastCombatantCount = battle.combatants.length;
      lastAliveCount = aliveNow;
    } else {
      updateLive(root!, battle);
    }
  }

  requestAnimationFrame(frame);
}

window.addEventListener("keydown", e => {
  if ((e.key === "r" || e.key === "R") &&
      screen === "battle" && battle &&
      (battle.state.kind === "victory" || battle.state.kind === "defeat")) {
    showHome();
  }
});

// Re-export for type usage above (minor lint).
export type _Unused = Combatant;
export const _persistPartyProgress = persistPartyProgress;
export const _distributeEndOfBattleXp = distributeEndOfBattleXp;
