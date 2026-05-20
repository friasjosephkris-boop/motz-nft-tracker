import { PLAYER_ROSTER, unitBaseAtLevel } from "../units/roster";
import { UnitTemplate } from "../units/types";
import { Stats, ZERO_STATS, sumStats, deriveStats, STAT_KEYS, StatKey } from "../core/stats";
import { classBaseAtLevel, getClass, CLASSES } from "../units/classes";
import { loadSettings } from "./settings";
import { hexStatSvg, hexLegendHtml } from "./hexStat";
import { getProgress, setProgress, UnitProgress, MAX_EQUIPPED_SKILLS, autoEquipNewlyUnlocked, rebuildLoadoutToStrongest } from "../core/progress";
import { xpToNext, MAX_LEVEL } from "../core/levels";
import { CLASS_SKILLS, CHARACTER_SKILLS, getSkill } from "../skills/registry";
import { isAdmin } from "../core/admin";
import { adminBumpXpCap } from "../auth/energyApi";
import { XP_TABLE } from "../core/levels";
import { portraitInner, capeHtml, isUnitLocked } from "../units/art";
import { confirmModal, alertModal } from "./confirmModal";
import { fetchShopStatus, consumeShopItem } from "../core/shop";

const LORE: Record<string, string> = {
  soda: "A fizzy elemental from the spring. Said to fight harder when shaken.",
  ego: "Sees its own reflection on every blade. Charming. Insufferable.",
  gruyere: "A wedge of ancient cheese. Surprisingly tough rind.",
  calypso: "Sings to the tide. The tide answers back, sometimes.",
  calico: "Three patches, three lives, one wicked grin.",
  nova: "Born from a starfall. Burns first, asks later.",
  hera: "Carries an old crown and an older grudge.",
  aspen: "Quiet ranger of the high pines. Aim true, leave no trace.",
  oge: "A walking boulder with a slow heart and a slow swing.",
  slime: "Common woodland goo. Rude but mostly harmless.",
  slime_king: "What every Slime aspires to. Bigger, gooier, royaler.",
};

let allocatingFor: string | null = null;       // template id currently in alloc modal
let allocDraft: Stats | null = null;             // pending custom stats during modal

export interface RenderUnitsScreenOpts {
  /** When set, restrict the roster grid to a single template id. Used by the
   *  tutorial stats step so the player only sees the unit they just chose. */
  onlyUnitId?: string;
  /** Forced onboarding: locks the player on this screen until they have
   *  picked a class for AT LEAST this many distinct units. Player chooses
   *  which units and which classes themselves — full roster stays visible. */
  forceClassPickRequired?: number;
  /** Forced onboarding: auto-opens the stat allocator on this unit and locks
   *  the player on the screen until they finalize their allocation. */
  forceStatAllocFor?: string;
  /** Called when the forced action completes (class chosen OR points spent).
   *  Caller should clear its pending flag and route the player onward. */
  onForcedComplete?: () => void;
  /** When true, hides the back button (used by forced flows). */
  hideBack?: boolean;
  /** Optional banner shown above the roster grid — used by forced flows to
   *  tell the player exactly what they need to do. */
  topBanner?: string;
}

/** Units-screen header. Replaces the plain text top-bar with the "UNITS"
 *  title-banner artwork (public/for unit box.png) — the art already contains
 *  the word "UNITS", so no text is rendered. The Back button is overlaid in
 *  the top-left corner; it keeps id="back-btn" so the existing click wiring
 *  in renderUnitsScreen still finds it. */
function unitsBannerHtml(backVisible: boolean): string {
  return `
    <div class="units-banner">
      ${backVisible ? `<button class="back-btn units-banner-back" id="back-btn" type="button">← Back</button>` : ""}
    </div>
  `;
}

