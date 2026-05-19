import { UnitTemplate } from "./types";
import { Stats } from "../core/stats";

/** Default per-level growth, expressed as a fraction of the base stat, used
 *  for templates (mostly enemies) that don't declare unitGrowth explicitly.
 *  At 0.05 a level-30 enemy with base STR 14 ends up at ~14 + 14*0.05*29 ≈ 34. */
export const DEFAULT_GROWTH_PCT = 0.05;

/** Unit baseStats scaled for `level`.
 *  - If unitGrowth is set on the template, adds it × (level - 1).
 *  - Otherwise, uses baseStats × DEFAULT_GROWTH_PCT × (level - 1).
 *  This keeps enemy mobs scaling alongside players without requiring an
 *  explicit unitGrowth on every enemy template. */
export function unitBaseAtLevel(t: UnitTemplate, level: number): Stats {
  const lvls = Math.max(0, level - 1);
  if (lvls === 0) return { ...t.unitBaseStats };
  const explicit = t.unitGrowth;
  if (explicit) {
    return {
      STR: t.unitBaseStats.STR + explicit.STR * lvls,
      DEF: t.unitBaseStats.DEF + explicit.DEF * lvls,
      AGI: t.unitBaseStats.AGI + explicit.AGI * lvls,
      DEX: t.unitBaseStats.DEX + explicit.DEX * lvls,
      VIT: t.unitBaseStats.VIT + explicit.VIT * lvls,
      INT: t.unitBaseStats.INT + explicit.INT * lvls,
    };
  }
  // Implicit growth derived from baseStats.
  return {
    STR: t.unitBaseStats.STR * (1 + DEFAULT_GROWTH_PCT * lvls),
    DEF: t.unitBaseStats.DEF * (1 + DEFAULT_GROWTH_PCT * lvls),
    AGI: t.unitBaseStats.AGI * (1 + DEFAULT_GROWTH_PCT * lvls),
    DEX: t.unitBaseStats.DEX * (1 + DEFAULT_GROWTH_PCT * lvls),
    VIT: t.unitBaseStats.VIT * (1 + DEFAULT_GROWTH_PCT * lvls),
    INT: t.unitBaseStats.INT * (1 + DEFAULT_GROWTH_PCT * lvls),
  };
}


// ---- Player units ----
// startingSkills is just "idle" — class & character signature skills come from registry.

export const SODA: UnitTemplate = {
  id: "soda", name: "Soda", portrait: "💧",
  unitBaseStats: { STR: 5, DEF: 2, AGI: 15, DEX: 12, VIT: 3, INT: 3 },
  unitGrowth:    { STR: 0.5, DEF: 0.2, AGI: 1.5, DEX: 1.2, VIT: 0.3, INT: 0.3 },
  startingSkills: ["idle"],
};
export const EGO: UnitTemplate = {
  id: "ego", name: "Ego", portrait: "🪞",
  unitBaseStats: { STR: 18, DEF: 0, AGI: 2, DEX: 16, VIT: 2, INT: 2 },
  unitGrowth:    { STR: 1.8, DEF: 0.0, AGI: 0.2, DEX: 1.6, VIT: 0.2, INT: 0.2 },
  startingSkills: ["idle"],
};
export const GRUYERE: UnitTemplate = {
  id: "gruyere", name: "Gruyere", portrait: "🧀",
  unitBaseStats: { STR: 4, DEF: 6, AGI: 6, DEX: 10, VIT: 4, INT: 10 },
  unitGrowth:    { STR: 0.4, DEF: 0.6, AGI: 0.6, DEX: 1.0, VIT: 0.4, INT: 1.0 },
  startingSkills: ["idle"],
};
export const CALYPSO: UnitTemplate = {
  id: "calypso", name: "Calypso", portrait: "🌊",
  unitBaseStats: { STR: 2, DEF: 5, AGI: 3, DEX: 5, VIT: 10, INT: 15 },
  unitGrowth:    { STR: 0.2, DEF: 0.5, AGI: 0.3, DEX: 0.5, VIT: 1.0, INT: 1.5 },
  startingSkills: ["idle"],
};
export const CALICO: UnitTemplate = {
  id: "calico", name: "Calico", portrait: "🐈",
  unitBaseStats: { STR: 2, DEF: 2, AGI: 8, DEX: 20, VIT: 3, INT: 5 },
  unitGrowth:    { STR: 0.2, DEF: 0.2, AGI: 0.8, DEX: 2.0, VIT: 0.3, INT: 0.5 },
  startingSkills: ["idle"],
};
export const NOVA: UnitTemplate = {
  id: "nova", name: "Nova", portrait: "✨",
  unitBaseStats: { STR: 2, DEF: 4, AGI: 4, DEX: 4, VIT: 6, INT: 20 },
  unitGrowth:    { STR: 0.2, DEF: 0.4, AGI: 0.4, DEX: 0.4, VIT: 0.6, INT: 2.0 },
  startingSkills: ["idle"],
  basicAttackKind: "magical",
};
export const HERA: UnitTemplate = {
  id: "hera", name: "Hera", portrait: "👑",
  unitBaseStats: { STR: 1, DEF: 7, AGI: 1, DEX: 1, VIT: 10, INT: 20 },
  unitGrowth:    { STR: 0.1, DEF: 0.7, AGI: 0.1, DEX: 0.1, VIT: 1.0, INT: 2.0 },
  startingSkills: ["idle"],
  basicAttackKind: "magical",
};
export const ASPEN: UnitTemplate = {
  id: "aspen", name: "Aspen", portrait: "🏹",
  unitBaseStats: { STR: 15, DEF: 8, AGI: 5, DEX: 7, VIT: 5, INT: 0 },
  unitGrowth:    { STR: 1.5, DEF: 0.8, AGI: 0.5, DEX: 0.7, VIT: 0.5, INT: 0.0 },
  startingSkills: ["idle"],
};
export const OGE: UnitTemplate = {
  id: "oge", name: "Oge", portrait: "🪨",
  unitBaseStats: { STR: 5, DEF: 15, AGI: 2, DEX: 3, VIT: 15, INT: 0 },
  unitGrowth:    { STR: 0.5, DEF: 1.5, AGI: 0.2, DEX: 0.3, VIT: 1.5, INT: 0.0 },
  startingSkills: ["idle"],
};
export const SHEGO: UnitTemplate = {
  id: "shego", name: "Shego", portrait: "🌿",
  unitBaseStats: { STR: 2, DEF: 15, AGI: 4, DEX: 3, VIT: 15, INT: 1 },
  unitGrowth:    { STR: 0.2, DEF: 1.5, AGI: 0.4, DEX: 0.3, VIT: 1.5, INT: 0.1 },
  startingSkills: ["idle"],
  basicAttackKind: "magical",
};

export const PLAYER_ROSTER: UnitTemplate[] = [
  SODA, EGO, GRUYERE, CALYPSO, CALICO, NOVA, HERA, ASPEN, OGE, SHEGO,
];

export const MAX_PARTY_SIZE = 3;

// ---- Enemies ----
// Difficulty curve: stage 1 baseline → stage 10 final boss.

export const SLIME: UnitTemplate = {
  id: "slime", name: "Slime", portrait: "🟢",
  unitBaseStats: { STR: 4, DEF: 3, AGI: 4, DEX: 3, VIT: 4, INT: 0 },
  startingSkills: ["slime_goo"],
  level: 1,
  xpReward: 5,
};

export const SLIME_KING: UnitTemplate = {
  id: "slime_king", name: "Slime King", portrait: "👑🟢",
  unitBaseStats: { STR: 7, DEF: 6, AGI: 3, DEX: 5, VIT: 13, INT: 11 },
  startingSkills: ["slime_king_goo", "slime_barrage", "spawn_slimes"],
  overrideMaxHp: 220,
  overrideMaxMp: 60,
  level: 5,
  xpReward: 50,
  atkMultiplier: 2,
};

export const WOLF: UnitTemplate = {
  id: "wolf", name: "Wolf", portrait: "🐺",
  unitBaseStats: { STR: 7, DEF: 3, AGI: 8, DEX: 6, VIT: 5, INT: 0 },
  startingSkills: ["basic_attack"],
  level: 2, xpReward: 9,
};

export const BANDIT: UnitTemplate = {
  id: "bandit", name: "Bandit", portrait: "🗡",
  unitBaseStats: { STR: 9, DEF: 5, AGI: 6, DEX: 7, VIT: 6, INT: 1 },
  startingSkills: ["basic_attack"],
  level: 3, xpReward: 14,
};

export const ACOLYTE: UnitTemplate = {
  id: "acolyte", name: "Acolyte", portrait: "🧙‍♂️",
  unitBaseStats: { STR: 2, DEF: 4, AGI: 4, DEX: 4, VIT: 5, INT: 11 },
  startingSkills: ["basic_attack"],
  basicAttackKind: "magical",
  level: 4, xpReward: 18,
};

export const SKELETON: UnitTemplate = {
  id: "skeleton", name: "Skeleton", portrait: "💀",
  unitBaseStats: { STR: 11, DEF: 6, AGI: 5, DEX: 6, VIT: 8, INT: 0 },
  startingSkills: ["basic_attack"],
  level: 5, xpReward: 22,
};

export const WRAITH: UnitTemplate = {
  id: "wraith", name: "Wraith", portrait: "👻",
  unitBaseStats: { STR: 4, DEF: 5, AGI: 9, DEX: 8, VIT: 7, INT: 14 },
  startingSkills: ["basic_attack"],
  basicAttackKind: "magical",
  level: 6, xpReward: 28,
};

