import { EffectApplication } from "../core/effects";
import { StatKey } from "../core/stats";

export type SkillKind = "physical" | "magical" | "buff" | "summon";

/** Per-skill stat scaling on top of the generic phys.atk / mag.atk formula.
 *  Each entry contributes (attacker.stats[stat] * weight) to the attack stat
 *  used in the damage roll, multiplied by the skill's power. Default weight 1. */
export interface SkillScaling {
  stat: StatKey;
  weight?: number;
}

// "self" — only the attacker. "enemy" — single enemy target. "all_enemies" — every living combatant on the opposite side.
export type SkillTargeting = "self" | "enemy" | "all_enemies";

export interface FlatDamageRange {
  min: number;
  max: number;
}

export interface Skill {
  id: string;
  name: string;
  kind: SkillKind;
  targeting: SkillTargeting;
  power: number;
  mpCost: number;
  hpCost?: number;
  /** Action cooldown — after firing this skill, the unit can't reuse it until N of its own actions pass. 0 = no cooldown. */
  cooldown: number;
  /** Player level required to use this skill. Default 1. */
  unlockLevel?: number;
  /** If set, skill resolves as N consecutive damage rolls against the target. */
  multiHit?: number;
  description: string;
  /** Used to pick the damage-popup icon: melee → sword/staff, range → bow/wizard. Default "melee". */
  range?: "melee" | "range";
  flatDamage?: FlatDamageRange;
  summon?: { templateId: string; count: number };
  // legacy-ish flags kept for the existing Slime skills + future hooks.
  noDistancePenalty?: boolean;
  customGaugeMul?: number;
  /** Status effects applied on hit. For "self"/"all_self" target the effect is
   *  applied to the caster. For "enemy"/"all_enemies" the effect is applied to
   *  each damaged target. */
  applies?: EffectApplication[];
  /** Effects applied to the caster regardless of damage (e.g., self buffs from buff skills). */
  selfApplies?: EffectApplication[];
  /** Adds (stat × weight × power) to the damage formula for damaging skills. */
  scalesWith?: SkillScaling[];
  /** Divisor for buff power scaling from stats. Default 200 (see combat.ts).
   *  Set higher (e.g. 300) for skills whose buff power should grow more slowly
   *  with the caster's stats — keeps Lv 30 from blowing past intended caps. */
  buffScaleDivisor?: number;
  /** When set, the skill rolls a per-target one-shot kill (0..1 chance) instead
   *  of normal damage. Used for boss "execute" skills like World Ender's
   *  "World End!" — bypasses damage formulas, resistances, shields, dmg-red. */
  instantKill?: { chance: number };
  /** Cooldown the skill starts the battle on (so it can't be used as an
   *  opener). Applied in makeCombatant. Defaults to 0 (immediately usable). */
  initialCooldown?: number;
  /** Visual effect played when this skill fires. Plays regardless of hit/miss
   *  so the player gets feedback on every use. See SkillVfxKind for the menu
   *  of styled effects. Omit to fall back to a generic hit flash. */
  vfx?: SkillVfxKind;
}

/** Catalogue of stylized skill visual effects. Each kind maps to a CSS class
 *  in styles.css (.skill-vfx-<kind>) that defines the keyframe animation.
 *  Adding a new effect: pick a kind name here, add the CSS in styles.css, and
 *  tag the relevant skills with `vfx: "<kind>"`. */
export type SkillVfxKind =
  | "slash"             // diagonal melee swipe at target (white-yellow streak)
  | "physical_impact"   // generic gray shockwave ring at target (default melee)
  | "flame_burst"       // expanding orange/red ring at target
  | "frost_burst"       // radial blue spikes at target
  | "lightning_strike"  // vertical bolt from above at target
  | "arrow_volley"      // projectile from caster to target
  | "heal_glow"         // rising green particles at target
  | "buff_aura"         // golden pulsing ring at caster
  | "holy_beam"         // vertical white-gold column at target
  | "dark_pulse"        // purple/violet expanding ring at target
  | "wind_slash";       // cyan crescent wave at target