export function renderUnitsScreen(root: HTMLElement, onBack: () => void, opts: RenderUnitsScreenOpts = {}): void {
  const pickingFor = new Set<string>();
  const editingSkillsFor = new Set<string>();
  // Units that are mid-pick via a spent Unit Class Change token (as opposed
  // to an initial pick or a dev/admin change). Tracked separately so the
  // pick handler knows to consume the entitlement + reset custom stats.
  const tokenChangeFor = new Set<string>();
  // How many Unit Class Change entitlement tokens the wallet owns. Starts at
  // 0 and is filled in by an async fetchShopStatus() right after first draw —
  // when > 0, locked-class units get a "Change Class" button instead of the
  // bare "🔒 locked" tag (the bug MisterBanatero hit: bought the item, no UI
  // to spend it).
  let classChangeTokens = 0;
  // Forced stat-alloc does NOT auto-open the allocator — the player must
  // click the highlighted "Allocate" button themselves so the action feels
  // intentional. All other interactions are disabled via CSS while forced.
  // Snapshot the baseline points so we can tell "saved" apart from "cancelled".
  const statAllocBaseline = opts.forceStatAllocFor
    ? getProgress(opts.forceStatAllocFor).availablePoints
    : 0;
  const settings = loadSettings();
  const admin = isAdmin();
  // Forced stat-alloc shows just the unit being leveled; everything else
  // (incl. forced class pick) shows the full roster so the player picks
  // which units they want to class up.
  const roster = opts.onlyUnitId
    ? PLAYER_ROSTER.filter(t => t.id === opts.onlyUnitId)
    : opts.forceStatAllocFor
    ? PLAYER_ROSTER.filter(t => t.id === opts.forceStatAllocFor)
    : PLAYER_ROSTER;

  // Helper: how many units currently have a class assigned? Drives the
  // forced-class-pick completion check and the banner progress count.
  const countClassedUnits = (): number => {
    let n = 0;
    for (const t of PLAYER_ROSTER) {
      if (getProgress(t.id).classId) n++;
    }
    return n;
  };

  const draw = () => {
    const backVisible = !opts.hideBack;
    // Compose the banner: caller-supplied + live progress counter for the
    // forced class-pick flow.
    let bannerHtml = "";
    if (opts.topBanner || opts.forceClassPickRequired) {
      const required = opts.forceClassPickRequired ?? 0;
      const have = required > 0 ? countClassedUnits() : 0;
      const progress = required > 0
        ? `<span class="units-forced-progress">${have}/${required} classes picked</span>`
        : "";
      bannerHtml = `<div class="units-forced-banner">${opts.topBanner ?? ""}${progress}</div>`;
    }
    const forceClasses = [
      opts.forceClassPickRequired ? "force-class-pick" : "",
      opts.forceStatAllocFor ? "force-stat-alloc" : "",
    ].filter(Boolean).join(" ");
    root.innerHTML = `
      <div class="screen-frame units-screen ${forceClasses}">
        <div class="units-sticky-header">
          ${unitsBannerHtml(backVisible)}
          ${bannerHtml}
          ${hexLegendHtml()}
        </div>
        <div class="units-section">
          <div class="section-label">Player roster</div>
          <div class="units-grid">
            ${roster.map(t => unitCardHtml(t, pickingFor.has(t.id), settings.devUnlockClass || admin, admin, editingSkillsFor.has(t.id), classChangeTokens)).join("")}
          </div>
        </div>
      </div>
      ${allocatingFor ? allocModalHtml(allocatingFor) : ""}
    `;
    if (backVisible) root.querySelector("#back-btn")?.addEventListener("click", onBack);
    wireOpenAlloc(root, draw);
    wireAllocModal(root, () => {
      // ALWAYS redraw first so the alloc modal HTML is removed from the DOM
      // immediately after Save (allocatingFor was already cleared by the
      // save handler). Without this, the modal stays visually open during
      // the async pushProgress + showHome navigation — player thinks the
      // page froze.
      draw();
      if (opts.forceStatAllocFor && allocatingFor === null && opts.onForcedComplete) {
        const cur = getProgress(opts.forceStatAllocFor);
        if (cur.availablePoints < statAllocBaseline) {
          opts.onForcedComplete();
        }
      }
    });
    wireClassPicker(root, pickingFor, tokenChangeFor, settings.devUnlockClass || admin, () => {
      // Same pattern — redraw first so the class-picker UI updates with the
      // just-saved class assignment before we navigate away.
      draw();
      if (opts.forceClassPickRequired && opts.onForcedComplete) {
        const have = countClassedUnits();
        if (have >= opts.forceClassPickRequired) {
          opts.onForcedComplete();
        }
      }
    }, () => {
      // onTokenConsumed — drop the local count so the button label / gating
      // updates on the next draw without another shop fetch.
      classChangeTokens = Math.max(0, classChangeTokens - 1);
    });
    wireSkillLoadout(root, editingSkillsFor, draw);
    wireAdminControls(root, admin, draw);
  };
  draw();
  // Pull the wallet's Unit Class Change token count so locked-class units can
  // offer a "Change Class" button. Async — redraws once when it lands.
  void fetchShopStatus().then(status => {
    if (!status) return;
    const owned = status.inventory.buffs?.unit_class_change ?? 0;
    if (owned !== classChangeTokens) {
      classChangeTokens = owned;
      draw();
    }
  }).catch(() => undefined);
}

function isPlayerTemplate(id: string): boolean {
  return PLAYER_ROSTER.some(t => t.id === id);
}

