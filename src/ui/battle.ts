import { Battle, Combatant } from "../core/combat";
import { ATB_FULL } from "../core/timeline";
import { getSkill } from "../skills/registry";
import { drainEvents, FloatEvent, iconGlyph, drainSkillVfx, SkillVfxEvent } from "../core/animations";
import { effectIcon, effectName, isDebuff, isSkillBlockedBySilence, isSilenced } from "../core/effects";
import { portraitInner, capeHtml } from "../units/art";
import { runCheatCheck } from "../core/cheatCheck";
import { confirmModal } from "./confirmModal";
import { getBattleSpeed, setBattleSpeed, isFastForwardAllowed, FAST_FORWARD_MAX_STAGE, BattleSpeed } from "../core/battleSpeed";

const BASE_SKILL_IDS = new Set(["idle", "basic_attack", "guard"]);
type ActionTab = "basic" | "skills";
const actionTabByUnit = new Map<string, ActionTab>();
function getActionTab(c: Combatant): ActionTab {
  const cur = actionTabByUnit.get(c.id);
  if (cur) return cur;
  return isSilenced(c) ? "basic" : "skills";
}

export type ActionHandler = (unitId: string, skillId: string, targetId: string) => void;
export type PostBattleAction = "home" | "stages" | "surrender";
export type PostBattleHandler = (a: PostBattleAction) => void;

interface Targeting {
  unitId: string;
  skillId: string;
}
let targeting: Targeting | null = null;

export interface RenderBattleOpts {
  /** When false, victory/defeat suppress the Return-to-Home / Tower-Stages buttons (used between survival floors). */
  showPostBattleButtons?: boolean;
  /** Floors 31+ render in slow motion — adds a CSS class that stretches all animation durations. */
  slowMo?: boolean;
  /** Current stage id — drives the per-tier battle-field background image. Omit for tutorial / replay if you don't want it. */
  stageId?: number;
  /** Run mode — gates the fast-forward feature to campaign floors only. */
  mode?: "floor" | "survival" | "boss_raid";
}

export function renderBattle(
  root: HTMLElement,
  b: Battle,
  onAction: ActionHandler,
  onPost: PostBattleHandler,
  opts: RenderBattleOpts = {},
): void {
  targeting = null;
  const showPost = opts.showPostBattleButtons !== false;
  const slowMo = !!opts.slowMo;
  // Map stage → tier so CSS can pick the right background. Tiers correspond
  // to the floor-X-Y.webp/.jpg assets in /public.
  const tier = stageTier(opts.stageId);
  root.innerHTML = `
    <div class="battle${slowMo ? " slowmo" : ""}"${tier ? ` data-tier="${tier}"` : ""}>
      <div class="battle-toolbar">
        <button class="surrender-btn" id="surrender-btn" type="button">Surrender</button>
        ${slowMo ? `<span class="slowmo-tag">SLOW MOTION</span>` : ""}
        ${fastForwardWidgetHtml(opts.stageId, opts.mode)}
      </div>

      <div class="battle-field" id="battle-field">
        <div class="battle-log-panel">
          <div class="battle-log-title">Battle Log</div>
          <div class="log" id="log">
            ${logLinesHtml(b)}
          </div>
        </div>
        <div class="enemy-cluster" id="enemy-cluster">
          ${enemyClusterHtml(b)}
        </div>
        <div class="player-stack" id="player-stack">
          ${playerStackHtml(b)}
        </div>
        <div class="float-layer" id="float-layer"></div>
        <div class="crit-flash-overlay" id="crit-flash-overlay"></div>
      </div>

      <div class="action-panel">
        ${actionPanelHtml(b, showPost)}
      </div>

      ${b.state.kind === "victory" ? `<div class="banner victory">Victory!</div>` : ""}
      ${b.state.kind === "defeat" ? `<div class="banner defeat">Defeat</div>` : ""}
    </div>
  `;

  wireActionButtons(root, b, onAction);
  wireEnemyClicks(root, b, onAction);
  wireSurrender(root, b, onPost);
  wirePostBattleButtons(root, onPost);
  wireFastForward(root);

  // Anti-cheat: ask the server whether this wallet's claimed total XP fits
  // the lifetime ceiling we've recorded. Admin wallets are exempt server-side.
  // Network failures fall through silently — never block a legit player.
  void runCheatCheck().then(result => {
    if (!result || result.ok) return;
    // ---- WIPE-RECOVERY PATH ----
    // If the server XP cap is 0 while the client claims any XP, the server
    // was wiped (or this is a brand-new wallet with stale localStorage from
    // a previous account). Don't accuse the player — silently reset the
    // local cache to match the fresh server state and reload.
    if (result.cap === 0) {
      try {
        // Preserve the JWT session so the player doesn't have to re-sign in.
        const sessionRaw = localStorage.getItem("toz.session");
        localStorage.clear();
        if (sessionRaw) localStorage.setItem("toz.session", sessionRaw);
      } catch { /* ignore */ }
      location.reload();
      return;
    }
    // Real cheat (claimed > cap > 0) — show the overlay as before.
    mountCheaterOverlay(root, result.claimed, result.cap);
  });
}

