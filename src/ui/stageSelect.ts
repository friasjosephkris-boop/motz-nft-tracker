import { topBarHtml } from "./settings";
import { getEnergy, ENERGY_MAX, msUntilNextRefill } from "../core/energy";
import { STAGE_DEFS, StageEnemyDef, PLAYER_ROSTER, isPostGameFloor, postGameEnemyLevelFor, resistProfileForFloor } from "../units/roster";
import { getMaxCleared } from "../core/clears";
import { pullCanonicalProgress } from "../core/progress";
import { UnitTemplate, DamageResistance } from "../units/types";
import { getProgress } from "../core/progress";
import { fetchAttemptsStatus } from "../core/shop";

export const SURVIVAL_ENERGY_COST: number = 3;
export const BOSS_RAID_ENERGY_COST: number = 3;
/** Minimum unit level (anywhere in the roster) to unlock Survival + Boss Raid. */
export const ENDLESS_MODE_UNLOCK_LEVEL: number = 5;

function highestRosterLevel(): number {
  let max = 0;
  for (const t of PLAYER_ROSTER) {
    const lvl = getProgress(t.id).level ?? 1;
    if (lvl > max) max = lvl;
  }
  return max;
}

export type StagePick =
  | { kind: "floor"; id: number }
  | { kind: "survival" }
  | { kind: "boss_raid" };

/** Mode picker — three large tiles: Campaign / Survival / Boss Raid.
 *  Campaign opens the floor grid sub-screen; the other two start a run. */
export function renderStageSelect(root: HTMLElement, onPick: (pick: StagePick) => void, onBack: () => void): void {
  const energy = getEnergy();
  const topLevel = highestRosterLevel();
  const endlessUnlocked = topLevel >= ENDLESS_MODE_UNLOCK_LEVEL;
  const survivalDisabled = !endlessUnlocked || energy < SURVIVAL_ENERGY_COST;
  const bossRaidDisabled = !endlessUnlocked || energy < BOSS_RAID_ENERGY_COST;
  const lockHint = `<div class="mode-tile-lock">🔒 Reach <strong>Lv ${ENDLESS_MODE_UNLOCK_LEVEL}</strong> on any unit to unlock</div>`;

  const draw = (): void => {
    root.innerHTML = `
      <div class="screen-frame stage-select-screen">
        ${topBarHtml("Gauntlet Tower", true)}
        <div class="energy-pill standalone" title="Energy">
          <span class="energy-icon">⚡</span><span>${getEnergy()} / ${ENERGY_MAX}</span>
          <span class="energy-hint">refills in <span id="energy-refill-timer">${formatCountdown(msUntilNextRefill())}</span></span>
        </div>
        <div class="mode-picker">
          <button class="campaign-tile" id="mode-campaign" type="button">
            <div class="campaign-art"></div>
            <div class="campaign-overlay">
              <div class="campaign-title">Campaign</div>
              <div class="campaign-sub">Climb floors 1 → 50 · 1 energy per floor</div>
            </div>
          </button>
          <button class="survival-tile ${endlessUnlocked ? "" : "locked"}" id="mode-survival" type="button" ${survivalDisabled ? "disabled" : ""}>
            <div class="survival-art"></div>
            <div class="survival-overlay">
              <div class="survival-title">Survival Mode!</div>
              <div class="survival-sub">(${SURVIVAL_ENERGY_COST} energy spent per run)</div>
              <div class="mode-tile-attempts" id="survival-attempts">attempts: <strong>—/3</strong> today</div>
              ${endlessUnlocked ? "" : lockHint}
            </div>
          </button>
          <button class="bossraid-tile ${endlessUnlocked ? "" : "locked"}" id="mode-bossraid" type="button" ${bossRaidDisabled ? "disabled" : ""}>
            <div class="bossraid-art">
              <img class="bossraid-img" src="/boss-raid.webp" alt="" draggable="false" />
            </div>
            <div class="bossraid-overlay">
              <div class="bossraid-title">Boss Raid</div>
              <div class="bossraid-sub">(${BOSS_RAID_ENERGY_COST} energy spent per run)</div>
              <div class="mode-tile-attempts" id="bossraid-attempts">attempts: <strong>—/3</strong> today</div>
              ${endlessUnlocked ? "" : lockHint}
            </div>
          </button>
        </div>
      </div>
    `;
    root.querySelector("#back-btn")?.addEventListener("click", onBack);
    root.querySelector<HTMLButtonElement>("#mode-campaign")?.addEventListener("click", () => {
      renderCampaignFloors(root, onPick, () => renderStageSelect(root, onPick, onBack));
    });
    root.querySelector<HTMLButtonElement>("#mode-survival")?.addEventListener("click", () => {
      if (survivalDisabled) return;
      onPick({ kind: "survival" });
    });
    root.querySelector<HTMLButtonElement>("#mode-bossraid")?.addEventListener("click", () => {
      if (bossRaidDisabled) return;
      onPick({ kind: "boss_raid" });
    });

    const tick = () => {
      const t = document.getElementById("energy-refill-timer");
      if (!t) return;
      t.textContent = formatCountdown(msUntilNextRefill());
      setTimeout(tick, 1000);
    };
    setTimeout(tick, 1000);

    // Async fetch attempt counts and patch the badges.
    void (async () => {
      const [surv, br] = await Promise.all([
        fetchAttemptsStatus("survival"),
        fetchAttemptsStatus("boss_raid"),
      ]);
      const sEl = document.getElementById("survival-attempts");
      if (sEl && surv) {
        sEl.innerHTML = `attempts: <strong>${surv.used}/${surv.max}</strong> today`;
        if (surv.remaining <= 0) sEl.classList.add("attempts-exhausted");
      }
      const bEl = document.getElementById("bossraid-attempts");
      if (bEl && br) {
        bEl.innerHTML = `attempts: <strong>${br.used}/${br.max}</strong> today`;
        if (br.remaining <= 0) bEl.classList.add("attempts-exhausted");
      }
    })();
  };

  draw();
}

