import { UnitTemplate, DamageResistance } from "../units/types";
import { PlayerSlot } from "../core/combat";
import { PLAYER_ROSTER, MAX_PARTY_SIZE, getStage, STAGE_DEFS, unitBaseAtLevel } from "../units/roster";
import { topBarHtml } from "./settings";
import { getProgress, setProgress, MAX_EQUIPPED_SKILLS } from "../core/progress";
import { Stats, ZERO_STATS, sumStats } from "../core/stats";
import { classBaseAtLevel } from "../units/classes";
import { hexStatSvg } from "./hexStat";
import { portraitInner, capeHtml, isUnitLocked } from "../units/art";
import { confirmModal } from "./confirmModal";
import { playBattleStartAnimation } from "./battleStartAnim";
import { getSkill, CLASS_SKILLS, CHARACTER_SKILLS } from "../skills/registry";
import { getPendingBuff, setPendingBuff } from "../main";
import { SHOP_CATALOG, ShopItemDef, ShopItemId, fetchShopStatus } from "../core/shop";

// Effective stats = unit base@lvl + class base@lvl + allocated custom points.
// Mirrors what makeCombatant does, so the roster preview matches battle reality.
function effectiveStats(t: UnitTemplate): Stats {
  const progress = getProgress(t.id);
  const classId = progress.classId ?? t.classId;
  const level = progress.level ?? t.level ?? 1;
  const custom = { ...ZERO_STATS, ...(progress.customStats ?? t.customStats ?? ZERO_STATS) };
  return sumStats(unitBaseAtLevel(t, level), classBaseAtLevel(classId, level), custom);
}

export interface SquadResult {
  players: PlayerSlot[];
  enemies: UnitTemplate[];
  stageId: number;
}

type SortKey = "lvl" | "name" | "STR" | "DEF" | "AGI" | "DEX" | "VIT" | "INT";
const SORT_LABELS: Record<SortKey, string> = {
  lvl: "Level",
  name: "Name (A→Z)",
  STR: "STR",
  DEF: "DEF",
  AGI: "AGI",
  DEX: "DEX",
  VIT: "VIT",
  INT: "INT",
};
let lastSortKey: SortKey = "lvl";
let lastSortDir: "asc" | "desc" = "desc";

function sortRoster(roster: UnitTemplate[], key: SortKey, dir: "asc" | "desc"): UnitTemplate[] {
  const out = [...roster];
  out.sort((a, b) => {
    let cmp = 0;
    if (key === "lvl") cmp = getProgress(a.id).level - getProgress(b.id).level;
    else if (key === "name") cmp = a.name.localeCompare(b.name);
    else cmp = effectiveStats(a)[key] - effectiveStats(b)[key];
    if (cmp === 0) cmp = a.name.localeCompare(b.name);
    return dir === "asc" ? cmp : -cmp;
  });
  return out;
}

export type SquadSelectMode = "floor" | "survival" | "boss_raid";