/** Map stage id to its tier label, used as the `data-tier` attribute that the
 *  CSS keys per-tier battle backgrounds off. Returns null for out-of-range /
 *  undefined. Floor 50 (World Ender) is its own tier so it can use a dedicated
 *  background.
 *
 *  Post-game floors 51-500 map to 10-floor sub-tiers ("51-60", "61-70", …).
 *  A sub-tier only shows custom art once both a `/public/floor X-Y.webp` asset
 *  AND a matching `.battle[data-tier="X-Y"]` CSS rule exist — sub-tiers without
 *  art simply fall back to the base battle-field gradient. So adding a new
 *  tier background later is just: drop the PNG in /public + add one CSS rule. */
function stageTier(stageId: number | undefined): string | null {
  if (typeof stageId !== "number" || stageId < 1 || stageId > 500) return null;
  if (stageId === 50) return "50";
  if (stageId <= 10) return "1-10";
  if (stageId <= 20) return "11-20";
  if (stageId <= 30) return "21-30";
  if (stageId <= 40) return "31-40";
  if (stageId <= 49) return "41-49";
  // Post-game: 10-floor sub-tiers — 51-60, 61-70, … 491-500.
  const start = Math.floor((stageId - 51) / 10) * 10 + 51;
  return `${start}-${start + 9}`;
}

function mountCheaterOverlay(root: HTMLElement, claimed: number, cap: number): void {
  if (root.querySelector(".cheater-overlay")) return;
  const overlay = document.createElement("div");
  overlay.className = "cheater-overlay";
  overlay.innerHTML = `
    <div class="cheater-card">
      <div class="cheater-title">⚠ CHEATER DETECTED</div>
      <div class="cheater-sub">
        Your local progress doesn't match the server audit log.
        Battles are blocked until your save is reset.
      </div>
      <div class="cheater-stats">
        Claimed total XP: <strong>${claimed.toLocaleString()}</strong><br>
        Server ceiling:&nbsp;&nbsp;&nbsp; <strong>${cap.toLocaleString()}</strong>
      </div>
    </div>
  `;
  root.appendChild(overlay);
}

