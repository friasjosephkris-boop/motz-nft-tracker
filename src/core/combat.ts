import { Stats, ZERO_STATS, deriveStats, sumStats, MP_PER_LEVEL } from "./stats";
import { classBaseAtLevel } from "../units/classes";
import { unitBaseAtLevel } from "../units/roster";
import { Rng } from "./rng";
import { physicalDamage, magicalDamage, DamageResult } from "./formulas";
import { tickGauges, ATB_FULL } from "./timeline";
import { UnitTemplate } from "../units/types";
import { Skill, SkillVfxKind } from "../skills/types";
import { getSkill, CLASS_SKILLS, CHARACTER_SKILLS, SKILLS } from "../skills/registry";
import { SLIME, SLIME_KING } from "../units/roster";
import { awardXp, xpToNext, MAX_LEVEL } from "./levels";
import { isRecording, recordAction } from "./replay";
import { getProgress, setProgress, UnitProgress, autoEquipNewlyUnlocked } from "./progress";
import { pushDamage, pushMiss, pushBronDrop, pushSkillVfx } from "./animations";
import { sfx, playSkillCastSfx } from "./audio";
import {
  ActiveEffect,
  EffectApplication,
  applyEffect,
  applyTickEffects,
  atkBuffMultiplier,
  buffedStats,
  hasEffect,
  incomingDamageMultiplier,
  isSkillBlockedBySilence,
  tickEffectDurations,
  blindHitPenalty,
  damageReflectPct,
} from "./effects";

/** Enemy template IDs marked as solo bosses in the roster (every soloBoss: true
 *  stage). Reflect against these only deals 50% — non-boss enemies still take
 *  the full reflected amount. World Ender is checked separately (full immunity). */
const BOSS_TEMPLATE_IDS: ReadonlySet<string> = new Set([
  "stone_sentinel", "wraith_lord", "tower_lord", "iron_behemoth", "storm_lord",
  "demon_general", "witch_queen", "dragon_lord", "tower_god",
  "null_hierophant", "the_untouched", "apex_arbiter",
  // world_ender is intentionally NOT in this set — it has full reflect immunity.
]);

export type Side = "player" | "enemy";

export interface Position {
  row: number;
  col: number;
}

export interface QueuedAction {
  skillId: string;
  targetId: string;
}

export interface StatBreakdown {
  unit: Stats;
  classBase: Stats;
  custom: Stats;
}

export interface Combatant {
  id: string;
  templateId: string;
  name: string;
  side: Side;
  portrait: string;
  position: Position;
  stats: Stats;
  statBreakdown: StatBreakdown;
  classId?: string;
  basicAttackKind?: "physical" | "magical";
  hp: number;
  mp: number;
  maxHp: number;
  maxMp: number;
  atbSpeed: number;
  gauge: number;
  alive: boolean;
  guarding: boolean;
  skills: string[];
  skillCooldowns: Record<string, number>;
  queuedAction: QueuedAction | null;
  level: number;
  xp: number;
  availablePoints: number;
  xpReward: number;
  /** Active buffs/debuffs (applied on hit, ticks per action). */
  effects: ActiveEffect[];
  resist?: import("../units/types").DamageResistance;
  atkMultiplier?: number;
  // ---- Run-summary trackers (accumulate across floors via carryover) ----
  damageDealt: number;
  damageTaken: number;
  kills: number;
  xpGainedTotal: number;
  /** True from the moment a windup-eligible action is committed until it resolves. */
  casting: boolean;
}

export type BattleState =
  | { kind: "ticking" }
  | { kind: "victory" }
  | { kind: "defeat" };

export interface Battle {
  state: BattleState;
  combatants: Combatant[];
  originalPartyTemplateIds: string[];
  log: string[];
  rng: Rng;
  /** Seconds remaining until next action may execute. Acts as a serial-animation queue gate. */
  actionLock: number;
  /** XP multiplier applied at distribution time (survival = 0.5). */
  xpMultiplier: number;
  /** Seed used to construct the rng — captured for replay recording. */
  seed: number;
  /** True when this Battle is being driven by a recorded replay; suppresses recording / leaderboard / progress writes. */
  replayMode?: boolean;
  /** Fixed-step accumulator. The frame loop calls tickAccum(realDt) which
   *  consumes whole SIM_STEP slices from this accumulator and calls tick(SIM_STEP)
   *  for each. This makes the simulation deterministic regardless of frame rate,
   *  which is required for replay determinism. */
  simAccum: number;
  // ---- Shop-buff state (set by startBattle from BattleOptions) ----
  /** Phoenix Embers: per-battle revive charge for the first player ally to fall. */
  phoenixEmbersCharge: boolean;
  /** Last Stand: damage mul when only one player is alive (1 = inactive). */
  lastStandDamageMul: number;
  // ---- RON drop kill accounting (server rolls drops, not the client) ----
  /** List of enemy kills this battle — fed to the server's bron_roll op,
   *  which is the ONLY authority that decides drops + credits the wallet.
   *  killTier feeds the server-side multiplier: mob = 1×, boss = 2×, world_ender = 4×. */
  killEvents: { enemyTemplateId: string; killTier: "mob" | "boss" | "world_ender" }[];
}

export type BronTier = "t1" | "t2" | "t3" | "t4" | "t5";

/** Fixed simulation step (seconds). Combat uses a fixed timestep so the same
 *  seed reproduces the same outcome across machines and frame rates. */
export const SIM_STEP = 1 / 60;
const MAX_STEPS_PER_FRAME = 8;  // safety cap; keeps a slow tab from spiral-of-death.

/** Accumulate real-frame dt and run as many fixed-step ticks as are owed.
 *  Frame loops should call this instead of tick() directly.
 *
 *  `beforeEachTick` runs once per fixed sim step, immediately before the tick.
 *  Replay playback uses it to inject the next recorded action right before
 *  every step, so a unit that fires twice within a single real frame still
 *  has its second action queued in time. */
export function tickAccum(b: Battle, realDt: number, beforeEachTick?: (b: Battle) => void): void {
  // Cap each frame's real time to avoid huge bursts after a tab regains focus.
  b.simAccum += Math.min(realDt, MAX_STEPS_PER_FRAME * SIM_STEP);
  let steps = 0;
  while (b.simAccum >= SIM_STEP && steps < MAX_STEPS_PER_FRAME) {
    if (beforeEachTick) beforeEachTick(b);
    tick(b, SIM_STEP);
    b.simAccum -= SIM_STEP;
    steps += 1;
  }
}

export interface PlayerSlot {
  template: UnitTemplate;
  position: Position;
}

let nextInstanceId = 0;

const TEMPLATE_LOOKUP: Record<string, UnitTemplate> = {
  slime: SLIME,
  slime_king: SLIME_KING,
};

// Post-attack lock — how long the queue waits before the next combatant
// can act on a damaging hit. Lower = snappier combat between actions.
const ANIM_DURATION_S = 1.0;

export interface PartyOverride {
  classId?: string;
  level: number;
  customStats: Stats;
  equippedSkills?: string[];
}

