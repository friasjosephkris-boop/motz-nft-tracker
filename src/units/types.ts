import { Stats } from "../core/stats";

export interface UnitTemplate {
  id: string;
  name: string;
  portrait: string;
  /**
   * Unit-specific base stats (the red layer in the hex chart). Always present.
   * Effective stats at runtime = unitBaseStats + classBaseStats(classId) + customStats.
   */
  unitBaseStats: Stats;
  /** Per-level growth applied to the unit base layer on level-up. */
  unitGrowth?: Stats;
  /** Optional class assignment (available from Lv1). Adds the class's baseStats layer. */
  classId?: string;
  /** Player-allocated stat points (the yellow layer). Default zero. */
  customStats?: Stats;
  startingSkills: string[];
  /** When set, the generic "basic_attack" skill resolves with this kind for this unit (e.g. "magical" for Hera/Nova). */
  basicAttackKind?: "physical" | "magical";
  overrideMaxHp?: number;
  overrideMaxMp?: number;
  level?: number;
  xpReward?: number;
  /** Per-damage-type incoming multipliers (e.g., { magical: 0.25 } = takes 25% of magical damage).
   *  LEGACY: multiplicative across kind + range axes. Use for hand-authored
   *  single-channel resists (e.g. one boss that resists magical). */
  resist?: DamageResistance;
  /** Tiered resist (used by the floor 100-500 randomized profile). Counts
   *  how many of the attack's two axes (kind + range) land in `resisted`
   *  and applies a flat multiplier per count. Avoids the multiplicative
   *  blow-up that pushes "one viable damage type" to 91%+ effective resist. */
  resistTiered?: TieredResist;
  /** Outgoing damage multiplier (boss scaling). 1 = normal. 3 = boss hits 3x harder. */
  atkMultiplier?: number;
}

export interface DamageResistance {
  physical?: number;
  magical?: number;
  melee?: number;
  range?: number;
}

export type ResistChannel = "physical" | "magical" | "melee" | "range";

/** Count-based resist. The attacker's effKind (physical / magical) and range
 *  (melee / range) each either ARE or ARE NOT in `resisted`. We count how
 *  many match (0, 1, or 2) and pick the multiplier from `muls`. */
export interface TieredResist {
  resisted: ResistChannel[];
  muls: { none: number; one: number; both: number };
}
