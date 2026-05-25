# MoTZ Design System

The shared brand + UI design system for **Mark of the Zeal (MoTZ)** — the #1 crypto-gaming guild and community brand. MoTZ rallies players, mokis (champion characters), and creators around Web3 games like Fableborne, Cambria, and Moku, and partnerships with chains like Ronin and Arbitrum.

This system covers everything we ship: **markofthezeal.com**, social and stream overlays, merch, event collateral (e.g. YGG Summit), and in-app UI.

> **Vibe:** bold, energetic, gamer-first. Friendly mascot-led personality (our mascot **Ego** is the narrator) over a high-contrast neon palette with strong type and gradient surfaces.

---

## Index — what's in this folder

| Path | What it is |
|---|---|
| `README.md` | You are here. Brand context, content + visual foundations, iconography. |
| `SKILL.md` | Agent-skill manifest — load this when designing for MoTZ. |
| `colors_and_type.css` | All tokens (colors, gradients, type, spacing, shadows). Drop-in. |
| `assets/logos/` | Wordmark (horizontal/vertical), icon mark, favicon. |
| `assets/mascot/` | Ego (the narrator) — primary art + 4 loader variants + closeup. |
| `assets/imagery/` | Vault key, founders coin, vault legacy art, game characters, roadmap. |
| `assets/backgrounds/` | Hero background webp + share-template OG image. |
| `preview/` | Design-system cards rendered for the Design System tab. |
| `ui_kits/website/` | High-fidelity recreation of the markofthezeal.com hub. |

---

## Sources we mirrored from

- **GitHub:** `kyrohmotz/motz-toolkit` (private) — primary canonical source. Specifically:
  - `public/brand.html` — brand guide page (colors, gradients, type, mascot, buttons)
  - `public/ui-guide.html` — UX brand guide v1 (tokens, principles, components)
  - `public/index.html` — markofthezeal.com hub (live UI patterns)
  - `public/assets/motz/` — official logos, Ego art, loaders, share templates
  - `public/assets/brand/guide-pages/` — six-page PDF brand guide rendered as JPGs
  - `public/images/` — game art, vault/coin art, character renders
- **Brand brief (2026):** MoTZ Brand System v1.1 — voice, mascot rules, official font and color callouts.
- **Live site:** https://markofthezeal.com and https://markofthezeal.com/brand.html

The `MarkofTheZeal/` Obsidian vault attached to the project is operational coordination notes (Inbox/Tasks/Logs) — no design assets there.

---

## ⚠️ Substitutions to confirm

| Brand brief calls for | Codebase ships | What we did |
|---|---|---|
| **YOURMATE** display font | **Fredoka** (Google Fonts) | Treating Fredoka as the live working substitute. Variables in `colors_and_type.css` reference both. Drop `/fonts/Yourmate.woff2` in and uncomment the `@font-face` block to swap. |
| **Roc Grotesk** body font | **Inter** (Google Fonts) | Same — Inter is live. Drop `/fonts/RocGrotesk.woff2` to swap. |
| **MoTz Red `#ca2b5b`** | **`#FF2A55`** | We follow the codebase. The hotter `#FF2A55` matches the live site, brand.html, and ui-guide.html. |
| Brand brief's separate Mavis Blue | Used minimally | Kept as `--mavis-blue` token; not used in core surfaces. |

**Action for you:** Send `Yourmate.woff2` + `RocGrotesk.woff2` (and any additional weights), and confirm the canonical red. Without those files we ship Fredoka/Inter — visually adjacent, but not exact.

The MoTZ Media Kit ZIP was attached to the original prompt but didn't make it through the upload — re-attach it via the Import menu and we can pull canonical PDFs, full Ego sprite set, additional Mokis, and merch templates.

---

## CONTENT FUNDAMENTALS

### Voice

Confident, playful, gamer-first. We talk like a hype friend, not a corporation. Web3-native vocabulary used **naturally** — never jargon-heavy.

