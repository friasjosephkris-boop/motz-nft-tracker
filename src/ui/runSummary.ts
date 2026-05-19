// Post-run summary screen for survival and boss-raid modes.
// Triggered after a run ends (victory or defeat). Shows per-unit damage / kills /
// XP gained, the active daily multiplier, and a one-click path back to Home.

import { PLAYER_ROSTER } from "../units/roster";
import { portraitInner, capeHtml } from "../units/art";
import { getProgress } from "../core/progress";
import { getCachedDailyMultiplier } from "../core/daily";

export interface RunSummaryUnit {
  templateId: string;
  level: number;
  xpGained: number;
  damageDealt: number;
  damageTaken: number;
  kills: number;
}

export interface RunSummary {
  mode: "survival" | "boss_raid" | "floor";
  outcome: "victory" | "defeat";
  /** Survival/boss-raid: floors cleared this run. Floor mode: the stage id played. */
  floorsCleared: number;
  totalMs: number;
  units: RunSummaryUnit[];
  /** Provided by the leaderboard endpoint when the run was submitted. */
  submitted?: boolean;
  /** Floor-mode only — the stage name to display alongside the floor number. */
  floorLabel?: string;
  /** MVP unit id (already factored into units[].xpGained if a bonus was applied). */
  mvpId?: string | null;
  /** Extra XP awarded to the MVP on top of their regular share. */
  mvpBonusXp?: number;
  /** Full battle log lines from the last (or only) battle of the run. */
  battleLog?: string[];
  /** Combatant names by side, used to colorize the log review modal. */
  playerNames?: string[];
  enemyNames?: string[];
  /** RON voucher drops accumulated across all battles of this run. */
  ronDrops?: { t1: number; t2: number; t3: number; t4: number; t5: number; total: number };
}

/** Highest score = damageDealt + 1000 × kills. Returns null if no candidates. */
export function pickMvpId(units: RunSummaryUnit[]): string | null {
  if (units.length === 0) return null;
  let bestId = units[0].templateId;
  let bestScore = -1;
  for (const u of units) {
    const score = u.damageDealt + u.kills * 1000;
    if (score > bestScore) { bestScore = score; bestId = u.templateId; }
  }
  return bestId;
}

export interface RunSummaryActions {
  /** If provided, render a banner letting the player know they got +1 energy
   *  refunded for the defeat (server-granted, daily-capped). */
  refundNotice?: string;
  /** If provided, render a "Next Floor" button. Used for floor-mode victories
   *  when the next floor is unlocked and the player has energy. */
  onNextFloor?: () => void;
  /** Label override; defaults to "Next Floor". */
  nextFloorLabel?: string;
  /** If provided, render a "Replay Floor" button. Lets the player re-fight
   *  the same floor (consumes energy again, no leaderboard impact since
   *  campaign floors aren't ranked). Use it for the same-floor restart UX
   *  on victory or defeat. */
  onReplayFloor?: () => void;
}