export const SKELETON_KNIGHT: UnitTemplate = {
  id: "skeleton_knight", name: "Skeleton Knight", portrait: "🛡",
  unitBaseStats: { STR: 14, DEF: 12, AGI: 5, DEX: 7, VIT: 12, INT: 0 },
  startingSkills: ["basic_attack"],
  level: 7, xpReward: 36,
};

export const ELITE_WRAITH: UnitTemplate = {
  id: "elite_wraith", name: "Elite Wraith", portrait: "🌀",
  unitBaseStats: { STR: 6, DEF: 8, AGI: 11, DEX: 10, VIT: 11, INT: 18 },
  startingSkills: ["basic_attack"],
  basicAttackKind: "magical",
  level: 8, xpReward: 45,
};

// ---- Solo bosses (3 / 6 / 10) — significantly harder ----

export const STONE_SENTINEL: UnitTemplate = {
  id: "stone_sentinel", name: "Stone Sentinel", portrait: "🗿",
  unitBaseStats: { STR: 14, DEF: 18, AGI: 4, DEX: 6, VIT: 24, INT: 4 },
  startingSkills: ["basic_attack", "earthshaker"],
  overrideMaxHp: 220,
  overrideMaxMp: 50,
  level: 8,
  xpReward: 120,
  atkMultiplier: 2,
};

export const WRAITH_LORD: UnitTemplate = {
  id: "wraith_lord", name: "Wraith Lord", portrait: "☠",
  unitBaseStats: { STR: 9, DEF: 14, AGI: 14, DEX: 14, VIT: 22, INT: 26 },
  startingSkills: ["basic_attack", "tidal_wave", "celestial_beam"],
  basicAttackKind: "magical",
  overrideMaxHp: 360,
  overrideMaxMp: 120,
  level: 12,
  xpReward: 260,
  atkMultiplier: 2,
};

export const TOWER_LORD: UnitTemplate = {
  id: "tower_lord", name: "Tower Lord", portrait: "🐉",
  unitBaseStats: { STR: 24, DEF: 22, AGI: 16, DEX: 18, VIT: 32, INT: 26 },
  startingSkills: ["basic_attack", "colossal_slam", "inferno_crash", "celestial_beam"],
  overrideMaxHp: 620,
  overrideMaxMp: 200,
  level: 16,
  xpReward: 600,
  atkMultiplier: 2,
};

// ============================================================
// Floors 11-30 — themed rooms + skewed-stat / mechanic bosses
// ============================================================

// --- Buff-themed mobs (cast support skills on allies) ---

export const CLERIC: UnitTemplate = {
  id: "cleric", name: "Cleric", portrait: "⚕",
  unitBaseStats: { STR: 4, DEF: 6, AGI: 5, DEX: 5, VIT: 10, INT: 14 },
  startingSkills: ["basic_attack", "tidal_mending", "aura_shield"],
  basicAttackKind: "magical",
  level: 11, xpReward: 50,
};

export const CANTOR: UnitTemplate = {
  id: "cantor", name: "Cantor", portrait: "🎺",
  unitBaseStats: { STR: 5, DEF: 5, AGI: 7, DEX: 7, VIT: 8, INT: 12 },
  startingSkills: ["basic_attack", "analyze_vulnerability"],
  basicAttackKind: "magical",
  level: 11, xpReward: 50,
};

export const ARCHON: UnitTemplate = {
  id: "archon", name: "Archon", portrait: "📯",
  unitBaseStats: { STR: 6, DEF: 8, AGI: 6, DEX: 8, VIT: 10, INT: 14 },
  startingSkills: ["basic_attack", "grandmasters_domain"],
  basicAttackKind: "magical",
  level: 12, xpReward: 60,
};

// --- Debuff-themed mobs ---

export const HEXER: UnitTemplate = {
  id: "hexer", name: "Hexer", portrait: "🪄",
  unitBaseStats: { STR: 6, DEF: 5, AGI: 8, DEX: 10, VIT: 8, INT: 12 },
  startingSkills: ["basic_attack", "needle_shot"],
  level: 12, xpReward: 55,
};

export const PLAGUE_BEARER: UnitTemplate = {
  id: "plague_bearer", name: "Plague Bearer", portrait: "🦠",
  unitBaseStats: { STR: 5, DEF: 6, AGI: 6, DEX: 8, VIT: 10, INT: 14 },
  startingSkills: ["basic_attack", "ignite_touch"],
  basicAttackKind: "magical",
  level: 12, xpReward: 55,
};

export const JINX: UnitTemplate = {
  id: "jinx", name: "Jinx", portrait: "🃏",
  unitBaseStats: { STR: 4, DEF: 5, AGI: 12, DEX: 10, VIT: 7, INT: 10 },
  startingSkills: ["basic_attack", "shadow_step"],
  level: 12, xpReward: 55,
};

export const GRAVELOCK: UnitTemplate = {
  id: "gravelock", name: "Gravelock", portrait: "⛓",
  unitBaseStats: { STR: 10, DEF: 10, AGI: 4, DEX: 7, VIT: 14, INT: 4 },
  startingSkills: ["basic_attack", "bash"],
  level: 13, xpReward: 60,
};

// --- Heavier mid-tier mobs (floors 15-22) ---

export const DARK_KNIGHT: UnitTemplate = {
  id: "dark_knight", name: "Dark Knight", portrait: "⚔",
  unitBaseStats: { STR: 18, DEF: 14, AGI: 6, DEX: 9, VIT: 14, INT: 0 },
  startingSkills: ["basic_attack", "impact_strike"],
  level: 14, xpReward: 80,
};

export const LICH: UnitTemplate = {
  id: "lich", name: "Lich", portrait: "💀✨",
  unitBaseStats: { STR: 4, DEF: 8, AGI: 7, DEX: 9, VIT: 12, INT: 22 },
  startingSkills: ["basic_attack", "blazing_burst", "binding_shot"],
  basicAttackKind: "magical",
  level: 16, xpReward: 110,
};

export const BERSERKER: UnitTemplate = {
  id: "berserker", name: "Berserker", portrait: "🪓",
  unitBaseStats: { STR: 24, DEF: 4, AGI: 12, DEX: 10, VIT: 8, INT: 0 },
  startingSkills: ["basic_attack", "limit_break"],
  level: 17, xpReward: 130,
};

export const NIGHT_HAG: UnitTemplate = {
  id: "night_hag", name: "Night Hag", portrait: "🌑",
  unitBaseStats: { STR: 6, DEF: 8, AGI: 10, DEX: 12, VIT: 12, INT: 20 },
  startingSkills: ["basic_attack", "ignite_touch", "shadow_step", "needle_shot"],
  basicAttackKind: "magical",
  level: 19, xpReward: 160,
};

export const GARGOYLE: UnitTemplate = {
  id: "gargoyle", name: "Gargoyle", portrait: "🗿",
  unitBaseStats: { STR: 14, DEF: 22, AGI: 4, DEX: 6, VIT: 22, INT: 4 },
  startingSkills: ["basic_attack", "iron_bulwark"],
  level: 18, xpReward: 140,
};

export const DEMON_HOUND: UnitTemplate = {
  id: "demon_hound", name: "Demon Hound", portrait: "🐺‍🔥",
  unitBaseStats: { STR: 16, DEF: 8, AGI: 18, DEX: 14, VIT: 10, INT: 0 },
  startingSkills: ["basic_attack", "swift_jab"],
  level: 20, xpReward: 180,
};

// --- Floor bosses 11-30 ---

// Floor 14 — VIT-skewed wall boss. Massive HP, low offense, low speed.
export const IRON_BEHEMOTH: UnitTemplate = {
  id: "iron_behemoth", name: "Iron Behemoth", portrait: "🦏",
  unitBaseStats: { STR: 8, DEF: 42, AGI: 2, DEX: 5, VIT: 240, INT: 0 },
  startingSkills: ["basic_attack", "iron_bulwark"],
  overrideMaxHp: 4500,
  overrideMaxMp: 30,
  level: 14,
  xpReward: 400,
  atkMultiplier: 2,
};

// Floor 17 — AOE freezer boss.
export const STORM_LORD: UnitTemplate = {
  id: "storm_lord", name: "Storm Lord", portrait: "⛈",
  unitBaseStats: { STR: 10, DEF: 12, AGI: 12, DEX: 14, VIT: 22, INT: 26 },
  startingSkills: ["basic_attack", "tidal_wave", "binding_shot", "frost_bite"],
  basicAttackKind: "magical",
  overrideMaxHp: 960,
  overrideMaxMp: 200,
  level: 17, xpReward: 540,
  atkMultiplier: 2,
  resist: { magical: 0.2 },
};

// Floor 20 — physical brute boss.
export const DEMON_GENERAL: UnitTemplate = {
  id: "demon_general", name: "Demon General", portrait: "😈",
  unitBaseStats: { STR: 32, DEF: 58, AGI: 14, DEX: 14, VIT: 24, INT: 0 },
  startingSkills: ["basic_attack", "colossal_slam", "earthshaker", "limit_break"],
  overrideMaxHp: 720,
  overrideMaxMp: 120,
  level: 20, xpReward: 700,
  atkMultiplier: 2,
  resist: { physical: 0.2 },
};

// Floor 23 — debuff stacker boss.
export const WITCH_QUEEN: UnitTemplate = {
  id: "witch_queen", name: "Witch Queen", portrait: "🧙‍♀",
  unitBaseStats: { STR: 8, DEF: 14, AGI: 12, DEX: 16, VIT: 22, INT: 30 },
  startingSkills: ["basic_attack", "ignite_touch", "shadow_step", "binding_shot", "mark_of_death"],
  basicAttackKind: "magical",
  overrideMaxHp: 720,
  overrideMaxMp: 240,
  level: 23, xpReward: 900,
  atkMultiplier: 2,
  resist: { magical: 0.2 },
};