export function renderSquadSelect(
  root: HTMLElement,
  stageId: number,
  onConfirm: (r: SquadResult) => void,
  onBack: () => void,
  mode: SquadSelectMode = "floor",
): void {
  const picks: UnitTemplate[] = [];
  const stage = getStage(stageId) ?? STAGE_DEFS[0];
  // Reset cached inventory so re-entering the screen re-fetches the live state
  // (charges consumed by the previous run should appear).
  cachedBuffInventory = null;

  const draw = () => {
    const placed = picks.length;
    const atCap = placed >= MAX_PARTY_SIZE;
    const sorted = sortRoster(PLAYER_ROSTER, lastSortKey, lastSortDir);
    const underCap = placed < MAX_PARTY_SIZE;
    const partyLabel = placed === 0
      ? `<span class="squad-warn">No units selected — pick up to ${MAX_PARTY_SIZE}.</span>`
      : underCap
        ? `<span class="squad-warn">${placed}/${MAX_PARTY_SIZE} selected — you can still add ${MAX_PARTY_SIZE - placed} more.</span>`
        : `<span class="squad-ready">Full party of ${MAX_PARTY_SIZE} — ready to launch.</span>`;

    root.innerHTML = `
      <div class="squad-screen">
        ${topBarHtml(`Floor ${stage.id} · ${stage.name}`, true)}
        <div class="squad-header">
          <div class="squad-header-text">
            <div class="squad-header-title">Pick up to ${MAX_PARTY_SIZE} units</div>
            <div class="squad-header-sub">Click a roster card to add or remove. ${partyLabel}</div>
          </div>
          <div class="party-count-row">Party <span class="party-count">${placed}/${MAX_PARTY_SIZE}</span></div>
        </div>

        <div class="squad-layout-flat">
          <div class="roster">
            <div class="roster-header">
              <span class="section-label">Roster</span>
              <div class="roster-sort">
                <label class="roster-sort-label">Sort
                  <select id="roster-sort-key">
                    ${(Object.keys(SORT_LABELS) as SortKey[]).map(k =>
                      `<option value="${k}" ${k === lastSortKey ? "selected" : ""}>${SORT_LABELS[k]}</option>`
                    ).join("")}
                  </select>
                </label>
                <button class="ghost-btn roster-sort-dir" id="roster-sort-dir" type="button" title="Toggle direction">
                  ${lastSortDir === "desc" ? "↓ High→Low" : "↑ Low→High"}
                </button>
              </div>
            </div>
            <div class="roster-list">
              ${sorted.map(t => rosterItemHtml(t, picks, atCap)).join("")}
            </div>
          </div>

          <div class="enemy-config">
            <div class="section-label">Floor ${stage.id} — ${stage.soloBoss ? "Solo Boss" : "Mob"}</div>
            <div class="stage-info">
              ${enemyChipsHtml(stage.enemies, !!stage.soloBoss)}
            </div>
            <div class="squad-actions-side">
              ${mode === "floor" ? `
                <div class="buff-slot-row" id="buff-slot-row">
                  <div class="buff-slot-label">Campaign Buff <span class="buff-slot-rule">— pick ONE for this floor</span></div>
                  <div class="buff-slot-icons" id="buff-slot-icons">
                    <div class="buff-slot-empty">Loading…</div>
                  </div>
                </div>
              ` : ""}
              <button class="confirm-btn" id="confirm" ${placed === 0 ? "disabled" : ""}>
                Start Battle (${placed} unit${placed === 1 ? "" : "s"})
              </button>
            </div>
          </div>
        </div>
      </div>
    `;

    root.querySelector("#back-btn")?.addEventListener("click", onBack);

    // Mount the buff selector only on Campaign (floor) mode — Survival and
    // Boss Raid don't use campaign buffs. Floor 50 disables them and shows
    // a notice in place of the chip row.
    if (mode === "floor") {
      void mountBuffSelector(root, stage.id === 50);
    } else if (getPendingBuff()) {
      // If a buff is somehow left chosen from a previous floor run, clear it
      // so it isn't auto-consumed when starting an endless-mode run.
      setPendingBuff(null);
    }

    root.querySelector<HTMLSelectElement>("#roster-sort-key")?.addEventListener("change", e => {
      lastSortKey = (e.target as HTMLSelectElement).value as SortKey;
      draw();
    });
    root.querySelector<HTMLButtonElement>("#roster-sort-dir")?.addEventListener("click", () => {
      lastSortDir = lastSortDir === "desc" ? "asc" : "desc";
      draw();
    });

    root.querySelectorAll<HTMLElement>("[data-roster]").forEach(el => {
      const id = el.dataset.roster!;
      el.addEventListener("click", () => {
        if (isUnitLocked(id)) return;
        const t = PLAYER_ROSTER.find(x => x.id === id);
        if (!t) return;
        const idx = picks.findIndex(p => p.id === t.id);
        if (idx >= 0) {
          picks.splice(idx, 1);
        } else if (picks.length < MAX_PARTY_SIZE) {
          picks.push(t);
        }
        // Hard guard against any external mutation of `picks` — never let it
        // exceed the cap regardless of how it got there.
        if (picks.length > MAX_PARTY_SIZE) picks.length = MAX_PARTY_SIZE;
        draw();
      });
    });

    // "Edit Loadout" buttons — open the lobby skill editor. stopPropagation so
    // the click doesn't bubble to the card's add/remove handler above.
    root.querySelectorAll<HTMLButtonElement>("[data-edit-loadout]").forEach(btn => {
      btn.addEventListener("click", async e => {
        e.stopPropagation();
        const t = PLAYER_ROSTER.find(x => x.id === btn.dataset.editLoadout);
        if (!t) return;
        const changed = await openLoadoutEditor(t);
        // Re-render so the card's skill chips reflect the new loadout.
        if (changed) draw();
      });
    });

    root.querySelector<HTMLButtonElement>("#confirm")?.addEventListener("click", async () => {
      if (picks.length === 0) return;
      // Final defensive truncation — even if the array was mutated externally,
      // the party that gets sent to the server is capped here. The server
      // re-validates and rejects oversize parties.
      if (picks.length > MAX_PARTY_SIZE) picks.length = MAX_PARTY_SIZE;
      const partyNames = picks.map(p => p.name).join(", ");
      const chosen = getPendingBuff();
      const buffDef = chosen ? SHOP_CATALOG.find(i => i.id === chosen) : null;
      const buffLine = buffDef
        ? `<br><br>⚡ Chosen buff: <strong>${escapeHtml(buffDef.name)}</strong> — will be consumed when the battle starts.`
        : "";
      const ok = await confirmModal({
        title: "Begin Battle?",
        message: `Start the battle with <strong>${picks.length}</strong> unit${picks.length === 1 ? "" : "s"} — <strong>${escapeHtml(partyNames)}</strong>?<br><br>You can bring up to <strong>${MAX_PARTY_SIZE}</strong> units into battle. Your party is locked once the battle begins.${buffLine}`,
        confirmLabel: "Begin",
        cancelLabel: "Cancel",
      });
      if (!ok) return;
      const players: PlayerSlot[] = picks.map((t, i) => ({
        template: t,
        position: { row: i, col: 0 },
      }));
      await playBattleStartAnimation();
      onConfirm({ players, enemies: stage.enemies, stageId: stage.id });
    });
  };

  draw();
}