export function makeCombatant(t: UnitTemplate, side: Side, position: Position, override?: PartyOverride): Combatant {
  const progress: UnitProgress | null = side === "player" && !override ? getProgress(t.id) : null;
  const classId = override?.classId ?? progress?.classId ?? t.classId;
  const customStats = override?.customStats ?? progress?.customStats ?? t.customStats ?? { ...ZERO_STATS };
  const level = override?.level ?? progress?.level ?? t.level ?? 1;
  const xp = progress?.xp ?? 0;
  const availablePoints = progress?.availablePoints ?? 0;

  const unit = unitBaseAtLevel(t, level);
  const classBase = classBaseAtLevel(classId, level);
  const custom = { ...ZERO_STATS, ...customStats };
  const effective = sumStats(unit, classBase, custom);
  const d = deriveStats(effective);
  // Round HP/MP to integers — fractional stat growth (e.g. INT 0.7/lvl) flows
  // into derived values and would otherwise render as 229.8/229.8 in the UI.
  const maxHp = Math.max(1, Math.round(t.overrideMaxHp ?? d.maxHp));
  // MP scales by level on top of stat-derived MP so casters always have the
  // mana to actually use their kit. Override still wins if set.
  const maxMp = Math.max(0, Math.round(t.overrideMaxMp ?? (d.maxMp + level * MP_PER_LEVEL)));

  // Skills available in this battle:
  //   - idle is always present
  //   - basic_attack always present (fallback baseline)
  //   - players: only equipped skills (max 4) on top of idle
  //   - enemies: their full template skill list
  const skills = new Set<string>();
  // Baseline actions every unit always has: Idle, Attack, Guard.
  skills.add("idle");
  skills.add("basic_attack");
  skills.add("guard");
  if (side === "player") {
    const equipped = [...(override?.equippedSkills ?? progress?.equippedSkills ?? [])];
    // Top up any empty loadout slots with currently-unlocked skills the unit has
    // access to (starting + character-specific + class), preserving the player's
    // chosen order. Idempotent — already-equipped skills are skipped.
    if (equipped.length < 4) {
      const seen = new Set<string>(equipped);
      const candidates: string[] = [];
      const push = (id: string) => { if (!seen.has(id)) { seen.add(id); candidates.push(id); } };
      for (const id of t.startingSkills) push(id);
      for (const id of (CHARACTER_SKILLS[t.id] ?? [])) push(id);
      if (classId) for (const id of (CLASS_SKILLS[classId] ?? [])) push(id);
      for (const id of candidates) {
        if (equipped.length >= 4) break;
        const sk = SKILLS[id];
        if (sk && (sk.unlockLevel ?? 1) > level) continue; // skip locked
        equipped.push(id);
      }
    }
    for (const id of equipped) skills.add(id);
  } else {
    for (const id of t.startingSkills) skills.add(id);
    for (const id of (CHARACTER_SKILLS[t.id] ?? [])) skills.add(id);
    if (classId) for (const id of (CLASS_SKILLS[classId] ?? [])) skills.add(id);
  }

  return {
    id: `${t.id}#${nextInstanceId++}`,
    templateId: t.id,
    name: t.name,
    side,
    portrait: t.portrait,
    position,
    stats: effective,
    statBreakdown: { unit, classBase, custom },
    classId,
    basicAttackKind: t.basicAttackKind,
    hp: maxHp,
    mp: maxMp,
    maxHp,
    maxMp,
    atbSpeed: d.atbSpeed,
    gauge: 0,
    alive: true,
    guarding: false,
    skills: [...skills],
    // Apply any per-skill initialCooldown so e.g. World Ender's "World End!"
    // can't be used as an opener — it starts on full cooldown.
    skillCooldowns: (() => {
      const cd: Record<string, number> = {};
      for (const id of skills) {
        const s = SKILLS[id];
        if (s && s.initialCooldown && s.initialCooldown > 0) cd[id] = s.initialCooldown;
      }
      return cd;
    })(),
    queuedAction: null,
    level,
    xp,
    availablePoints,
    xpReward: t.xpReward ?? 0,
    effects: [],
    resist: t.resist,
    atkMultiplier: t.atkMultiplier,
    damageDealt: 0,
    damageTaken: 0,
    kills: 0,
    xpGainedTotal: 0,
    casting: false,
  };
}

function placeEnemies(templates: UnitTemplate[], rng: Rng): Combatant[] {
  // Up to 9 enemies. For solo bosses, just place at center.
  if (templates.length === 1) {
    return [makeCombatant(templates[0], "enemy", { row: 1, col: 1 })];
  }
  const slots: Position[] = [];
  for (let row = 0; row < 3; row++) for (let col = 0; col < 3; col++) slots.push({ row, col });
  for (let i = slots.length - 1; i > 0; i--) {
    const j = Math.floor(rng.next() * (i + 1));
    [slots[i], slots[j]] = [slots[j], slots[i]];
  }
  return templates.slice(0, 9).map((t, i) => makeCombatant(t, "enemy", slots[i]));
}

export interface BattleOptions {
  /** Carry over state from prior battle (survival mode). Keyed by template id. */
  carryover?: Record<string, {
    hp: number; mp: number; xp: number; level: number;
    availablePoints: number; customStats: Stats; classId?: string;
    skillCooldowns?: Record<string, number>;
    gauge?: number;
    alive?: boolean;
    /** Run-summary trackers — accumulate across floors. */
    damageDealt?: number;
    damageTaken?: number;
    kills?: number;
    xpGainedTotal?: number;
  }>;
  /** Replay only: override player progress at battle start so the viewer's
   *  localStorage doesn't influence the simulation. Keyed by template id.
   *  hp/mp/gauge/cooldowns capture mid-run carryover state for survival or
   *  boss-raid replays; for fresh battles those fields are omitted and the
   *  unit starts at full HP/MP. */
  partyOverride?: Record<string, {
    classId?: string;
    level: number;
    customStats: Stats;
    equippedSkills?: string[];
    hp?: number;
    mp?: number;
    gauge?: number;
    alive?: boolean;
    skillCooldowns?: Record<string, number>;
  }>;
  /** XP multiplier applied at end-of-battle distribution. Default 1. Survival uses 1/50. */
  xpMultiplier?: number;
  /** Boss Raid: scale boss stats 3x and atb-speed 1.5x. Set per battle. */
  bossRaid?: boolean;
  /** Boss Raid: stacking 5%-per-pick reduction applied on top of bossRaid scaling. */
  bossStatReduction?: number;
  /** Boss Raid: stacking 10%-per-pick boost applied to player stats and atb-speed. */
  playerStatBoost?: number;
  /** Boss Raid: heal player HP/MP by 20% of max at battle start (consumed once per pick). */
  pendingHeal?: boolean;
  /** Shop buff "Battle Cry": all player units start with full ATB gauge. */
  playerStartFullGauge?: boolean;
  /** Shop buff "Phoenix Embers": first player ally to fall this battle revives
   *  at 50% HP instead of dying. Consumed per battle (each floor of a survival
   *  run gets its own charge while the buff is active for the run). */
  phoenixEmbers?: boolean;
  /** Shop buff "Quickdraw": multiplier on player units' atbSpeed (e.g. 1.25 = +25% regen). */
  playerAtbSpeedMul?: number;
  /** Shop buff "Last Stand": when only one player ally is alive, that unit's
   *  outgoing damage is multiplied by this (e.g. 2.0 doubles damage). */
  lastStandDamageMul?: number;
}