// Floor 26 — fire/burn boss.
export const DRAGON_LORD: UnitTemplate = {
  id: "dragon_lord", name: "Dragon Lord", portrait: "🐲",
  unitBaseStats: { STR: 22, DEF: 18, AGI: 12, DEX: 14, VIT: 28, INT: 28 },
  startingSkills: ["basic_attack", "inferno_crash", "blazing_burst", "solar_flare"],
  basicAttackKind: "magical",
  overrideMaxHp: 920,
  overrideMaxMp: 240,
  level: 26, xpReward: 1100,
  atkMultiplier: 2,
  resist: { melee: 0.2 },
};

// Floor 30 — final boss, balanced and scariest.
export const TOWER_GOD: UnitTemplate = {
  id: "tower_god", name: "Tower God", portrait: "🌌",
  unitBaseStats: { STR: 32, DEF: 28, AGI: 22, DEX: 24, VIT: 40, INT: 32 },
  startingSkills: [
    "basic_attack", "colossal_slam", "inferno_crash", "celestial_beam",
    "tidal_wave", "earthshaker", "mark_of_death",
  ],
  overrideMaxHp: 1400,
  overrideMaxMp: 400,
  level: 30, xpReward: 2000,
  atkMultiplier: 2,
  resist: { range: 0.5 },
};

// ============================================================
// Floors 31-40 — anti-X resistance gauntlet
// Each unit has a "resist" multiplier on incoming damage of one type.
// 0.25 = takes 25% (i.e., 75% reduction). 0.15 on bosses.
// ============================================================

// --- Anti-MAGIC (high INT/DEF, magical: 0.25) ---
export const NULL_GUARDIAN: UnitTemplate = {
  id: "null_guardian", name: "Null Guardian", portrait: "🛡✨",
  unitBaseStats: { STR: 14, DEF: 14, AGI: 6, DEX: 9, VIT: 18, INT: 4 },
  startingSkills: ["basic_attack", "iron_bulwark"],
  level: 22, xpReward: 280,
  resist: { magical: 0.08 },
};
export const VOID_KNIGHT: UnitTemplate = {
  id: "void_knight", name: "Void Knight", portrait: "⚔🌑",
  unitBaseStats: { STR: 18, DEF: 16, AGI: 8, DEX: 10, VIT: 16, INT: 6 },
  startingSkills: ["basic_attack", "impact_strike"],
  level: 24, xpReward: 320,
  resist: { magical: 0.07 },
};

// --- Anti-PHYSICAL (incorporeal — high AGI/INT, physical: 0.25) ---
export const SPECTRE: UnitTemplate = {
  id: "spectre", name: "Spectre", portrait: "👻💨",
  unitBaseStats: { STR: 4, DEF: 6, AGI: 14, DEX: 12, VIT: 12, INT: 18 },
  startingSkills: ["basic_attack", "shadow_step"],
  basicAttackKind: "magical",
  level: 22, xpReward: 280,
  resist: { physical: 0.08 },
};
export const STORMCALLER: UnitTemplate = {
  id: "stormcaller", name: "Stormcaller", portrait: "⚡🪶",
  unitBaseStats: { STR: 5, DEF: 8, AGI: 12, DEX: 12, VIT: 14, INT: 22 },
  startingSkills: ["basic_attack", "frost_bite"],
  basicAttackKind: "magical",
  level: 24, xpReward: 320,
  resist: { physical: 0.07 },
};

// --- Anti-MELEE (high AGI evasion, melee: 0.25) ---
export const AIR_DANCER: UnitTemplate = {
  id: "air_dancer", name: "Air Dancer", portrait: "🪽",
  unitBaseStats: { STR: 8, DEF: 6, AGI: 22, DEX: 14, VIT: 10, INT: 8 },
  startingSkills: ["basic_attack", "swift_jab"],
  level: 23, xpReward: 300,
  resist: { melee: 0.08 },
};
export const FLOATING_EYE: UnitTemplate = {
  id: "floating_eye", name: "Floating Eye", portrait: "👁",
  unitBaseStats: { STR: 4, DEF: 8, AGI: 18, DEX: 16, VIT: 10, INT: 18 },
  startingSkills: ["basic_attack", "blazing_burst"],
  basicAttackKind: "magical",
  level: 24, xpReward: 320,
  resist: { melee: 0.08 },
};

// --- Anti-RANGE (thick hide / shells, range: 0.25) ---
export const BULWARK_BEAR: UnitTemplate = {
  id: "bulwark_bear", name: "Bulwark Bear", portrait: "🐻",
  unitBaseStats: { STR: 18, DEF: 16, AGI: 4, DEX: 8, VIT: 24, INT: 0 },
  startingSkills: ["basic_attack", "earthshaker"],
  level: 23, xpReward: 300,
  resist: { range: 0.08 },
};
export const SPIKED_SHELL: UnitTemplate = {
  id: "spiked_shell", name: "Spiked Shell", portrait: "🦔",
  unitBaseStats: { STR: 10, DEF: 22, AGI: 4, DEX: 6, VIT: 22, INT: 4 },
  startingSkills: ["basic_attack", "iron_bulwark"],
  level: 24, xpReward: 320,
  resist: { range: 0.08 },
};

// --- Anti-X bosses ---
export const NULL_HIEROPHANT: UnitTemplate = {
  id: "null_hierophant", name: "Null Hierophant", portrait: "📿",
  unitBaseStats: { STR: 22, DEF: 26, AGI: 10, DEX: 14, VIT: 30, INT: 8 },
  startingSkills: ["basic_attack", "phalanx_wall", "earthshaker", "impact_strike"],
  overrideMaxHp: 1100,
  overrideMaxMp: 200,
  level: 28, xpReward: 1300,
  resist: { magical: 0.05 },
  atkMultiplier: 2,
};
export const THE_UNTOUCHED: UnitTemplate = {
  id: "the_untouched", name: "The Untouched", portrait: "🌫",
  unitBaseStats: { STR: 6, DEF: 12, AGI: 22, DEX: 18, VIT: 26, INT: 30 },
  startingSkills: ["basic_attack", "tidal_wave", "celestial_beam", "binding_shot", "shadow_step"],
  basicAttackKind: "magical",
  overrideMaxHp: 1100,
  overrideMaxMp: 320,
  level: 28, xpReward: 1300,
  resist: { physical: 0.05 },
  atkMultiplier: 2,
};

// ============================================================
// Floors 41-50 — Apex tier. Resist + active buff/debuff combo.
// Everything from prior tiers stacked.
// ============================================================

// --- Anti-magic, support buffer ---
export const SHIELD_PRIEST: UnitTemplate = {
  id: "shield_priest", name: "Shield Priest", portrait: "✝🛡",
  unitBaseStats: { STR: 10, DEF: 14, AGI: 8, DEX: 10, VIT: 22, INT: 14 },
  startingSkills: ["basic_attack", "aura_shield", "tidal_mending"],
  basicAttackKind: "magical",
  level: 32, xpReward: 480,
  resist: { magical: 0.08 },
};
export const WARDING_PALADIN: UnitTemplate = {
  id: "warding_paladin", name: "Warding Paladin", portrait: "🗝🛡",
  unitBaseStats: { STR: 16, DEF: 18, AGI: 8, DEX: 12, VIT: 22, INT: 8 },
  startingSkills: ["basic_attack", "phalanx_wall", "impact_strike"],
  level: 33, xpReward: 520,
  resist: { magical: 0.07 },
};

// --- Anti-physical, debuff caster ---
export const WRAITH_HEXER: UnitTemplate = {
  id: "wraith_hexer", name: "Wraith Hexer", portrait: "👻🪄",
  unitBaseStats: { STR: 4, DEF: 8, AGI: 14, DEX: 14, VIT: 14, INT: 24 },
  startingSkills: ["basic_attack", "ignite_touch", "needle_shot"],
  basicAttackKind: "magical",
  level: 32, xpReward: 480,
  resist: { physical: 0.08 },
};
export const STORM_ORACLE: UnitTemplate = {
  id: "storm_oracle", name: "Storm Oracle", portrait: "⚡🔮",
  unitBaseStats: { STR: 6, DEF: 10, AGI: 12, DEX: 14, VIT: 16, INT: 26 },
  startingSkills: ["basic_attack", "binding_shot", "frost_bite"],
  basicAttackKind: "magical",
  level: 33, xpReward: 520,
  resist: { physical: 0.07 },
};

// --- Anti-melee, evasive buff/debuff hybrid ---
export const DUST_DJINN: UnitTemplate = {
  id: "dust_djinn", name: "Dust Djinn", portrait: "🌬",
  unitBaseStats: { STR: 8, DEF: 8, AGI: 24, DEX: 16, VIT: 12, INT: 14 },
  startingSkills: ["basic_attack", "shadow_step", "swift_jab"],
  level: 34, xpReward: 560,
  resist: { melee: 0.08 },
};
export const MIRROR_SPRITE: UnitTemplate = {
  id: "mirror_sprite", name: "Mirror Sprite", portrait: "🪞✨",
  unitBaseStats: { STR: 4, DEF: 10, AGI: 20, DEX: 18, VIT: 12, INT: 22 },
  startingSkills: ["basic_attack", "radiant_punch", "tidal_mending"],
  basicAttackKind: "magical",
  level: 34, xpReward: 560,
  resist: { melee: 0.07 },
};