/** Floor-grid sub-screen reached by clicking the Campaign mode tile. */
function renderCampaignFloors(root: HTMLElement, onPick: (pick: StagePick) => void, onBack: () => void): void {
  // Pull canonical progress (incl. server maxFloor) BEFORE rendering so a
  // post-wipe player doesn't briefly see every floor unlocked from stale
  // localStorage. The pull is fast (~100ms) and the loading frame keeps the
  // UI from flashing.
  root.innerHTML = `<div class="screen-frame stage-select-screen">${topBarHtml("Campaign", true)}<div style="text-align:center;padding:40px;opacity:0.7">Loading…</div></div>`;
  root.querySelector("#back-btn")?.addEventListener("click", onBack);

  // The "Loading…" frame must never be terminal. Render the grid exactly
  // once — whichever happens first: the canonical-progress pull settling, or
  // an 8s safety timeout. Any exception inside drawFloorGrid is caught and
  // turned into a Retry screen rather than a dead loading state.
  let done = false;
  const finish = (): void => {
    if (done) return;
    done = true;
    try {
      drawFloorGrid(root, onPick, onBack);
    } catch (err) {
      console.error("[campaign] floor grid render failed", err);
      root.innerHTML = `<div class="screen-frame stage-select-screen">${topBarHtml("Campaign", true)}`
        + `<div style="text-align:center;padding:40px;opacity:0.8">Couldn't load floors.<br>`
        + `<button id="campaign-retry" type="button" style="margin-top:14px;padding:8px 18px;cursor:pointer">Retry</button></div></div>`;
      root.querySelector("#back-btn")?.addEventListener("click", onBack);
      root.querySelector("#campaign-retry")?.addEventListener("click", () => renderCampaignFloors(root, onPick, onBack));
    }
  };
  const safety = setTimeout(finish, 8000);
  void pullCanonicalProgress().catch(() => undefined).then(() => {
    clearTimeout(safety);
    finish();
  });
}