export function startBattle(
  players: PlayerSlot[],
  enemies: UnitTemplate[],
  seed = (Date.now() & 0xffffffff) >>> 0,
  opts: BattleOptions = {},
): Battle {
  const rng = new Rng(seed);
  const playerCombatants = players.map(p => {
    const ov = opts.partyOverride?.[p.template.id];
    const c = makeCombatant(p.template, "player", p.position, ov);
    // Apply hp/mp/gauge from partyOverride (replay mode) before carryover.
    if (ov && (ov.hp !== undefined || ov.mp !== undefined || ov.gauge !== undefined || ov.alive !== undefined || ov.skillCooldowns !== undefined)) {
      if (typeof ov.hp === "number") c.hp = Math.min(c.maxHp, Math.max(0, ov.hp));
      if (typeof ov.mp === "number") c.mp = Math.min(c.maxMp, Math.max(0, ov.mp));
      if (typeof ov.gauge === "number") c.gauge = Math.max(0, Math.min(ATB_FULL, ov.gauge));
      if (ov.skillCooldowns) c.skillCooldowns = { ...ov.skillCooldowns };
      if (ov.alive === false || c.hp <= 0) {
        c.alive = false; c.hp = 0; c.queuedAction = null;
      }
    }
    const co = opts.carryover?.[p.template.id];
    if (co) {
      c.hp = Math.min(c.maxHp, Math.max(0, co.hp));
      c.mp = Math.min(c.maxMp, Math.max(0, co.mp));
      c.xp = co.xp;
      c.level = co.level;
      c.availablePoints = co.availablePoints;
      c.statBreakdown.custom = co.customStats;
      if (co.classId) c.classId = co.classId;
      if (co.skillCooldowns) c.skillCooldowns = { ...co.skillCooldowns };
      if (typeof co.gauge === "number") c.gauge = Math.max(0, Math.min(ATB_FULL, co.gauge));
      if (co.alive === false || c.hp <= 0) {
        c.alive = false;
        c.hp = 0;
        c.queuedAction = null;
      }
      if (typeof co.damageDealt === "number") c.damageDealt = co.damageDealt;
      if (typeof co.damageTaken === "number") c.damageTaken = co.damageTaken;
      if (typeof co.kills === "number") c.kills = co.kills;
      if (typeof co.xpGainedTotal === "number") c.xpGainedTotal = co.xpGainedTotal;
    }
    return c;
  });
  const enemyCombatants = placeEnemies(enemies, rng);

  // Shop buff: Battle Cry — fill all alive player gauges. Applied AFTER
  // carryover so it overrides survival/boss-raid gauge inheritance.
  if (opts.playerStartFullGauge) {
    for (const c of playerCombatants) {
      if (c.alive) c.gauge = ATB_FULL;
    }
  }

  // Boss Raid: scale enemy stats and atb-speed, then apply any stacking
  // bossStatReduction (5% per Weaken pick) on top.
  if (opts.bossRaid) {
    const reduction = Math.max(0, Math.min(0.95, opts.bossStatReduction ?? 0));
    const statMul = BOSS_RAID_STAT_MUL * (1 - reduction);
    const speedMul = BOSS_RAID_SPEED_MUL * (1 - reduction);
    for (const c of enemyCombatants) {
      applyBossScaling(c, statMul, speedMul);
    }
  }

  // Boss Raid: stacking player stat boost (10% per pick) — affects all players.
  const boost = Math.max(0, opts.playerStatBoost ?? 0);
  if (boost > 0) {
    const mul = 1 + boost;
    for (const c of playerCombatants) {
      applyPlayerBoost(c, mul);
    }
  }

  // Boss Raid: heal 20% HP/MP at battle start (consumed once per pick by caller).
  if (opts.pendingHeal) {
    for (const c of playerCombatants) {
      if (!c.alive) continue;
      c.hp = Math.min(c.maxHp, c.hp + Math.floor(c.maxHp * 0.2));
      c.mp = Math.min(c.maxMp, c.mp + Math.floor(c.maxMp * 0.2));
    }
  }

  // Apply Quickdraw — bump player atbSpeed before the battle starts ticking.
  if (opts.playerAtbSpeedMul && opts.playerAtbSpeedMul !== 1) {
    for (const c of playerCombatants) {
      c.atbSpeed = c.atbSpeed * opts.playerAtbSpeedMul;
    }
  }

  return {
    state: { kind: "ticking" },
    combatants: [...playerCombatants, ...enemyCombatants],
    originalPartyTemplateIds: players.map(p => p.template.id),
    log: ["Battle start."],
    rng,
    actionLock: 0,
    xpMultiplier: opts.xpMultiplier ?? 1,
    seed,
    simAccum: 0,
    phoenixEmbersCharge: !!opts.phoenixEmbers,
    lastStandDamageMul: Math.max(1, opts.lastStandDamageMul ?? 1),
    killEvents: [],
  };
}

// Boss Raid base multipliers. Tune here; bossStatReduction (Weaken pick) stacks on top.
export const BOSS_RAID_STAT_MUL = 2.0;   // was 3.0 — too punishing
export const BOSS_RAID_SPEED_MUL = 1.25; // was 1.5  — still faster than the player party

function applyBossScaling(c: Combatant, statMul: number, speedMul: number): void {
  // Scale input stats so derived combat values (physAtk, magAtk, defs, etc.)
  // come out roughly statMul times stronger. We override atbSpeed afterward
  // since AGI feeds into both speed and damage; we want speed at speedMul, not statMul.
  const origAtb = c.atbSpeed;
  c.stats = scaleStats(c.stats, statMul);
  const d = deriveStats(c.stats);
  c.maxHp = Math.max(1, Math.round(d.maxHp));
  c.maxMp = Math.max(0, Math.round(d.maxMp + c.level * MP_PER_LEVEL));
  c.hp = c.maxHp;
  c.mp = c.maxMp;
  c.atbSpeed = origAtb * speedMul;
  // Bosses keep their template atkMultiplier (2×) for normal floor runs;
  // Boss Raid bumps it ×1.5 → 3× to match the harder mode's intent.
  if (c.atkMultiplier && c.atkMultiplier > 1) {
    c.atkMultiplier = c.atkMultiplier * 1.5;
  }
}

function applyPlayerBoost(c: Combatant, mul: number): void {
  const origAtb = c.atbSpeed;
  c.stats = scaleStats(c.stats, mul);
  const d = deriveStats(c.stats);
  const newMaxHp = Math.max(1, Math.round(d.maxHp));
  const newMaxMp = Math.max(0, Math.round(d.maxMp + c.level * MP_PER_LEVEL));
  // Preserve current HP/MP ratio when scaling caps.
  const hpRatio = c.maxHp > 0 ? c.hp / c.maxHp : 1;
  const mpRatio = c.maxMp > 0 ? c.mp / c.maxMp : 1;
  c.maxHp = newMaxHp;
  c.maxMp = newMaxMp;
  c.hp = Math.round(newMaxHp * hpRatio);
  c.mp = Math.round(newMaxMp * mpRatio);
  c.atbSpeed = origAtb * mul;
}