// --- Anti-range, armored brutes that stun + buff allies ---
export const HUSK_TITAN: UnitTemplate = {
  id: "husk_titan", name: "Husk Titan", portrait: "🗿🪨",
  unitBaseStats: { STR: 22, DEF: 22, AGI: 4, DEX: 8, VIT: 32, INT: 0 },
  startingSkills: ["basic_attack", "iron_bulwark", "bash"],
  level: 35, xpReward: 600,
  resist: { range: 0.08 },
};
export const CARAPACE_MATRON: UnitTemplate = {
  id: "carapace_matron", name: "Carapace Matron", portrait: "🦂",
  unitBaseStats: { STR: 14, DEF: 24, AGI: 6, DEX: 12, VIT: 26, INT: 6 },
  startingSkills: ["basic_attack", "aura_shield", "needle_shot"],
  level: 35, xpReward: 600,
  resist: { range: 0.07 },
};

// --- Tier-5 bosses ---

// Floor 45 — heals itself, silences party, double-resist (magic + melee).
export const APEX_ARBITER: UnitTemplate = {
  id: "apex_arbiter", name: "Apex Arbiter", portrait: "⚖",
  unitBaseStats: { STR: 18, DEF: 22, AGI: 14, DEX: 16, VIT: 32, INT: 28 },
  startingSkills: ["basic_attack", "tidal_mending", "phalanx_wall", "earthshaker", "binding_shot"],
  basicAttackKind: "magical",
  overrideMaxHp: 1600,
  overrideMaxMp: 360,
  level: 38, xpReward: 1800,
  resist: { magical: 0.06, melee: 0.06 },
  atkMultiplier: 2,
};

// Floor 50 — final-tier boss. Mild resist on every type + 4x damage.
export const WORLD_ENDER: UnitTemplate = {
  id: "world_ender", name: "World Ender", portrait: "🌑🌌",
  unitBaseStats: { STR: 45, DEF: 50, AGI: 18, DEX: 25, VIT: 69, INT: 45 },
  startingSkills: [
    "basic_attack", "colossal_slam", "inferno_crash", "celestial_beam",
    "tidal_wave", "earthshaker", "mark_of_death", "phalanx_wall",
    "world_end",
  ],
  overrideMaxHp: 2400,
  overrideMaxMp: 600,
  level: 45, xpReward: 3500,
  resist: { physical: 0.5, magical: 0.5, melee: 0.5, range: 0.5 },
  atkMultiplier: 2,
};

// ---- Stages ----

export const STAGE_1_ENEMIES: UnitTemplate[] = [SLIME, SLIME, SLIME, SLIME_KING];

export interface StageEnemyDef {
  id: number;
  name: string;
  enemies: UnitTemplate[];
  /** When true, stage is boss-only (a single enemy). */
  soloBoss?: boolean;
}

// ============================================================================
// Post-game content — Floors 51–500
// ----------------------------------------------------------------------------
// Tier 1 (Floors 1–50) is hand-authored below. Floors 51–500 are generated
// procedurally so we can ship 450 new floors without a 3000-line table.
// Constants + generator MUST live ABOVE the STAGE_DEFS array because the
// array-init spread `...generatePostGameFloors()` runs at module-load time
// and would TDZ on any consts declared later.
//
// Design:
//   • Enemy LEVEL scales linearly Lv30 → Lv70 from F51 → F500 via
//     BattleOptions.enemyLevelOverride (combat.ts → placeEnemies). The
//     template's intrinsic level field is preserved; only stat scaling
//     changes at runtime.
//   • Every 10th floor (60, 70, …, 500) is a recycled solo boss.
//   • Every 5th floor (55, 65, …, 495) is an "Elite Vault" — 4 enemies.
//   • All other floors are 3-mob rooms from mid/late pool.
//   • Picks are deterministic per floor id (no rng) — fair for replays.
//
// To extend to Floors 501-1000 later: bump POST_GAME_LAST_FLOOR and (optionally)
// retune POST_GAME_LEVEL_AT_LAST. Generator handles the rest.
// ============================================================================

export const POST_GAME_FIRST_FLOOR = 51;
export const POST_GAME_LAST_FLOOR = 500;
const POST_GAME_LEVEL_AT_FIRST = 30;   // F51 enemies start near Lv30 (matches fresh Lv30 party)
const POST_GAME_LEVEL_AT_LAST = 70;    // F500 enemies sit at Lv70 (target for Lv70 player units)

/** Linearly interpolate the enemy level for a post-game floor. Clamped to
 *  [LEVEL_AT_FIRST, LEVEL_AT_LAST]. Used by main.ts to set
 *  BattleOptions.enemyLevelOverride before startBattle. */
export function postGameEnemyLevelFor(floorId: number): number {
  if (floorId <= POST_GAME_FIRST_FLOOR) return POST_GAME_LEVEL_AT_FIRST;
  if (floorId >= POST_GAME_LAST_FLOOR) return POST_GAME_LEVEL_AT_LAST;
  const t = (floorId - POST_GAME_FIRST_FLOOR) / (POST_GAME_LAST_FLOOR - POST_GAME_FIRST_FLOOR);
  return Math.round(POST_GAME_LEVEL_AT_FIRST + t * (POST_GAME_LEVEL_AT_LAST - POST_GAME_LEVEL_AT_FIRST));
}

/** True when a floor is a post-game floor (51–500) and so should receive
 *  the level-override scaling. */
export function isPostGameFloor(floorId: number): boolean {
  return floorId >= POST_GAME_FIRST_FLOOR && floorId <= POST_GAME_LAST_FLOOR;
}

/** Floor where resist randomization kicks in. Below this, enemies use their
 *  template's intrinsic resist field (or none). At-or-above, every enemy on
 *  the floor inherits the floor's randomized resist profile — see below. */
export const RESIST_RANDO_FIRST_FLOOR = 100;

/** Per-mode resist intensity. Campaign + Survival use brutal numbers (100%/70%);
 *  Boss Raid uses gentler numbers (90%/60%) because the full 58-boss run
 *  already compounds difficulty from boss-raid stat scaling + 1.25× ATB —
 *  brutal immunes on top would be unfair. */
const RESIST_PROFILES = {
  floor:     { highMul: 0,   lowMul: 0.3 },  // 100% / 70% resist
  survival:  { highMul: 0,   lowMul: 0.3 },  // 100% / 70% resist
  boss_raid: { highMul: 0.1, lowMul: 0.4 },  // 90% / 60% resist (gentler)
} as const;
export type ResistMode = keyof typeof RESIST_PROFILES;

/** Compute a deterministic resistance profile for the given floor + mode.
 *  From F100 onward, every floor randomly assigns:
 *    - 2 of the 4 resist channels (physical / magical / melee / range) → high resist
 *    - the other 2                                                     → low resist
 *  The selection is seeded by floorId so the same floor always produces the
 *  same resist profile (fair across replays / leaderboard). The MAGNITUDE
 *  comes from `mode`: floor/survival = brutal, boss_raid = lighter. */
export function resistProfileForFloor(
  floorId: number,
  mode: ResistMode = "floor",
): import("./types").DamageResistance | null {
  if (floorId < RESIST_RANDO_FIRST_FLOOR) return null;
  // xorshift-ish hash of the floorId → 32-bit unsigned.
  let h = (floorId * 2654435761) >>> 0;
  h ^= h >>> 13;
  h = (h * 1597334677) >>> 0;
  h ^= h >>> 16;
  // Pick 2 of 4 indices to receive the high resist. The remaining 2 get the
  // low resist. We iterate through the 6 possible 2-of-4 combinations and
  // pick one deterministically. (C(4,2) = 6.)
  type Slot = "physical" | "magical" | "melee" | "range";
  const slots: Slot[] = ["physical", "magical", "melee", "range"];
  const combos: [Slot, Slot][] = [
    ["physical", "magical"],
    ["physical", "melee"],
    ["physical", "range"],
    ["magical", "melee"],
    ["magical", "range"],
    ["melee",    "range"],
  ];
  const picked = combos[h % combos.length];
  const { highMul, lowMul } = RESIST_PROFILES[mode];
  const profile: import("./types").DamageResistance = {};
  for (const slot of slots) {
    const isHigh = slot === picked[0] || slot === picked[1];
    profile[slot] = isHigh ? highMul : lowMul;
  }
  return profile;
}

/** Hand-authored name + enemy overrides for floors 51-500 (all current
 *  post-game floors). Outside this range, generatePostGameFloors uses
 *  procedural names. When 501-1000 get added, extend this map by 500 more
 *  rows; the generator picks up the additions automatically.
 *
 *  Naming theme: a slow descent through "Echoes of the Fallen Gods" — each
 *  10-floor sub-tier has its own atmosphere, each capstone is a boss-aspect
 *  fight. No name repeats across the entire 51-500 range. */