function enemyChipsHtml(enemies: UnitTemplate[], soloBoss: boolean): string {
  if (soloBoss) {
    const e = enemies[0];
    return `<div class="enemy-chip boss" tabindex="0">${e.portrait} ${e.name} · BOSS${enemyTipHtml(e, 1)}</div>`;
  }
  const counts = new Map<string, { t: UnitTemplate; n: number }>();
  for (const e of enemies) {
    const cur = counts.get(e.id);
    if (cur) cur.n++;
    else counts.set(e.id, { t: e, n: 1 });
  }
  return [...counts.values()].map(({ t, n }) =>
    `<div class="enemy-chip" tabindex="0">${t.portrait} ${t.name}${n > 1 ? ` ×${n}` : ""}${enemyTipHtml(t, n)}</div>`
  ).join("");
}

function enemyTipHtml(t: UnitTemplate, count: number): string {
  const lvl = t.level ?? 1;
  const tags = resistTags(t.resist);
  const atk = t.atkMultiplier && t.atkMultiplier > 1
    ? `<span class="stt-tag stt-warn">×${t.atkMultiplier} ATK</span>`
    : "";
  return `
    <div class="stage-tooltip stage-tooltip-anchor-left" role="tooltip">
      <div class="stt-head">
        <span class="stt-title">${escapeHtml(t.name)}${count > 1 ? ` ×${count}` : ""}</span>
        <span class="stt-meta">Lv${lvl}</span>
      </div>
      <div class="stt-rows">
        <div class="stt-row">${tags || `<span class="stt-meta">No special resists</span>`}${atk}</div>
      </div>
    </div>
  `;
}