// Tier groupings. The first tier (Floors 1-50) is the hand-tuned campaign;
// post-game tiers (51-500) bundle 50 floors each. When a tier is fully
// cleared it collapses into a single summary banner; the tier containing
// the player's "next-up" floor is expanded; locked tiers are collapsed
// with a 🔒 indicator. Player can click any unlocked tier to manually
// expand/collapse it.
interface FloorTier { id: string; label: string; firstFloor: number; lastFloor: number; }
const FLOOR_TIERS: FloorTier[] = (() => {
  const tiers: FloorTier[] = [{ id: "tier-main", label: "Campaign", firstFloor: 1, lastFloor: 50 }];
  for (let start = 51; start <= 500; start += 50) {
    const end = Math.min(start + 49, 500);
    tiers.push({ id: `tier-${start}-${end}`, label: `Floors ${start}–${end}`, firstFloor: start, lastFloor: end });
  }
  return tiers;
})();

/** Which tiers should render expanded on initial load. By default: the tier
 *  containing maxCleared+1 (the next-up floor). Player toggles are stored
 *  in-memory on the closure so re-renders honor manual expansions. */
const expandedTiers = new Set<string>();

function drawFloorGrid(root: HTMLElement, onPick: (pick: StagePick) => void, onBack: () => void): void {
  const energy = getEnergy();
  const maxCleared = getMaxCleared();
  const nextUp = maxCleared + 1;

  // Default-expand the active tier on every render. Manual toggles add to
  // expandedTiers and persist across re-renders within this screen session.
  const activeTier = FLOOR_TIERS.find(t => nextUp >= t.firstFloor && nextUp <= t.lastFloor);
  if (activeTier) expandedTiers.add(activeTier.id);

  // Visibility rule: only render tiers the player has actually reached. A tier
  // is shown when its first floor is at-or-below the player's next-up floor
  // (so the player sees the Campaign tier always, then 51-100 once they clear
  // 50, then 101-150 once they clear 100, etc.). Locked-but-visible tiers
  // (further than next-up) are hidden entirely so the screen stays clean —
  // they appear one-by-one as the player progresses.
  const visibleTiers = FLOOR_TIERS.filter(tier => tier.firstFloor <= nextUp);
  const tiersHtml = visibleTiers.map(tier => renderTier(tier, energy, maxCleared)).join("");

  root.innerHTML = `
    <div class="screen-frame stage-select-screen">
      ${topBarHtml("Campaign", true)}
      <div class="energy-pill standalone" title="Energy">
        <span class="energy-icon">⚡</span><span>${energy} / ${ENERGY_MAX}</span>
        <span class="energy-hint">refills in <span id="energy-refill-timer">${formatCountdown(msUntilNextRefill())}</span></span>
      </div>
      <div class="stage-tier-list">${tiersHtml}</div>
    </div>
  `;
  root.querySelector("#back-btn")?.addEventListener("click", onBack);

  // Tier headers: toggle expand/collapse on click (only for unlocked tiers —
  // locked ones reject the click).
  root.querySelectorAll<HTMLElement>(".stage-tier-header").forEach(header => {
    header.addEventListener("click", () => {
      const tierId = header.dataset.tier;
      if (!tierId) return;
      const tier = FLOOR_TIERS.find(t => t.id === tierId);
      if (!tier) return;
      // Locked tiers (first floor > nextUp) can't be expanded — show why.
      if (tier.firstFloor > nextUp) return;
      if (expandedTiers.has(tierId)) expandedTiers.delete(tierId);
      else expandedTiers.add(tierId);
      drawFloorGrid(root, onPick, onBack);
    });
  });

  root.querySelectorAll<HTMLButtonElement>(".stage-tile").forEach(btn => {
    btn.addEventListener("click", e => {
      e.stopPropagation(); // don't bubble up to the tier-header toggle
      const id = Number(btn.dataset.stage);
      const stage = STAGE_DEFS.find(s => s.id === id);
      if (!stage) return;
      const unlocked = id <= maxCleared + 1;
      if (!unlocked) return;
      if (getEnergy() <= 0) return;
      onPick({ kind: "floor", id });
    });
  });

  const tick = () => {
    const t = document.getElementById("energy-refill-timer");
    if (!t) return;
    t.textContent = formatCountdown(msUntilNextRefill());
    setTimeout(tick, 1000);
  };
  setTimeout(tick, 1000);
}