export function updateLive(root: HTMLElement, b: Battle): void {
  for (const c of b.combatants) {
    const el = root.querySelector<HTMLElement>(`[data-id="${cssAttr(c.id)}"]`);
    if (el) {
      setBar(el, "hp", c.hp, c.maxHp, true);
      if (c.maxMp > 0) setBar(el, "mp", c.mp, c.maxMp, true);
      // Enemies render their own ATB on the chip; players render ATB in the action row only.
      if (c.side === "enemy") setBar(el, "atb", c.gauge, ATB_FULL, false);
      // Detect alive → dead transition for the gold kill-burst ring AND the
      // brief kill-cam slow-mo on the whole battle field.
      const wasAlive = !el.classList.contains("dead");
      if (wasAlive && !c.alive) {
        el.classList.remove("kill-burst");
        void el.offsetWidth;
        el.classList.add("kill-burst");
        setTimeout(() => el.classList.remove("kill-burst"), 750);
        // Apply kill-cam slow-mo to the whole battle scene for ~500ms.
        const battleRoot = root.querySelector<HTMLElement>(".battle");
        if (battleRoot && !battleRoot.classList.contains("slowmo")) {
          battleRoot.classList.remove("kill-cam");
          void battleRoot.offsetWidth;
          battleRoot.classList.add("kill-cam");
          setTimeout(() => battleRoot.classList.remove("kill-cam"), 520);
        }
      }
      el.classList.toggle("dead", !c.alive);
      el.classList.toggle("ready", c.alive && c.gauge >= ATB_FULL);
      el.classList.toggle("casting", !!c.casting);
      const badge = el.querySelector<HTMLElement>(".guard-badge");
      if (badge) badge.style.display = c.guarding ? "" : "none";
      // Refresh the buff/debuff chip strip in place so freshly-applied effects
      // appear and expired ones disappear without waiting for a full re-render.
      const chipsHost = el.querySelector<HTMLElement>(".name .effect-chips");
      const newChipsHtml = renderEffectChipsInner(c);
      if (chipsHost) {
        if (newChipsHtml === "") chipsHost.remove();
        else if (chipsHost.innerHTML !== newChipsHtml) chipsHost.innerHTML = newChipsHtml;
      } else if (newChipsHtml !== "") {
        const span = document.createElement("span");
        span.className = "effect-chips";
        span.innerHTML = newChipsHtml;
        const nameEl = el.querySelector<HTMLElement>(".name");
        if (nameEl) nameEl.appendChild(span);
      }
    }

    // Action-row vitals (player only) hold the ATB gauge.
    if (c.side === "player") {
      const row = root.querySelector<HTMLElement>(`[data-row-id="${cssAttr(c.id)}"]`);
      if (row) {
        setBar(row, "atb", c.gauge, ATB_FULL, false);
        row.classList.toggle("ready", c.alive && c.gauge >= ATB_FULL);
        row.classList.toggle("dead", !c.alive);
        const hpEl = row.querySelector<HTMLElement>(".vstat-val.hp");
        if (hpEl) hpEl.textContent = `${c.hp}/${c.maxHp}`;
        const mpEl = row.querySelector<HTMLElement>(".vstat-val.mp");
        if (mpEl) mpEl.textContent = `${c.mp}/${c.maxMp}`;
      }
    }
  }

  // Action buttons.
  for (const c of b.combatants) {
    if (c.side !== "player") continue;
    for (const skillId of visibleSkills(c)) {
      const btn = root.querySelector<HTMLButtonElement>(
        `button[data-unit-id="${cssAttr(c.id)}"][data-skill="${cssAttr(skillId)}"]`
      );
      if (!btn) continue;
      const skill = getSkill(skillId);
      const cd = c.skillCooldowns[skillId] ?? 0;
      const unaffordable = skill.mpCost > c.mp || (skill.hpCost !== undefined && skill.hpCost >= c.hp);
      const onCooldown = cd > 0;
      btn.classList.toggle("unaffordable", unaffordable);
      btn.classList.toggle("on-cooldown", onCooldown);
      btn.classList.toggle("queued", c.queuedAction?.skillId === skillId);
      btn.classList.toggle("targeting", targeting?.unitId === c.id && targeting?.skillId === skillId);
      btn.disabled = unaffordable || onCooldown || !c.alive;
      const cdBadge = btn.querySelector<HTMLElement>(".cd-badge");
      if (cdBadge) cdBadge.textContent = onCooldown ? `${cd}` : "";
    }
  }

  // Battle log (latest entry rendered first / on top).
  const logEl = root.querySelector<HTMLElement>("#log");
  if (logEl) {
    if (logEl.dataset.lastLen !== String(b.log.length)) {
      logEl.innerHTML = logLinesHtml(b);
      logEl.dataset.lastLen = String(b.log.length);
      logEl.scrollTop = 0;
    }
  }

  // Queued-target tag on enemies.
  root.querySelectorAll<HTMLElement>(".queued-target-tag").forEach(a => a.remove());
  for (const c of b.combatants) {
    if (c.side !== "player" || !c.queuedAction) continue;
    const skill = getSkill(c.queuedAction.skillId);
    if (skill.targeting !== "enemy") continue;
    const tEl = root.querySelector<HTMLElement>(`[data-id="${cssAttr(c.queuedAction.targetId)}"]`);
    if (!tEl) continue;
    const tag = document.createElement("div");
    tag.className = "queued-target-tag";
    tag.textContent = `← ${c.name}`;
    tEl.appendChild(tag);
  }

  // Targetable highlight + cursor mode on enemies.
  const cluster = root.querySelector<HTMLElement>(".enemy-cluster");
  cluster?.classList.remove("cursor-sword", "cursor-wand");
  root.querySelectorAll<HTMLElement>(".enemy-cluster .combatant").forEach(el => {
    el.classList.remove("targetable");
  });
  if (targeting) {
    const skill = getSkill(targeting.skillId);
    if (skill.targeting === "enemy") {
      for (const e of b.combatants) {
        if (e.side === "enemy" && e.alive) {
          const el = root.querySelector<HTMLElement>(`[data-id="${cssAttr(e.id)}"]`);
          if (el) el.classList.add("targetable");
        }
      }
      // Pick cursor based on resolved damage kind for this skill.
      const attacker = b.combatants.find(c => c.id === targeting!.unitId);
      const kind: "physical" | "magical" =
        skill.id === "basic_attack" && attacker?.basicAttackKind === "magical"
          ? "magical"
          : (skill.kind === "magical" ? "magical" : "physical");
      cluster?.classList.add(kind === "magical" ? "cursor-wand" : "cursor-sword");
    }
  }

  // Skill VFX (drain first so animations are layered behind popups in z-order).
  flushSkillVfx(root);
  // Float damage popups.
  flushFloats(root);
}

/** Render queued skill-visual-effects. Each VFX spawns a positioned overlay
 *  div in the float-layer with a CSS-keyframe animation tied to its kind.
 *  Self-targeted effects (buff_aura, heal_glow on caster) anchor at the
 *  caster's tile center. Target effects anchor at the target's tile center.
 *  Projectile effects (arrow_volley) draw a transform from caster → target. */