function resistTags(r: DamageResistance | undefined): string {
  if (!r) return "";
  const tags: string[] = [];
  for (const key of ["physical", "magical", "melee", "range"] as const) {
    const v = r[key];
    if (v === undefined) continue;
    if (v < 1) tags.push(`<span class="stt-tag stt-resist">resists ${key}</span>`);
    else if (v > 1) tags.push(`<span class="stt-tag stt-weak">weak ${key}</span>`);
  }
  return tags.join("");
}

function rosterItemHtml(t: UnitTemplate, picks: UnitTemplate[], atCap: boolean): string {
  const selected = picks.some(p => p.id === t.id);
  const motzLocked = isUnitLocked(t.id);
  const locked = (atCap && !selected) || motzLocked;
  const cls = ["roster-card",
    selected ? "selected" : "",
    locked ? "locked" : "",
    motzLocked ? "motz-locked" : "",
  ].filter(Boolean).join(" ");
  const progress = getProgress(t.id);
  const lvl = progress.level;
  const classId = progress.classId ?? t.classId;
  const custom = { ...ZERO_STATS, ...(progress.customStats ?? t.customStats ?? ZERO_STATS) };
  const unitBase = unitBaseAtLevel(t, lvl);
  const classBase = classBaseAtLevel(classId, lvl);
  const s = sumStats(unitBase, classBase, custom);
  // Reference s so its type stays in-scope (hex chart already consumes the
  // breakdown). Kept for future tooltips on the chips row.
  void s;
  const equipped = progress.equippedSkills ?? [];
  const skillChips = equipped.length > 0
    ? equipped.map(id => {
        try {
          const sk = getSkill(id);
          return `<span class="rs-skill-chip" title="${escapeAttr(sk.name)}">${escapeHtml(sk.name)}</span>`;
        } catch {
          // Skill id from older save / removed skill — skip silently.
          return "";
        }
      }).filter(Boolean).join("")
    : `<span class="rs-skill-empty">No skills equipped</span>`;
  return `
    <div class="${cls}" data-roster="${escapeAttr(t.id)}">
      ${motzLocked ? `<div class="rs-locked-overlay" title="Requires MoTZ Vault Key">🔒</div>` : ""}
      <div class="rs-portrait-wrap">
        <div class="rs-portrait">${capeHtml(classId)}${portraitInner(t.id, t.portrait)}<span class="lv-badge">Lv${lvl}</span></div>
        <div class="rs-name">${escapeHtml(t.name)}</div>
        ${selected ? `<div class="placed-tag">Selected</div>` : ""}
      </div>
      <div class="rs-hex">${hexStatSvg({ unit: unitBase, classBase, custom, size: 140 })}</div>
      <div class="rs-skill-row">${skillChips}</div>
      ${motzLocked ? "" : `<button class="rs-edit-loadout" data-edit-loadout="${escapeAttr(t.id)}" type="button" title="Edit ${escapeAttr(t.name)}'s skill loadout">✎ Edit Loadout</button>`}
    </div>
  `;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  } as Record<string, string>)[c]);
}
function escapeAttr(s: string): string { return escapeHtml(s); }

/** Lobby skill-loadout editor. Lets the player retune a unit's equipped
 *  skills right from Squad Select, without a detour to the Units screen.
 *  Toggling a skill saves immediately via setProgress (which also schedules
 *  the server sync), so the change is live for the battle about to start.
 *  Resolves true if anything changed, so the caller can re-render the card.
 *
 *  Rules mirror the Units screen: a unit's pool is its signature skills plus
 *  its class skills; only skills whose unlockLevel is met can be equipped;
 *  at most MAX_EQUIPPED_SKILLS may be slotted at once. */
