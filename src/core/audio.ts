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

// ---- Noise + filter helpers ----
// Pure-oscillator chords sound "bubbly" because they're tonal blips. Real
// elemental SFX need NOISE (random samples) shaped by a filter envelope:
// crackling fire, hissing water, sharp lightning, airy wind. These two
// helpers give us a noise generator and a one-shot biquad-filtered burst.

let noiseBuffer: AudioBuffer | null = null;
function getNoiseBuffer(a: AudioContext): AudioBuffer {
  if (noiseBuffer && noiseBuffer.sampleRate === a.sampleRate) return noiseBuffer;
  // 1 second of white noise — plenty for short bursts, looped if longer.
  const buf = a.createBuffer(1, a.sampleRate, a.sampleRate);
  const ch = buf.getChannelData(0);
  for (let i = 0; i < ch.length; i++) ch[i] = Math.random() * 2 - 1;
  noiseBuffer = buf;
  return buf;
}

interface NoiseBurst {
  /** Total duration in ms. */
  durMs: number;
  /** Peak gain (pre-volume-slider). 0..1 range, typical 0.05–0.20. */
  gain?: number;
  /** Filter type. "lowpass" = thump/rumble, "highpass" = hiss/sizzle,
   *  "bandpass" = focused tone, "notch" = airy. */
  filterType?: BiquadFilterType;
  /** Filter cutoff start (Hz). */
  freqStart: number;
  /** Filter cutoff end (Hz) — linearly ramped over the duration. */
  freqEnd?: number;
  /** Filter Q — higher = more resonant/focused. Default 1. */
  q?: number;
  /** Gain envelope shape. "instant" = full peak immediately (sharp attack
   *  for impacts/lightning), "swell" = ramps in over 30% of dur (whoosh).
   *  Default "instant". */
  attack?: "instant" | "swell";
}