function scaleStats(s: Stats, mul: number): Stats {
  return {
    STR: s.STR * mul,
    INT: s.INT * mul,
    DEX: s.DEX * mul,
    AGI: s.AGI * mul,
    DEF: s.DEF * mul,
    VIT: s.VIT * mul,
  };
}

export function distanceBetween(attacker: Combatant, target: Combatant): number {
  return attacker.position.col + target.position.col + 1;
}

export function nearestEnemy(b: Battle, attacker: Combatant): Combatant | null {
  let best: Combatant | null = null;
  let bestDist = Infinity;
  let bestRow = Infinity;
  for (const c of b.combatants) {
    if (!c.alive || c.side === attacker.side) continue;
    const d = distanceBetween(attacker, c);
    if (d < bestDist || (d === bestDist && c.position.row < bestRow)) {
      best = c;
      bestDist = d;
      bestRow = c.position.row;
    }
  }
  return best;
}

export function tick(b: Battle, dt: number): void {
  if (b.state.kind !== "ticking") return;

  // Always tick gauges so combat keeps flowing visually even mid-animation.
  tickGauges(b.combatants, dt);

  // Animation lock — actions queue serially behind any in-flight animation.
  if (b.actionLock > 0) {
    b.actionLock = Math.max(0, b.actionLock - dt);
    return;
  }

  // Pick the combatant who's been "ready" longest with an action they can take.
  // Gauge overflow past ATB_FULL serves as the wait-time tiebreaker, so a unit
  // that hits full first and idles waiting for an action goes ahead of one that
  // just filled this frame.
  let actor: Combatant | null = null;
  let bestGauge = ATB_FULL - 0.01;
  for (const c of b.combatants) {
    if (!c.alive) continue;
    if (c.gauge < ATB_FULL) continue;
    // Players without a queued action aren't candidates — they keep waiting.
    if (c.side === "player" && !c.queuedAction) continue;
    if (c.gauge > bestGauge) { bestGauge = c.gauge; actor = c; }
  }
  if (!actor) return;

  const c = actor;

  // Tick DoT/HoT before action.
  applyTickEffects(c, b.log);
  if (!c.alive) {
    c.gauge = 0;
    tickEffectDurations(c);
    checkEndConditions(b);
    return;
  }

  // Stun: skip the queued/AI action this turn.
  if (hasEffect(c, "stun")) {
    b.log.push(`${c.name} is stunned and skips the action.`);
    c.gauge = 0;
    c.queuedAction = null;
    tickEffectDurations(c);
    b.actionLock = 0.4;
    return;
  }

  if (c.side === "enemy") {
    const action = chooseEnemyAction(c, b);
    if (action) {
      executeAction(b, c, action);
      return;
    }
    // No valid action — reset so they don't camp the front of the queue forever.
    c.gauge = 0;
    return;
  }

  // Player with a queued action.
  if (c.queuedAction) {
    const skill = getSkill(c.queuedAction.skillId);
    if (isSkillBlockedBySilence(c, skill.id)) {
      b.log.push(`${c.name} is silenced — ${skill.name} fails.`);
      c.queuedAction = null;
      c.gauge = 0;
      tickEffectDurations(c);
      b.actionLock = 0.4;
      return;
    }
    if (!isSkillAffordable(c, skill, b)) {
      // Drop the bad queue but don't burn the turn — they'll re-queue.
      c.queuedAction = null;
      return;
    }
    executeAction(b, c, c.queuedAction);
  }
}

function chooseEnemyAction(c: Combatant, b: Battle): QueuedAction | null {
  if (c.templateId === "slime_king") {
    return chooseSlimeKingAction(c, b);
  }
  const available = c.skills.filter(id =>
    isSkillAffordable(c, getSkill(id), b)
    && id !== "idle"
    && !isSkillBlockedBySilence(c, id)
  );
  if (available.length === 0) return targetForSkill(c, b, "basic_attack");
  const skillId = available[Math.floor(b.rng.next() * available.length)];
  return targetForSkill(c, b, skillId);
}

function chooseSlimeKingAction(c: Combatant, b: Battle): QueuedAction | null {
  const slimesAlive = b.combatants.some(x => x.alive && x.side === "enemy" && x.templateId === "slime");
  if (!slimesAlive && isSkillAffordable(c, getSkill("spawn_slimes"), b)) {
    return targetForSkill(c, b, "spawn_slimes");
  }
  const pick = b.rng.next() < 0.5 ? "slime_king_goo" : "slime_barrage";
  if (!isSkillAffordable(c, getSkill(pick), b)) {
    return targetForSkill(c, b, "slime_king_goo");
  }
  return targetForSkill(c, b, pick);
}

function isSkillAffordable(c: Combatant, s: Skill, b: Battle): boolean {
  if (s.mpCost > c.mp) return false;
  if (s.hpCost !== undefined && s.hpCost >= c.hp) return false;
  if ((c.skillCooldowns[s.id] ?? 0) > 0) return false;
  if ((s.unlockLevel ?? 1) > c.level) return false;
  if (s.kind === "summon") {
    const occupied = new Set(
      b.combatants.filter(x => x.side === c.side && x.alive).map(x => `${x.position.row},${x.position.col}`)
    );
    if (occupied.size >= 9) return false;
  }
  return true;
}

function targetForSkill(c: Combatant, b: Battle, skillId: string): QueuedAction | null {
  const s = getSkill(skillId);
  if (s.targeting === "self" || s.targeting === "all_enemies") {
    return { skillId, targetId: c.id };
  }
  const target = nearestEnemy(b, c);
  if (!target) return null;
  return { skillId, targetId: target.id };
}

export function queueAction(b: Battle, unitId: string, skillId: string, targetId: string): void {
  if (b.state.kind !== "ticking") return;
  const unit = b.combatants.find(c => c.id === unitId);
  if (!unit || !unit.alive) return;
  if (unit.side !== "player") return;
  if (!unit.skills.includes(skillId)) return;
  const skill = getSkill(skillId);
  if (!isSkillAffordable(unit, skill, b)) return;
  const target = b.combatants.find(c => c.id === targetId);
  if (!target || !target.alive) return;
  if (skill.targeting === "self" && target.id !== unit.id) return;
  if (skill.targeting === "enemy" && target.side === unit.side) return;
  unit.queuedAction = { skillId, targetId };
  // Record the action for replay (no-op if not currently recording or in replay mode).
  if (!b.replayMode && isRecording()) {
    const players = b.combatants.filter(c => c.side === "player");
    const enemies = b.combatants.filter(c => c.side === "enemy");
    const attackerIdx = players.findIndex(c => c.id === unit.id);
    const targetIdx = target.side === "enemy"
      ? enemies.findIndex(c => c.id === target.id)
      : -1;
    recordAction(attackerIdx, skillId, targetIdx);
  }
}

export function clearQueued(b: Battle, unitId: string): void {
  const unit = b.combatants.find(c => c.id === unitId);
  if (unit) unit.queuedAction = null;
}