function openLoadoutEditor(t: UnitTemplate): Promise<boolean> {
  return new Promise<boolean>(resolve => {
    // Distinct overlay class (NOT game-confirm-overlay) so confirm/alert
    // modals can't accidentally remove this one, and vice versa.
    document.querySelectorAll(".lle-overlay").forEach(el => el.remove());
    let changed = false;
    let warn = "";

    const overlay = document.createElement("div");
    overlay.className = "lle-overlay";
    document.body.appendChild(overlay);

    const close = (): void => {
      overlay.remove();
      document.removeEventListener("keydown", onKey);
      resolve(changed);
    };
    const onKey = (e: KeyboardEvent): void => { if (e.key === "Escape") close(); };
    document.addEventListener("keydown", onKey);
    overlay.addEventListener("click", e => { if (e.target === overlay) close(); });

    const toggle = (id: string): void => {
      const cur = getProgress(t.id);
      const eq = [...(cur.equippedSkills ?? [])];
      const idx = eq.indexOf(id);
      if (idx >= 0) {
        eq.splice(idx, 1);
        warn = "";
      } else if (eq.length >= MAX_EQUIPPED_SKILLS) {
        warn = `Loadout full — remove a skill before adding another (max ${MAX_EQUIPPED_SKILLS}).`;
        render();
        return;
      } else {
        eq.push(id);
        warn = "";
      }
      setProgress(t.id, { ...cur, equippedSkills: eq });
      changed = true;
      render();
    };

    const render = (): void => {
      const progress = getProgress(t.id);
      const classId = progress.classId ?? t.classId;
      const level = progress.level ?? t.level ?? 1;
      const equipped = progress.equippedSkills ?? [];
      const pool = [
        ...(CHARACTER_SKILLS[t.id] ?? []),
        ...(classId ? CLASS_SKILLS[classId] ?? [] : []),
      ];
      const unlocked = pool.filter(id => (getSkill(id).unlockLevel ?? 1) <= level);
      const locked = pool
        .filter(id => (getSkill(id).unlockLevel ?? 1) > level)
        .sort((a, b) => (getSkill(a).unlockLevel ?? 1) - (getSkill(b).unlockLevel ?? 1));
      const eqCount = equipped.filter(id => unlocked.includes(id)).length;

      const skillRow = (id: string, isLocked: boolean): string => {
        const s = getSkill(id);
        const on = equipped.includes(id);
        const meta = isLocked
          ? `Unlocks Lv${s.unlockLevel ?? 1}`
          : `${s.mpCost > 0 ? `${s.mpCost} MP` : "0 MP"}${s.cooldown > 0 ? ` · CD ${s.cooldown}` : ""}`;
        const cls = ["lle-skill", on ? "on" : "", isLocked ? "locked" : ""].filter(Boolean).join(" ");
        return `
          <button class="${cls}" data-skill="${escapeAttr(id)}" type="button" ${isLocked ? "disabled" : ""}>
            <span class="lle-mark">${isLocked ? "🔒" : on ? "✓" : ""}</span>
            <span class="lle-body">
              <span class="lle-name">${escapeHtml(s.name)}</span>
              <span class="lle-desc">${escapeHtml(s.description)}</span>
            </span>
            <span class="lle-meta">${escapeHtml(meta)}</span>
          </button>
        `;
      };

      const rows = unlocked.map(id => skillRow(id, false)).join("")
        + locked.map(id => skillRow(id, true)).join("");
      const listHtml = pool.length > 0
        ? rows
        : `<div class="lle-empty">This unit has no skills yet — pick a class and level it up.</div>`;

      overlay.innerHTML = `
        <div class="game-confirm-card lle-card" role="dialog" aria-modal="true" aria-label="Skill loadout">
          <div class="lle-title">${escapeHtml(t.name)} — Skill Loadout</div>
          <div class="lle-sub">Lv${level} · <span class="lle-count">${eqCount}/${MAX_EQUIPPED_SKILLS}</span> equipped — tap a skill to equip or remove</div>
          ${warn ? `<div class="lle-warn">${escapeHtml(warn)}</div>` : ""}
          <div class="lle-list">${listHtml}</div>
          <div class="game-confirm-actions">
            <button class="confirm-btn lle-done" type="button">Done</button>
          </div>
        </div>
      `;

      overlay.querySelectorAll<HTMLButtonElement>(".lle-skill:not(.locked)").forEach(btn => {
        btn.addEventListener("click", () => toggle(btn.dataset.skill!));
      });
      overlay.querySelector<HTMLButtonElement>(".lle-done")?.addEventListener("click", close);
    };

    render();
  });
}