function flushSkillVfx(root: HTMLElement): void {
  const layer = root.querySelector<HTMLElement>("#float-layer");
  const field = root.querySelector<HTMLElement>("#battle-field");
  if (!layer || !field) return;
  const events: SkillVfxEvent[] = drainSkillVfx();
  if (events.length === 0) return;
  const fieldRect = field.getBoundingClientRect();
  for (const e of events) {
    const casterEl = root.querySelector<HTMLElement>(`[data-id="${cssAttr(e.casterId)}"]`);
    const targetEl = root.querySelector<HTMLElement>(`[data-id="${cssAttr(e.targetId)}"]`);
    if (!targetEl) continue;
    const tRect = targetEl.getBoundingClientRect();
    const tx = tRect.left - fieldRect.left + tRect.width / 2;
    const ty = tRect.top - fieldRect.top + tRect.height / 2;
    const div = document.createElement("div");
    div.className = `skill-vfx skill-vfx-${e.kind}`;
    div.style.left = `${tx}px`;
    div.style.top = `${ty}px`;
    // Projectile-style effects need the caster origin so the CSS transform
    // can interpolate the flight path. We pass dx/dy as custom properties.
    if (e.kind === "arrow_volley" && casterEl) {
      const cRect = casterEl.getBoundingClientRect();
      const cx = cRect.left - fieldRect.left + cRect.width / 2;
      const cy = cRect.top - fieldRect.top + cRect.height / 2;
      div.style.setProperty("--from-x", `${cx - tx}px`);
      div.style.setProperty("--from-y", `${cy - ty}px`);
    }
    layer.appendChild(div);
    // 900ms covers the longest keyframe; remove after to keep the DOM clean.
    setTimeout(() => div.remove(), 1000);
  }
}

function flushFloats(root: HTMLElement): void {
  const layer = root.querySelector<HTMLElement>("#float-layer");
  const field = root.querySelector<HTMLElement>("#battle-field");
  if (!layer || !field) return;
  const events: FloatEvent[] = drainEvents();
  if (events.length === 0) return;

  const fieldRect = field.getBoundingClientRect();

  // Track per-batch flags for crit flash + World End! zoom.
  let hadCrit = false;
  let hadWorldEnd = false;
  // Targets that should get a kill-burst ring (HP went to 0 from this batch).
  // We can't reliably know the post-event HP here without combat state, so we
  // proxy "kill" with: the next render-pass will mark the combatant `.dead`
  // — and we re-apply the burst class for one animation cycle when that
  // transition is observed. For now, this batch tracks visible damage hits.

  for (const e of events) {
    const tgt = root.querySelector<HTMLElement>(`[data-id="${cssAttr(e.targetId)}"]`);
    if (!tgt) continue;
    const r = tgt.getBoundingClientRect();
    const x = r.left - fieldRect.left + r.width / 2;
    const y = r.top - fieldRect.top + 6;

    const isDrop = e.icon === "moneybag";
    const div = document.createElement("div");
    div.className = "float-popup" + (e.crit ? " crit" : "") + (isDrop ? " bron-drop" : "");
    div.style.left = `${x}px`;
    div.style.top = `${y}px`;
    div.style.color = e.color;
    div.innerHTML = `<span class="float-icon">${iconGlyph(e.icon)}</span><span class="float-text">${escapeHtml(e.text)}</span>${e.crit ? `<span class="float-crit">CRIT!</span>` : ""}`;
    layer.appendChild(div);

    // Hit-flash on target — but not for cosmetic drop popups (target is
    // already dead at that point, no flash needed).
    if (!isDrop) {
      tgt.classList.remove("hit-flash");
      void tgt.offsetWidth;
      tgt.classList.add("hit-flash");
      if (e.crit) hadCrit = true;
      if (e.skillId === "world_end") hadWorldEnd = true;
    }

    // Drops linger longer so the player has time to see what dropped.
    setTimeout(() => div.remove(), isDrop ? 1800 : 900);
  }

  // ---- Crit flash (game-feel polish, no shake) ----
  if (hadCrit) {
    const flash = root.querySelector<HTMLElement>("#crit-flash-overlay");
    if (flash) {
      flash.classList.remove("fire");
      void flash.offsetWidth;
      flash.classList.add("fire");
      setTimeout(() => flash.classList.remove("fire"), 320);
    }
  }

  // ---- World End! cinematic zoom ----
  // Only triggers for the literal World Ender's signature skill — every other
  // skill is intentionally left alone so the zoom stays special.
  if (hadWorldEnd) {
    field.classList.remove("world-end-zoom");
    void field.offsetWidth;
    field.classList.add("world-end-zoom");
    setTimeout(() => field.classList.remove("world-end-zoom"), 820);
  }
}

function visibleSkills(c: Combatant): string[] {
  // Hide skills until the unit reaches the unlock level.
  return c.skills.filter(id => {
    const s = getSkill(id);
    return (s.unlockLevel ?? 1) <= c.level;
  });
}