function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => n < 10 ? `0${n}` : `${n}`;
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}

/** Render one tier as a header banner + (when expanded) the grid of floor tiles. */
function renderTier(tier: FloorTier, energy: number, maxCleared: number): string {
  const tierFloors = STAGE_DEFS.filter(s => s.id >= tier.firstFloor && s.id <= tier.lastFloor);
  const totalFloors = tierFloors.length;
  const clearedInTier = Math.max(0, Math.min(totalFloors, maxCleared - tier.firstFloor + 1));
  const isFullyCleared = maxCleared >= tier.lastFloor;
  const isLocked = tier.firstFloor > maxCleared + 1;
  const isActive = !isFullyCleared && !isLocked;
  const isExpanded = expandedTiers.has(tier.id);

  // Status label + chevron. Active = chevron-down, otherwise indicator emoji.
  let statusBadge: string;
  if (isFullyCleared) statusBadge = `<span class="tier-badge cleared">✓ ALL CLEARED</span>`;
  else if (isLocked) statusBadge = `<span class="tier-badge locked">🔒 Locked</span>`;
  else statusBadge = `<span class="tier-badge active">${clearedInTier} / ${totalFloors} cleared</span>`;
  const chevron = isExpanded ? "▾" : "▸";

  const headerCls = ["stage-tier-header",
    isFullyCleared ? "cleared" : "",
    isLocked ? "locked" : "",
    isActive ? "active" : "",
    isExpanded ? "expanded" : "",
  ].filter(Boolean).join(" ");

  const subtitle = isLocked
    ? `Clear Floor ${tier.firstFloor - 1} to unlock`
    : isFullyCleared
      ? `Floors ${tier.firstFloor}–${tier.lastFloor} mastered`
      : `Floor ${maxCleared + 1} unlocked — keep climbing`;

  let body = "";
  if (isExpanded && !isLocked) {
    body = `<div class="stage-grid full-width">${tierFloors.map(s => stageTileHtml(s, energy, maxCleared)).join("")}</div>`;
  }

  return `
    <div class="stage-tier ${isLocked ? "tier-locked" : ""}">
      <button class="${headerCls}" data-tier="${tier.id}" type="button" ${isLocked ? "disabled" : ""}>
        <span class="tier-chevron">${chevron}</span>
        <span class="tier-label">${tier.label}</span>
        <span class="tier-range">Floor ${tier.firstFloor}–${tier.lastFloor}</span>
        ${statusBadge}
        <span class="tier-sub">${subtitle}</span>
      </button>
      ${body}
    </div>
  `;
}

function stageTileHtml(s: StageEnemyDef, energy: number, maxCleared: number): string {
  const unlocked = s.id <= maxCleared + 1;
  const noEnergy = energy <= 0;
  const playable = unlocked && !noEnergy;
  const cls = ["stage-tile",
    unlocked && !noEnergy ? "unlocked" : "locked",
    s.soloBoss ? "boss" : "",
  ].filter(Boolean).join(" ");
  const label = unlocked ? s.name : "Locked";
  const tag = s.soloBoss ? `<div class="stage-tag boss-tag">BOSS</div>` : "";
  const tooltip = unlocked ? stageTooltipHtml(s) : "";
  return `
    <button class="${cls}" data-stage="${s.id}" type="button" ${playable ? "" : "disabled"}>
      <div class="stage-num">Floor ${s.id}</div>
      <div class="stage-name">${label}</div>
      ${tag}
      ${tooltip}
    </button>
  `;
}