export function renderRunSummary(root: HTMLElement, summary: RunSummary, onClose: () => void, actions: RunSummaryActions = {}): void {
  const mvpId = summary.mvpId ?? pickMvpId(summary.units);
  const dailyMul = getCachedDailyMultiplier();
  const totalDamageDealt = summary.units.reduce((s, u) => s + u.damageDealt, 0);
  const totalDamageTaken = summary.units.reduce((s, u) => s + u.damageTaken, 0);
  const totalKills = summary.units.reduce((s, u) => s + u.kills, 0);
  const totalXp = summary.units.reduce((s, u) => s + u.xpGained, 0);

  const modeLabel = summary.mode === "survival" ? "Survival"
                  : summary.mode === "boss_raid" ? "Boss Raid"
                  : "Campaign";
  const outcomeLabel = summary.outcome === "victory"
    ? (summary.mode === "floor" ? "Floor Cleared" : "Run Complete")
    : (summary.mode === "floor" ? "Floor Failed" : "Run Ended");

  // Outcome SFX is fired by combat.ts the moment the battle resolves, so it
  // already plays during the Victory/Defeat banner and continues into this
  // panel. We deliberately don't re-trigger here.

  const bigBanner = summary.outcome === "victory"
    ? `<div class="rs-big-banner victory">VICTORY!</div>`
    : `<div class="rs-big-banner defeat">DEFEAT</div>`;

  root.innerHTML = `
    <div class="run-summary-screen rs-${summary.outcome}">
      <div class="rs-card">
        ${summary.outcome === "victory" ? `
          <div class="rs-victory-fx" aria-hidden="true">
            <span class="rs-confetti rs-confetti-1"></span>
            <span class="rs-confetti rs-confetti-2"></span>
            <span class="rs-confetti rs-confetti-3"></span>
            <span class="rs-confetti rs-confetti-4"></span>
            <span class="rs-confetti rs-confetti-5"></span>
            <span class="rs-confetti rs-confetti-6"></span>
            <span class="rs-confetti rs-confetti-7"></span>
            <span class="rs-confetti rs-confetti-8"></span>
            <span class="rs-spark rs-spark-1">✦</span>
            <span class="rs-spark rs-spark-2">✶</span>
            <span class="rs-spark rs-spark-3">★</span>
            <span class="rs-spark rs-spark-4">✦</span>
          </div>
        ` : ""}
        <div class="rs-header">
          <div class="rs-mode-tag rs-mode-${summary.mode}">${modeLabel}</div>
          <div class="rs-outcome rs-outcome-${summary.outcome}">${outcomeLabel}</div>
        </div>

        ${bigBanner}

        <div class="rs-headline">
          <div class="rs-headline-floor">Floor ${summary.floorsCleared}${summary.floorLabel ? ` · ${escapeHtml(summary.floorLabel)}` : ""}</div>
          <div class="rs-headline-time">${formatMs(summary.totalMs)}</div>
        </div>

        ${dailyMul > 1 ? `<div class="rs-multiplier-banner">🔥 Daily streak active · ${dailyMul}× XP</div>` : ""}
        ${summary.mvpBonusXp && summary.mvpBonusXp > 0 ? `<div class="rs-mvp-banner">⭐ MVP bonus · +${summary.mvpBonusXp.toLocaleString()} XP (1.2×)</div>` : ""}
        ${actions.refundNotice ? `<div class="rs-refund-banner">⚡ ${escapeHtml(actions.refundNotice)}</div>` : ""}
        ${summary.ronDrops && summary.ronDrops.total > 0 ? ronBannerHtml(summary.ronDrops) : ""}

        <div class="rs-totals">
          <div class="rs-total"><span class="rs-total-label">Damage Dealt</span><span class="rs-total-value">${totalDamageDealt.toLocaleString()}</span></div>
          <div class="rs-total"><span class="rs-total-label">Damage Taken</span><span class="rs-total-value">${totalDamageTaken.toLocaleString()}</span></div>
          <div class="rs-total"><span class="rs-total-label">Total Kills</span><span class="rs-total-value">${totalKills}</span></div>
          <div class="rs-total"><span class="rs-total-label">Total XP</span><span class="rs-total-value">${totalXp.toLocaleString()}</span></div>
        </div>

        <div class="rs-units-list">
          ${summary.units.map(u => unitRowHtml(u, u.templateId === mvpId)).join("")}
        </div>

        ${summary.submitted ? `<div class="rs-submitted">✓ Submitted to leaderboard</div>` : ""}

        <div class="rs-actions">
          ${summary.battleLog && summary.battleLog.length > 0 ? `<button class="ghost-btn" id="rs-log" type="button">Review Battle Log</button>` : ""}
          <button class="ghost-btn" id="rs-home" type="button">Home</button>
          ${actions.onReplayFloor ? `<button class="ghost-btn" id="rs-replay" type="button">↻ Replay Floor</button>` : ""}
          ${actions.onNextFloor ? `<button class="confirm-btn" id="rs-next" type="button">${escapeHtml(actions.nextFloorLabel ?? "Next Floor")}</button>` : ""}
        </div>
      </div>
    </div>
  `;

  root.querySelector<HTMLButtonElement>("#rs-home")?.addEventListener("click", onClose);
  if (actions.onNextFloor) {
    root.querySelector<HTMLButtonElement>("#rs-next")?.addEventListener("click", actions.onNextFloor);
  }
  if (actions.onReplayFloor) {
    root.querySelector<HTMLButtonElement>("#rs-replay")?.addEventListener("click", actions.onReplayFloor);
  }
  if (summary.battleLog && summary.battleLog.length > 0) {
    root.querySelector<HTMLButtonElement>("#rs-log")?.addEventListener("click", () => {
      showBattleLogModal(summary.battleLog!, summary.playerNames ?? [], summary.enemyNames ?? []);
    });
  }
}