function noise(b: NoiseBurst): void {
  if (!sfxAllowed()) return;
  const a = ac();
  if (!a) return;
  const dur = b.durMs / 1000;
  const src = a.createBufferSource();
  src.buffer = getNoiseBuffer(a);
  src.loop = true;
  const filter = a.createBiquadFilter();
  filter.type = b.filterType ?? "lowpass";
  filter.Q.setValueAtTime(b.q ?? 1, a.currentTime);
  filter.frequency.setValueAtTime(b.freqStart, a.currentTime);
  if (b.freqEnd !== undefined) {
    filter.frequency.linearRampToValueAtTime(b.freqEnd, a.currentTime + dur);
  }
  const g = a.createGain();
  const peak = (b.gain ?? 0.08) * readSfxVolume();
  if (b.attack === "swell") {
    g.gain.setValueAtTime(0, a.currentTime);
    g.gain.linearRampToValueAtTime(peak, a.currentTime + dur * 0.3);
    g.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + dur);
  } else {
    g.gain.setValueAtTime(0, a.currentTime);
    g.gain.linearRampToValueAtTime(peak, a.currentTime + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + dur);
  }
  src.connect(filter).connect(g).connect(a.destination);
  src.start();
  src.stop(a.currentTime + dur + 0.02);
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
  // Built from filtered noise + targeted tones so each theme has natural
  // texture (crackle, splash, hiss, zap) instead of pure synth blips.

  // Fire ignite: three-layer composite that reads as a real flame catching.
  //   1) T+0   — sharp "spark" click: short high-freq noise + tone (the
  //              moment of ignition, like a lighter striking).
  //   2) T+30  — "whoosh": bandpass noise swelling 1200→2400Hz then settling,
  //              that classic FWOOSH as flames catch and balloon outward.
  //   3) T+80  — body rumble: lowpass noise + sub-bass tone for the warmth
  //              and weight underneath.
  //   4) T+250 — crackle tail: brief mid-band noise puff so the sustain
  //              doesn't end clean — fire never just stops, it crackles out.
  spellFire: () => {
    // Layer 1: spark click (instant).
    noise({ durMs: 50, freqStart: 6000, freqEnd: 3000, filterType: "highpass", q: 2, gain: 0.10 });
    blip({ freq: 3200, endFreq: 1600, type: "square", durMs: 25, gain: 0.05 });
    // Layer 2: whoosh starts ~30ms after the spark.
    setTimeout(() => {
      noise({ durMs: 260, freqStart: 1200, freqEnd: 2400, filterType: "bandpass", q: 1.5, gain: 0.14, attack: "swell" });
    }, 30);
    // Layer 3: body rumble starts ~80ms in (right as the whoosh peaks).
    setTimeout(() => {
      noise({ durMs: 280, freqStart: 400, freqEnd: 120, filterType: "lowpass", q: 1, gain: 0.10, attack: "swell" });
      blip({ freq: 90, endFreq: 55, type: "sawtooth", durMs: 240, gain: 0.06 });
    }, 80);
    // Layer 4: crackle tail at ~250ms — keeps the fire feeling alive.
    setTimeout(() => {
      noise({ durMs: 120, freqStart: 2000, freqEnd: 800, filterType: "bandpass", q: 4, gain: 0.06 });
    }, 250);
  },
  // Ice: bandpass-filtered noise (cold hiss) + bell-like high tone shimmer.
  spellIce: () => {
    noise({ durMs: 320, freqStart: 8000, freqEnd: 4000, filterType: "highpass", q: 0.5, gain: 0.08 });
    blip({ freq: 2200, type: "sine", durMs: 280, gain: 0.06 });
    blip({ freq: 3300, type: "sine", durMs: 220, gain: 0.04 });
  },
  // Water: lowpass noise gurgle + descending tone (splash).
  spellWater: () => {
    noise({ durMs: 360, freqStart: 1800, freqEnd: 300, filterType: "lowpass", q: 2, gain: 0.12, attack: "swell" });
    blip({ freq: 660, endFreq: 220, type: "sine", durMs: 280, gain: 0.04 });
  },
  // Lightning: instant noise crack + sharp transient + decaying buzz.
  spellLightning: () => {
    noise({ durMs: 60, freqStart: 6000, filterType: "highpass", q: 1, gain: 0.18 });
    blip({ freq: 2400, type: "square", durMs: 30, gain: 0.10 });
    blip({ freq: 1200, endFreq: 110, type: "sawtooth", durMs: 220, gain: 0.06 });
  },
  // Holy: layered choir-like rising sines (no noise — clean and ethereal).
  spellHoly: () => chord([
    { freq: 523, endFreq: 1047, type: "sine", durMs: 420, gain: 0.07 },   // C5 → C6
    { freq: 659, endFreq: 1319, type: "sine", durMs: 420, gain: 0.05 },   // E5 → E6
    { freq: 784, endFreq: 1568, type: "sine", durMs: 420, gain: 0.04 },   // G5 → G6
  ]),
  // Shadow: lowpass rumble + dissonant low tone.
  spellDark: () => {
    noise({ durMs: 420, freqStart: 200, freqEnd: 80, filterType: "lowpass", q: 3, gain: 0.13, attack: "swell" });
    blip({ freq: 73, type: "sawtooth", durMs: 380, gain: 0.06 });   // very low D
    blip({ freq: 98, type: "triangle", durMs: 320, gain: 0.04 });   // G slightly above (dissonant)
  },
  // Wind: bandpass noise sweep upward — airy and moving.
  spellWind: () => {
    noise({ durMs: 320, freqStart: 800, freqEnd: 3200, filterType: "bandpass", q: 2, gain: 0.10, attack: "swell" });
  },
  // Slash: very short noise transient + descending blade tone.
  spellSlash: () => {
    noise({ durMs: 80, freqStart: 4000, freqEnd: 1500, filterType: "bandpass", q: 3, gain: 0.14 });
    blip({ freq: 1760, endFreq: 440, type: "sawtooth", durMs: 90, gain: 0.07 });
  },
  // Impact: sub-bass thump + lowpass noise crunch (kick-drum-ish).
  spellImpact: () => {
    blip({ freq: 90, endFreq: 30, type: "sine", durMs: 220, gain: 0.18 });
    noise({ durMs: 120, freqStart: 800, freqEnd: 200, filterType: "lowpass", q: 1, gain: 0.10 });
  },
  // Arrow: short noise whistle ascending + tight tone.
  spellArrow: () => {
    noise({ durMs: 110, freqStart: 1200, freqEnd: 4000, filterType: "bandpass", q: 4, gain: 0.10 });
    blip({ freq: 1320, endFreq: 2640, type: "triangle", durMs: 90, gain: 0.05 });
  },
  // Shadow magic: same as spellDark (alias kept in case we want differentiation later).
  spellShadow: () => sfx.spellDark(),
  // Heal: chime triad — major bell-like ring (no noise, all cleanly tonal).
  spellHeal: () => chord([
    { freq: 880, type: "sine", durMs: 360, gain: 0.07 },         // A5
    { freq: 1109, type: "sine", durMs: 340, gain: 0.05 },        // C#6
    { freq: 1319, type: "sine", durMs: 320, gain: 0.04 },        // E6
  ]),
  // Buff: rising triangle arpeggio — clean and uplifting.
  spellBuff: () => chord([
    { freq: 523, type: "triangle", durMs: 180, gain: 0.06 },     // C5
    { freq: 659, type: "triangle", durMs: 220, gain: 0.05 },     // E5
    { freq: 784, type: "triangle", durMs: 280, gain: 0.04 },     // G5
  ]),
  // Summon: deep build-up with rising harmonic.
  spellSummon: () => {
    noise({ durMs: 420, freqStart: 100, freqEnd: 600, filterType: "lowpass", q: 2, gain: 0.10, attack: "swell" });
    blip({ freq: 110, endFreq: 440, type: "square", durMs: 360, gain: 0.06 });
  },
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
