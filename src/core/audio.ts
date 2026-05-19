// Tiny Web Audio synth for menu/click and combat hits, plus a single
// prerecorded WAV for crit damage. Honors loadSettings().sfxOn so all
// sounds can be muted from settings.

import { loadSettings } from "../ui/settings";

let ctx: AudioContext | null = null;
function ac(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!ctx) {
    try { ctx = new (window.AudioContext || (window as any).webkitAudioContext)(); }
    catch { ctx = null; }
  }
  return ctx;
}

function sfxAllowed(): boolean {
  try { return loadSettings().sfxOn; } catch { return true; }
}

// User-facing SFX volume (0..1). Independent from the bgm volume slider.
// Each individual sound source applies its own gain on top of this master.
const SFX_VOL_KEY = "toz.sfx.volume";
function readSfxVolume(): number {
  try {
    const raw = localStorage.getItem(SFX_VOL_KEY);
    if (raw === null) return 0.8;
    const n = Number(raw);
    return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0.8;
  } catch { return 0.8; }
}
export function getSfxVolume(): number { return readSfxVolume(); }
export function setSfxVolume(v: number): void {
  const clamped = Math.max(0, Math.min(1, v));
  try { localStorage.setItem(SFX_VOL_KEY, String(clamped)); } catch { /* ignore */ }
}

interface Tone {
  freq: number;
  type?: OscillatorType;
  durMs?: number;
  gain?: number;
  /** Frequency at end (linear glide). */
  endFreq?: number;
}

function blip(t: Tone): void {
  if (!sfxAllowed()) return;
  const a = ac();
  if (!a) return;
  const dur = (t.durMs ?? 90) / 1000;
  const o = a.createOscillator();
  const g = a.createGain();
  o.type = t.type ?? "square";
  o.frequency.setValueAtTime(t.freq, a.currentTime);
  if (t.endFreq !== undefined) {
    o.frequency.linearRampToValueAtTime(t.endFreq, a.currentTime + dur);
  }
  // Scale per-sound peak gain by the user's SFX volume slider.
  const peak = (t.gain ?? 0.08) * readSfxVolume();
  g.gain.setValueAtTime(0, a.currentTime);
  g.gain.linearRampToValueAtTime(peak, a.currentTime + 0.005);
  g.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + dur);
  o.connect(g).connect(a.destination);
  o.start();
  o.stop(a.currentTime + dur + 0.02);
}

function chord(tones: Tone[]): void {
  for (const t of tones) blip(t);
}

// ---- File-based samples (small set) ----
const SAMPLE_SRC: Record<string, string> = {
  crit: "/sfx/crit.wav",
  hitPhys: "/sfx/hit-physical.wav",
  hitMag: "/sfx/hit-magical.wav",
  castBuff: "/sfx/cast-buff.wav",
  victory: "/sfx/victory.mp3",
  swordClash: "/sfx/sword sound.m4a",
};
const sampleCache: Record<string, HTMLAudioElement> = {};
function preloadSample(key: string): void {
  if (typeof window === "undefined") return;
  if (sampleCache[key]) return;
  const src = SAMPLE_SRC[key];
  if (!src) return;
  const a = new Audio(src);
  a.preload = "auto";
  sampleCache[key] = a;
}
function playSample(key: string, gain: number, startAtSec = 0): void {
  if (!sfxAllowed()) return;
  if (typeof window === "undefined") return;
  const src = SAMPLE_SRC[key];
  if (!src) return;
  preloadSample(key);
  // Fresh Audio per call so rapid hits don't cut each other off.
  const a = new Audio(src);
  a.volume = Math.max(0, Math.min(1, gain * readSfxVolume()));
  if (startAtSec > 0) {
    // Some browsers need metadata loaded before currentTime sticks; set both
    // eagerly and again on loadedmetadata as a safety net.
    try { a.currentTime = startAtSec; } catch { /* ignore */ }
    a.addEventListener("loadedmetadata", () => {
      try { a.currentTime = startAtSec; } catch { /* ignore */ }
    }, { once: true });
  }
  a.play().catch(() => undefined);
}