interface FloorOverride { name: string; enemies?: UnitTemplate[]; soloBoss?: boolean; }
const FLOOR_OVERRIDES_51_100: Record<number, FloorOverride> = {
  // ----- Sub-tier A: Pale Threshold (F51-F60) -----
  51: { name: "Pale Threshold" },
  52: { name: "Echoing Halls" },
  53: { name: "Whisper of Ash" },
  54: { name: "Forgotten Garrison" },
  55: { name: "Vault of Lost Pacts" },           // elite
  56: { name: "Withered Shrine" },
  57: { name: "Tomb of Acolytes" },
  58: { name: "Marrow Wastes" },
  59: { name: "Cinder Court" },
  60: { name: "Echo of the Stone Sentinel", enemies: [STONE_SENTINEL], soloBoss: true },

  // ----- Sub-tier B: Hollow Sovereignty (F61-F70) -----
  61: { name: "Hollow Veins" },
  62: { name: "Black Glass Bazaar" },
  63: { name: "Bonemarch" },
  64: { name: "The Lacuna" },
  65: { name: "Cathedral of Splinters" },        // elite
  66: { name: "Iron Garden" },
  67: { name: "Wraith's Promenade" },
  68: { name: "Spire of Spite" },
  69: { name: "Pale Sovereignty" },
  70: { name: "Echo of the Wraith Lord", enemies: [WRAITH_LORD], soloBoss: true },

  // ----- Sub-tier C: Twilight Foundry (F71-F80) -----
  71: { name: "Twilight Foundry" },
  72: { name: "Threadbare Halls" },
  73: { name: "Coiled Reliquary" },
  74: { name: "Pyrelight Bog" },
  75: { name: "Throat of Ash" },                 // elite
  76: { name: "Smoldering Wake" },
  77: { name: "Pallid Crossing" },
  78: { name: "Spire of Mirrors" },
  79: { name: "Calcified Veil" },
  80: { name: "Echo of the Tower Lord", enemies: [TOWER_LORD], soloBoss: true },

  // ----- Sub-tier D: Veinflow Depths (F81-F90) -----
  81: { name: "Veinflow Mines" },
  82: { name: "Riven Sky" },
  83: { name: "Choking Galleries" },
  84: { name: "Witherspine Pass" },
  85: { name: "Sepulchre of Names" },            // elite
  86: { name: "Cradle of Embers" },
  87: { name: "Hollowed Hallows" },
  88: { name: "Suncrack Aqueduct" },
  89: { name: "Ashen Carnival" },
  90: { name: "Echo of the Iron Behemoth", enemies: [IRON_BEHEMOTH], soloBoss: true },

  // ----- Sub-tier E: Tideblood Reach (F91-F100) -----
  91: { name: "Plagueglass Quay" },
  92: { name: "Tideblood Reach" },
  93: { name: "Shrouded Conservatory" },
  94: { name: "Cinder-River Crossing" },
  95: { name: "Crypt of Last Light" },           // elite
  96: { name: "Pale Conjunction" },
  97: { name: "Splintered Reverie" },
  98: { name: "The Outer Cloister" },
  99: { name: "Throne of Echoes" },
  100: { name: "Echo of the Storm Lord", enemies: [STORM_LORD], soloBoss: true },

  // ----- Sub-tier F: Veiled Bastion (F101-F110) -----
  101: { name: "Pall-Watcher Causeway" },
  102: { name: "Bleak Approach" },
  103: { name: "Funereal Galleries" },
  104: { name: "Ash-Wreathed Outlands" },
  105: { name: "Conclave of Husks" },
  106: { name: "Wormcoil Tunnels" },
  107: { name: "Slow-Burn Refectory" },
  108: { name: "Sepulchral Veil" },
  109: { name: "Bastion's Heart" },
  110: { name: "Shade of the Demon General", enemies: [DEMON_GENERAL], soloBoss: true },

  // ----- Sub-tier G: Crucible of Shrouds (F111-F120) -----
  111: { name: "Shroud-Wind Pass" },
  112: { name: "Loose-Thread Shrine" },
  113: { name: "Forelight Atrium" },
  114: { name: "Sallow Marches" },
  115: { name: "Choir-Lit Foundry" },
  116: { name: "Wax-Lined Cells" },
  117: { name: "Pinprick Constellation" },
  118: { name: "Pall-Torch Necropolis" },
  119: { name: "Shrouded Apex" },
  120: { name: "Hollow Witch Queen", enemies: [WITCH_QUEEN], soloBoss: true },

  // ----- Sub-tier H: Salt-Choked Reaches (F121-F130) -----
  121: { name: "Saltveil Approach" },
  122: { name: "Murmur Tide" },
  123: { name: "Ferric Lagoons" },
  124: { name: "Brackish Library" },
  125: { name: "Salt-Pillar Cathedral" },
  126: { name: "Drowned Concourse" },
  127: { name: "Bleached Anchorage" },
  128: { name: "Cured Ossuary" },
  129: { name: "Reach Eternal" },
  130: { name: "Aspect of the Dragon Lord", enemies: [DRAGON_LORD], soloBoss: true },

  // ----- Sub-tier I: Brimstone Choir (F131-F140) -----
  131: { name: "Brimstone Antechamber" },
  132: { name: "Black-Lung Foundry" },
  133: { name: "Forge of Sighs" },
  134: { name: "Pyremarch" },
  135: { name: "Vault of Smoldered Vows" },
  136: { name: "Caustic Aviary" },
  137: { name: "Slag-Throat Gully" },
  138: { name: "Cinderscar Tower" },
  139: { name: "Brim-Vault" },
  140: { name: "Black Tower God", enemies: [TOWER_GOD], soloBoss: true },

  // ----- Sub-tier J: Black Aurora (F141-F150) -----
  141: { name: "Twilight Filaments" },
  142: { name: "Polar Reliquary" },
  143: { name: "Frost-Etched Halls" },
  144: { name: "Penumbra Galleries" },
  145: { name: "Vault of Riven Skies" },
  146: { name: "Glacial Conservatory" },
  147: { name: "Borealis Crucible" },
  148: { name: "Frozen Antiphon" },
  149: { name: "Aurora's End" },
  150: { name: "Splintered Null Hierophant", enemies: [NULL_HIEROPHANT], soloBoss: true },

  // ----- Sub-tier K: Glassbone Marches (F151-F160) -----
  151: { name: "Glass-Veil Crossing" },
  152: { name: "Splintered Lowlands" },
  153: { name: "Crystal Catacombs" },
  154: { name: "Refracted Pass" },
  155: { name: "Vault of Mirror-Bones" },
  156: { name: "Prism Reliquary" },
  157: { name: "Sand-Glass Reach" },
  158: { name: "Knife-Edge Walk" },
  159: { name: "March's Pinnacle" },
  160: { name: "Risen Untouched", enemies: [THE_UNTOUCHED], soloBoss: true },

  // ----- Sub-tier L: Hollow Heliopause (F161-F170) -----
  161: { name: "Helio-Drift Outlands" },
  162: { name: "Silent Aurora" },
  163: { name: "Sun-Cracked Wastes" },
  164: { name: "Tide-Pulled Forge" },
  165: { name: "Vault of Cooled Stars" },
  166: { name: "Empty Photosphere" },
  167: { name: "Solar-Cinder Span" },
  168: { name: "Pallid Corona" },
  169: { name: "Heliopause Threshold" },
  170: { name: "Crowned Apex Arbiter", enemies: [APEX_ARBITER], soloBoss: true },

  // ----- Sub-tier M: Crimson Solstice (F171-F180) -----
  171: { name: "Bloodwarden Approach" },
  172: { name: "Crimson Atrium" },
  173: { name: "Pulse-Lit Sepulchre" },
  174: { name: "Vein-Marbled Halls" },
  175: { name: "Vault of Last Heartbeats" },
  176: { name: "Sanguine Conservatory" },
  177: { name: "Carmine Aviary" },
  178: { name: "Solstice Crucible" },
  179: { name: "Crimson Apex" },
  180: { name: "Lord-Eternal World Ender", enemies: [WORLD_ENDER], soloBoss: true },

  // ----- Sub-tier N: Calamity's Ledger (F181-F190) -----
  181: { name: "Tally-Hall of Names" },
  182: { name: "Disaster's Anteroom" },
  183: { name: "Reckoning Furnace" },
  184: { name: "Auditor's Vault" },
  185: { name: "Vault of Unpaid Debts" },
  186: { name: "Account of Embers" },
  187: { name: "Ledger's Edge" },
  188: { name: "Numbered Sepulchre" },
  189: { name: "Calamity's Last Page" },
  190: { name: "Shade of the Stone Sentinel", enemies: [STONE_SENTINEL], soloBoss: true },

  // ----- Sub-tier O: The Wormwood Sky (F191-F200) -----
  191: { name: "Wormwood Marches" },
  192: { name: "Bitter-Star Watchtower" },
  193: { name: "Plumbago Gardens" },
  194: { name: "Soot-Steeped Vault" },
  195: { name: "Vault of Acrid Hymns" },
  196: { name: "Tannic Aviary" },
  197: { name: "Bile-Lit Foundry" },
  198: { name: "Wormwood Apex" },
  199: { name: "Sky's Last Bough" },
  200: { name: "Hollow Wraith Lord", enemies: [WRAITH_LORD], soloBoss: true },

  // ----- Sub-tier P: Verdigris Cathedrals (F201-F210) -----
  201: { name: "Verdigris Approach" },
  202: { name: "Patina Halls" },
  203: { name: "Greenflame Cloister" },
  204: { name: "Copper-Choked Reliquary" },
  205: { name: "Vault of Quiet Rust" },
  206: { name: "Oxidized Atrium" },
  207: { name: "Tarnished Vows" },
  208: { name: "Bronze-Skin Foundry" },
  209: { name: "Cathedral's Pinnacle" },
  210: { name: "Aspect of the Tower Lord", enemies: [TOWER_LORD], soloBoss: true },

  // ----- Sub-tier Q: Murmuring Wastes (F211-F220) -----
  211: { name: "Whisper-Wind Wastes" },
  212: { name: "Hollow Susurrus" },
  213: { name: "Babbling Outlands" },
  214: { name: "Echo-Marred Plains" },
  215: { name: "Vault of Endless Murmur" },
  216: { name: "Choking Concourse" },
  217: { name: "Throat-Sand Reach" },
  218: { name: "Resonant Apex" },
  219: { name: "Murmur's Final Verse" },
  220: { name: "Black Iron Behemoth", enemies: [IRON_BEHEMOTH], soloBoss: true },

  // ----- Sub-tier R: Lacuna of Stars (F221-F230) -----
  221: { name: "Star-Wound Approach" },
  222: { name: "Constellation's Gap" },
  223: { name: "Empty Asterism" },
  224: { name: "Galactic Reliquary" },
  225: { name: "Vault of Lost Suns" },
  226: { name: "Void-Lit Atrium" },
  227: { name: "Wandering Comet's Tail" },
  228: { name: "Lacuna Crucible" },
  229: { name: "Stars' Far Boundary" },
  230: { name: "Splintered Storm Lord", enemies: [STORM_LORD], soloBoss: true },

  // ----- Sub-tier S: Threadbare Eternity (F231-F240) -----
  231: { name: "Threadbare Outlands" },
  232: { name: "Hollow Loom" },
  233: { name: "Frayed Tapestry" },
  234: { name: "Moth-Eaten Vault" },
  235: { name: "Vault of Unwoven Hours" },
  236: { name: "Bobbin's Cradle" },
  237: { name: "Worn Antiphon" },
  238: { name: "Eternity Frayed" },
  239: { name: "Last Thread" },
  240: { name: "Risen Demon General", enemies: [DEMON_GENERAL], soloBoss: true },

  // ----- Sub-tier T: The Forsaken Diadem (F241-F250) -----
  241: { name: "Crown-Shed Approach" },
  242: { name: "Diadem's Hollow" },
  243: { name: "Gem-Mute Reliquary" },
  244: { name: "Toppled Coronet" },
  245: { name: "Vault of Empty Crowns" },
  246: { name: "Throneless Atrium" },
  247: { name: "Discarded Sceptre" },
  248: { name: "Forsaken Vault" },
  249: { name: "Diadem's Last Stone" },
  250: { name: "Crowned Witch Queen", enemies: [WITCH_QUEEN], soloBoss: true },

  // ----- Sub-tier U: Inkwell Conjunction (F251-F260) -----
  251: { name: "Inksoaked Approach" },
  252: { name: "Quill's Final Stroke" },
  253: { name: "Margin Wastes" },
  254: { name: "Blotted Reliquary" },
  255: { name: "Vault of Black Letters" },
  256: { name: "Manuscript Foundry" },
  257: { name: "Pen-Stricken Apex" },
  258: { name: "Glyph-Lit Sepulchre" },
  259: { name: "Inkwell's Edge" },
  260: { name: "Lord-Eternal Dragon Lord", enemies: [DRAGON_LORD], soloBoss: true },

  // ----- Sub-tier V: Frostgallows Span (F261-F270) -----
  261: { name: "Frostgallows Approach" },
  262: { name: "Icebound Scaffold" },
  263: { name: "Hangman's Frost" },
  264: { name: "Cryo-Lit Cells" },
  265: { name: "Vault of Hung Vows" },
  266: { name: "Glacier-Marrow Reach" },
  267: { name: "Rime-Locked Atrium" },
  268: { name: "Hangman's Apex" },
  269: { name: "Span's Last Plank" },
  270: { name: "Aspect of the Tower God", enemies: [TOWER_GOD], soloBoss: true },

  // ----- Sub-tier W: Bleached Constellation (F271-F280) -----
  271: { name: "Bleach-Star Approach" },
  272: { name: "Sun-Skinned Halls" },
  273: { name: "Bone-Light Cathedral" },
  274: { name: "Faded Asterism" },
  275: { name: "Vault of Pallid Stars" },
  276: { name: "Ashen Heliosphere" },
  277: { name: "Marrow-Sky Span" },
  278: { name: "Bleach Antiphon" },
  279: { name: "Constellation's End" },
  280: { name: "Black Null Hierophant", enemies: [NULL_HIEROPHANT], soloBoss: true },

  // ----- Sub-tier X: Spire of Last Hours (F281-F290) -----
  281: { name: "Lasthour Approach" },
  282: { name: "Clock-Choked Atrium" },
  283: { name: "Cog-Strewn Reliquary" },
  284: { name: "Pendulum's Stop" },
  285: { name: "Vault of Final Minutes" },
  286: { name: "Hourless Aviary" },
  287: { name: "Timepiece Cathedral" },
  288: { name: "Sundial's Shadow" },
  289: { name: "Spire's Crown" },
  290: { name: "Splintered Untouched", enemies: [THE_UNTOUCHED], soloBoss: true },

  // ----- Sub-tier Y: The Mute Choir (F291-F300) -----
  291: { name: "Voiceless Approach" },
  292: { name: "Throat-Sewn Halls" },
  293: { name: "Hush-Stoppered Cloister" },
  294: { name: "Tongueless Reliquary" },
  295: { name: "Vault of Silent Vows" },
  296: { name: "Whispermute Atrium" },
  297: { name: "Mum-Stitched Apex" },
  298: { name: "Choirless Aviary" },
  299: { name: "Mute's Last Note" },
  300: { name: "Risen Apex Arbiter", enemies: [APEX_ARBITER], soloBoss: true },

  // ----- Sub-tier Z: Annihilation Causeway (F301-F310) -----
  301: { name: "Causeway's Mouth" },
  302: { name: "Annulled Galleries" },
  303: { name: "Erased Reliquary" },
  304: { name: "Voiding March" },
  305: { name: "Vault of Forgotten Names" },
  306: { name: "Annihilator's Atrium" },
  307: { name: "Unmade Concourse" },
  308: { name: "Causeway's Edge" },
  309: { name: "Annihilation Apex" },
  310: { name: "Crowned World Ender", enemies: [WORLD_ENDER], soloBoss: true },

  // ----- Sub-tier AA: Pall of the Outer Worlds (F311-F320) -----
  311: { name: "Outer-Pall Approach" },
  312: { name: "Hollowed Exosphere" },
  313: { name: "Distant-Sun Sepulchre" },
  314: { name: "Vacuum Garden" },
  315: { name: "Vault of Forgotten Worlds" },
  316: { name: "Outer Cloister" },
  317: { name: "Pall-Wreathed Apex" },
  318: { name: "Far-Sky Atrium" },
  319: { name: "Outerworlds' Edge" },
  320: { name: "Bleached Stone Sentinel", enemies: [STONE_SENTINEL], soloBoss: true },

  // ----- Sub-tier BB: Carrion Eclipse (F321-F330) -----
  321: { name: "Carrion Approach" },
  322: { name: "Vulture's Hall" },
  323: { name: "Marrow-Sown Reliquary" },
  324: { name: "Eclipse-Lit Mausoleum" },
  325: { name: "Vault of Half-Light" },
  326: { name: "Carrion Atrium" },
  327: { name: "Eclipsed Aviary" },
  328: { name: "Carrion Apex" },
  329: { name: "Last Eclipse" },
  330: { name: "Shade of the Tower Lord", enemies: [TOWER_LORD], soloBoss: true },

  // ----- Sub-tier CC: Furnace of Names (F331-F340) -----
  331: { name: "Furnace Approach" },
  332: { name: "Letter-Forged Halls" },
  333: { name: "Brand-Lit Reliquary" },
  334: { name: "Sigil Crucible" },
  335: { name: "Vault of Smelted Titles" },
  336: { name: "Names-on-Coals" },
  337: { name: "Forged Identity" },
  338: { name: "Furnace Apex" },
  339: { name: "Names' Last Spark" },
  340: { name: "Aspect of the Iron Behemoth", enemies: [IRON_BEHEMOTH], soloBoss: true },

  // ----- Sub-tier DD: Sundered Antiphon (F341-F350) -----
  341: { name: "Sundered Approach" },
  342: { name: "Hymn-Cleaved Halls" },
  343: { name: "Split-Voice Cathedral" },
  344: { name: "Riven Choir" },
  345: { name: "Vault of Broken Hymns" },
  346: { name: "Cracked Antiphon" },
  347: { name: "Cleft Cloister" },
  348: { name: "Halved Apex" },
  349: { name: "Sundered Verse" },
  350: { name: "Hollow Storm Lord", enemies: [STORM_LORD], soloBoss: true },

  // ----- Sub-tier EE: Crucible Beneath (F351-F360) -----
  351: { name: "Crucible's Mouth" },
  352: { name: "Submerged Forge" },
  353: { name: "Beneath-Halls" },
  354: { name: "Crucible's Core" },
  355: { name: "Vault of Re-Melted Vows" },
  356: { name: "Subterrane Atrium" },
  357: { name: "Below-Light Cathedral" },
  358: { name: "Crucible Apex" },
  359: { name: "Beneath's Edge" },
  360: { name: "Black Demon General", enemies: [DEMON_GENERAL], soloBoss: true },

  // ----- Sub-tier FF: Mourner's Lattice (F361-F370) -----
  361: { name: "Mourner's Approach" },
  362: { name: "Crepe-Hung Halls" },
  363: { name: "Wake-Lit Cathedral" },
  364: { name: "Lattice of Tears" },
  365: { name: "Vault of Last Goodbyes" },
  366: { name: "Mourner's Atrium" },
  367: { name: "Veil-Strewn Aviary" },
  368: { name: "Lattice Apex" },
  369: { name: "Mourner's Final Knell" },
  370: { name: "Splintered Witch Queen", enemies: [WITCH_QUEEN], soloBoss: true },

  // ----- Sub-tier GG: Ashen Apex (F371-F380) -----
  371: { name: "Ash-Wreath Approach" },
  372: { name: "Soot-Sworn Halls" },
  373: { name: "Cinder-Lit Cathedral" },
  374: { name: "Ember Reliquary" },
  375: { name: "Vault of Cold Ash" },
  376: { name: "Ashen Atrium" },
  377: { name: "Cinder Apex" },
  378: { name: "Soot-Wreathed Cloister" },
  379: { name: "Apex's Final Ember" },
  380: { name: "Risen Dragon Lord", enemies: [DRAGON_LORD], soloBoss: true },

  // ----- Sub-tier HH: The Severed Hour (F381-F390) -----
  381: { name: "Hourless Approach" },
  382: { name: "Time-Sundered Halls" },
  383: { name: "Severed Pendulum" },
  384: { name: "Cleft Sundial" },
  385: { name: "Vault of Severed Time" },
  386: { name: "Hour-Sewn Cathedral" },
  387: { name: "Stopped-Clock Atrium" },
  388: { name: "Severed Apex" },
  389: { name: "Hour's Last Tick" },
  390: { name: "Crowned Tower God", enemies: [TOWER_GOD], soloBoss: true },

  // ----- Sub-tier II: Cradle of Cinders (F391-F400) -----
  391: { name: "Cradle Approach" },
  392: { name: "Cinder-Nursery" },
  393: { name: "Ash-Lullaby Halls" },
  394: { name: "Smoldering Cradle" },
  395: { name: "Vault of Young Embers" },
  396: { name: "Hearth-Crucible" },
  397: { name: "Cradle Cathedral" },
  398: { name: "Cradle's Apex" },
  399: { name: "Cradle's Last Spark" },
  400: { name: "Lord-Eternal Null Hierophant", enemies: [NULL_HIEROPHANT], soloBoss: true },

  // ----- Sub-tier JJ: Unwritten Wastes (F401-F410) -----
  401: { name: "Margins Beyond" },
  402: { name: "Unscribed Halls" },
  403: { name: "Blank Reliquary" },
  404: { name: "Page-Stripped Atrium" },
  405: { name: "Vault of Unwritten Names" },
  406: { name: "Margin-Walk" },
  407: { name: "Unbound Apex" },
  408: { name: "Blankspace Cathedral" },
  409: { name: "Margin's Edge" },
  410: { name: "Bleached Untouched", enemies: [THE_UNTOUCHED], soloBoss: true },

  // ----- Sub-tier KK: Mirage Ossuary (F411-F420) -----
  411: { name: "Mirage Approach" },
  412: { name: "Glimmering Bone-Halls" },
  413: { name: "Illusion's Reliquary" },
  414: { name: "Heat-Shimmer Ossuary" },
  415: { name: "Vault of False Skulls" },
  416: { name: "Wavering Atrium" },
  417: { name: "Mirage Cathedral" },
  418: { name: "Ossuary Apex" },
  419: { name: "Mirage's Edge" },
  420: { name: "Shade of the Apex Arbiter", enemies: [APEX_ARBITER], soloBoss: true },

  // ----- Sub-tier LL: Choirless Reach (F421-F430) -----
  421: { name: "Hushed Approach" },
  422: { name: "Silent Pulpit" },
  423: { name: "Songless Cathedral" },
  424: { name: "Reach of Mute Tongues" },
  425: { name: "Vault of Unsung Hymns" },
  426: { name: "Hushed Aviary" },
  427: { name: "Choirless Atrium" },
  428: { name: "Reach's Apex" },
  429: { name: "Voice's Final End" },
  430: { name: "Aspect of the World Ender", enemies: [WORLD_ENDER], soloBoss: true },

  // ----- Sub-tier MM: The Bleak Conjugation (F431-F440) -----
  431: { name: "Bleak Conjugation Pass" },
  432: { name: "Verb-Stripped Halls" },
  433: { name: "Tense-Locked Reliquary" },
  434: { name: "Syntax of Sorrow" },
  435: { name: "Vault of Failed Tenses" },
  436: { name: "Bleak Atrium" },
  437: { name: "Conjugation Apex" },
  438: { name: "Grammar's End" },
  439: { name: "Bleak Last Word" },
  440: { name: "Hollow Stone Sentinel", enemies: [STONE_SENTINEL], soloBoss: true },

  // ----- Sub-tier NN: Threshold of Unbecoming (F441-F450) -----
  441: { name: "Unbecoming Approach" },
  442: { name: "Reverse Halls" },
  443: { name: "Undone Reliquary" },
  444: { name: "Negation Atrium" },
  445: { name: "Vault of Backward Years" },
  446: { name: "Unmaking Cathedral" },
  447: { name: "Reverse Aviary" },
  448: { name: "Threshold Apex" },
  449: { name: "Unbecoming's Edge" },
  450: { name: "Black Wraith Lord", enemies: [WRAITH_LORD], soloBoss: true },

  // ----- Sub-tier OO: Nullspire Approach (F451-F460) -----
  451: { name: "Null-Edge Causeway" },
  452: { name: "Zero-Sworn Halls" },
  453: { name: "Voided Reliquary" },
  454: { name: "Cipher Atrium" },
  455: { name: "Vault of Empty Sigils" },
  456: { name: "Nullspire Cathedral" },
  457: { name: "Zero Crucible" },
  458: { name: "Cipher Apex" },
  459: { name: "Nullspire's Crown" },
  460: { name: "Splintered Tower Lord", enemies: [TOWER_LORD], soloBoss: true },

  // ----- Sub-tier PP: Catechism of Voids (F461-F470) -----
  461: { name: "Catechist's Approach" },
  462: { name: "Question-Hollow Halls" },
  463: { name: "Answerless Pulpit" },
  464: { name: "Doctrine of Nothing" },
  465: { name: "Vault of Blank Creeds" },
  466: { name: "Catechism Atrium" },
  467: { name: "Voided Recitation" },
  468: { name: "Catechism Apex" },
  469: { name: "Last Article of Void" },
  470: { name: "Risen Iron Behemoth", enemies: [IRON_BEHEMOTH], soloBoss: true },

  // ----- Sub-tier QQ: Final Rite (F471-F480) -----
  471: { name: "Rite's Approach" },
  472: { name: "Final-Vow Halls" },
  473: { name: "Censer-Strewn Reliquary" },
  474: { name: "Sacrament's End" },
  475: { name: "Vault of Last Sacraments" },
  476: { name: "Rite's Atrium" },
  477: { name: "Final Recitation" },
  478: { name: "Rite Apex" },
  479: { name: "Sacrament's Last Smoke" },
  480: { name: "Crowned Storm Lord", enemies: [STORM_LORD], soloBoss: true },

  // ----- Sub-tier RR: The Long Silence (F481-F490) -----
  481: { name: "Quietened Causeway" },
  482: { name: "Hushlands" },
  483: { name: "Whisperless Cathedral" },
  484: { name: "Tongueless Reach" },
  485: { name: "Vault of Final Silence" },
  486: { name: "Soundless Atrium" },
  487: { name: "Wordless Apex" },
  488: { name: "Lull-Lit Aviary" },
  489: { name: "Silence's Edge" },
  490: { name: "Lord-Eternal Demon General", enemies: [DEMON_GENERAL], soloBoss: true },

  // ----- Sub-tier SS: Beyond the Last Door (F491-F500) -----
  491: { name: "Last Door's Approach" },
  492: { name: "Hingeless Halls" },
  493: { name: "Threshold Reliquary" },
  494: { name: "Doorless Atrium" },
  495: { name: "Vault of Final Egress" },
  496: { name: "Beyond-Cathedral" },
  497: { name: "Last Door's Crown" },
  498: { name: "Egress Apex" },
  499: { name: "The Door That Closes" },
  500: { name: "Echo of Echoes", enemies: [WORLD_ENDER], soloBoss: true },
};

