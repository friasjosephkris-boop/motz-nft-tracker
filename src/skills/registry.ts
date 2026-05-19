import { Skill } from "./types";

// "low/mid/high/very_high" power coefficients used by sheet skills.
const POW = { low: 1.0, mid: 1.5, high: 2.5, very_high: 3.5 } as const;

export const SKILLS: Record<string, Skill> = {
  // ---- Generic ----
  idle: {
    id: "idle", name: "Idle",
    kind: "buff", targeting: "self",
    power: 0, mpCost: 0, cooldown: 0,
    description: "Wait this action. Recovers 2% max HP and 3% max MP, and ATB gauge keeps 25% of full instead of resetting, so your next turn comes sooner.",
  },
  basic_attack: {
    id: "basic_attack", name: "Attack",
    kind: "physical", targeting: "enemy",
    power: 1.0, mpCost: 0, cooldown: 0,
    description: "Low single melee phys.",
  },
  guard: {
    id: "guard", name: "Guard",
    kind: "buff", targeting: "self",
    power: 0, mpCost: 0, cooldown: 0,
    description: "Halve damage taken until your next action.",
  },
  power_strike: {
    id: "power_strike", name: "Power Strike",
    kind: "physical", targeting: "enemy",
    power: 2.0, mpCost: 6, cooldown: 0,
    description: "High single melee phys.",
  },
  fireball: {
    id: "fireball", name: "Fireball",
    kind: "magical", targeting: "enemy",
    power: 1.6, mpCost: 5, cooldown: 0,
    description: "Mid single melee magical.",
  },

  // ---- Slime / Boss (post-50%-nerf) ----
  slime_goo: {
    id: "slime_goo", name: "Slime Goo",
    kind: "physical", targeting: "enemy",
    power: 0, mpCost: 0, cooldown: 0,
    description: "Low single melee phys. Sticky goo splatter (2–5 dmg).",
    flatDamage: { min: 2, max: 5 },
  },
  slime_king_goo: {
    id: "slime_king_goo", name: "Slime Goo",
    kind: "physical", targeting: "enemy",
    power: 0, mpCost: 0, cooldown: 0,
    description: "Mid single melee phys. King-sized goo splatter (8–10 dmg).",
    flatDamage: { min: 8, max: 10 },
  },
  slime_barrage: {
    id: "slime_barrage", name: "Slime Barrage",
    kind: "physical", targeting: "all_enemies",
    power: 0, mpCost: 0, cooldown: 0,
    description: "Mid AOE melee phys. Hits every player unit (10–15 dmg each).",
    flatDamage: { min: 10, max: 15 },
  },
  spawn_slimes: {
    id: "spawn_slimes", name: "Spawn Slimes",
    kind: "summon", targeting: "self",
    power: 0, mpCost: 0, hpCost: 10, cooldown: 0,
    description: "Summon 2 Slimes (only when no Slimes alive). Costs 10 HP.",
    summon: { templateId: "slime", count: 2 },
  },

  // ---- World Ender (final boss) ----
  world_end: {
    id: "world_end", name: "World End!",
    kind: "magical", targeting: "all_enemies",
    power: 0, mpCost: 80, cooldown: 10,
    description: "AOE execute — 50% chance to instantly kill each player. Bypasses defense, resists, and shields. 10-action cooldown. Starts on cooldown.",
    instantKill: { chance: 0.5 },
    initialCooldown: 10,
    vfx: "lightning_strike",
  },

  // ============================================================
  // SKILLS final — class skills (3 per class; lvl 5 + lvl 10 unlocks).
  // Status effects (confuse/burn/freeze/etc.) are NO-OPs for now;
  // descriptions preserved verbatim for future implementation.
  // Power coefficients map low/mid/high/very_high → 1.0/1.5/2.5/3.5.
  // ============================================================

  // Fighter
  impact_strike: {
    id: "impact_strike", name: "Impact Strike",
    kind: "physical", targeting: "enemy",
    power: POW.mid, mpCost: 10, cooldown: 1, unlockLevel: 1,
    description: "Mid single melee phys. 50% chance to confuse target for 2 actions.",
    applies: [{ id: "confuse", chance: 0.5, duration: 2, power: 1 }],
    scalesWith: [{ stat: "STR" }],
  },
  focus_pulse: {
    id: "focus_pulse", name: "Focus Pulse",
    kind: "buff", targeting: "self",
    power: 0, mpCost: 20, cooldown: 5, unlockLevel: 5,
    description: "+30% physical attack for 3 actions.",
    selfApplies: [{ id: "atk_buff", duration: 3, power: 0.3, target: "phys" }],
  },
  colossal_slam: {
    id: "colossal_slam", name: "Colossal Slam",
    kind: "physical", targeting: "all_enemies",
    power: POW.high, mpCost: 45, cooldown: 4, unlockLevel: 10,
    description: "High AOE melee phys (scales with STR/DEF/VIT).",
    scalesWith: [{ stat: "STR" }, { stat: "DEF" }, { stat: "VIT" }],
    vfx: "physical_impact",
  },

  // Fire Mage
  ignite_touch: {
    id: "ignite_touch", name: "Ignite Touch",
    kind: "magical", targeting: "enemy",
    power: POW.mid, mpCost: 10, cooldown: 1, unlockLevel: 1,
    description: "Mid single melee magical. 20% chance to burn (8 dmg/action × 3).",
    applies: [{ id: "burn", chance: 0.2, duration: 3, power: 8 }],
    scalesWith: [{ stat: "INT" }],
  },
  blazing_burst: {
    id: "blazing_burst", name: "Blazing Burst",
    kind: "magical", targeting: "all_enemies",
    power: POW.mid, mpCost: 30, cooldown: 3, unlockLevel: 5,
    description: "Mid AOE melee magical. 20% chance to burn each (8 dmg/action × 3).",
    applies: [{ id: "burn", chance: 0.2, duration: 3, power: 8 }],
    scalesWith: [{ stat: "INT" }],
  },
  inferno_crash: {
    id: "inferno_crash", name: "Inferno Crash",
    kind: "magical", targeting: "enemy", range: "melee",
    power: POW.very_high, mpCost: 40, cooldown: 5, unlockLevel: 10,
    description: "Very high single melee magical. Inflicts burn (12 dmg/action × 3).",
    applies: [{ id: "burn", duration: 3, power: 12 }],
    scalesWith: [{ stat: "INT" }],
    vfx: "flame_burst",
  },

  // Sharpshooter
  quick_draw: {
    id: "quick_draw", name: "Quick Draw",
    kind: "physical", targeting: "enemy", range: "range",
    power: POW.mid, mpCost: 5, cooldown: 1, unlockLevel: 1,
    description: "Mid single range phys. Self +30% ATB speed for 2 actions.",
    selfApplies: [{ id: "haste", duration: 2, power: 0.3 }],
    scalesWith: [{ stat: "DEX" }],
  },
  double_tap: {
    id: "double_tap", name: "Double Tap",
    kind: "physical", targeting: "enemy", range: "range",
    power: POW.mid, mpCost: 10, cooldown: 2, unlockLevel: 5,
    description: "2× Mid single range phys.",
    multiHit: 2,
    scalesWith: [{ stat: "DEX" }],
  },
  apex_shot: {
    id: "apex_shot", name: "Apex Shot",
    kind: "physical", targeting: "enemy", range: "range",
    power: POW.high, mpCost: 30, cooldown: 5, unlockLevel: 10,
    description: "High single range phys. Self +30% DEX for 1 action (crit + accuracy boost).",
    selfApplies: [{ id: "stat_buff", duration: 1, power: 0.3, target: "DEX" }],
    scalesWith: [{ stat: "DEX" }],
  },

  // Water Mage
  hydro_bolt: {
    id: "hydro_bolt", name: "Hydro Bolt",
    kind: "magical", targeting: "enemy", range: "range",
    power: POW.mid, mpCost: 10, cooldown: 1, unlockLevel: 1,
    description: "Mid single range magical. Freezes target (-25% ATB for 2 actions).",
    applies: [{ id: "freeze", duration: 2, power: 0.25 }],
    scalesWith: [{ stat: "INT" }],
  },
  vortex_stream: {
    id: "vortex_stream", name: "Vortex Stream",
    kind: "magical", targeting: "all_enemies", range: "range",
    power: POW.mid, mpCost: 30, cooldown: 2, unlockLevel: 5,
    description: "Mid AOE range magical. 20% chance to confuse (2 actions).",
    applies: [{ id: "confuse", chance: 0.2, duration: 2, power: 1 }],
    scalesWith: [{ stat: "INT" }],
  },
  tidal_wave: {
    id: "tidal_wave", name: "Tidal Wave",
    kind: "magical", targeting: "all_enemies", range: "range",
    power: POW.high, mpCost: 60, cooldown: 6, unlockLevel: 10,
    description: "High AOE range magical. Freezes all enemies (-25% ATB for 2 actions).",
    applies: [{ id: "freeze", duration: 2, power: 0.25 }],
    scalesWith: [{ stat: "INT" }],
    vfx: "frost_burst",
  },

  // Scout
  swift_jab: {
    id: "swift_jab", name: "Swift Jab",
    kind: "physical", targeting: "enemy",
    power: POW.mid, mpCost: 5, cooldown: 1, unlockLevel: 1,
    description: "Mid single melee phys. Self +50% AGI for 1 action.",
    selfApplies: [{ id: "stat_buff", duration: 1, power: 0.5, target: "AGI" }],
    scalesWith: [{ stat: "AGI" }],
  },
  shadow_step: {
    id: "shadow_step", name: "Shadow Step",
    kind: "physical", targeting: "enemy",
    power: POW.mid, mpCost: 10, cooldown: 2, unlockLevel: 5,
    description: "Mid single melee phys. Inflicts confuse (2 actions).",
    applies: [{ id: "confuse", duration: 2, power: 1 }],
    scalesWith: [{ stat: "AGI" }],
  },
  phantom_flurry: {
    id: "phantom_flurry", name: "Phantom Flurry",
    kind: "physical", targeting: "enemy",
    power: POW.low, mpCost: 20, cooldown: 4, unlockLevel: 10,
    description: "10× low single melee phys. Each hit has 20% chance to inflict bleed.",
    multiHit: 10,
    applies: [{ id: "bleed", chance: 0.2, duration: 3, power: 0.04 }],
    scalesWith: [{ stat: "AGI" }],
    vfx: "wind_slash",
  },

  // Defender
  bash: {
    id: "bash", name: "Bash",
    kind: "physical", targeting: "enemy",
    power: POW.mid, mpCost: 10, cooldown: 1, unlockLevel: 1,
    description: "Mid single melee phys. Stuns target (skip next action).",
    applies: [{ id: "stun", duration: 1, power: 1 }],
    scalesWith: [{ stat: "STR" }],
  },
  phalanx_wall: {
    id: "phalanx_wall", name: "Phalanx Wall",
    kind: "buff", targeting: "self",
    power: 0, mpCost: 20, cooldown: 3, unlockLevel: 5,
    description: "Self +50% DEF & VIT for 3 actions.",
    selfApplies: [
      { id: "stat_buff", duration: 3, power: 0.5, target: "DEF" },
      { id: "stat_buff", duration: 3, power: 0.5, target: "VIT" },
    ],
  },
  earthshaker: {
    id: "earthshaker", name: "Earthshaker",
    kind: "physical", targeting: "all_enemies",
    power: POW.high, mpCost: 45, cooldown: 5, unlockLevel: 10,
    description: "High AOE melee phys. Stuns all enemies (skip next action).",
    applies: [{ id: "stun", duration: 1, power: 1 }],
    scalesWith: [{ stat: "STR" }, { stat: "VIT" }],
    vfx: "physical_impact",
  },

  // Warden
  binding_shot: {
    id: "binding_shot", name: "Binding Shot",
    kind: "magical", targeting: "enemy", range: "range",
    power: POW.mid, mpCost: 5, cooldown: 1, unlockLevel: 1,
    description: "Mid single range magical. Slows target (-25% ATB for 3 actions).",
    applies: [{ id: "freeze", duration: 3, power: 0.25 }],
    scalesWith: [{ stat: "INT" }],
  },
  aura_shield: {
    id: "aura_shield", name: "Aura Shield",
    kind: "buff", targeting: "self",
    power: 0, mpCost: 10, cooldown: 4, unlockLevel: 5,
    description: "Allies +50% DEF for 3 actions.",
    applies: [{ id: "stat_buff", duration: 3, power: 0.5, target: "DEF" }],
  },
  celestial_beam: {
    id: "celestial_beam", name: "Celestial Beam",
    kind: "magical", targeting: "all_enemies", range: "range",
    power: POW.high, mpCost: 30, cooldown: 5, unlockLevel: 10,
    description: "High AOE range magical (scales INT + VIT).",
    scalesWith: [{ stat: "INT" }, { stat: "VIT" }],
    vfx: "holy_beam",
  },

  // ============================================================
  // Character signature skills (3 per character; lvl 1 / 2 / 5).
  // ============================================================

  // Hera (magical)
  lightburst: {
    id: "lightburst", name: "Lightburst",
    kind: "magical", targeting: "enemy",
    power: POW.low, mpCost: 2, cooldown: 1, unlockLevel: 1,
    description: "Low single melee magical (scales m.atk + INT).",
    scalesWith: [{ stat: "INT" }],
  },
  radiant_punch: {
    id: "radiant_punch", name: "Radiant Punch",
    kind: "magical", targeting: "all_enemies",
    power: POW.mid, mpCost: 25, cooldown: 2, unlockLevel: 2,
    description: "Mid AOE melee magical. 20% chance to blind (-20% hit) for 2 actions.",
    applies: [{ id: "blind", chance: 0.2, duration: 2, power: 0.2 }],
    scalesWith: [{ stat: "INT" }],
  },
  solar_flare: {
    id: "solar_flare", name: "Solar Flare",
    kind: "magical", targeting: "all_enemies", range: "range",
    power: POW.high, mpCost: 60, cooldown: 5, unlockLevel: 5,
    description: "High AOE range magical. 20% chance to burn (10 dmg/action × 3).",
    applies: [{ id: "burn", chance: 0.2, duration: 3, power: 10 }],
    scalesWith: [{ stat: "INT" }],
    vfx: "holy_beam",
  },

  // Aspen (physical)
  decimate: {
    id: "decimate", name: "Decimate",
    kind: "physical", targeting: "enemy",
    power: POW.low, mpCost: 0, cooldown: 1, unlockLevel: 1,
    description: "Low single melee phys (scales p.atk + STR + VIT).",
    scalesWith: [{ stat: "STR" }, { stat: "VIT" }],
  },
  twin_slash: {
    id: "twin_slash", name: "Twin Slash",
    kind: "physical", targeting: "enemy",
    power: POW.low * 0.8, mpCost: 5, cooldown: 2, unlockLevel: 2,
    description: "2× low single melee phys (80% Decimate dmg).",
    multiHit: 2,
    scalesWith: [{ stat: "STR" }],
  },
  whirlwind_edge: {
    id: "whirlwind_edge", name: "Whirlwind Edge",
    kind: "physical", targeting: "all_enemies",
    power: POW.mid, mpCost: 15, cooldown: 4, unlockLevel: 5,
    description: "Mid AOE melee phys. Self +50% VIT & DEF for 2 actions.",
    selfApplies: [
      { id: "stat_buff", duration: 2, power: 0.5, target: "VIT" },
      { id: "stat_buff", duration: 2, power: 0.5, target: "DEF" },
    ],
    scalesWith: [{ stat: "STR" }, { stat: "VIT" }],
  },

  // Oge (tank)
  iron_bulwark: {
    id: "iron_bulwark", name: "Iron Bulwark",
    kind: "buff", targeting: "self",
    power: 0, mpCost: 0, cooldown: 1, unlockLevel: 1,
    description: "Self DEF & VIT up for 2 actions (scales with VIT/DEF).",
    selfApplies: [
      { id: "stat_buff", duration: 2, power: 0.25, target: "DEF" },
      { id: "stat_buff", duration: 2, power: 0.25, target: "VIT" },
    ],
    scalesWith: [{ stat: "VIT" }, { stat: "DEF" }],
    buffScaleDivisor: 300,
  },
  bastions_call: {
    id: "bastions_call", name: "Bastion's Call",
    kind: "buff", targeting: "self",
    power: 0, mpCost: 5, cooldown: 1, unlockLevel: 2,
    description: "Draws fire — for 2 actions, all damage to allies (including every hit of AOE) is redirected to self.",
    selfApplies: [{ id: "taunt", duration: 2, power: 1 }],
  },
  unyielding_heart: {
    id: "unyielding_heart", name: "Unyielding Heart",
    kind: "buff", targeting: "self",
    power: 0, mpCost: 20, cooldown: 6, unlockLevel: 5,
    description: "Heavy self damage reduction (cap 90%); allies phys+mag atk up for 3 actions (scales with VIT/DEF).",
    selfApplies: [{ id: "dmg_reduction", duration: 3, power: 0.8, maxPower: 0.90 }],
    applies: [
      { id: "atk_buff", duration: 3, power: 0.2, target: "phys" },
      { id: "atk_buff", duration: 3, power: 0.2, target: "mag" },
    ],
    scalesWith: [{ stat: "VIT" }, { stat: "DEF" }],
  },

  // Soda (physical / support heal)
  soda_punch: {
    id: "soda_punch", name: "Soda Punch",
    kind: "physical", targeting: "enemy",
    power: POW.low, mpCost: 0, cooldown: 1, unlockLevel: 1,
    description: "Low single melee phys (scales p.atk + AGI).",
    scalesWith: [{ stat: "AGI" }],
  },
  soda_pop: {
    id: "soda_pop", name: "Soda Pop",
    kind: "buff", targeting: "self",
    power: 0, mpCost: 10, cooldown: 3, unlockLevel: 2,
    description: "Allies heal 12 + (AGI + DEX) / 10 HP + 8% of their max HP.",
    applies: [{ id: "heal", duration: 1, power: 12, percentMaxHp: 0.08 }],
    scalesWith: [{ stat: "AGI" }, { stat: "DEX" }],
  },
  swift_echo: {
    id: "swift_echo", name: "Swift Echo",
    kind: "physical", targeting: "enemy",
    power: POW.low, mpCost: 10, cooldown: 2, unlockLevel: 5,
    description: "3× low single melee phys (scales AGI).",
    multiHit: 3,
    scalesWith: [{ stat: "AGI" }],
  },

  // Ego (physical)
  body_slam: {
    id: "body_slam", name: "Body Slam",
    kind: "physical", targeting: "enemy",
    power: POW.low, mpCost: 0, cooldown: 1, unlockLevel: 1,
    description: "Low single melee phys (scales p.atk + STR).",
    scalesWith: [{ stat: "STR" }],
  },
  limit_break: {
    id: "limit_break", name: "Limit Break",
    kind: "buff", targeting: "self",
    power: 0, mpCost: 5, cooldown: 3, unlockLevel: 2,
    description: "Self +100% phys atk, -50% DEF for 3 actions (glass-cannon mode).",
    selfApplies: [
      { id: "atk_buff", duration: 3, power: 1.0, target: "phys" },
      { id: "stat_buff", duration: 3, power: -0.5, target: "DEF" },
    ],
  },
  all_or_nothing: {
    id: "all_or_nothing", name: "All or Nothing!",
    kind: "physical", targeting: "enemy",
    power: POW.high, mpCost: 10, cooldown: 2, unlockLevel: 5,
    description: "High single melee phys; 50% chance to confuse self for 1 action.",
    selfApplies: [{ id: "confuse", chance: 0.5, duration: 1, power: 1 }],
    scalesWith: [{ stat: "STR" }],
  },

  // Gruyere (physical / debuff)
  tactical_hit: {
    id: "tactical_hit", name: "Tactical Hit",
    kind: "physical", targeting: "enemy",
    power: POW.low, mpCost: 0, cooldown: 1, unlockLevel: 1,
    description: "Low single melee phys (scales p.atk + DEX).",
    scalesWith: [{ stat: "DEX" }],
  },
  analyze_vulnerability: {
    id: "analyze_vulnerability", name: "Analyze Vulnerability",
    kind: "buff", targeting: "self",
    power: 0, mpCost: 5, cooldown: 2, unlockLevel: 2,
    description: "Allies +15% phys & mag attack for 2 actions.",
    applies: [
      { id: "atk_buff", duration: 2, power: 0.15, target: "phys" },
      { id: "atk_buff", duration: 2, power: 0.15, target: "mag" },
    ],
  },
  grandmasters_domain: {
    id: "grandmasters_domain", name: "Grandmaster's Domain",
    kind: "buff", targeting: "self",
    power: 0, mpCost: 20, cooldown: 5, unlockLevel: 5,
    description: "Allies +20% DEX & AGI for 3 actions.",
    applies: [
      { id: "stat_buff", duration: 3, power: 0.2, target: "DEX" },
      { id: "stat_buff", duration: 3, power: 0.2, target: "AGI" },
    ],
  },

  // Calypso (magical / support heal)
  siphon_pulse: {
    id: "siphon_pulse", name: "Siphon Pulse",
    kind: "magical", targeting: "enemy", range: "range",
    power: POW.low, mpCost: 0, cooldown: 1, unlockLevel: 1,
    description: "Low single range magical (scales m.atk + INT).",
    scalesWith: [{ stat: "INT" }],
  },
  tidal_mending: {
    id: "tidal_mending", name: "Tidal Mending",
    kind: "buff", targeting: "self",
    power: 0, mpCost: 5, cooldown: 2, unlockLevel: 2,
    description: "Allies heal 16 + INT / 10 HP + 10% of their max HP.",
    applies: [{ id: "heal", duration: 1, power: 16, percentMaxHp: 0.10 }],
    scalesWith: [{ stat: "INT" }],
  },
  sirens_sanctuary: {
    id: "sirens_sanctuary", name: "Siren's Sanctuary",
    kind: "buff", targeting: "self",
    power: 0, mpCost: 20, cooldown: 5, unlockLevel: 5,
    description: "Allies heal 36 + INT / 10 HP + 20% of max HP, and gain -30% damage taken for 3 actions.",
    applies: [
      { id: "heal", duration: 1, power: 36, percentMaxHp: 0.20 },
      { id: "dmg_reduction", duration: 3, power: 0.3 },
    ],
    scalesWith: [{ stat: "INT" }],
  },

  // Calico (magical / range)
  horizon_strike: {
    id: "horizon_strike", name: "Horizon Strike",
    kind: "magical", targeting: "enemy", range: "range",
    power: POW.low, mpCost: 0, cooldown: 1, unlockLevel: 1,
    description: "Low single range magical (scales m.atk + AGI + INT).",
    scalesWith: [{ stat: "AGI" }, { stat: "INT" }],
  },
  needle_shot: {
    id: "needle_shot", name: "Needle Shot",
    kind: "physical", targeting: "enemy", range: "range",
    power: POW.mid, mpCost: 5, cooldown: 2, unlockLevel: 2,
    description: "Mid single range phys. Inflicts bleed (5% max HP per action × 3).",
    applies: [{ id: "bleed", duration: 3, power: 0.05 }],
    scalesWith: [{ stat: "DEX" }],
  },
  mark_of_death: {
    id: "mark_of_death", name: "Mark of Death",
    kind: "buff", targeting: "self",
    power: 0, mpCost: 20, cooldown: 5, unlockLevel: 5,
    description: "Allies gain +20% phys & mag atk for 4 actions (mark intent).",
    applies: [
      { id: "atk_buff", duration: 4, power: 0.2, target: "phys" },
      { id: "atk_buff", duration: 4, power: 0.2, target: "mag" },
    ],
  },

  // Nova (magical)
  water_bolt: {
    id: "water_bolt", name: "Water Bolt",
    kind: "magical", targeting: "enemy", range: "range",
    power: POW.low, mpCost: 5, cooldown: 1, unlockLevel: 1,
    description: "Low single range magical (scales m.atk + INT).",
    scalesWith: [{ stat: "INT" }],
  },
  frost_bite: {
    id: "frost_bite", name: "Frost Bite",
    kind: "magical", targeting: "all_enemies", range: "range",
    power: POW.mid, mpCost: 25, cooldown: 2, unlockLevel: 2,
    description: "Mid AOE range magical. Freezes enemies (-25% ATB for 2 actions).",
    applies: [{ id: "freeze", duration: 2, power: 0.25 }],
    scalesWith: [{ stat: "INT" }],
  },
  navigators_wrath: {
    id: "navigators_wrath", name: "Navigator's Wrath",
    kind: "magical", targeting: "enemy", range: "range",
    power: POW.very_high, mpCost: 40, cooldown: 6, unlockLevel: 5,
    description: "Very High single range magical (scales m.atk + INT).",
    scalesWith: [{ stat: "INT" }],
  },

  // ---- Shego (tank / retribution caster) ----
  gaze_of_retribution: {
    id: "gaze_of_retribution", name: "Gaze of Retribution",
    kind: "buff", targeting: "self",
    power: 0, mpCost: 0, cooldown: 1, unlockLevel: 1,
    description: "Damage reduction + reflect for 2 actions (scales with VIT/DEF).",
    selfApplies: [
      { id: "dmg_reduction", duration: 2, power: 0.15 },
      { id: "damage_reflect", duration: 2, power: 0.10 },
    ],
    scalesWith: [{ stat: "VIT" }, { stat: "DEF" }],
    buffScaleDivisor: 300,
  },
  iron_prophecy: {
    id: "iron_prophecy", name: "Iron Prophecy",
    kind: "buff", targeting: "self",
    power: 0, mpCost: 5, cooldown: 1, unlockLevel: 2,
    description: "Taunt all enemies for 2 actions. Reflect scales with VIT/DEF.",
    selfApplies: [
      { id: "taunt", duration: 2, power: 1 },
      { id: "damage_reflect", duration: 2, power: 0.20 },
    ],
    scalesWith: [{ stat: "VIT" }, { stat: "DEF" }],
    buffScaleDivisor: 300,
  },
  fates_rebound: {
    id: "fates_rebound", name: "Fate's Rebound",
    kind: "buff", targeting: "self",
    power: 0, mpCost: 20, cooldown: 6, unlockLevel: 5,
    description: "Heavy damage reduction (cap 80%) + reflect (cap 70%) on self, ally atk buff (scales with VIT/DEF). 3 actions.",
    selfApplies: [
      { id: "dmg_reduction", duration: 3, power: 0.50, maxPower: 0.80 },
      { id: "damage_reflect", duration: 3, power: 0.50, maxPower: 0.70 },
    ],
    applies: [
      { id: "atk_buff", duration: 3, power: 0.25, target: "phys" },
      { id: "atk_buff", duration: 3, power: 0.25, target: "mag" },
    ],
    scalesWith: [{ stat: "VIT" }, { stat: "DEF" }],
    buffScaleDivisor: 300,
  },
};