function unitCardHtml(t: UnitTemplate, isPicking: boolean, devUnlock: boolean, admin: boolean, isEditingSkills: boolean, classChangeTokens: number): string {
  const isPlayer = isPlayerTemplate(t.id);
  const progress: UnitProgress | null = isPlayer ? getProgress(t.id) : null;

  const lvlForBase = progress?.level ?? t.level ?? 1;
  const unit = unitBaseAtLevel(t, lvlForBase);
  const classId = progress?.classId ?? t.classId;
  const cls = classBaseAtLevel(classId, lvlForBase);
  const cust = progress?.customStats ?? t.customStats ?? { ...ZERO_STATS };
  const effective = sumStats(unit, cls, cust);
  const d = deriveStats(effective);
  const maxHp = t.overrideMaxHp ?? d.maxHp;
  const maxMp = t.overrideMaxMp ?? d.maxMp;
  const lore = LORE[t.id] ?? "Lore coming soon.";
  const className = classId ? (getClass(classId)?.name ?? "—") : "—";
  const lvl = progress?.level ?? t.level ?? 1;
  const points = progress?.availablePoints ?? 0;
  const xp = progress?.xp ?? 0;

  const locked = isPlayer && isUnitLocked(t.id);
  const lockedAttr = locked ? ` data-locked="motz_key"` : "";
  const lockedOverlay = locked ? `<div class="unit-locked-overlay" title="Requires MoTZ Vault Key">🔒 MoTZ Vault Key</div>` : "";

  return `
    <div class="unit-card${locked ? " locked-card" : ""}" data-template="${escapeAttr(t.id)}"${lockedAttr}>
      ${lockedOverlay}
      <div class="unit-card-head">
        <div class="portrait">${capeHtml(classId)}${portraitInner(t.id, t.portrait)}</div>
        <div class="unit-card-head-info">
          <div class="unit-card-name"><span class="lv-inline">Lv${lvl}</span> ${escapeHtml(t.name)}</div>
          <div class="unit-card-hp">HP ${maxHp} · MP ${maxMp} · Class: ${escapeHtml(className)}</div>
          ${isPlayer && admin ? `
            <div class="admin-row-inline">
              <button class="admin-btn" data-admin-levelup="${escapeAttr(t.id)}" type="button" ${lvl >= MAX_LEVEL ? "disabled" : ""}>+ Level</button>
              <button class="admin-btn" data-admin-reset-stats="${escapeAttr(t.id)}" type="button">Reset Stats</button>
              <button class="admin-btn" data-admin-reset-level="${escapeAttr(t.id)}" type="button" ${lvl <= 1 ? "disabled" : ""}>Reset Level</button>
            </div>
          ` : ""}
        </div>
      </div>

      ${isPlayer ? xpBarHtml(lvl, xp) : ""}

      ${isPlayer ? classRowHtml(t, classId, isPicking, devUnlock, classChangeTokens) : ""}

      <div class="hex-wrap">${hexStatSvg({ unit, classBase: cls, custom: cust, size: 150 })}</div>

      ${isPlayer ? statSummaryHtml(t.id, cust, points) : ""}

      ${isPlayer ? skillLoadoutHtml(t, classId, lvl, isEditingSkills, progress?.equippedSkills ?? []) : ""}

      <div class="derived-grid">
        ${pillHtml("PhysAtk", d.physAtk)}
        ${pillHtml("MagAtk", d.magAtk)}
        ${pillHtml("PhysDef", d.physDef)}
        ${pillHtml("MagDef", d.magDef)}
        ${pillHtml("Speed", d.speed)}
        ${pillHtml("Acc", d.accuracy)}
        ${pillHtml("Crit%", d.critPoints)}
        ${pillHtml("Eva%", d.evadePoints)}
      </div>

      <div class="unit-card-lore">${escapeHtml(lore)}</div>
    </div>
  `;
}

function xpBarHtml(level: number, xp: number): string {
  if (level >= MAX_LEVEL) {
    return `
      <div class="xp-row">
        <span class="xp-row-label">XP</span>
        <div class="bar xp maxed"><div class="fill" style="width:100%"></div><span class="bar-text">MAX (Lv${MAX_LEVEL})</span></div>
      </div>
    `;
  }
  const need = xpToNext(level);
  const pct = (xp / need) * 100;
  return `
    <div class="xp-row">
      <span class="xp-row-label">XP</span>
      <div class="bar xp"><div class="fill" style="width:${pct}%"></div><span class="bar-text">${xp}/${need}</span></div>
    </div>
  `;
}

function classRowHtml(t: UnitTemplate, classId: string | undefined, isPicking: boolean, devUnlock: boolean, classChangeTokens: number): string {
  const locked = !!classId && !devUnlock;
  if (isPicking) {
    return `
      <div class="class-row picking">
        <div class="class-row-head">Pick a class for ${escapeHtml(t.name)}: <em class="warning">cannot change later this season</em></div>
        <div class="class-pick-grid">
          ${CLASSES.map(c => `
            <button class="class-pick-btn ${classId === c.id ? "current" : ""}" data-pick-class="${escapeAttr(c.id)}" data-template="${escapeAttr(t.id)}" type="button">
              <div class="class-name">${escapeHtml(c.name)}</div>
              <div class="class-role">${escapeHtml(c.role)}</div>
              ${classSkillTipHtml(c.id)}
            </button>
          `).join("")}
        </div>
        <div class="class-pick-actions">
          <button class="ghost-btn" data-cancel-pick="${escapeAttr(t.id)}" type="button">Cancel</button>
        </div>
      </div>
    `;
  }
  if (!classId) {
    return `
      <div class="class-row">
        <span class="class-row-text">No class assigned.</span>
        <button class="ghost-btn" data-open-pick="${escapeAttr(t.id)}" type="button">Pick class</button>
      </div>
    `;
  }
  const cls = getClass(classId);
  // Action shown next to a chosen class:
  //  - dev/admin unlock → "Change (dev)" (free re-pick)
  //  - owns a Unit Class Change token → "Change Class" button that spends it
  //  - otherwise → bare "🔒 locked" tag (season lock, no token)
  let actionHtml: string;
  if (!locked) {
    actionHtml = `<button class="ghost-btn" data-open-pick="${escapeAttr(t.id)}" type="button">Change (dev)</button>`;
  } else if (classChangeTokens > 0) {
    actionHtml = `<button class="ghost-btn class-change-token-btn" data-token-change-class="${escapeAttr(t.id)}" type="button" title="Spend 1 Unit Class Change token — resets this unit's custom stats">🛡 Change Class (${classChangeTokens})</button>`;
  } else {
    actionHtml = `<span class="locked-tag" title="Locked for the season — buy a Unit Class Change in the Shop to change it">🔒 locked</span>`;
  }
  return `
    <div class="class-row chosen">
      <span class="class-row-text">Class: <strong>${escapeHtml(cls?.name ?? classId)}</strong> · ${escapeHtml(cls?.role ?? "")}</span>
      ${actionHtml}
    </div>
  `;
}