/** Build the floor-detail tooltip (enemies, levels, resist tags). Exported so
 *  other surfaces — currently the victory popup's "Next Floor" button — can
 *  show the same preview a player gets when hovering the campaign tile. */
export function stageTooltipHtml(s: StageEnemyDef): string {
  // Floors 100+ override enemy resists with a per-floor randomized profile
  // (see resistProfileForFloor in roster.ts). Show that instead of the
  // template's intrinsic resist so players can plan their party correctly.
  const floorResists = resistProfileForFloor(s.id);
  // Floors 51+ also override the level (Lv30→Lv70 linear scaling).
  const floorLevel = isPostGameFloor(s.id) ? postGameEnemyLevelFor(s.id) : null;

  const counts = new Map<string, { unit: UnitTemplate; count: number }>();
  for (const u of s.enemies) {
    const cur = counts.get(u.id);
    if (cur) cur.count += 1;
    else counts.set(u.id, { unit: u, count: 1 });
  }
  const rows = [...counts.values()].map(({ unit, count }) => {
    const lvl = floorLevel ?? unit.level ?? 1;
    // Floor 100+ profile takes priority and renders as tiered tags; otherwise
    // fall back to the template's intrinsic per-channel resist.
    const tags = floorResists
      ? tieredResistTags(floorResists)
      : resistTags(unit.resist);
    const atk = unit.atkMultiplier && unit.atkMultiplier > 1
      ? `<span class="stt-tag stt-warn">×${unit.atkMultiplier} ATK</span>`
      : "";
    return `
      <div class="stt-row">
        <span class="stt-portrait">${unit.portrait}</span>
        <span class="stt-name">${escapeHtml(unit.name)}${count > 1 ? ` ×${count}` : ""}</span>
        <span class="stt-lv">Lv${lvl}</span>
        ${tags}${atk}
      </div>
    `;
  }).join("");
  const heading = s.soloBoss ? "Solo Boss" : `${s.enemies.length} enemies`;
  return `
    <div class="stage-tooltip" role="tooltip">
      <div class="stt-head">
        <span class="stt-title">${escapeHtml(s.name)}</span>
        <span class="stt-meta">${heading}</span>
      </div>
      <div class="stt-rows">${rows}</div>
    </div>
  `;
}

function resistTags(r: DamageResistance | null | undefined): string {
  if (!r) return "";
  const tags: string[] = [];
  for (const key of ["physical", "magical", "melee", "range"] as const) {
    const v = r[key];
    if (v === undefined) continue;
    // mul 0   = 100% resist (only 1 dmg passes through)  → "immune"
    // mul <1  = partial resist (e.g. 0.3 → 70% resist)   → "resists"
    // mul >1  = vulnerability                            → "weak"
    if (v === 0) tags.push(`<span class="stt-tag stt-resist">immune ${key}</span>`);
    else if (v < 1) tags.push(`<span class="stt-tag stt-resist">resists ${key}</span>`);
    else if (v > 1) tags.push(`<span class="stt-tag stt-weak">weak ${key}</span>`);
  }
  return tags.join("");
}

/** Render the floor-100+ tiered resist profile as tags. We mark every
 *  channel in `resisted` as "resists X" — combat then escalates the actual
 *  damage reduction based on how many of an attack's two axes match
 *  (both → 90%, one → 60%, none → 0%). */
function tieredResistTags(t: import("../units/types").TieredResist): string {
  return t.resisted
    .map(ch => `<span class="stt-tag stt-resist">resists ${ch}</span>`)
    .join("");
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}
