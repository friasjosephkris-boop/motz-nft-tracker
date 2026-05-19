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