// Public sounds — synth blips for everything except the crit damage WAV.
export const sfx = {
  click: () => blip({ freq: 880, type: "square", durMs: 35, gain: 0.05 }),
  hover: () => blip({ freq: 660, type: "sine", durMs: 25, gain: 0.03 }),
  physMelee: () => playSample("hitPhys", 0.22),
  physRange: () => playSample("hitPhys", 0.22),
  magMelee: () => playSample("hitMag", 0.22),
  magRange: () => playSample("hitMag", 0.22),
  castBuff: () => playSample("castBuff", 0.22),
  heal: () => chord([
    { freq: 880, endFreq: 1320, type: "sine", durMs: 160, gain: 0.07 },
    { freq: 1320, endFreq: 1760, type: "sine", durMs: 160, gain: 0.05 },
  ]),
  manaHeal: () => chord([
    { freq: 660, endFreq: 990, type: "triangle", durMs: 160, gain: 0.06 },
  ]),
  crit: () => playSample("crit", 0.32),
  miss: () => blip({ freq: 220, endFreq: 110, type: "triangle", durMs: 80, gain: 0.04 }),
  fall: () => blip({ freq: 200, endFreq: 60, type: "sawtooth", durMs: 240, gain: 0.10 }),
  victory: () => playSample("victory", 0.5),
  /** Sword-clash sound for the begin-battle transition. Plays the dedicated
   *  sword-clash sample at full volume scaled by the user's SFX slider. */
  skirmish: () => playSample("swordClash", 0.8, 2.5),
  defeat: () => chord([
    { freq: 392, type: "sawtooth", durMs: 220, gain: 0.06 },
    { freq: 311, type: "sawtooth", durMs: 320, gain: 0.07 },
  ]),
  idle: () => blip({ freq: 440, type: "sine", durMs: 50, gain: 0.04 }),

  // ---- Themed skill-cast SFX ----
  // Each one is a short synth chord designed to read as the theme without
  // requiring a sound file. Routed by playSkillCastSfx() below based on
  // keywords in the skill name.
  spellFire: () => chord([
    { freq: 220, endFreq: 110, type: "sawtooth", durMs: 220, gain: 0.10 },
    { freq: 880, endFreq: 440, type: "triangle", durMs: 180, gain: 0.06 },
  ]),
  spellIce: () => chord([
    { freq: 1760, endFreq: 1320, type: "sine", durMs: 220, gain: 0.06 },
    { freq: 2200, endFreq: 1760, type: "sine", durMs: 200, gain: 0.04 },
    { freq: 660, type: "triangle", durMs: 160, gain: 0.05 },
  ]),
  spellWater: () => chord([
    { freq: 440, endFreq: 220, type: "sine", durMs: 280, gain: 0.08 },
    { freq: 660, endFreq: 330, type: "sine", durMs: 280, gain: 0.05 },
  ]),
  spellLightning: () => chord([
    { freq: 2400, type: "square", durMs: 40, gain: 0.10 },
    { freq: 1200, endFreq: 220, type: "sawtooth", durMs: 200, gain: 0.09 },
  ]),
  spellHoly: () => chord([
    { freq: 880, endFreq: 1760, type: "sine", durMs: 320, gain: 0.07 },
    { freq: 1320, endFreq: 2640, type: "sine", durMs: 320, gain: 0.05 },
    { freq: 660, endFreq: 1320, type: "triangle", durMs: 280, gain: 0.04 },
  ]),
  spellDark: () => chord([
    { freq: 110, endFreq: 55, type: "sawtooth", durMs: 360, gain: 0.10 },
    { freq: 220, endFreq: 110, type: "triangle", durMs: 320, gain: 0.06 },
  ]),
  spellWind: () => chord([
    { freq: 1320, endFreq: 2200, type: "triangle", durMs: 220, gain: 0.06 },
    { freq: 1760, endFreq: 2640, type: "triangle", durMs: 200, gain: 0.04 },
  ]),
  spellSlash: () => chord([
    { freq: 1760, endFreq: 880, type: "square", durMs: 90, gain: 0.10 },
    { freq: 880, endFreq: 440, type: "sawtooth", durMs: 60, gain: 0.06 },
  ]),
  spellImpact: () => chord([
    { freq: 165, endFreq: 55, type: "sawtooth", durMs: 240, gain: 0.12 },
    { freq: 330, endFreq: 165, type: "square", durMs: 120, gain: 0.06 },
  ]),
  spellArrow: () => chord([
    { freq: 1320, endFreq: 2640, type: "triangle", durMs: 80, gain: 0.07 },
    { freq: 660, endFreq: 1320, type: "sine", durMs: 70, gain: 0.04 },
  ]),
  spellShadow: () => chord([
    { freq: 165, endFreq: 110, type: "triangle", durMs: 280, gain: 0.07 },
    { freq: 330, endFreq: 220, type: "sine", durMs: 320, gain: 0.05 },
  ]),
  spellHeal: () => chord([
    { freq: 880, endFreq: 1760, type: "sine", durMs: 280, gain: 0.07 },
    { freq: 1320, endFreq: 1980, type: "sine", durMs: 280, gain: 0.05 },
  ]),
  spellBuff: () => chord([
    { freq: 660, endFreq: 990, type: "triangle", durMs: 240, gain: 0.06 },
    { freq: 990, endFreq: 1320, type: "sine", durMs: 240, gain: 0.04 },
  ]),
  spellSummon: () => chord([
    { freq: 220, endFreq: 880, type: "square", durMs: 280, gain: 0.07 },
    { freq: 440, type: "triangle", durMs: 240, gain: 0.05 },
  ]),
  spellGeneric: () => chord([
    { freq: 660, endFreq: 880, type: "triangle", durMs: 140, gain: 0.06 },
  ]),
};