function classSkillTipHtml(classId: string): string {
  const ids = CLASS_SKILLS[classId] ?? [];
  if (ids.length === 0) return "";
  const sorted = [...ids].sort((a, b) => (getSkill(a).unlockLevel ?? 1) - (getSkill(b).unlockLevel ?? 1));
  const rows = sorted.map(id => {
    const s = getSkill(id);
    const lvl = s.unlockLevel ?? 1;
    return `<div class="class-tip-row">
      <span class="class-tip-skill"><span class="class-tip-lvl">Lv${lvl}</span> ${escapeHtml(s.name)}</span>
      <span class="class-tip-desc">${escapeHtml(s.description)}</span>
    </div>`;
  }).join("");
  return `<span class="class-tip">
    <span class="class-tip-head">Class skills</span>
    ${rows}
  </span>`;
}

function skillLoadoutHtml(t: UnitTemplate, classId: string | undefined, level: number, editing: boolean, equipped: string[]): string {
  const charSkills = CHARACTER_SKILLS[t.id] ?? [];
  const classSkills = classId ? (CLASS_SKILLS[classId] ?? []) : [];
  const pool = [...charSkills, ...classSkills];

  // Filter to currently unlocked skills (level requirement met).
  const unlocked = pool.filter(id => (getSkill(id).unlockLevel ?? 1) <= level);
  const lockedNext = pool.filter(id => (getSkill(id).unlockLevel ?? 1) > level)
    .sort((a, b) => (getSkill(a).unlockLevel ?? 1) - (getSkill(b).unlockLevel ?? 1));

  if (!editing) {
    const eqVisible = equipped.filter(id => unlocked.includes(id));
    const chip = (id: string, locked: boolean) => {
      const s = getSkill(id);
      const lvlNote = locked ? `Unlocks Lv${s.unlockLevel ?? 1}` : `${s.mpCost > 0 ? `${s.mpCost} MP` : "0 MP"}${s.cooldown > 0 ? ` · CD ${s.cooldown}` : ""}`;
      const cls = ["skill-chip", locked ? "locked" : "", eqVisible.includes(id) ? "equipped" : ""].filter(Boolean).join(" ");
      return `<span class="${cls}">
        ${locked ? "🔒 " : ""}${escapeHtml(s.name)}
        <span class="skill-tip"><span class="skill-tip-name">${escapeHtml(s.name)}</span><span class="skill-tip-desc">${escapeHtml(s.description)}</span><span class="skill-tip-meta">${escapeHtml(lvlNote)}</span></span>
      </span>`;
    };

    const equippedChips = eqVisible.length > 0
      ? eqVisible.map(id => chip(id, false)).join("")
      : `<span class="skill-empty">(no skills equipped — Idle only)</span>`;

    const remainingUnlocked = unlocked.filter(id => !eqVisible.includes(id));
    const lockedSorted = lockedNext;
    const browseChips = [
      ...remainingUnlocked.map(id => chip(id, false)),
      ...lockedSorted.map(id => chip(id, true)),
    ].join("");

    return `
      <div class="skill-loadout">
        <div class="skill-loadout-head">
          <span class="skill-loadout-label">Equipped (${eqVisible.length}/${MAX_EQUIPPED_SKILLS})</span>
          <div class="skill-loadout-actions">
            <button class="ghost-btn" data-auto-equip="${escapeAttr(t.id)}" type="button" ${unlocked.length === 0 ? "disabled" : ""} title="Auto-equip the strongest ${MAX_EQUIPPED_SKILLS} unlocked skills">Auto-Equip</button>
            <button class="ghost-btn" data-edit-skills="${escapeAttr(t.id)}" type="button" ${pool.length === 0 ? "disabled" : ""}>Edit Loadout</button>
          </div>
        </div>
        <div class="skill-chips">${equippedChips}</div>
        ${browseChips ? `
          <div class="skill-loadout-sub">All skills (hover for details)</div>
          <div class="skill-chips skill-chips-browse">${browseChips}</div>
        ` : ""}
      </div>
    `;
  }

  const checkboxes = unlocked.map(id => {
    const s = getSkill(id);
    const checked = equipped.includes(id);
    return `
      <label class="skill-pick">
        <div class="skill-pick-row">
          <input type="checkbox" data-skill-toggle="${escapeAttr(t.id)}" data-skill-id="${escapeAttr(id)}" ${checked ? "checked" : ""}>
          <span class="skill-pick-name">${escapeHtml(s.name)}</span>
          <span class="skill-pick-meta">${s.mpCost > 0 ? `${s.mpCost} MP` : ""}${s.cooldown > 0 ? ` · CD ${s.cooldown}` : ""}</span>
        </div>
        <div class="skill-pick-desc">${escapeHtml(s.description)}</div>
      </label>
    `;
  }).join("");
  const lockedPreview = lockedNext.slice(0, 3).map(id => {
    const s = getSkill(id);
    return `<div class="skill-pick locked">
      <div class="skill-pick-row">
        <span class="skill-pick-name">🔒 ${escapeHtml(s.name)}</span>
        <span class="skill-pick-meta">unlocks Lv${s.unlockLevel}</span>
      </div>
      <div class="skill-pick-desc">${escapeHtml(s.description)}</div>
    </div>`;
  }).join("");

  return `
    <div class="skill-loadout editing">
      <div class="skill-loadout-head">
        <span class="skill-loadout-label">Pick up to ${MAX_EQUIPPED_SKILLS} skills for combat</span>
        <button class="ghost-btn" data-edit-skills-done="${escapeAttr(t.id)}" type="button">Done</button>
      </div>
      <div class="skill-pick-grid">
        ${unlocked.length > 0 ? checkboxes : `<div class="skill-empty">No skills unlocked yet. Pick a class and level up.</div>`}
        ${lockedPreview}
      </div>
    </div>
  `;
}