function generatePostGameFloors(): StageEnemyDef[] {
  // Enemy pools to roll from. Mid-mobs are the bread-and-butter; late-mobs
  // add elite flavor at every 5th floor; bosses cycle through the solo-boss
  // roster (varied enough to keep things from feeling stale).
  const midMobs: UnitTemplate[] = [
    DARK_KNIGHT, BERSERKER, NIGHT_HAG, LICH, GARGOYLE, DEMON_HOUND,
    ELITE_WRAITH, SKELETON_KNIGHT, HEXER, PLAGUE_BEARER, JINX, GRAVELOCK,
    ARCHON, CANTOR, CLERIC,
  ];
  const lateMobs: UnitTemplate[] = [
    NULL_GUARDIAN, VOID_KNIGHT, SPECTRE, STORMCALLER, AIR_DANCER,
    FLOATING_EYE, BULWARK_BEAR, SPIKED_SHELL, SHIELD_PRIEST, WARDING_PALADIN,
    WRAITH_HEXER, STORM_ORACLE, DUST_DJINN, MIRROR_SPRITE, HUSK_TITAN, CARAPACE_MATRON,
  ];
  const bossRoster: UnitTemplate[] = [
    STONE_SENTINEL, WRAITH_LORD, TOWER_LORD, IRON_BEHEMOTH, STORM_LORD,
    DEMON_GENERAL, WITCH_QUEEN, DRAGON_LORD, TOWER_GOD,
    NULL_HIEROPHANT, THE_UNTOUCHED, APEX_ARBITER, WORLD_ENDER,
  ];

  // Deterministic pick: hash(floorId, salt) % pool.length. xorshift-ish so
  // adjacent floors don't pick the same template. Stable across deploys.
  const pick = <T,>(pool: T[], floorId: number, salt: number): T => {
    let h = (floorId * 2654435761) ^ (salt * 1597334677);
    h = (h ^ (h >>> 13)) >>> 0;
    return pool[h % pool.length];
  };

  const floors: StageEnemyDef[] = [];
  for (let id = POST_GAME_FIRST_FLOOR; id <= POST_GAME_LAST_FLOOR; id++) {
    const isBoss = id % 10 === 0;
    const isElite = !isBoss && id % 5 === 0;
    let enemies: UnitTemplate[];
    let name: string;
    let soloBoss = false;
    if (isBoss) {
      const b = pick(bossRoster, id, 1);
      enemies = [b];
      name = `Echo of ${b.name} (F${id})`;
      soloBoss = true;
    } else if (isElite) {
      enemies = [
        pick(lateMobs, id, 1),
        pick(midMobs, id, 2),
        pick(midMobs, id, 3),
        pick(lateMobs, id, 4),
      ];
      name = `Elite Vault (F${id})`;
    } else {
      const lateWeight = (id - POST_GAME_FIRST_FLOOR) / (POST_GAME_LAST_FLOOR - POST_GAME_FIRST_FLOOR);
      enemies = [1, 2, 3].map(slot => {
        const useLate = (((id * 2654435761) ^ (slot * 1597334677)) >>> 0) / 0xffffffff < lateWeight;
        return pick(useLate ? lateMobs : midMobs, id, slot * 7 + 11);
      });
      name = `Post-Game F${id}`;
    }
    // Hand-authored override (F51-F100 today). Name always wins; enemies +
    // soloBoss win when the override supplies them — otherwise we keep the
    // procedural pick so just adding a `name:` line is enough to rename a
    // floor without redoing its enemy composition.
    const override = FLOOR_OVERRIDES_51_100[id];
    if (override) {
      name = override.name;
      if (override.enemies) enemies = override.enemies;
      if (override.soloBoss !== undefined) soloBoss = override.soloBoss;
    }
    floors.push({ id, name, enemies, soloBoss: soloBoss || undefined });
  }
  return floors;
}