/** Theme keywords matched against the skill name (case-insensitive) to pick
 *  the appropriate spell-cast SFX. First match wins; ordering matters because
 *  some words overlap (e.g. "Solar Flare" contains both "solar" → holy and
 *  "flare" → fire — we want holy to win since it's the brighter theme).
 *  Keep keywords plural-/conjugation-tolerant by using substrings. */
const SPELL_SFX_THEMES: Array<{ match: RegExp; play: () => void }> = [
  // Light / holy first — beats fire/heat themes when both words appear.
  { match: /\b(holy|radiant|celestial|solar|light|divine|sacred|aura|halo|sun)/i, play: () => sfx.spellHoly() },
  // Shadow / dark before generic magic.
  { match: /\b(shadow|dark|void|abyss|phantom|wraith|necro)/i, play: () => sfx.spellShadow() },
  // Fire family.
  { match: /\b(fire|flame|blaz|ignit|inferno|burn|ember|pyro|combust|scorch)/i, play: () => sfx.spellFire() },
  // Ice / frost.
  { match: /\b(ice|frost|froz|freeze|cold|chill|glacial|cryo)/i, play: () => sfx.spellIce() },
  // Water / hydro.
  { match: /\b(water|hydro|tidal|wave|aqua|ocean|sea|stream|vortex|drown|tsunami)/i, play: () => sfx.spellWater() },
  // Lightning / thunder.
  { match: /\b(lightning|thunder|bolt|shock|static|electric|spark|storm)/i, play: () => sfx.spellLightning() },
  // Wind / movement.
  { match: /\b(wind|gust|tornado|cyclone|swift|whirl|sweep|dash)/i, play: () => sfx.spellWind() },
  // Slash / blade.
  { match: /\b(slash|slice|cut|blade|edge|cleav|sever|carve|twin|whirlwind)/i, play: () => sfx.spellSlash() },
  // Arrow / shot.
  { match: /\b(arrow|shot|volley|draw|tap|apex|fire(?=\s|$)|pierc|barrage|bind)/i, play: () => sfx.spellArrow() },
  // Heavy impact / slam / stomp.
  { match: /\b(strike|slam|smash|bash|punch|crush|crash|pound|stomp|quake|shake|earth|colossal|hammer|fist)/i, play: () => sfx.spellImpact() },
  // Heal-keyword skills.
  { match: /\b(heal|cure|restor|revive|mend|regen|recover|soda(?=\s+pop))/i, play: () => sfx.spellHeal() },
  // Summon.
  { match: /\b(summon|spawn|conjure|call|bastion)/i, play: () => sfx.spellSummon() },
  // Buff-y verbs (focus, pulse, shield, guard, bulwark, heart) — last resort
  // before falling through to kind-based default.
  { match: /\b(focus|pulse|shield|bulwark|heart|unyielding|wall|barrier|might|fury|rage|frenzy|guard)/i, play: () => sfx.spellBuff() },
];

/** Public dispatcher. Picks an SFX by skill name keywords, falling back to
 *  the skill's kind (physical / magical / buff / summon). Called from the
 *  combat loop the moment a skill resolves. */
export function playSkillCastSfx(skillName: string, skillKind: "physical" | "magical" | "buff" | "summon"): void {
  for (const theme of SPELL_SFX_THEMES) {
    if (theme.match.test(skillName)) {
      theme.play();
      return;
    }
  }
  // No keyword hit — fall back to the skill kind so we still play SOMETHING
  // distinct. Generic physical skills also covered by hit SFX on impact,
  // so we keep this very subtle to avoid doubling up.
  if (skillKind === "summon") sfx.spellSummon();
  else if (skillKind === "buff") sfx.spellBuff();
  else if (skillKind === "magical") sfx.spellGeneric();
  // Pure physical with no keyword: stay silent here, the hit SFX covers it.
}

// Global click/hover delegation for any clickable element.
let clickWired = false;
export function installGlobalClickSounds(): void {
  if (clickWired || typeof document === "undefined") return;
  clickWired = true;
  document.addEventListener("click", e => {
    const t = e.target as HTMLElement | null;
    if (!t) return;
    const clickable = t.closest("button, [data-roster], [data-cell], .stage-tile, .home-tile, .roster-item, .class-pick-btn, .alloc-btn, .gear-btn, .back-btn");
    if (clickable && !(clickable as HTMLButtonElement).disabled) sfx.click();
  }, true);
}