export function getSkill(id: string): Skill {
  const s = SKILLS[id];
  if (!s) throw new Error(`Unknown skill: ${id}`);
  return s;
}

// Skills earned by class membership (looked up by class id).
export const CLASS_SKILLS: Record<string, string[]> = {
  fighter: ["impact_strike", "focus_pulse", "colossal_slam"],
  fire_mage: ["ignite_touch", "blazing_burst", "inferno_crash"],
  sharpshooter: ["quick_draw", "double_tap", "apex_shot"],
  water_mage: ["hydro_bolt", "vortex_stream", "tidal_wave"],
  scout: ["swift_jab", "shadow_step", "phantom_flurry"],
  defender: ["bash", "phalanx_wall", "earthshaker"],
  warden: ["binding_shot", "aura_shield", "celestial_beam"],
};

// Signature skills earned by character (looked up by template id).
export const CHARACTER_SKILLS: Record<string, string[]> = {
  hera: ["lightburst", "radiant_punch", "solar_flare"],
  aspen: ["decimate", "twin_slash", "whirlwind_edge"],
  oge: ["iron_bulwark", "bastions_call", "unyielding_heart"],
  soda: ["soda_punch", "soda_pop", "swift_echo"],
  ego: ["body_slam", "limit_break", "all_or_nothing"],
  gruyere: ["tactical_hit", "analyze_vulnerability", "grandmasters_domain"],
  calypso: ["siphon_pulse", "tidal_mending", "sirens_sanctuary"],
  calico: ["horizon_strike", "needle_shot", "mark_of_death"],
  nova: ["water_bolt", "frost_bite", "navigators_wrath"],
  shego: ["gaze_of_retribution", "iron_prophecy", "fates_rebound"],
};
