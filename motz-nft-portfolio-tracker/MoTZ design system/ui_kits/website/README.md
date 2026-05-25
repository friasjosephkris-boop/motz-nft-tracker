# MoTZ Website UI Kit

A high-fidelity recreation of the **markofthezeal.com** hub page, faithful to `kyrohmotz/motz-toolkit:public/index.html`.

## What's here
- `index.html` — the running prototype: nav, hero with animated Ego, stat bar, hub grid (8 tiles), games grid, footer. Click **Connect Wallet** for the modal flow; clicking any hub or game tile shows a loading toast.
- `components.jsx` — extracted React components: `Nav`, `Btn`, `HubCard`, `GameCard`, `StatBlock`, `SectionTitle`, `Footer`, `EgoFloat`, `HeroBadge`.

## Patterns demonstrated
- Three radial bg glows (red / purple / gold) over `--void-black` + 60px grid pattern overlay
- Animated pulse dot in hero badge, floating Ego mascot
- Hub-card hover: lift + gold border tint + top gradient bar reveal
- Glassmorphic modal with backdrop blur (Connect Wallet)
- Tactical-tone toast notifications

## Surfaces this kit doesn't include
The codebase has additional pages (`fableborne.html`, `voyages.html`, `cambria/`, `trade.html`, `command-center.html`) — recreating those is the natural next step. The hub captures the brand vocabulary; the tool pages each riff on it.