function wireActionButtons(root: HTMLElement, b: Battle, onAction: ActionHandler): void {
  // Use onclick property assignment (not addEventListener) so repeat calls are
  // idempotent — reassignment overwrites the previous handler instead of stacking.
  root.querySelectorAll<HTMLButtonElement>("[data-tab-unit]").forEach(btn => {
    btn.onclick = () => {
      const unitId = btn.dataset.tabUnit!;
      const tab = btn.dataset.tab as ActionTab;
      const c = b.combatants.find(x => x.id === unitId);
      if (!c) return;
      if (tab === "skills" && isSilenced(c)) return;
      actionTabByUnit.set(unitId, tab);
      const row = root.querySelector<HTMLElement>(`[data-row-id="${cssAttr(unitId)}"]`);
      if (!row) return;
      row.outerHTML = unitRowHtml(c);
      wireActionButtons(root, b, onAction);
    };
  });

  for (const c of b.combatants) {
    if (c.side !== "player") continue;
    for (const skillId of visibleSkills(c)) {
      const btn = root.querySelector<HTMLButtonElement>(
        `button[data-unit-id="${cssAttr(c.id)}"][data-skill="${cssAttr(skillId)}"]`
      );
      if (!btn) continue;
      btn.onclick = () => {
        const skill = getSkill(skillId);
        if (skill.targeting === "self" || skill.targeting === "all_enemies") {
          onAction(c.id, skillId, c.id);
          targeting = null;
        } else {
          if (targeting?.unitId === c.id && targeting?.skillId === skillId) {
            targeting = null;
          } else {
            targeting = { unitId: c.id, skillId };
          }
        }
        updateLive(root, b);
      };
    }
  }
}

function wireEnemyClicks(root: HTMLElement, b: Battle, onAction: ActionHandler): void {
  // Event-delegated: a single listener on the cluster survives DOM rebuilds of
  // the individual enemy chips, so clicks never get lost between renders.
  const cluster = root.querySelector<HTMLElement>(".enemy-cluster");
  if (!cluster) return;
  cluster.addEventListener("click", e => {
    if (!targeting) return;
    const cell = (e.target as HTMLElement | null)?.closest<HTMLElement>(".combatant");
    if (!cell) return;
    const targetId = cell.dataset.id;
    if (!targetId) return;
    const target = b.combatants.find(c => c.id === targetId);
    if (!target) return;
    // Don't block on `alive`: the engine retargets to the nearest survivor.
    if (target.side !== "enemy") return;
    onAction(targeting.unitId, targeting.skillId, targetId);
    targeting = null;
    updateLive(root, b);
  });
}

/** Renders the ▶▶ Fast Forward pill (1x / 2x / 4x) when the current battle is
 *  a campaign floor 1..FAST_FORWARD_MAX_STAGE. For any other context (survival,
 *  boss raid, floors 21+, tutorial, replay) we render nothing so the UI stays
 *  clean and the option doesn't appear to be available. */
function fastForwardWidgetHtml(stageId: number | undefined, mode: RenderBattleOpts["mode"]): string {
  if (typeof stageId !== "number") return "";
  if (!isFastForwardAllowed(stageId, mode ?? "")) return "";
  const cur = getBattleSpeed();
  return `
    <div class="ff-widget" title="Fast forward — campaign floors 1-${FAST_FORWARD_MAX_STAGE} only">
      <span class="ff-label">▶▶</span>
      <button class="ff-btn ${cur === 1 ? "active" : ""}" data-ff="1" type="button">1x</button>
      <button class="ff-btn ${cur === 2 ? "active" : ""}" data-ff="2" type="button">2x</button>
      <button class="ff-btn ${cur === 4 ? "active" : ""}" data-ff="4" type="button">4x</button>
    </div>
  `;
}

function wireFastForward(root: HTMLElement): void {
  root.querySelectorAll<HTMLButtonElement>(".ff-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const mul = Number(btn.dataset.ff);
      const next: BattleSpeed = mul === 2 || mul === 4 ? mul : 1;
      setBattleSpeed(next);
      // Update active state across the row without re-rendering the whole battle.
      root.querySelectorAll<HTMLButtonElement>(".ff-btn").forEach(b => {
        b.classList.toggle("active", Number(b.dataset.ff) === next);
      });
    });
  });
}

function wireSurrender(root: HTMLElement, b: Battle, onPost: PostBattleHandler): void {
  const btn = root.querySelector<HTMLButtonElement>("#surrender-btn");
  if (!btn) return;
  if (b.state.kind !== "ticking") {
    btn.disabled = true;
    return;
  }
  btn.addEventListener("click", async () => {
    const ok = await confirmModal({
      title: "Surrender?",
      message: "Surrender this battle? You'll keep the XP earned so far.",
      confirmLabel: "Surrender",
      cancelLabel: "Keep Fighting",
      danger: true,
    });
    if (!ok) return;
    onPost("surrender");
  });
}

function wirePostBattleButtons(root: HTMLElement, onPost: PostBattleHandler): void {
  root.querySelector<HTMLButtonElement>("#post-home")?.addEventListener("click", () => onPost("home"));
  root.querySelector<HTMLButtonElement>("#post-stages")?.addEventListener("click", () => onPost("stages"));
}