function statSummaryHtml(templateId: string, custom: Stats, points: number): string {
  // Show the per-stat allocation chips only when there's something to look at —
  // either the player has put points in OR has points to spend. A roster of
  // "STR +0 DEF +0 AGI +0 …" chips for every Lv 1 unit is pure noise.
  const totalAllocated = STAT_KEYS.reduce((sum, k) => sum + (custom[k] ?? 0), 0);
  const showChips = totalAllocated > 0;
  const chips = showChips
    ? STAT_KEYS.filter(k => (custom[k] ?? 0) > 0)
        .map(k => `<span class="stat-mini">${k} +${custom[k]}</span>`).join("")
    : "";
  // Skip the row entirely when nothing to allocate AND nothing already spent.
  if (!showChips && points <= 0) return "";
  return `
    <div class="stat-alloc-row">
      <div class="stat-mini-grid">${chips}</div>
      <button class="alloc-open-btn" data-open-alloc="${escapeAttr(templateId)}" type="button" ${points <= 0 ? "disabled" : ""}>
        ${points > 0 ? `Allocate · ${points} pt${points === 1 ? "" : "s"}` : "Allocated"}
      </button>
    </div>
  `;
}

function allocModalHtml(templateId: string): string {
  const t = PLAYER_ROSTER.find(p => p.id === templateId);
  if (!t) return "";
  const progress = getProgress(templateId);
  if (!allocDraft) {
    allocDraft = { ...ZERO_STATS, ...progress.customStats };
  }
  const used = STAT_KEYS.reduce((sum, k) => sum + Math.max(0, allocDraft![k] - (progress.customStats[k] ?? 0)), 0);
  const remaining = progress.availablePoints - used;
  return `
    <div class="modal-overlay" id="alloc-modal-overlay">
      <div class="modal-panel">
        <div class="modal-title">Stat Point Allocation — ${escapeHtml(t.name)}</div>
        <div class="modal-sub">Available: <strong>${remaining}</strong> point${remaining === 1 ? "" : "s"}</div>

        <div class="alloc-row">
          ${STAT_KEYS.map(k => {
            const baseVal = progress.customStats[k] ?? 0;
            const cur = allocDraft![k];
            const canDec = cur > baseVal;
            const canInc = remaining > 0;
            return `
              <div class="alloc-cell">
                <span class="alloc-label">${k}</span>
                <span class="alloc-value">+${cur}</span>
                <div class="alloc-buttons">
                  <button class="alloc-btn dec" data-alloc-dec="${k}" type="button" ${canDec ? "" : "disabled"}>−</button>
                  <button class="alloc-btn inc" data-alloc-inc="${k}" type="button" ${canInc ? "" : "disabled"}>+</button>
                </div>
              </div>
            `;
          }).join("")}
        </div>

        <div class="modal-actions">
          <button class="ghost-btn" id="alloc-cancel" type="button">Cancel</button>
          <button class="confirm-btn" id="alloc-finalize" type="button" ${used === 0 ? "disabled" : ""}>Finalize (${used})</button>
        </div>
      </div>
    </div>
  `;
}

function pillHtml(label: string, value: number): string {
  return `<div class="pill"><span class="pill-label">${label}</span><span class="pill-value">${value.toFixed(0)}</span></div>`;
}