function showBattleLogModal(lines: string[], playerNames: string[], enemyNames: string[]): void {
  // Drop any prior modal so re-clicks don't stack.
  document.getElementById("rs-log-modal")?.remove();

  // Sort longest first so multi-word names like "Tower God" win over "Tower".
  // Player wins ties so a colliding name never reads as enemy.
  const players = new Set(playerNames);
  const allNames = [...new Set([...playerNames, ...enemyNames])].sort((a, b) => b.length - a.length);

  const colorize = (line: string): string => {
    let html = escapeHtml(line);
    for (const name of allNames) {
      const escapedRegex = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const re = new RegExp(`\\b${escapedRegex}\\b`, "g");
      const cls = players.has(name) ? "log-player" : "log-enemy";
      html = html.replace(re, `<span class="${cls}">${escapeHtml(name)}</span>`);
    }
    // CRIT marker → gold.
    html = html.replace(/\bCRIT\b/g, `<span class="log-crit">CRIT</span>`);
    return html;
  };

  const modal = document.createElement("div");
  modal.id = "rs-log-modal";
  modal.className = "rs-log-overlay";
  modal.innerHTML = `
    <div class="rs-log-card">
      <div class="rs-log-head">
        <span class="rs-log-title">Battle Log</span>
        <button class="ghost-btn rs-log-close" id="rs-log-close" type="button">Close</button>
      </div>
      <div class="rs-log-body">${lines.map(l => `<div class="rs-log-line">${colorize(l)}</div>`).join("")}</div>
    </div>
  `;
  document.body.appendChild(modal);
  const close = () => modal.remove();
  modal.querySelector<HTMLButtonElement>("#rs-log-close")?.addEventListener("click", close);
  modal.addEventListener("click", e => { if (e.target === modal) close(); });
}

function unitRowHtml(u: RunSummaryUnit, isMvp: boolean): string {
  const t = PLAYER_ROSTER.find(p => p.id === u.templateId);
  if (!t) return "";
  const classId = getProgress(t.id).classId ?? t.classId;
  return `
    <div class="rs-unit-row${isMvp ? " mvp" : ""}">
      <div class="portrait">${capeHtml(classId)}${portraitInner(t.id, t.portrait)}</div>
      <div class="rs-unit-main">
        <div class="rs-unit-name">
          ${isMvp ? `<span class="mvp-tag">MVP</span>` : ""}
          <span class="lv-inline">Lv${u.level}</span> ${escapeHtml(t.name)}
        </div>
        <div class="rs-unit-stats">
          <span><span class="dim">DMG</span> ${u.damageDealt.toLocaleString()}</span>
          <span><span class="dim">TAKEN</span> ${u.damageTaken.toLocaleString()}</span>
          <span><span class="dim">KILLS</span> ${u.kills}</span>
          <span><span class="dim">XP</span> +${u.xpGained.toLocaleString()}</span>
        </div>
      </div>
    </div>
  `;
}


function formatMs(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function ronBannerHtml(drops: { t1: number; t2: number; t3: number; t4: number; t5: number; total: number }): string {
  // Build a per-tier breakdown so the rarity feels rewarding.
  const tiers: { id: keyof typeof drops; label: string; color: string }[] = [
    { id: "t5", label: "T5 (200)", color: "var(--gold-bright)" },
    { id: "t4", label: "T4 (50)",  color: "#ffb05f" },
    { id: "t3", label: "T3 (20)",  color: "#ffd96f" },
    { id: "t2", label: "T2 (10)",  color: "#a0e5ff" },
    { id: "t1", label: "T1 (5)",   color: "#cfd6e4" },
  ];
  const chips = tiers
    .filter(t => (drops[t.id] as number) > 0)
    .map(t => `<span class="rs-bron-chip" style="color:${t.color}"><span class="rs-bron-chip-label">${t.label}</span><span class="rs-bron-chip-count">×${drops[t.id]}</span></span>`)
    .join("");
  return `
    <div class="rs-bron-banner">
      <div class="rs-bron-head">💰 <strong>+${drops.total.toLocaleString()} bRON</strong> earned this run</div>
      ${chips ? `<div class="rs-bron-chips">${chips}</div>` : ""}
    </div>
  `;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}