function enemyClusterHtml(b: Battle): string {
  const enemies = b.combatants.filter(c => c.side === "enemy");
  // Cluster: arrange in roughly circular bunches with deterministic seeded jitter.
  const count = enemies.length;
  // Hand-tuned cluster layout (percent positions inside .enemy-cluster).
  const positions = clusterPositions(count);
  // A single enemy means a solo boss — rendered larger to convey threat.
  const soloBoss = count === 1;
  return enemies.map((c, i) => {
    const p = positions[i] ?? { x: 50, y: 50 };
    return `<div class="cluster-slot ${soloBoss ? "boss" : ""}" style="left:${p.x}%;top:${p.y}%">
      ${enemyChipHtml(c, soloBoss)}
    </div>`;
  }).join("");
}

function clusterPositions(n: number): { x: number; y: number }[] {
  // Spread chips far enough that ~210px-wide bubbles don't visually collide.
  // The cluster container is ~640px × ~360px, so we use generous fractional placements.
  if (n === 1) return [{ x: 50, y: 50 }];
  const presets: Record<number, { x: number; y: number }[]> = {
    2: [{ x: 28, y: 50 }, { x: 72, y: 50 }],
    3: [{ x: 22, y: 30 }, { x: 70, y: 30 }, { x: 46, y: 78 }],
    4: [{ x: 22, y: 22 }, { x: 70, y: 22 }, { x: 22, y: 78 }, { x: 70, y: 78 }],
    5: [{ x: 20, y: 18 }, { x: 70, y: 18 }, { x: 50, y: 50 }, { x: 20, y: 82 }, { x: 70, y: 82 }],
    6: [{ x: 20, y: 18 }, { x: 70, y: 18 }, { x: 20, y: 50 }, { x: 70, y: 50 }, { x: 20, y: 82 }, { x: 70, y: 82 }],
    7: [{ x: 20, y: 14 }, { x: 70, y: 14 }, { x: 20, y: 46 }, { x: 70, y: 46 }, { x: 20, y: 78 }, { x: 70, y: 78 }, { x: 46, y: 100 }],
    8: [{ x: 18, y: 14 }, { x: 70, y: 14 }, { x: 18, y: 42 }, { x: 70, y: 42 }, { x: 18, y: 70 }, { x: 70, y: 70 }, { x: 18, y: 96 }, { x: 70, y: 96 }],
    9: [{ x: 18, y: 14 }, { x: 50, y: 14 }, { x: 82, y: 14 }, { x: 18, y: 50 }, { x: 50, y: 50 }, { x: 82, y: 50 }, { x: 18, y: 86 }, { x: 50, y: 86 }, { x: 82, y: 86 }],
  };
  return presets[Math.min(9, n)] ?? presets[9];
}

/** Level → aura tier. Post-game enemies (Lv30+) get progressively more
 *  menacing portrait auras so a Lv65 Wraith reads visually distinct from
 *  the Lv5 Wraith you fought on Floor 5. Tiers map to color families:
 *    Lv  1-29  → none (vanilla portrait)
 *    Lv 30-39  → bronze (faint warm glow)
 *    Lv 40-49  → silver (cool sheen)
 *    Lv 50-59  → gold (radiant pulse)
 *    Lv 60-69  → violet (menacing crimson-purple)
 *    Lv 70+    → void (intense dark aura with pulsing animation)
 *  Returns "" for low-level enemies so floors 1-50 look exactly as before. */
function enemyAuraTier(level: number): string {
  if (level >= 70) return "aura-tier-void";
  if (level >= 60) return "aura-tier-violet";
  if (level >= 50) return "aura-tier-gold";
  if (level >= 40) return "aura-tier-silver";
  if (level >= 30) return "aura-tier-bronze";
  return "";
}

function enemyChipHtml(c: Combatant, isBoss = false): string {
  const dead = !c.alive ? "dead" : "";
  const ready = c.alive && c.gauge >= ATB_FULL ? "ready" : "";
  const casting = c.casting ? "casting" : "";
  const boss = isBoss ? "boss" : "";
  const auraTier = enemyAuraTier(c.level);
  const guardStyle = c.guarding ? "" : "display:none";
  return `
    <div class="combatant enemy split ${boss} ${dead} ${ready} ${casting} ${auraTier}" data-id="${escapeAttr(c.id)}">
      <div class="info">
        <div class="name">
          <span class="lv-inline">Lv${c.level}</span> ${escapeHtml(c.name)}
          <span class="badge guard-badge" style="${guardStyle}">G</span>
          ${renderEffectChips(c)}
        </div>
        <div class="bar hp"><div class="fill" style="width:${(c.hp / c.maxHp) * 100}%"></div><span class="bar-text">${c.hp}/${c.maxHp}</span></div>
        ${c.maxMp > 0 ? `<div class="bar mp"><div class="fill" style="width:${(c.mp / c.maxMp) * 100}%"></div><span class="bar-text">${c.mp}/${c.maxMp}</span></div>` : ""}
        <div class="bar atb"><div class="fill" style="width:${(c.gauge / ATB_FULL) * 100}%"></div></div>
      </div>
      <div class="enemy-avatar">
        <div class="portrait">${capeHtml(c.classId)}${portraitInner(c.templateId, c.portrait)}</div>
      </div>
    </div>
  `;
}