export function surrenderBattle(b: Battle): void {
  if (b.state.kind !== "ticking") return;
  b.state = { kind: "defeat" };
  b.log.push("Surrendered.");
  if (!b.replayMode) persistPartyProgress(b);
}

export function distributeEndOfBattleXp(b: Battle): void {
  const totalRaw = b.combatants
    .filter(c => c.side === "enemy")
    .reduce((sum, c) => sum + (c.alive ? 0 : c.xpReward), 0);
  const total = Math.floor(totalRaw * (b.xpMultiplier ?? 1));
  if (total <= 0) return;
  const partyIds = b.originalPartyTemplateIds;
  if (partyIds.length === 0) return;
  const share = Math.max(1, Math.floor(total / partyIds.length));
  for (const tid of partyIds) {
    const c = b.combatants.find(x => x.side === "player" && x.templateId === tid);
    if (!c) continue;
    if (c.level >= MAX_LEVEL) continue;
    const gained = awardXp(c, share);
    c.xpGainedTotal += share;
    if (gained > 0) {
      c.availablePoints += gained * 4;
      b.log.push(`${c.name} reached Lv ${c.level}! (+${gained * 4} stat points${c.level >= MAX_LEVEL ? ", MAX" : `, next: ${xpToNext(c.level)}`})`);
    } else {
      b.log.push(`${c.name} +${share} XP.`);
    }
  }
}

export function persistPartyProgress(b: Battle): void {
  for (const tid of b.originalPartyTemplateIds) {
    const c = b.combatants.find(x => x.side === "player" && x.templateId === tid);
    if (!c) continue;
    const cur = getProgress(tid);
    const equippedSkills = autoEquipNewlyUnlocked(c.templateId, c.classId, c.level, cur.equippedSkills ?? []);
    setProgress(tid, {
      ...cur,
      level: c.level,
      xp: c.xp,
      availablePoints: c.availablePoints,
      classId: c.classId,
      customStats: c.statBreakdown.custom,
      equippedSkills,
    });
  }
}

function executeAction(b: Battle, attacker: Combatant, action: QueuedAction): void {
  const skill = getSkill(action.skillId);
  if (!isSkillAffordable(attacker, skill, b)) {
    b.log.push(`${attacker.name} can't use ${skill.name}.`);
    attacker.queuedAction = null;
    return;
  }

  // Phase 1 — synchronous commitments + cast SFX. Always run regardless of windup.
  attacker.guarding = false;
  attacker.mp -= skill.mpCost;
  if (skill.hpCost !== undefined) {
    attacker.hp = Math.max(1, attacker.hp - skill.hpCost);
  }

  // Cast SFX is for buff/summon skills only — the empower / charging cue.
  // Damaging skills (physical / magical) already play a hit SFX on impact,
  // and an additional cast cue right before just stacks two clashing sounds.
  // Idle and Guard are quiet by design.
  if ((skill.kind === "buff" || skill.kind === "summon") && skill.id !== "guard") {
    playSkillCastSfx(skill);
  }

  // Resolve the action immediately — no wind-up delay. The action lock that
  // gates the next combatant is set inside finalizePostAction based on whether
  // damage actually rolled.
  const didDamage = runActionResolution(b, attacker, skill, action);
  finalizePostAction(b, attacker, skill, didDamage);
}

/** Runs the body of the action — applies damage, summons, or buff effects.
 *  Pre-conditions (MP/HP cost + cast SFX) must have already been committed. */
/** Pick a sensible default VFX for any skill that hasn't been explicitly
 *  tagged. Heuristic by kind / range / targeting / applied effects. Keeps
 *  every skill visually distinct without requiring hand-tagging all 50+
 *  entries in the registry. Hand-tagged `skill.vfx` always wins. */
function defaultVfxForSkill(skill: Skill): SkillVfxKind {
  // Heal-applying buff skills get the green glow.
  if (skill.kind === "buff" || skill.targeting === "self") {
    const applies = [...(skill.applies ?? []), ...(skill.selfApplies ?? [])];
    if (applies.some(e => e.id === "heal")) return "heal_glow";
    return "buff_aura";
  }
  if (skill.kind === "summon") return "buff_aura";
  if (skill.kind === "magical") {
    // Magical AOE feels like a frost or arcane explosion; magical single can
    // be a flame burst. World End! and other instant-kill specials get the
    // ominous dark pulse.
    if (skill.instantKill) return "dark_pulse";
    if (skill.range === "range") return "frost_burst";
    return "flame_burst";
  }
  // Physical: range = arrow, melee = slash.
  if (skill.range === "range") return "arrow_volley";
  return "slash";
}

function runActionResolution(b: Battle, attacker: Combatant, skill: Skill, action: QueuedAction): boolean {
  let didDamage = false;

  // Skill VFX: fire BEFORE resolution so the visual plays even on miss /
  // dodge. Self / buff skills target the caster; all_enemies fires on every
  // target so AOE skills paint the whole enemy row. Single-target uses the
  // queued targetId. Skills without an explicit `vfx` field fall through to
  // an auto-derived default based on kind / range / targeting — so every
  // skill gets some animation, even ones we haven't hand-tagged yet.
  if (skill.id !== "idle" && skill.id !== "guard") {
    const vfxKind = skill.vfx ?? defaultVfxForSkill(skill);
    if (skill.targeting === "self") {
      pushSkillVfx(attacker.id, attacker.id, vfxKind, skill.id);
    } else if (skill.targeting === "all_enemies") {
      const targets = b.combatants.filter(c => c.alive && c.side !== attacker.side);
      for (const t of targets) pushSkillVfx(attacker.id, t.id, vfxKind, skill.id);
    } else if (action.targetId) {
      pushSkillVfx(attacker.id, action.targetId, vfxKind, skill.id);
    }
  }

  if (skill.id === "idle") {
    // Recover a small slice of HP/MP — rewards stalling without trivializing it.
    const hpGain = Math.max(1, Math.floor(attacker.maxHp * 0.02));
    const mpGain = Math.max(1, Math.floor(attacker.maxMp * 0.03));
    const hpBefore = attacker.hp;
    const mpBefore = attacker.mp;
    attacker.hp = Math.min(attacker.maxHp, attacker.hp + hpGain);
    attacker.mp = Math.min(attacker.maxMp, attacker.mp + mpGain);
    const hpHealed = attacker.hp - hpBefore;
    const mpHealed = attacker.mp - mpBefore;
    if (hpHealed > 0 || mpHealed > 0) {
      b.log.push(`${attacker.name} waits and recovers ${hpHealed} HP / ${mpHealed} MP.`);
    } else {
      b.log.push(`${attacker.name} waits.`);
    }
    sfx.idle();
  } else if (skill.targeting === "self") {
    if (skill.kind === "summon" && skill.summon) {
      doSummon(b, attacker, skill);
    } else if (skill.kind === "buff" && skill.id === "guard") {
      attacker.guarding = true;
      b.log.push(`${attacker.name} guards.`);
      sfx.shield();
    } else if (skill.kind === "buff") {
      b.log.push(`${attacker.name} uses ${skill.name}.`);
      // castBuff was already played in Phase 1.
      if (skill.applies && skill.applies.length > 0) {
        const allies = b.combatants.filter(c => c.alive && c.side === attacker.side);
        for (const a of allies) {
          for (const eff of skill.applies) {
            maybeApplyEffect(b, attacker, a, scaleEffectIfRelevant(attacker, skill, eff));
          }
        }
      }
    }
  } else if (skill.targeting === "all_enemies") {
    const targets = b.combatants.filter(c => c.alive && c.side !== attacker.side);
    b.log.push(`${attacker.name} unleashes ${skill.name}!`);
    if (skill.instantKill) {
      // Per-target one-shot roll. Bypasses damage formulas, resists, shields.
      for (const t of targets) {
        if (tryInstantKill(b, attacker, t, skill)) didDamage = true;
      }
    } else {
      for (const t of targets) { applyDamageRolls(b, attacker, t, skill, { aoe: true }); didDamage = true; }
    }
  } else {
    let target = b.combatants.find(c => c.id === action.targetId);
    if (!target || !target.alive) {
      const fallback = nearestEnemy(b, attacker);
      target = fallback ?? undefined;
      if (target && attacker.queuedAction) attacker.queuedAction.targetId = target.id;
    }
    // Confuse: pick a random alive combatant (any side) instead.
    if (target && hasEffect(attacker, "confuse")) {
      const candidates = b.combatants.filter(c => c.alive && c.id !== attacker.id);
      if (candidates.length > 0) {
        target = candidates[Math.floor(b.rng.next() * candidates.length)];
        b.log.push(`${attacker.name} is confused and targets ${target.name}!`);
      }
    }
    if (target) {
      if (skill.instantKill) {
        if (tryInstantKill(b, attacker, target, skill)) didDamage = true;
      } else {
        applyDamageRolls(b, attacker, target, skill);
        didDamage = true;
      }
    }
  }

  return didDamage;
}