function wireOpenAlloc(root: HTMLElement, redraw: () => void): void {
  root.querySelectorAll<HTMLButtonElement>("[data-open-alloc]").forEach(btn => {
    btn.addEventListener("click", () => {
      allocatingFor = btn.dataset.openAlloc!;
      allocDraft = null;
      redraw();
    });
  });
}

function wireAllocModal(root: HTMLElement, redraw: () => void): void {
  if (!allocatingFor || !allocDraft) return;

  root.querySelectorAll<HTMLButtonElement>("[data-alloc-inc]").forEach(btn => {
    btn.addEventListener("click", () => {
      const k = btn.dataset.allocInc as StatKey;
      const progress = getProgress(allocatingFor!);
      const used = STAT_KEYS.reduce((sum, kk) => sum + Math.max(0, allocDraft![kk] - (progress.customStats[kk] ?? 0)), 0);
      if (used >= progress.availablePoints) return;
      allocDraft![k] = (allocDraft![k] ?? 0) + 1;
      redraw();
    });
  });
  root.querySelectorAll<HTMLButtonElement>("[data-alloc-dec]").forEach(btn => {
    btn.addEventListener("click", () => {
      const k = btn.dataset.allocDec as StatKey;
      const progress = getProgress(allocatingFor!);
      const baseVal = progress.customStats[k] ?? 0;
      if (allocDraft![k] <= baseVal) return;
      allocDraft![k] = allocDraft![k] - 1;
      redraw();
    });
  });

  root.querySelector<HTMLButtonElement>("#alloc-cancel")?.addEventListener("click", () => {
    allocatingFor = null;
    allocDraft = null;
    redraw();
  });

  root.querySelector<HTMLButtonElement>("#alloc-finalize")?.addEventListener("click", async () => {
    const tid = allocatingFor!;
    const progress = getProgress(tid);
    const used = STAT_KEYS.reduce((sum, kk) => sum + Math.max(0, allocDraft![kk] - (progress.customStats[kk] ?? 0)), 0);
    if (used <= 0) return;
    const ok = await confirmModal({
      title: "Finalize Stat Points?",
      message: `Spend <strong>${used}</strong> stat point${used === 1 ? "" : "s"}?<br><br>This allocation is final.`,
      confirmLabel: "Spend",
      cancelLabel: "Cancel",
    });
    if (!ok) return;
    const next: UnitProgress = {
      ...progress,
      customStats: { ...allocDraft! },
      availablePoints: progress.availablePoints - used,
    };
    setProgress(tid, next);
    allocatingFor = null;
    allocDraft = null;
    redraw();
  });
}

function wireSkillLoadout(root: HTMLElement, editing: Set<string>, redraw: () => void): void {
  root.querySelectorAll<HTMLButtonElement>("[data-edit-skills]").forEach(btn => {
    btn.addEventListener("click", () => {
      editing.add(btn.dataset.editSkills!);
      redraw();
    });
  });
  // One-click "rebuild loadout from strongest N unlocked skills" — useful for
  // units whose loadout was set by the OLD auto-equip logic and is now stuck
  // with low-tier skills even though stronger ones are unlocked.
  root.querySelectorAll<HTMLButtonElement>("[data-auto-equip]").forEach(btn => {
    btn.addEventListener("click", () => {
      const tid = btn.dataset.autoEquip!;
      const cur = getProgress(tid);
      // Explicit player action — rebuild to the strongest N skills. The
      // automatic per-level-up function (autoEquipNewlyUnlocked) is
      // intentionally non-destructive; only this button rebuilds.
      const next = rebuildLoadoutToStrongest(tid, cur.classId, cur.level);
      setProgress(tid, { ...cur, equippedSkills: next });
      redraw();
    });
  });
  root.querySelectorAll<HTMLButtonElement>("[data-edit-skills-done]").forEach(btn => {
    btn.addEventListener("click", () => {
      editing.delete(btn.dataset.editSkillsDone!);
      redraw();
    });
  });
  root.querySelectorAll<HTMLInputElement>("[data-skill-toggle]").forEach(cb => {
    cb.addEventListener("change", () => {
      const tid = cb.dataset.skillToggle!;
      const sid = cb.dataset.skillId!;
      const cur = getProgress(tid);
      const equipped = new Set<string>(cur.equippedSkills ?? []);
      if (cb.checked) {
        if (equipped.size >= MAX_EQUIPPED_SKILLS) {
          cb.checked = false;
          void alertModal({
            kind: "warning",
            title: "Loadout Full",
            message: `You can equip at most <strong>${MAX_EQUIPPED_SKILLS} skills</strong>. Uncheck one you're already using to free a slot.`,
          });
          return;
        }
        equipped.add(sid);
      } else {
        equipped.delete(sid);
      }
      setProgress(tid, { ...cur, equippedSkills: [...equipped] });
      redraw();
    });
  });
}