**Three pillars (verbatim from brand.html):**
- **Bold & Energetic** — speak with confidence and excitement; use exclamation points; hype the wins.
- **Community First** — inclusive, welcoming, encouraging. Use terms like *Fam, Squad, Legends*.
- **Futuristic & Tech-Savvy** — embrace Web3 terminology but keep it accessible: *Mint, Vault, Drop*.

### Pronouns / address

- Address the reader as **you** (or *fam, squad, legends*).
- **We** for MoTZ collectively. Never "the company" / "the team."
- Mascot **Ego** speaks in first-person when narrating — short, punchy, sometimes mock-cocky.

### Casing

- Brand and product names are typically rendered like **MoTZ** (mixed case, the Z capitalized) — also acceptable as **MoTz**.
- Display headlines lean **Title Case** or **ALL CAPS** for impact (`#1 MOKI HOLDER`, `LEGENDS`).
- Body copy is sentence case.
- Buttons use Title Case action verbs (`Join Discord`, `Mint NFT`, `Claim Reward`, `Connect Wallet`).

### Punctuation

- Exclamation points are welcome — but earned. Don't stack them.
- Em dashes for pace; ellipses sparingly.
- Numbers and stats love the spotlight: `2,800+ Legends`, `#1 Guild`, `1,250 Kingdoms Staked`.

### Emoji

- **Yes**, sparingly and in-system. Common ones in the codebase:
  - 🏰 (guild / homeland), 🎮 (game), 💬 (Discord), 🪙 (coin/NFT), ⛵ (voyages), ⚔️ (Cambria), 🤝 (P2P/trade), 🗓️ (calendar), 🎨 (brand), 🖼️ (art), 👑 (top holder), ⚡ 🚀 ✦ 👾.
- Used as **section icons** inside circular tinted tiles, never decorative pepper.
- Don't replace Ego with a generic emoji — Ego is the mascot.

### Signature lines + recurring CTAs

Pulled from brand.html and the brand brief:

- *"The Full MoTz Power-Up!"* (full lockup)
- *"MoTz Mini-Mascot!"* (icon-only lockup)
- *"the logo that always fits and gives a quick wave"*
- *"secret handshake of hues"*
- *"MoTz family"*
- CTAs: **Join MoTz**, **Join Discord**, **Mint Vault Keys**, **Coin Staking**, **Mint NFT**, **Claim Reward**, **Connect Wallet**, **Play Now**, **What's MoTz Doing?**, **Introducing the Champion Mokis!**

### Microcopy patterns (from ui-guide.html)

```
Success: "Mission complete. +24 XP."
Error:   "Not enough coin energy. Need 12, have 7."
Next:    "Queue 5 AFK casts to complete today's objective."
```

Tone here: confident, tactical, concise, slightly playful. **Disable reasons in plain language** — never leave the user wondering why a button is dead.

### Don'ts

- Don't strip personality with corporate or sterile copy.
- Don't pair YOURMATE/Fredoka with itself for body — use the secondary face.
- Don't bury the subject. Background never overpowers the mascot or main caption.
- Don't go thin/minimalist on iconography — it fights the brand energy.

---

## VISUAL FOUNDATIONS

### Color motif

The system lives in **dark void mode** by default. Cyberpunk aesthetic, deep void backgrounds, with high-energy accent flashes.

- **Backgrounds** are layered: a near-black base (`--void-black: #0F0518`) with two large radial blur glows behind the content — one **MoTz Red**, one **Electric Purple** — at ~10–16% opacity, blurred 150px. Sometimes a third faint **gold** glow centered for warmth. A faint 60×60px grid pattern (white at 2% opacity) sits over everything.
- **Surfaces** are translucent white over the void — `rgba(255,255,255,0.03–0.08)` — with `1px` glass borders at 6–15% white. Real **glassmorphism** with `backdrop-filter: blur(8–14px)` for overlays/menus.
- **Accents** punch hard: MoTZ Red for primary actions, Winner Gold for rewards/wins, Electric Purple for secondary surfaces and energy, Mavis Blue used sparingly for info states.
- **Imagery vibe:** warm reds, electric purples, glowing golds; rich darks; saturated. Not warm-grain or cool/blue — closer to neon-cyberpunk-stage-lighting.

### Type motif