function finalizePostAction(b: Battle, attacker: Combatant, skill: Skill, didDamage: boolean): void {
  if (skill.cooldown > 0) attacker.skillCooldowns[skill.id] = skill.cooldown;
  for (const id of Object.keys(attacker.skillCooldowns)) {
    if (id === skill.id) continue;
    attacker.skillCooldowns[id] = Math.max(0, attacker.skillCooldowns[id] - 1);
  }

  // Self-buff applications (e.g., Guardian Wall on caster).
  if (skill.selfApplies && skill.selfApplies.length > 0) {
    for (const eff of skill.selfApplies) {
      maybeApplyEffect(b, attacker, attacker, scaleEffectIfRelevant(attacker, skill, eff));
    }
  }

  // Decrement effects on the actor at end of their action.
  tickEffectDurations(attacker);

  // Clear the player's queued action so they don't auto-repeat.
  if (attacker.side === "player") attacker.queuedAction = null;

  // Idle as a tactical pump: instead of starting from 0, the gauge keeps
  // 25% of full so the next action fires noticeably sooner. Useful for
  // stalling a beat on a slow boss skill or letting a teammate go first.
  if (skill.id === "idle") {
    attacker.gauge = ATB_FULL * 0.25;
  } else {
    attacker.gauge = 0;
  }
  retargetSurvivors(b);
  // Action lock gates the next combatant: longer if damage played a hit
  // animation, brief otherwise.
  b.actionLock = didDamage ? ANIM_DURATION_S : 0.2;
  checkEndConditions(b);
}

function findActiveTaunter(b: Battle, side: Side): Combatant | null {
  for (const c of b.combatants) {
    if (c.side !== side) continue;
    if (!c.alive) continue;
    if (hasEffect(c, "taunt")) return c;
  }
  return null;
}

/** Roll an instant-kill against one target. Returns true if the roll
 *  succeeded and the target is now dead. Bypasses damage rolls entirely —
 *  no defense, resist, shield, or guard check applies. Used by boss
 *  "execute" skills like World Ender's "World End!". */
function tryInstantKill(b: Battle, attacker: Combatant, target: Combatant, skill: Skill): boolean {
  if (!skill.instantKill) return false;
  if (!target.alive) return false;
  const chance = Math.max(0, Math.min(1, skill.instantKill.chance));
  const roll = b.rng.next();
  if (roll >= chance) {
    b.log.push(`${attacker.name}'s ${skill.name} misses ${target.name}.`);
    return false;
  }
  // Kill outright. Credit damage = remaining HP for run summary stats.
  const dmg = target.hp;
  target.hp = 0;
  target.alive = false;
  target.queuedAction = null;
  if (attacker.side !== target.side) {
    attacker.damageDealt += dmg;
    target.damageTaken += dmg;
    attacker.kills += 1;
  }
  b.log.push(`${attacker.name}'s ${skill.name} obliterates ${target.name}!`);
  return true;
}

function applyDamageRolls(b: Battle, attacker: Combatant, target: Combatant, skill: Skill, ctx: { aoe?: boolean } = {}): void {
  const hits = Math.max(1, skill.multiHit ?? 1);
  for (let i = 0; i < hits; i++) {
    if (!target.alive) break;
    applyDamage(b, attacker, target, skill, ctx);
  }
}