function playerStackHtml(b: Battle): string {
  const players = b.combatants.filter(c => c.side === "player").sort((a, b) => a.position.row - b.position.row);
  return players.map((c, i) => `
    <div class="player-slot" style="--idx:${i}">
      ${playerChipHtml(c)}
    </div>
  `).join("");
}

function playerChipHtml(c: Combatant): string {
  const dead = !c.alive ? "dead" : "";
  const ready = c.alive && c.gauge >= ATB_FULL ? "ready" : "";
  const casting = c.casting ? "casting" : "";
  const guardStyle = c.guarding ? "" : "display:none";
  return `
    <div class="combatant player split ${dead} ${ready} ${casting}" data-id="${escapeAttr(c.id)}">
      <div class="info">
        <div class="name">
          <span class="lv-inline">Lv${c.level}</span> ${escapeHtml(c.name)}
          <span class="badge guard-badge" style="${guardStyle}">G</span>
          ${renderEffectChips(c)}
        </div>
        <div class="bar hp"><div class="fill" style="width:${(c.hp / c.maxHp) * 100}%"></div><span class="bar-text">${c.hp}/${c.maxHp}</span></div>
        ${c.maxMp > 0 ? `<div class="bar mp"><div class="fill" style="width:${(c.mp / c.maxMp) * 100}%"></div><span class="bar-text">${c.mp}/${c.maxMp}</span></div>` : ""}
      </div>
      <div class="enemy-avatar">
        <div class="portrait">${capeHtml(c.classId)}${portraitInner(c.templateId, c.portrait)}</div>
      </div>
    </div>
  `;
}

function setBar(host: HTMLElement, kind: "hp" | "mp" | "atb", cur: number, max: number, withText = true): void {
  const fill = host.querySelector<HTMLElement>(`.bar.${kind} .fill`);
  if (fill) {
    const newPct = (cur / max) * 100;
    // Damage flash: if the HP bar is SHRINKING from its prior visible width,
    // pulse the red glow keyframe. Cosmetic only; never blocks the actual width
    // update. ATB / MP shrinkage is normal (spends, ticks) so they don't flash.
    if (kind === "hp") {
      const prev = parseFloat(fill.style.width || "100");
      if (Number.isFinite(prev) && newPct < prev - 0.01) {
        const bar = fill.parentElement;
        if (bar) {
          bar.classList.remove("dmg-flash");
          void bar.offsetWidth;
          bar.classList.add("dmg-flash");
          setTimeout(() => bar.classList.remove("dmg-flash"), 500);
        }
      }
    }
    fill.style.width = `${newPct}%`;
  }
  if (withText) {
    const text = host.querySelector<HTMLElement>(`.bar.${kind} .bar-text`);
    if (text) text.textContent = `${Math.round(cur)}/${max}`;
  }
}

function logLinesHtml(b: Battle): string {
  const players = new Set(b.combatants.filter(c => c.side === "player").map(c => c.name));
  const enemies = new Set(b.combatants.filter(c => c.side === "enemy").map(c => c.name));
  // Longest names first so multi-word names ("Tower God") win over substrings.
  const allNames = [...new Set([...players, ...enemies])].sort((a, b) => b.length - a.length);
  const colorize = (line: string): string => {
    let html = escapeHtml(line);
    for (const name of allNames) {
      const escapedRegex = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const re = new RegExp(`\\b${escapedRegex}\\b`, "g");
      const cls = players.has(name) ? "log-player" : "log-enemy";
      html = html.replace(re, `<span class="${cls}">${escapeHtml(name)}</span>`);
    }
    html = html.replace(/\bCRIT\b/g, `<span class="log-crit">CRIT</span>`);
    return html;
  };
  // Latest line first.
  return b.log.slice(-12).slice().reverse().map(line => `<div class="log-line">${colorize(line)}</div>`).join("");
}

function actionPanelHtml(b: Battle, showPostButtons: boolean): string {
  if (b.state.kind === "victory" || b.state.kind === "defeat") {
    if (!showPostButtons) {
      return `<div class="action-empty">${b.state.kind === "victory" ? "Floor cleared!" : "Defeated."}</div>`;
    }
    return `
      <div class="post-battle">
        <button class="confirm-btn" id="post-home" type="button">Return to Home</button>
        <button class="ghost-btn" id="post-stages" type="button">Tower Stages</button>
      </div>
    `;
  }
  const players = b.combatants.filter(c => c.side === "player");
  if (players.length === 0) return `<div class="action-empty">No units.</div>`;
  return `<div class="action-grid">${players.map(unitRowHtml).join("")}</div>`;
}