function wireAdminControls(root: HTMLElement, admin: boolean, redraw: () => void): void {
  if (!admin) return;
  root.querySelectorAll<HTMLButtonElement>("[data-admin-levelup]").forEach(btn => {
    btn.addEventListener("click", async () => {
      const tid = btn.dataset.adminLevelup!;
      const cur = getProgress(tid);
      if (cur.level >= MAX_LEVEL) return;
      // Bump the server XP cap BEFORE writing the local level. The server's
      // progress_sync validator rejects any wallet whose claimed totalXp
      // exceeds the cap + slack — without this pre-bump, the next push
      // (debounced 500ms after setProgress) would roll the level back to
      // canonical. Bump by exactly the XP needed for the new level, so
      // legit play continues to count after the admin grant.
      const xpForLevel = XP_TABLE[cur.level - 1] ?? 0;
      if (xpForLevel > 0) {
        btn.disabled = true;
        const r = await adminBumpXpCap(xpForLevel);
        btn.disabled = false;
        if (!r.ok) {
          // Surface the server reason so it's clear why nothing happened.
          // eslint-disable-next-line no-alert
          alert(`Couldn't raise XP cap: ${r.error ?? "unknown error"}`);
          return;
        }
      }
      const newLevel = cur.level + 1;
      const equippedSkills = autoEquipNewlyUnlocked(tid, cur.classId, newLevel, cur.equippedSkills ?? []);
      setProgress(tid, {
        ...cur,
        level: newLevel,
        xp: 0,
        availablePoints: cur.availablePoints + 4,
        equippedSkills,
      });
      redraw();
    });
  });
  root.querySelectorAll<HTMLButtonElement>("[data-admin-reset-stats]").forEach(btn => {
    btn.addEventListener("click", async () => {
      const tid = btn.dataset.adminResetStats!;
      const cur = getProgress(tid);
      const refund = STAT_KEYS.reduce((sum, k) => sum + (cur.customStats[k] ?? 0), 0);
      if (refund === 0 && cur.availablePoints === 0) return;
      const ok = await confirmModal({
        title: "Refund Stats?",
        message: `Refund <strong>${refund}</strong> allocated point${refund === 1 ? "" : "s"} back to available?<br><br>This zeroes out the unit's custom stat allocation.`,
        confirmLabel: "Refund",
        cancelLabel: "Cancel",
        danger: true,
      });
      if (!ok) return;
      setProgress(tid, {
        ...cur,
        customStats: { ...ZERO_STATS },
        availablePoints: cur.availablePoints + refund,
      });
      redraw();
    });
  });
  root.querySelectorAll<HTMLButtonElement>("[data-admin-reset-level]").forEach(btn => {
    btn.addEventListener("click", async () => {
      const tid = btn.dataset.adminResetLevel!;
      const cur = getProgress(tid);
      if (cur.level <= 1) return;
      const ok = await confirmModal({
        title: "Reset to Lv 1?",
        message: `Reset this unit to <strong>Lv 1</strong>?<br><br>Clears XP, level progress, allocated stat points, and any unspent points. Equipped class and skills stay.`,
        confirmLabel: "Reset",
        cancelLabel: "Cancel",
        danger: true,
      });
      if (!ok) return;
      // Trim equipped skills back to those actually unlocked at level 1.
      const trimmedEquipped = (cur.equippedSkills ?? []).filter(id => {
        const s = getSkill(id);
        return (s.unlockLevel ?? 1) <= 1;
      });
      setProgress(tid, {
        ...cur,
        level: 1,
        xp: 0,
        customStats: { ...ZERO_STATS },
        availablePoints: 0,
        equippedSkills: trimmedEquipped,
      });
      redraw();
    });
  });
}