function applyDamage(b: Battle, attacker: Combatant, target: Combatant, skill: Skill, ctx: { aoe?: boolean } = {}): void {
  // Taunt redirect: if any ally of the original target has the "taunt" effect
  // active and is alive (and isn't the target themselves), the hit is rerouted
  // to that taunter. AOE iterates per-target, so each instance gets redirected
  // — meaning the taunter eats the full AOE.
  const taunter = findActiveTaunter(b, target.side);
  if (taunter && taunter !== target) {
    target = taunter;
  }

  let dmg: number;
  let crit = false;

  // Resolve damage kind & range for popup icon.
  const effKind: "physical" | "magical" =
    skill.id === "basic_attack" && attacker.basicAttackKind
      ? attacker.basicAttackKind
      : (skill.kind === "magical" ? "magical" : "physical");
  const range: "melee" | "range" =
    skill.range ?? (effKind === "magical" && skill.id === "basic_attack" && attacker.basicAttackKind === "magical"
      ? "range"
      : effKind === "magical" ? "range" : "melee");

  if (skill.flatDamage) {
    const { min, max } = skill.flatDamage;
    const span = max - min + 1;
    dmg = min + Math.floor(b.rng.next() * span);
  } else {
    // Stat-buff scaling on both sides (VIT/DEF/STR/INT/etc.).
    const attackerStats0 = buffedStats(attacker, attacker.stats);
    const targetStats0 = buffedStats(target, target.stats);
    // Apply +atk buffs to attacker stats for this damage roll.
    const atkMul = atkBuffMultiplier(attacker, effKind === "magical" ? "mag" : "phys");
    const buffedAttackerStats = atkMul === 1 ? attackerStats0 : (() => {
      const s = { ...attackerStats0 };
      if (effKind === "magical") s.INT = Math.floor(s.INT * atkMul);
      else s.STR = Math.floor(s.STR * atkMul);
      return s;
    })();
    // Per-skill scaling: each entry adds (stat * weight) onto the attack stat.
    let bonusAtk = 0;
    if (skill.scalesWith) {
      for (const e of skill.scalesWith) {
        bonusAtk += (buffedAttackerStats[e.stat] ?? 0) * (e.weight ?? 1);
      }
    }
    let result: DamageResult;
    if (effKind === "magical") {
      result = magicalDamage(buffedAttackerStats, targetStats0, skill.power, b.rng, blindHitPenalty(attacker), bonusAtk);
    } else {
      result = physicalDamage(buffedAttackerStats, targetStats0, skill.power, b.rng, blindHitPenalty(attacker), bonusAtk);
    }
    if (result.miss) {
      b.log.push(`${attacker.name} → ${target.name}: miss!`);
      pushMiss(target.id);
      return;
    }
    dmg = result.dmg;
    crit = result.crit;
  }

  if (ctx.aoe) dmg = Math.max(1, Math.floor(dmg * 0.75));
  if (target.guarding) dmg = Math.max(1, Math.floor(dmg / 2));
  // Outgoing scaling on the attacker (e.g. boss = 3x).
  if (attacker.atkMultiplier && attacker.atkMultiplier !== 1) {
    dmg = Math.max(1, Math.floor(dmg * attacker.atkMultiplier));
  }
  // Type resistances (melee/range/physical/magical) on the target template.
  if (target.resist) {
    const r = target.resist;
    let mul = 1;
    if (effKind === "physical" && r.physical !== undefined) mul *= r.physical;
    if (effKind === "magical" && r.magical !== undefined) mul *= r.magical;
    if (range === "melee" && r.melee !== undefined) mul *= r.melee;
    if (range === "range" && r.range !== undefined) mul *= r.range;
    if (mul !== 1) dmg = Math.max(1, Math.floor(dmg * mul));
  }
  // Vulnerability / damage reduction on the defender.
  const incomingMul = incomingDamageMultiplier(target);
  if (incomingMul !== 1) dmg = Math.max(1, Math.floor(dmg * incomingMul));
  // Last Stand (shop buff): when exactly one player ally is alive AND that
  // unit is the attacker, multiply outgoing damage. Counted right before the
  // hit lands so it tracks the moment-by-moment alive count.
  if (attacker.side === "player" && b.lastStandDamageMul > 1) {
    const aliveAllies = b.combatants.filter(c => c.side === "player" && c.alive).length;
    if (aliveAllies === 1) {
      dmg = Math.max(1, Math.floor(dmg * b.lastStandDamageMul));
    }
  }
  target.hp = Math.max(0, target.hp - dmg);

  // Run-summary trackers: only credit cross-side damage.
  if (attacker.side !== target.side) {
    attacker.damageDealt += dmg;
    target.damageTaken += dmg;
  }

  pushDamage(target.id, dmg, effKind, range, crit, {
    attackerTemplateId: attacker.templateId,
    attackerClassId: attacker.classId,
    skillId: skill.id,
    targetGuarding: target.guarding,
  });

  const tag = crit ? " CRIT" : "";
  const verb = skill.id === "basic_attack" ? "attacks" : `uses ${skill.name} on`;
  b.log.push(`${attacker.name} ${verb} ${target.name}: ${dmg}${tag}`);

  // Damage reflect: defender returns a % of damage taken to the attacker even
  // if the defender died from the hit. Skip cross-reflect (no infinite loops).
  //   - World Ender: fully immune (the capstone boss can't be reflect-cheesed).
  //   - Other solo bosses: take 50% of reflected damage. Reflect builds still
  //     contribute on boss floors, but can't trivialize them by passive return.
  //   - Non-boss enemies: take 100% of reflected damage as before.
  const reflectPct = damageReflectPct(target);
  const attackerReflectImmune = attacker.templateId === "world_ender";
  const attackerIsBoss = BOSS_TEMPLATE_IDS.has(attacker.templateId);
  if (reflectPct > 0 && attacker.side !== target.side && attacker.alive && dmg > 0 && !attackerReflectImmune) {
    const bossMul = attackerIsBoss ? 0.5 : 1.0;
    const reflectDmg = Math.max(1, Math.floor(dmg * reflectPct * bossMul));
    attacker.hp = Math.max(0, attacker.hp - reflectDmg);
    target.damageDealt += reflectDmg;
    attacker.damageTaken += reflectDmg;
    pushDamage(attacker.id, reflectDmg, effKind, "melee", false, {
      attackerTemplateId: target.templateId,
      attackerClassId: target.classId,
      skillId: "damage_reflect",
      targetGuarding: false,
    });
    b.log.push(`${target.name} reflects ${reflectDmg} back to ${attacker.name}.`);
    if (attacker.hp <= 0) {
      attacker.alive = false;
      attacker.queuedAction = null;
      target.kills += 1;
      b.log.push(`${attacker.name} falls to reflected damage.`);
    }
  }

  if (target.hp <= 0) {
    // Phoenix Embers: if the buff is armed and a PLAYER unit just fell, spend
    // the charge to revive them at 50% maxHp instead. Charge spans the whole
    // run but consumes on first use — applied once per battle.
    if (target.side === "player" && b.phoenixEmbersCharge) {
      b.phoenixEmbersCharge = false;
      const revivedTo = Math.max(1, Math.floor(target.maxHp * 0.5));
      target.hp = revivedTo;
      // Leave .alive = true (never set to false). Kill credit is NOT awarded.
      b.log.push(`${target.name} would have fallen — Phoenix Embers revive them at ${revivedTo} HP!`);
      // Don't 'return' — we still want on-hit applies to run on a survivor.
    } else {
      target.alive = false;
      target.queuedAction = null;
      if (attacker.side !== target.side) attacker.kills += 1;
      b.log.push(`${target.name} falls.`);
      // Track enemy deaths for the server-side RON roll. The client never
      // decides if a drop occurred — only reports who died and which kill
      // tier they belong to. World Ender is its own tier so the server can
      // apply a 4× multiplier; other solo bosses get 2×; mobs get 1×.
      if (target.side === "enemy") {
        const tier: "mob" | "boss" | "world_ender" =
          target.templateId === "world_ender" ? "world_ender" :
          BOSS_TEMPLATE_IDS.has(target.templateId) ? "boss" : "mob";
        b.killEvents.push({ enemyTemplateId: target.templateId, killTier: tier });
        // ---- COSMETIC visual drop pop ----
        // Uses Math.random (NOT the battle RNG) so it can't affect replay
        // determinism. The server is still the only authority on the actual
        // RON credited. Chances mirror the server table × tier multiplier so
        // the visual rate roughly matches actual reward rate over time.
        rollVisualBronDrop(target.id, tier);
      }
      return;
    }
  }

  // Apply attached on-hit effects.
  if (skill.applies && skill.applies.length > 0) {
    for (const eff of skill.applies) maybeApplyEffect(b, attacker, target, eff);
  }
}

function healScaleBonus(caster: Combatant, scaling: NonNullable<Skill["scalesWith"]>): number {
  let bonus = 0;
  for (const s of scaling) {
    const weight = s.weight ?? 1;
    const stat = caster.stats[s.stat] ?? 0;
    bonus += (stat * weight) / 10;
  }
  return Math.floor(bonus);
}