export const STAGE_DEFS: StageEnemyDef[] = [
  { id: 1, name: "Slime Den", enemies: STAGE_1_ENEMIES },
  { id: 2, name: "Wolf Pack", enemies: [WOLF, WOLF, WOLF, WOLF, WOLF] },
  { id: 3, name: "Stone Sentinel", enemies: [STONE_SENTINEL], soloBoss: true },
  { id: 4, name: "Bandit Camp", enemies: [BANDIT, BANDIT, BANDIT, BANDIT, ACOLYTE] },
  { id: 5, name: "Cursed Crypt", enemies: [SKELETON, SKELETON, SKELETON, WRAITH, WRAITH] },
  { id: 6, name: "Wraith Lord", enemies: [WRAITH_LORD], soloBoss: true },
  { id: 7, name: "Howling Hollow", enemies: [WOLF, WOLF, WOLF, WOLF, ACOLYTE, ACOLYTE] },
  { id: 8, name: "Bone Cathedral", enemies: [SKELETON_KNIGHT, SKELETON_KNIGHT, WRAITH, WRAITH, WRAITH] },
  { id: 9, name: "Throne Approach", enemies: [SKELETON_KNIGHT, ELITE_WRAITH, ELITE_WRAITH, ACOLYTE, BANDIT, WRAITH] },
  { id: 10, name: "Tower Lord", enemies: [TOWER_LORD], soloBoss: true },

  // ----- Tier 2: Floors 11-20 -----
  { id: 11, name: "Splintered Vault", enemies: [SKELETON_KNIGHT, SKELETON_KNIGHT, ELITE_WRAITH, BANDIT, ACOLYTE] },
  { id: 12, name: "Choir of Halos", enemies: [CLERIC, CANTOR, ARCHON, CLERIC] },
  { id: 13, name: "The Hex Pit", enemies: [HEXER, PLAGUE_BEARER, JINX, GRAVELOCK, HEXER] },
  { id: 14, name: "Iron Behemoth", enemies: [IRON_BEHEMOTH], soloBoss: true },
  { id: 15, name: "Black Phalanx", enemies: [DARK_KNIGHT, DARK_KNIGHT, DARK_KNIGHT, GRAVELOCK] },
  { id: 16, name: "Pale Sanctum", enemies: [LICH, ACOLYTE, ACOLYTE, ELITE_WRAITH, ELITE_WRAITH] },
  { id: 17, name: "Storm Lord", enemies: [STORM_LORD], soloBoss: true },
  { id: 18, name: "Statue Garden", enemies: [GARGOYLE, GARGOYLE, GARGOYLE, ARCHON] },
  { id: 19, name: "Witching Hour", enemies: [NIGHT_HAG, JINX, JINX, HEXER, PLAGUE_BEARER] },
  { id: 20, name: "Demon General", enemies: [DEMON_GENERAL], soloBoss: true },

  // ----- Tier 3: Floors 21-30 -----
  { id: 21, name: "Hounds of the Pit", enemies: [DEMON_HOUND, DEMON_HOUND, DEMON_HOUND, BERSERKER] },
  { id: 22, name: "Mirror of Sorrows", enemies: [BERSERKER, NIGHT_HAG, LICH, GARGOYLE] },
  { id: 23, name: "Witch Queen", enemies: [WITCH_QUEEN], soloBoss: true },
  { id: 24, name: "Crucible", enemies: [DARK_KNIGHT, DEMON_HOUND, NIGHT_HAG, PLAGUE_BEARER, GRAVELOCK, HEXER] },
  { id: 25, name: "Inner Sanctum", enemies: [LICH, LICH, ARCHON, CLERIC, CANTOR] },
  { id: 26, name: "Dragon Lord", enemies: [DRAGON_LORD], soloBoss: true },
  { id: 27, name: "The Long Walk", enemies: [DEMON_HOUND, DEMON_HOUND, DARK_KNIGHT, DARK_KNIGHT, BERSERKER] },
  { id: 28, name: "Twilight Spire", enemies: [NIGHT_HAG, NIGHT_HAG, LICH, GARGOYLE, GARGOYLE] },
  { id: 29, name: "Final Approach", enemies: [DEMON_GENERAL, WITCH_QUEEN] },
  { id: 30, name: "Tower God", enemies: [TOWER_GOD], soloBoss: true },

  // ----- Tier 4: Floors 31-40 — anti-X gauntlet -----
  // Each floor punishes a single damage profile: bring a balanced party.
  { id: 31, name: "Silent Reliquary", enemies: [NULL_GUARDIAN, NULL_GUARDIAN, NULL_GUARDIAN, VOID_KNIGHT] },              // anti-magic mob 1
  { id: 32, name: "Mage-Eater Hall", enemies: [VOID_KNIGHT, VOID_KNIGHT, NULL_GUARDIAN, GARGOYLE] },                       // anti-magic mob 2
  { id: 33, name: "Veil of Mist", enemies: [SPECTRE, SPECTRE, SPECTRE, STORMCALLER] },                                     // anti-physical mob 1
  { id: 34, name: "Skybreaker Roost", enemies: [STORMCALLER, STORMCALLER, SPECTRE, ELITE_WRAITH] },                        // anti-physical mob 2
  { id: 35, name: "Wind Garden", enemies: [AIR_DANCER, AIR_DANCER, AIR_DANCER, FLOATING_EYE] },                            // anti-melee mob 1
  { id: 36, name: "Hovering Watch", enemies: [FLOATING_EYE, FLOATING_EYE, AIR_DANCER, AIR_DANCER] },                       // anti-melee mob 2
  { id: 37, name: "Hide & Hide", enemies: [BULWARK_BEAR, BULWARK_BEAR, SPIKED_SHELL, SPIKED_SHELL] },                      // anti-range mob 1
  { id: 38, name: "Shellwall", enemies: [SPIKED_SHELL, SPIKED_SHELL, SPIKED_SHELL, BULWARK_BEAR] },                         // anti-range mob 2
  { id: 39, name: "Null Hierophant", enemies: [NULL_HIEROPHANT], soloBoss: true },                                          // anti-magic boss
  { id: 40, name: "The Untouched", enemies: [THE_UNTOUCHED], soloBoss: true },                                              // anti-physical boss

  // ----- Tier 5: Floors 41-50 — resist + buff/debuff combos -----
  { id: 41, name: "Bastion of Halos", enemies: [SHIELD_PRIEST, WARDING_PALADIN, WARDING_PALADIN, SHIELD_PRIEST] },         // anti-magic, heals + def buffs
  { id: 42, name: "Hexed Citadel", enemies: [SHIELD_PRIEST, WRAITH_HEXER, WARDING_PALADIN, WRAITH_HEXER] },                // anti-magic + DoT debuffers
  { id: 43, name: "Phantom Court", enemies: [WRAITH_HEXER, STORM_ORACLE, WRAITH_HEXER, STORM_ORACLE] },                    // anti-physical debuffers (freeze + DoT)
  { id: 44, name: "Eye of the Storm", enemies: [STORM_ORACLE, STORM_ORACLE, SHIELD_PRIEST, MIRROR_SPRITE] },               // anti-physical + regen support
  { id: 45, name: "Apex Arbiter", enemies: [APEX_ARBITER], soloBoss: true },                                                // dual-resist boss with silences
  { id: 46, name: "Whispering Veil", enemies: [DUST_DJINN, DUST_DJINN, MIRROR_SPRITE, MIRROR_SPRITE] },                    // anti-melee, confuse + heals
  { id: 47, name: "Hall of Echoes", enemies: [MIRROR_SPRITE, MIRROR_SPRITE, WRAITH_HEXER, DUST_DJINN, DUST_DJINN] },       // anti-melee + debuff swarm
  { id: 48, name: "Carapace Bastion", enemies: [HUSK_TITAN, HUSK_TITAN, CARAPACE_MATRON, CARAPACE_MATRON] },               // anti-range, stun + ally def-buff
  { id: 49, name: "Last Wall", enemies: [HUSK_TITAN, CARAPACE_MATRON, WRAITH_HEXER, WARDING_PALADIN] },                    // anti-range with mixed harassment
  { id: 50, name: "World Ender", enemies: [WORLD_ENDER], soloBoss: true },                                                  // capstone boss
  ...generatePostGameFloors(),
];

export function getStage(id: number): StageEnemyDef | null {
  return STAGE_DEFS.find(s => s.id === id) ?? null;
}

// Boss-only floor list, in order. Used by the Boss Raid game mode.
export const BOSS_RAID_FLOORS: StageEnemyDef[] = STAGE_DEFS.filter(s => s.soloBoss === true);