- **Display/heading:** Fredoka (Yourmate) — chunky, friendly, gamer-confident.
- **Body/UI:** Inter (Roc Grotesk) — clean, neutral, gets out of the way.
- **Mono:** JetBrains Mono — for stats, labels, code, overlines (with `letter-spacing: 0.18–0.25em` and `text-transform: uppercase` for the *tactical HUD* feel).
- **Hero text** uses red→purple gradient text-fill or gold glow text-shadow.
- **Tracking:** -0.01em on display headings; large +0.10–0.25em on overlines.

### Backgrounds

- Full-bleed void with radial glows + grid pattern is the **default page background**.
- For sections that need atmosphere: gradient surfaces (`--grad-surface`), or a hero background image (`assets/backgrounds/bg-1920.webp`).
- Hand-drawn pixel-art pieces (Cambria islands/cores, Fableborne kingdoms) appear as **subject art**, not background patterns.
- Repeating patterns/textures are otherwise minimal — let the glow + grid carry it.

### Gradients

Every gradient in the system is built from the four primary colors:

- **Button / Primary CTA** — `linear-gradient(135deg, #FF2A55, #D91A45)`
- **Text & Hero gradient** — `linear-gradient(135deg, #FF2A55, #7000FF)`
- **Gold (rewards)** — `linear-gradient(135deg, #FBBF24, #F59E0B)`
- **Purple secondary** — `linear-gradient(135deg, #7000FF, #5A00D6)`
- **Surface card** — `linear-gradient(180deg, rgba(255,255,255,0.05), rgba(255,255,255,0.025))`

### Animation

- **Default ease:** `cubic-bezier(.2, .7, .2, 1)` (out-cubic) for transitions.
- **Bounces:** `cubic-bezier(.34, 1.56, .64, 1)` (out-back) for entries — counters, sprite drops, tile reveals.
- **Durations:** 120/200/240ms for UI; 400ms+ for hero entries.
- **Mascot float:** Ego bobs `±12px` vertically over a 4s `ease-in-out` infinite loop. CTA badges/tile chips can also bob subtly.
- **Pulse dot** on live badges: 2s opacity 1 → 0.4 → 1.
- **Starfield + scanlines + grid floor** are accepted ambient effects on full-bleed hero compositions.
- **Reduced-motion supported** — pause loops on `prefers-reduced-motion`.

### Hover states

- Cards lift: `translateY(-2 to -4px)` + intensify shadow + add a colored glow ring (red or gold) + reveal a top gradient bar (red→gold→transparent).
- Buttons: lift `-2px` + shadow goes from `--sh-cta` to `--sh-cta-hi`. No color flip.
- Links/nav items: background fades to `--surface-hover`, text from `--text-muted` to `--text-primary`.
- Image tiles: tiny scale (1.01) + slight border color shift toward gold.

### Press / active

- Buttons return to baseline transform (drop the lift) — no aggressive shrink.
- Text-button color does NOT change on press; the lift drop is the cue.
- Disabled: `--surface` background, `--text-dim` text, `cursor: not-allowed`, no shadow.

### Borders + dividers

- Default border: `1px solid var(--glass-border)` (white at 8%) on dark surfaces.
- Strong/active borders use the brand colors (red/gold/purple) at ~30–66% alpha.
- Section dividers are 1px lines at `rgba(255,255,255,0.04–0.06)`.
- Featured tiles can use a 2–4px **gold** stroke for emphasis (think trading card frame).

### Shadow system

Two shadow families:

- **Card shadow** — broad black drop (`0 8–14px`), low opacity, plus an `inset 0 1px 0 rgba(255,255,255,0.05)` top highlight to feel raised.
- **Glow shadow** — colored, soft, attached to brand-color elements: red on primary CTAs, gold on rewards, purple on secondary.

No outer rings, no harsh inner shadows. Everything is felt, not seen.

### Protection layers / capsules

When mascot/subject art sits on busy backgrounds, we use a **soft radial protection blur** behind the subject (matching the dominant accent — usually red or gold) at 40–55% opacity, blurred 20–40px. This protects the silhouette without a hard halo or capsule.