/** Percentage bonus added to effect.power for buff/debuff effects.
 *  Each contributing stat adds (stat * weight) / divisor — divisor defaults to
 *  200, can be overridden per-skill via Skill.buffScaleDivisor. Higher divisor
 *  = slower scaling (tuned for late-level pacing). */
const DEFAULT_BUFF_SCALE_DIVISOR = 200;
function buffScaleBonus(caster: Combatant, scaling: NonNullable<Skill["scalesWith"]>, divisor: number): number {
  let bonus = 0;
  for (const s of scaling) {
    const weight = s.weight ?? 1;
    const stat = caster.stats[s.stat] ?? 0;
    bonus += (stat * weight) / divisor;
  }
  return bonus;
}

/** Effect ids whose `power` is a fraction in [0..1] (or ~0..2 for atk_buff) and
 *  benefits from being scaled by caster stats when the skill declares scalesWith. */
const SCALABLE_BUFF_IDS = new Set<string>([
  "dmg_reduction", "damage_reflect", "atk_buff", "stat_buff", "vulnerability",
]);

/** Returns a copy of `eff` with power scaled by the caster's stats when
 *  appropriate. Default caps: 0.95 for reductions/reflects, 2.0 for atk/stat
 *  buffs. Per-effect `maxPower` (set on EffectApplication) overrides the cap.
 *  Heal scaling stays on its own additive path via healScaleBonus. */
function scaleEffectIfRelevant(caster: Combatant, skill: Skill, eff: EffectApplication): EffectApplication {
  if (!skill.scalesWith || skill.scalesWith.length === 0) return eff;
  if (eff.id === "heal") {
    return { ...eff, power: eff.power + healScaleBonus(caster, skill.scalesWith) };
  }
  if (!SCALABLE_BUFF_IDS.has(eff.id)) return eff;
  const divisor = skill.buffScaleDivisor ?? DEFAULT_BUFF_SCALE_DIVISOR;
  const bonus = buffScaleBonus(caster, skill.scalesWith, divisor);
  let power = eff.power + bonus;
  const defaultCap = eff.id === "atk_buff" || eff.id === "stat_buff" || eff.id === "vulnerability" ? 2.0 : 0.95;
  const cap = eff.maxPower !== undefined ? eff.maxPower : defaultCap;
  if (power > cap) power = cap;
  return { ...eff, power };
}

function maybeApplyEffect(b: Battle, source: Combatant, target: Combatant, eff: EffectApplication): void {
  const chance = eff.chance ?? 1;
  if (chance < 1 && b.rng.next() > chance) return;
  if (eff.id === "heal") {
    if (!target.alive) return;
    // Heal = floor(power) flat + floor(maxHp * percentMaxHp). The percent
    // component keeps healing meaningful at endgame when target HP is huge.
    const flat = Math.max(0, Math.floor(eff.power));
    const pct = eff.percentMaxHp ? Math.floor(target.maxHp * eff.percentMaxHp) : 0;
    const amount = Math.max(1, flat + pct);
    const before = target.hp;
    target.hp = Math.min(target.maxHp, target.hp + amount);
    b.log.push(`${target.name} heals ${target.hp - before} HP.`);
    return;
  }
  applyEffect(target, {
    id: eff.id,
    duration: eff.duration,
    power: eff.power,
    target: eff.target,
    sourceId: source.id,
  });
  if (eff.id !== "regen") b.log.push(`${target.name} is afflicted with ${eff.id}.`);
}

function doSummon(b: Battle, attacker: Combatant, skill: Skill): void {
  if (!skill.summon) return;
  const tpl = TEMPLATE_LOOKUP[skill.summon.templateId];
  if (!tpl) {
    b.log.push(`${attacker.name} tried to summon (unknown template).`);
    return;
  }
  const occupied = new Set(
    b.combatants.filter(c => c.side === attacker.side && c.alive).map(c => `${c.position.row},${c.position.col}`)
  );
  const empties: Position[] = [];
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) {
    if (!occupied.has(`${r},${c}`)) empties.push({ row: r, col: c });
  }
  for (let i = empties.length - 1; i > 0; i--) {
    const j = Math.floor(b.rng.next() * (i + 1));
    [empties[i], empties[j]] = [empties[j], empties[i]];
  }
  const slots = empties.slice(0, skill.summon.count);
  if (slots.length === 0) {
    b.log.push(`${attacker.name} tried to summon — no room.`);
    return;
  }
  for (const pos of slots) {
    const c = makeCombatant(tpl, attacker.side, pos);
    b.combatants.push(c);
  }
  b.log.push(`${attacker.name} summons ${slots.length} ${tpl.name}${slots.length === 1 ? "" : "s"}!`);
}

function retargetSurvivors(b: Battle): void {
  for (const c of b.combatants) {
    if (!c.alive || !c.queuedAction) continue;
    const t = b.combatants.find(x => x.id === c.queuedAction!.targetId);
    if (t && t.alive) continue;
    const skill = getSkill(c.queuedAction.skillId);
    if (skill.targeting === "self") continue;
    const nearest = nearestEnemy(b, c);
    if (nearest) {
      c.queuedAction.targetId = nearest.id;
    } else {
      c.queuedAction = null;
    }
  }
}

function checkEndConditions(b: Battle): void {
  const playersAlive = b.combatants.some(c => c.side === "player" && c.alive);
  const enemiesAlive = b.combatants.some(c => c.side === "enemy" && c.alive);
  if (!playersAlive) {
    b.state = { kind: "defeat" };
    b.log.push("Defeat...");
    if (!b.replayMode) {
      sfx.defeat();
      distributeEndOfBattleXp(b);
      persistPartyProgress(b);
    }
  } else if (!enemiesAlive) {
    b.state = { kind: "victory" };
    b.log.push("Victory!");
    // Fire the victory SFX immediately so it plays during the brief Victory
    // banner, carrying through into the run summary panel that fades in 1.5s
    // later. The summary itself no longer triggers it to avoid overlap.
    if (!b.replayMode) {
      sfx.victory();
      distributeEndOfBattleXp(b);
      persistPartyProgress(b);
    }
  }
}

// ---- Cosmetic RON drop popup (purely visual, NOT replay-deterministic) ----
// Mirrors the server's drop table per tier × the kill-tier multiplier so the
// visual rate roughly matches actual server rewards over time. Uses Math.random
// (separate from b.rng) so it never shifts combat outcomes.
const COSMETIC_BRON_TIERS: { tier: "t1" | "t2" | "t3" | "t4" | "t5"; chance: number }[] = [
  { tier: "t5", chance: 0.0000016 },
  { tier: "t4", chance: 0.000008 },
  { tier: "t3", chance: 0.00004 },
  { tier: "t2", chance: 0.0002 },
  { tier: "t1", chance: 0.001 },
];
function rollVisualBronDrop(targetId: string, killTier: "mob" | "boss" | "world_ender"): void {
  const mul = killTier === "world_ender" ? 4 : killTier === "boss" ? 2 : 1;
  for (const t of COSMETIC_BRON_TIERS) {
    if (Math.random() < t.chance * mul) {
      pushBronDrop(targetId, t.tier);
      return; // first hit wins (matches server logic)
    }
  }
}
