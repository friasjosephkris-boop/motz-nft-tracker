const UNIT_ART_IDS = new Set([
  "soda", "ego", "gruyere", "calypso", "calico", "nova", "hera", "aspen", "oge", "shego",
]);
/** Override the default `.webp` extension per unit id. Add here if an asset
 *  is uploaded as something other than .webp. All unit art is currently WebP,
 *  so this is empty. */
const UNIT_ART_EXT: Record<string, string> = {};

/** Player units that require holding the MoTZ Vault Key to use. */
export const MOTZ_KEY_LOCKED_UNITS = new Set(["hera", "nova", "oge", "shego"]);

import { getVerifiedPerks } from "../auth/session";

/** True if this unit is currently locked behind a perk the player doesn't have. */
export function isUnitLocked(unitId: string): boolean {
  if (!MOTZ_KEY_LOCKED_UNITS.has(unitId)) return false;
  return !getVerifiedPerks().motzKey;
}
const CLASS_CAPE_IDS = new Set([
  "fighter", "fire_mage", "water_mage", "sharpshooter", "scout", "defender", "warden",
]);

// Enemy art is dropped under /public/tiles. Keys are roster template ids;
// values are the exact filenames on disk (spaces preserved, original case).
// Add a new line here whenever a new tile is added.
const ENEMY_TILE_FILES: Record<string, string> = {
  slime: "slime.webp",
  slime_king: "slime king.webp",
  wolf: "wolf.webp",
  bandit: "bandit.webp",
  acolyte: "acolyte.webp",
  skeleton: "Skeleton.webp",
  wraith: "Wraith.webp",
  skeleton_knight: "Skeleton knight.webp",
  elite_wraith: "Elite Wraith.webp",
  cleric: "Cleric.webp",
  cantor: "Cantor.webp",
  archon: "Archon.webp",
  hexer: "Hexer.webp",
  plague_bearer: "plague bearer.webp",
  jinx: "Jinx.webp",
  gravelock: "Gravelock.webp",
  dark_knight: "Dark knight.webp",
  lich: "lich.webp",
  berserker: "Berserker.webp",
  night_hag: "night hag.webp",
  gargoyle: "Gargoyle.webp",
  demon_hound: "Demon hound.webp",
  stone_sentinel: "Stone Sentinel.webp",
  wraith_lord: "Wraith Lord.webp",
  tower_lord: "Tower Lord.webp",
  iron_behemoth: "Iron Behemoth.webp",
  storm_lord: "Storm Lord.webp",
  demon_general: "Demon General.webp",
  witch_queen: "Witch Queen.webp",
  dragon_lord: "Dragon Lord.webp",
  tower_god: "Tower God.webp",
  null_guardian: "Null Guardian.webp",
  void_knight: "Void knight.webp",
  spectre: "Spectre.webp",
  stormcaller: "Storm Caller.webp",
  air_dancer: "Air Dancer.webp",
  floating_eye: "Floating eye.webp",
  bulwark_bear: "Bulwark Bear.webp",
  spiked_shell: "Spiked Shell.webp",
  null_hierophant: "Null Hierophant.webp",
  the_untouched: "The Untouched.webp",
  shield_priest: "Shield Priest.webp",
  warding_paladin: "Warding Paladin.webp",
  wraith_hexer: "Wraith Hexer.webp",
  storm_oracle: "Storm Oracle.webp",
  dust_djinn: "Dust Djinn.webp",
  mirror_sprite: "Mirror Sprite.webp",
  husk_titan: "Husk Titan.webp",
  carapace_matron: "Carapace Matron.webp",
  apex_arbiter: "Apex Arbiter.webp",
  world_ender: "World Ender.webp",
};

export function unitArtUrl(unitId: string): string | null {
  if (UNIT_ART_IDS.has(unitId)) {
    const ext = UNIT_ART_EXT[unitId] ?? "webp";
    return `/units/${unitId}.${ext}`;
  }
  const tile = ENEMY_TILE_FILES[unitId];
  if (tile) return `/tiles/${encodeURIComponent(tile)}`;
  return null;
}

export function classCapeUrl(classId: string | undefined): string | null {
  return classId && CLASS_CAPE_IDS.has(classId) ? `/capes/${classId}.webp` : null;
}

/** Returns either an <img> tag for units with art, or the emoji fallback. */
export function portraitInner(unitId: string, emojiFallback: string): string {
  const url = unitArtUrl(unitId);
  return url
    ? `<img class="portrait-art" src="${url}" alt="" draggable="false" />`
    : emojiFallback;
}

/** Class-cape <img> rendered behind the portrait, or empty string if no class. */
export function capeHtml(classId: string | undefined): string {
  const url = classCapeUrl(classId);
  return url
    ? `<img class="portrait-cape" src="${url}" alt="" draggable="false" />`
    : "";
}