function wireClassPicker(
  root: HTMLElement,
  pickingFor: Set<string>,
  tokenChangeFor: Set<string>,
  devUnlock: boolean,
  redraw: () => void,
  onTokenConsumed: () => void,
): void {
  root.querySelectorAll<HTMLButtonElement>("[data-open-pick]").forEach(btn => {
    btn.addEventListener("click", () => {
      pickingFor.add(btn.dataset.openPick!);
      redraw();
    });
  });
  // Token-spend class change: the player owns a Unit Class Change entitlement.
  // Warn about the stat reset BEFORE opening the picker so they don't pick a
  // class and only then learn their build gets wiped.
  root.querySelectorAll<HTMLButtonElement>("[data-token-change-class]").forEach(btn => {
    btn.addEventListener("click", async () => {
      const tid = btn.dataset.tokenChangeClass!;
      const ok = await confirmModal({
        title: "Change This Unit's Class?",
        message: `This spends <strong>1 Unit Class Change</strong> token and <strong>resets this unit's custom stats</strong> — every allocated point is refunded so you can re-spend it on the new build. Equipped skills are rebuilt for the new class.<br><br>Continue to pick the new class?`,
        confirmLabel: "Continue",
        cancelLabel: "Cancel",
      });
      if (!ok) return;
      pickingFor.add(tid);
      tokenChangeFor.add(tid);
      redraw();
    });
  });
  root.querySelectorAll<HTMLButtonElement>("[data-cancel-pick]").forEach(btn => {
    btn.addEventListener("click", () => {
      const tid = btn.dataset.cancelPick!;
      pickingFor.delete(tid);
      tokenChangeFor.delete(tid);  // cancelling a token change spends nothing
      redraw();
    });
  });
  root.querySelectorAll<HTMLButtonElement>("[data-pick-class]").forEach(btn => {
    btn.addEventListener("click", () => {
      const classId = btn.dataset.pickClass!;
      const tid = btn.dataset.template!;
      const cur = getProgress(tid);
      const isTokenChange = tokenChangeFor.has(tid);
      // Block re-picking an already-classed unit UNLESS this is a dev unlock
      // or a legitimate token spend.
      if (cur.classId && !devUnlock && !isTokenChange) return;
      openClassConfirmModal(root, classId, tid, async () => {
        if (isTokenChange) {
          // Consume the entitlement server-side FIRST. Only mutate the unit
          // if the token actually burned — otherwise a race / already-spent
          // token would hand out a free class change.
          const consumed = await consumeShopItem("unit_class_change");
          if (!consumed) {
            await alertModal({
              kind: "error",
              title: "Couldn't Use Token",
              message: "Your Unit Class Change token couldn't be consumed — it may have already been used. Refresh the screen and try again.",
            });
            tokenChangeFor.delete(tid);
            pickingFor.delete(tid);
            redraw();
            return;
          }
          const c = getProgress(tid);
          // Reset custom stats per the item's terms; refund every earned
          // point so the player rebuilds from scratch. earnedPoints = (lvl-1)*4.
          const refundedPoints = Math.max(0, (c.level - 1) * 4);
          const equippedSkills = autoEquipNewlyUnlocked(tid, classId, c.level, []);
          setProgress(tid, {
            ...c,
            classId,
            customStats: { ...ZERO_STATS },
            availablePoints: refundedPoints,
            equippedSkills,
          });
          tokenChangeFor.delete(tid);
          pickingFor.delete(tid);
          onTokenConsumed();
          redraw();
          await alertModal({
            kind: "success",
            title: "Class Changed",
            message: `Class updated. This unit's custom stats were reset — <strong>${refundedPoints}</strong> point${refundedPoints === 1 ? "" : "s"} are available to re-allocate on the Units screen.`,
          });
          return;
        }
        // Non-token path — initial class pick, or a free dev/admin change.
        const c = getProgress(tid);
        const equippedSkills = autoEquipNewlyUnlocked(tid, classId, c.level, c.equippedSkills ?? []);
        setProgress(tid, { ...c, classId, equippedSkills });
        pickingFor.delete(tid);
        redraw();
      });
    });
  });
}

function openClassConfirmModal(root: HTMLElement, classId: string, templateId: string, onConfirm: () => void): void {
  const cls = getClass(classId);
  if (!cls) return;
  const ids = CLASS_SKILLS[classId] ?? [];
  const sorted = [...ids].sort((a, b) => (getSkill(a).unlockLevel ?? 1) - (getSkill(b).unlockLevel ?? 1));
  const skillRows = sorted.map(id => {
    const s = getSkill(id);
    const lvl = s.unlockLevel ?? 1;
    const meta = `${s.mpCost > 0 ? `${s.mpCost} MP` : "0 MP"}${s.cooldown > 0 ? ` · CD ${s.cooldown}` : ""}`;
    return `
      <div class="class-confirm-skill">
        <div class="class-confirm-skill-head">
          <span class="class-tip-lvl">Lv${lvl}</span>
          <span class="class-confirm-skill-name">${escapeHtml(s.name)}</span>
          <span class="class-confirm-skill-meta">${escapeHtml(meta)}</span>
        </div>
        <div class="class-confirm-skill-desc">${escapeHtml(s.description)}</div>
      </div>
    `;
  }).join("");

  const overlay = document.createElement("div");
  overlay.className = "modal-overlay class-confirm-modal";
  overlay.innerHTML = `
    <div class="modal-panel">
      <div class="modal-title">Confirm Class — ${escapeHtml(cls.name)}</div>
      <div class="modal-sub">Role: ${escapeHtml(cls.role)}</div>
      <div class="class-confirm-warning">
        <strong>Warning:</strong> Once you confirm, this class is locked for the season and cannot be changed.
      </div>
      <div class="class-confirm-skills">
        <div class="class-confirm-skills-head">Class skills</div>
        ${skillRows || `<div class="skill-empty">(no class skills defined)</div>`}
      </div>
      <div class="modal-actions">
        <button class="ghost-btn" data-class-confirm-cancel type="button">Cancel</button>
        <button class="confirm-btn" data-class-confirm-ok type="button">Confirm ${escapeHtml(cls.name)}</button>
      </div>
    </div>
  `;
  root.appendChild(overlay);

  const close = () => { overlay.remove(); };
  overlay.querySelector<HTMLButtonElement>("[data-class-confirm-cancel]")?.addEventListener("click", close);
  overlay.querySelector<HTMLButtonElement>("[data-class-confirm-ok]")?.addEventListener("click", () => {
    close();
    onConfirm();
  });
  overlay.addEventListener("click", e => { if (e.target === overlay) close(); });
  void templateId;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  } as Record<string, string>)[c]);
}
function escapeAttr(s: string): string { return escapeHtml(s); }