/** Cache shop status so re-draws don't re-fetch. Cleared when the screen
 *  unmounts (next renderSquadSelect call resets it). */
let cachedBuffInventory: Partial<Record<ShopItemId, number>> | null = null;

async function mountBuffSelector(root: HTMLElement, isFloor50: boolean): Promise<void> {
  const slot = root.querySelector<HTMLElement>("#buff-slot-icons");
  if (!slot) return;

  // Floor 50 (World Ender): buffs are not allowed. Clear any slotted buff
  // and show a permanent notice in place of the chip row.
  if (isFloor50) {
    if (getPendingBuff()) setPendingBuff(null);
    const fresh = root.querySelector<HTMLElement>("#buff-slot-icons");
    if (!fresh) return;
    fresh.innerHTML = `
      <div class="buff-slot-blocked">
        🌑 Campaign buffs are <strong>disabled</strong> on Floor 50 — the World Ender fight is fair-fight only.
      </div>
    `;
    return;
  }

  // Resolve inventory — use cached value if we already fetched once for this screen.
  if (cachedBuffInventory === null) {
    const status = await fetchShopStatus();
    cachedBuffInventory = status?.inventory?.buffs ?? {};
  }
  // Subsequent re-renders happen on roster-card clicks, so we always
  // re-resolve the DOM target via id.
  const fresh = root.querySelector<HTMLElement>("#buff-slot-icons");
  if (!fresh) return;

  const owned: { def: ShopItemDef; count: number }[] = SHOP_CATALOG
    .filter(d => d.category === "buff")
    .map(d => ({ def: d, count: cachedBuffInventory?.[d.id] ?? 0 }))
    .filter(x => x.count > 0);

  if (owned.length === 0) {
    fresh.innerHTML = `<div class="buff-slot-empty">No buffs owned. Buy from <strong>Shop</strong> on the home screen.</div>`;
    return;
  }

  const pending = getPendingBuff();
  fresh.innerHTML = owned.map(({ def, count }) => `
    <button class="buff-icon-btn ${pending === def.id ? "slotted" : ""}"
            data-buff="${def.id}"
            type="button">
      <span class="buff-icon-glyph">${iconGlyphFor(def.id)}</span>
      <span class="buff-icon-count">${count}</span>
      <span class="buff-icon-name">${escapeHtml(def.name)}</span>
      <div class="buff-icon-tooltip" role="tooltip">
        <div class="buff-tip-head">
          <span class="buff-tip-icon">${iconGlyphFor(def.id)}</span>
          <span class="buff-tip-title">${escapeHtml(def.name)}</span>
        </div>
        <div class="buff-tip-desc">${escapeHtml(def.description)}</div>
        <div class="buff-tip-meta">⚠ Not usable on Floor 50 (World Ender)</div>
      </div>
    </button>
  `).join("");

  fresh.querySelectorAll<HTMLButtonElement>("[data-buff]").forEach(btn => {
    const id = btn.dataset.buff as ShopItemId;
    btn.addEventListener("click", () => {
      const cur = getPendingBuff();
      // Click on already-slotted → unslot. Otherwise toggle to this buff.
      setPendingBuff(cur === id ? null : id);
      // Re-render just the buff row (cheap re-mount of this section only).
      void mountBuffSelector(root, isFloor50);
    });
  });
}

function iconGlyphFor(id: ShopItemId): string {
  switch (id) {
    case "buff_battle_cry":       return "📯";
    case "buff_phoenix_embers":   return "🔥";
    case "buff_scholars_insight": return "📖";
    case "buff_quickdraw":        return "⚡";
    case "buff_last_stand":       return "🗡";
    default: return "❔";
  }
}