Pill **chips** (e.g. status badges, tone-badges) use `--r-pill` borders and `--surface-strong` fills — capsule-style, not gradient.

### Layout rules

- **Page max-width:** 1180–1200px, centered, 24px gutters.
- **Hero canvas (animated):** 1920×1080, scaled with transform to fit container.
- **Grid:** 12-col mental model; in practice we use `grid-template-columns: repeat(auto-fit, minmax(220–280px, 1fr))` for hub/game grids.
- **Sticky nav** sits at top, transparent over the void.
- **One primary CTA per section** (UX principle from ui-guide).
- **Subject + caption stay dominant** — backgrounds support, never compete.

### Transparency + blur

- Used liberally for: nav bars, modal overlays, sticky chips, glass cards.
- Default `backdrop-filter: blur(8–14px)`. Always paired with a low-alpha white surface and a 1px glass border.
- Don't blur the page background itself — keep glow, keep grid.

### Corner radii

- Pills: `999px`
- Buttons: `10–12px`
- Small cards / chips: `8–12px`
- Standard cards / panels: `14–16px`
- Hero cards / large panels: `18–22px`
- Featured trading-card frames: `18px` outer / `12px` inner.

### Card anatomy

A standard MoTZ card is:

- `linear-gradient(180deg, rgba(255,255,255,0.05), rgba(255,255,255,0.025))` background
- `1px solid rgba(255,255,255,0.12)` border
- `border-radius: 16px`
- Box-shadow: `0 8px 26px rgba(0,0,0,0.34), inset 0 1px 0 rgba(255,255,255,0.05)`
- Padding: `24–28px`
- On hover: lift 4px, border shifts to gold-tint, top gradient bar appears, shadow intensifies + red glow

---

## ICONOGRAPHY

### Approach

MoTZ icons are **bold, slightly chunky, gamey** — they match the energy of Fredoka, not corporate-grade thin strokes.

The shipping codebase uses three layered icon strategies:

1. **Emoji** as section icons (most common in the live hub) — wrapped in a 40–48px tinted-tile (`background: rgba(255,42,85,0.10)` / gold / purple equivalent), `border-radius: 12px`. Not arbitrary peppering — they're a structural design element.
2. **Image marks** for branded assets — `motz-coin.png`, `vault-key.jpg`, character renders sit inline as small images (54–80px) where an icon would normally go. These carry brand recognition that an icon can't.
3. **CDN icon set (substitute):** No icon font ships with the codebase. The `ui-guide.html` approved-stack section calls out **Lucide** as the default icon library. Until a custom MoTZ icon set lands, link Lucide from CDN: https://unpkg.com/lucide-static. **This is a substitution — flag if a different set is preferred.**

### Don't

- ❌ **Thin / minimalist / corporate icon sets** (e.g. Heroicons outline-thin, Phosphor light) — they fight the brand.
- ❌ **Inventing decorative SVG art for Ego or Mokis** — always use the photo/PNG renders in `assets/`.
- ❌ **Mixing icon styles** in a single section. Pick one row.

### Recommended sets (in order)

1. **Lucide** (filled-leaning, weight 2) — closest to Fredoka's chunky friendliness.
2. **Tabler Icons** — slightly chunkier alt.
3. Bespoke MoTZ icons (TBD — request from design).

### Unicode chars

Used decoratively, never as primary icons:
- `↗` for external links
- `↓` for downloads
- `●` / `◆` / `✦` as accent dots in overlines and HUD text

### Logos

Three lockup variants live in `assets/logos/`:

- `motz-wordmark-horizontal.png` — full color wordmark + mark, the primary lockup. *"The Full MoTz Power-Up!"*
- `motz-wordmark-vertical.png` — stacked variant for square-ish containers.
- `motz-icon.png` — mark only. *"MoTz Mini-Mascot!"* — for favicons, app icons, social profile pics.
- `motz-favicon.png` — 32px favicon-ready PNG.

**Spacing:** keep logo clear-space ≥ 0.5× wordmark height. **Background:** photographs are fine, but always test with a dark gradient behind to ensure the mark + caption remain dominant.