function unitRowHtml(c: Combatant): string {
  const all = visibleSkills(c);
  const basicIds = all.filter(id => BASE_SKILL_IDS.has(id));
  const skillIds = all.filter(id => !BASE_SKILL_IDS.has(id));
  const tab = getActionTab(c);
  const silenced = isSilenced(c);

  const renderButton = (id: string): string => {
    const skill = getSkill(id);
    const cd = c.skillCooldowns[id] ?? 0;
    const unaffordable = skill.mpCost > c.mp || (skill.hpCost !== undefined && skill.hpCost >= c.hp);
    const onCd = cd > 0;
    const queued = c.queuedAction?.skillId === id;
    const blockedBySilence = isSkillBlockedBySilence(c, id);
    const cls = [
      "skill-btn",
      unaffordable ? "unaffordable" : "",
      onCd ? "on-cooldown" : "",
      queued ? "queued" : "",
      blockedBySilence ? "silenced" : "",
    ].filter(Boolean).join(" ");
    const cost = skill.mpCost > 0 ? `<span class="cost">${skill.mpCost} MP</span>` : "";
    const hp = skill.hpCost ? `<span class="cost hp">${skill.hpCost}HP</span>` : "";
    const cdBadge = `<span class="cd-badge">${onCd ? cd : ""}</span>`;
    // For basic_attack, the static "phys" description is wrong for units with
    // basicAttackKind: "magical" (Shego, Nova, Hera, Calypso). Rewrite the
    // tooltip text on the fly so it matches the actual damage type.
    let desc = skill.description;
    if (id === "basic_attack" && c.basicAttackKind === "magical") {
      desc = desc.replace(/melee phys/i, "melee magical").replace(/\bphys\b/i, "magical");
    }
    const tip = `<span class="skill-tip"><span class="skill-tip-name">${escapeHtml(skill.name)}</span><span class="skill-tip-desc">${escapeHtml(desc)}</span></span>`;
    const disabled = unaffordable || onCd || blockedBySilence;
    return `<button class="${cls}" data-unit-id="${escapeAttr(c.id)}" data-skill="${escapeAttr(id)}" ${disabled ? "disabled" : ""}><span class="skill-label">${escapeHtml(skill.name)}</span>${cost}${hp}${cdBadge}${tip}</button>`;
  };

  const visibleIds = tab === "basic" ? basicIds : skillIds;
  const buttons = visibleIds.map(renderButton).join("");
  const dead = !c.alive ? "dead" : "";
  const effectChips = renderEffectChips(c);
  return `
    <div class="unit-row ${dead}" data-row-id="${escapeAttr(c.id)}">
      <div class="unit-label">
        ${escapeHtml(c.name)}
        ${effectChips}
      </div>
      <div class="unit-vitals-stack">
        <div class="vstat"><span class="vstat-label hp">HP</span><span class="vstat-val hp">${c.hp}/${c.maxHp}</span></div>
        ${c.maxMp > 0 ? `<div class="vstat"><span class="vstat-label mp">MP</span><span class="vstat-val mp">${c.mp}/${c.maxMp}</span></div>` : ""}
      </div>
      <div class="unit-atb">
        <div class="bar atb"><div class="fill" style="width:${(c.gauge / ATB_FULL) * 100}%"></div></div>
      </div>
      <div class="unit-action-tabs">
        <button class="action-tab ${tab === "basic" ? "active" : ""}" data-tab-unit="${escapeAttr(c.id)}" data-tab="basic" type="button">Basic</button>
        <button class="action-tab ${tab === "skills" ? "active" : ""} ${silenced ? "tab-disabled" : ""}" data-tab-unit="${escapeAttr(c.id)}" data-tab="skills" type="button">Skills</button>
      </div>
      <div class="unit-actions">${buttons}</div>
    </div>
  `;
}

/** Effect ids whose `power` is a fraction worth displaying as a percentage on
 *  the chip (lets the player see whether a 10% Gaze reflect or a 70% Fate's
 *  Rebound reflect is currently active). */
const PERCENT_EFFECT_IDS = new Set([
  "dmg_reduction", "damage_reflect", "vulnerability",
  "atk_buff", "stat_buff", "haste", "freeze",
]);

function renderEffectChipsInner(c: Combatant): string {
  if (c.effects.length === 0) return "";
  return c.effects.map(e => {
    const icon = effectIcon(e.id);
    const cls = isDebuff(e.id) ? "effect-chip debuff" : "effect-chip buff";
    const pct = PERCENT_EFFECT_IDS.has(e.id) ? Math.round(e.power * 100) : null;
    const pctHtml = pct !== null ? `<span class="effect-pct">${pct}%</span>` : "";
    const tooltipDetail = pct !== null ? `${pct}% · ${e.duration} actions` : `${e.duration} actions`;
    return `<span class="${cls}" title="${escapeAttr(effectName(e.id))} (${tooltipDetail})">${icon}${pctHtml}<span class="effect-dur">${e.duration}</span></span>`;
  }).join("");
}

function renderEffectChips(c: Combatant): string {
  const inner = renderEffectChipsInner(c);
  if (inner === "") return "";
  return `<span class="effect-chips">${inner}</span>`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  } as Record<string, string>)[c]);
}
function escapeAttr(s: string): string { return escapeHtml(s); }
function cssAttr(s: string): string { return s.replace(/(["\\])/g, "\\$1"); }
