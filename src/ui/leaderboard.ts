import { fetchTop, fetchTopWithExtras, formatMs, LbEntry, FirstConquerEntry, WorldEnderEntry, HighestFloorEntry, adminResetOneLeaderboard, AdminLbScope, fetchReplayBlob } from "../core/leaderboard";
import { loadSession } from "../auth/session";
import { isAdmin } from "../core/admin";
import { ReplayBlob } from "../core/replay";
import { confirmModal, alertModal } from "./confirmModal";

export function renderLeaderboard(root: HTMLElement, onBack: () => void, onPlayReplay?: (blob: ReplayBlob) => void): void {
  const myAddr = loadSession()?.address.toLowerCase() ?? null;

  const admin = isAdmin();
  const titleHtml = (label: string, scope: AdminLbScope): string =>
    admin
      ? `<div class="lb-board-title-row">
           <span class="lb-board-title">${escapeHtml(label)}</span>
           <button class="lb-admin-reset" type="button" data-reset-scope="${scope}" title="Admin: reset this board">Reset</button>
         </div>`
      : `<div class="lb-board-title">${escapeHtml(label)}</div>`;

  root.innerHTML = `
    <div class="screen-frame lb-screen">
      <div class="lb-header">
        <button class="back-btn" id="back-btn" type="button">← Back</button>
        <div class="lb-title-box">
          <svg class="lb-title-trophy" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M6 3h12v2h3v3a4 4 0 0 1-4 4h-.3A6 6 0 0 1 13 15.7V18h3v2H8v-2h3v-2.3A6 6 0 0 1 7.3 12H7a4 4 0 0 1-4-4V5h3V3Zm0 4H5v1a2 2 0 0 0 1 1.7V7Zm12 0v2.7A2 2 0 0 0 19 8V7h-1Z"/>
          </svg>
          <h1 class="lb-title-text">Leaderboard</h1>
        </div>
        <div></div>
      </div>
      <div class="lb-grid">
        <div class="lb-top-row">
          <div class="lb-board lb-floorclimb">
            ${titleHtml("Highest Floor Cleared", "floorclimb")}
            <div class="lb-rows" id="lb-floorclimb-rows">
              <div class="lb-empty">Loading…</div>
            </div>
          </div>
          <div class="lb-board lb-survival">
            ${titleHtml("Survival", "survival")}
            <div class="lb-rows" id="lb-survival-rows">
              <div class="lb-empty">Loading…</div>
            </div>
          </div>
          <div class="lb-board lb-bossraid">
            ${titleHtml("Boss Raid", "bossraid")}
            <div class="lb-rows" id="lb-bossraid-rows">
              <div class="lb-empty">Loading…</div>
            </div>
          </div>
          <div class="lb-board lb-fastest">
            ${titleHtml("Fastest to Kill World Ender", "we")}
            <div class="lb-rows" id="lb-fastest-rows">
              <div class="lb-empty">Loading…</div>
            </div>
          </div>
        </div>
        <div class="lb-board lb-conquer lb-conquer-wide">
          ${titleHtml("First to Conquer the Tower", "conquer")}
          <div class="lb-rows" id="lb-conquer-rows">
            <div class="lb-empty">Loading…</div>
          </div>
        </div>
      </div>
    </div>
  `;
  root.querySelector<HTMLButtonElement>("#back-btn")?.addEventListener("click", onBack);

  if (admin) {
    root.querySelectorAll<HTMLButtonElement>(".lb-admin-reset").forEach(btn => {
      btn.addEventListener("click", async () => {
        const scope = btn.dataset.resetScope as AdminLbScope | undefined;
        if (!scope) return;
        const labels: Record<AdminLbScope, string> = {
          survival: "Survival LB",
          bossraid: "Boss Raid LB",
          we: "Fastest World Ender LB",
          conquer: "First to Conquer record",
          floorclimb: "Highest Floor Cleared LB",
        };
        const ok = await confirmModal({
          title: "Wipe Leaderboard?",
          message: `Permanently wipe <strong>${labels[scope]}</strong>?<br><br>This can't be undone.`,
          confirmLabel: "Wipe",
          cancelLabel: "Cancel",
          danger: true,
        });
        if (!ok) return;
        btn.disabled = true;
        const r = await adminResetOneLeaderboard(scope);
        btn.disabled = false;
        if (r.ok) {
          renderLeaderboard(root, onBack, onPlayReplay);
        } else {
          await alertModal({
            kind: "error",
            title: "Reset Failed",
            message: `Couldn't reset the leaderboard: ${r.error ?? "unknown error"}`,
          });
        }
      });
    });
  }

  // Survival board (with first-conquer + world-ender in same payload).
  // Show up to 10 entries; replays available for top 3.
  void fetchTopWithExtras("survival", 10).then(({ entries, firstConquer, worldEnder, highestFloor, shopRevenue }) => {
    fillRows("lb-survival-rows", entries, myAddr, { mode: "survival" });
    fillFirstConquer("lb-conquer-rows", firstConquer, myAddr);
    fillWorldEnder("lb-fastest-rows", worldEnder, myAddr);
    fillHighestFloor("lb-floorclimb-rows", highestFloor, shopRevenue, myAddr);
  });

  // Boss raid board (independent fetch). Up to 10 entries.
  void fetchTop("boss_raid", 10).then(entries => {
    fillRows("lb-bossraid-rows", entries, myAddr, { mode: "boss_raid" });
  });

  // Wire loadout button clicks (delegated for buttons rendered later by async
  // loaders). Replaces the previous replay-playback flow — players found the
  // recorded battle less useful than just SEEING the levels + skills + stat
  // allocation the LB-holder used to reach their placement.
  root.addEventListener("click", async e => {
    const btn = (e.target as HTMLElement | null)?.closest<HTMLButtonElement>("button.lb-loadout-btn");
    if (!btn || btn.disabled) return;
    const scope = btn.dataset.replayScope;
    const address = btn.dataset.replayAddr;
    const ign = btn.dataset.replayIgn ?? "";
    const floorStr = btn.dataset.replayFloor;
    if (!scope || !address) return;
    btn.disabled = true;
    btn.textContent = "Loading…";
    const blob = await fetchReplayBlob<ReplayBlob>(scope, address);
    if (!blob || !blob.battles || blob.battles.length === 0) {
      // Older entries (predating the replay save) won't have a blob — gray
      // the button out in place instead of showing a browser alert.
      btn.disabled = true;
      btn.textContent = "No data";
      btn.classList.add("lb-loadout-empty");
      btn.title = "This entry was set before loadouts were recorded.";
      return;
    }
    // The party at battle 0 is what the player STARTED with; the party at the
    // last battle is what they ENDED with (after carryover hp/mp/cooldowns).
    // Show the starting party — represents the build they brought into the run.
    const startParty = blob.battles[0].party;
    showLoadoutModal({ ign, address, floor: floorStr ? Number(floorStr) : undefined, party: startParty });
    btn.disabled = false;
    btn.textContent = "👁 Loadout";
  });
}

/** Modal: shows the levels + class + stat allocation + equipped skills for
 *  every unit in a LB placement's starting party. Read-only viewer.
 *  Dismiss with Esc, click-outside, or the close button. */
function showLoadoutModal(opts: { ign: string; address: string; floor?: number; party: import("../core/replay").ReplayPartyMember[] }): void {
  document.querySelectorAll(".lb-loadout-modal").forEach(el => el.remove());
  const overlay = document.createElement("div");
  overlay.className = "lb-loadout-modal";
  const titleSuffix = opts.floor !== undefined ? ` · Floor ${opts.floor}` : "";
  overlay.innerHTML = `
    <div class="lb-loadout-card">
      <div class="lb-loadout-head">
        <div>
          <div class="lb-loadout-title">${escapeHtml(opts.ign || "—")}'s Loadout</div>
          <div class="lb-loadout-sub">${shortAddr(opts.address)}${titleSuffix}</div>
        </div>
        <button class="lb-loadout-close" id="lb-loadout-close" type="button" aria-label="Close">×</button>
      </div>
      <div class="lb-loadout-body">
        <div class="lb-conquer-party">
          ${opts.party.map(m => conquerPartyCardHtml({
            templateId: m.templateId,
            classId: m.classId,
            level: m.level,
            customStats: m.customStats as unknown as Record<string, number>,
            equippedSkills: m.equippedSkills,
          })).join("")}
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  const close = () => overlay.remove();
  overlay.querySelector<HTMLButtonElement>("#lb-loadout-close")?.addEventListener("click", close);
  overlay.addEventListener("click", e => { if (e.target === overlay) close(); });
  const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { close(); document.removeEventListener("keydown", onKey); } };
  document.addEventListener("keydown", onKey);
}

/** Prize tables per leaderboard. Values in RON. */
const PRIZES_RUN: Record<number, number> = { 1: 120, 2: 75, 3: 45, 4: 30, 5: 30 };
const PRIZES_WORLD_ENDER: Record<number, number> = { 1: 100, 2: 60, 3: 40 };
const PRIZE_FIRST_CONQUER = 200;

/** Highest Floor Cleared board: top 3 split the total RON spent on the shop.
 *  Percentages (not fixed RON) — the actual payout is computed live from the
 *  shopRevenue pool the server reports. */
const FLOOR_PRIZE_PCT: Record<number, number> = { 1: 50, 2: 30, 3: 20 };

function prizeChip(amount: number | undefined): string {
  if (!amount) return "";
  return `<span class="lb-prize" title="Prize: ${amount} $RON">${amount} RON</span>`;
}

/** Prize chip for the Highest Floor board — a percentage share of the live
 *  shop-revenue pool. Shows the computed RON when the pool is known, falling
 *  back to just the percentage when the pool is still empty. */
function floorPrizeChip(rank: number, pool: number): string {
  const pct = FLOOR_PRIZE_PCT[rank];
  if (!pct) return "";
  const ron = Math.floor((pool * pct) / 100);
  const label = pool > 0 ? `${pct}% · ${ron} RON` : `${pct}% of shop RON`;
  return `<span class="lb-prize" title="Prize: ${pct}% of total RON spent on the shop">${label}</span>`;
}

function fillWorldEnder(elId: string, entries: WorldEnderEntry[], myAddr: string | null): void {
  const el = document.getElementById(elId);
  if (!el) return;
  // Top 5 displayed; replays available for top 3; prizes for top 3.
  // Pad to 5 rows so empty slots still display the rank + RON reward (top 3).
  const SLOT_COUNT = 5;
  const display: (WorldEnderEntry | null)[] = [];
  for (let i = 0; i < SLOT_COUNT; i++) {
    display.push(entries[i] ?? null);
  }
  el.innerHTML = display.map((e, idx) => {
    const rank = idx + 1;
    if (!e) return emptySlotRowHtml(rank, PRIZES_WORLD_ENDER[rank]);
    const isMe = myAddr !== null && e.address.toLowerCase() === myAddr;
    return `
      <div class="lb-row ${isMe ? "me" : ""}">
        <span class="lb-col rank">${e.rank}</span>
        <span class="lb-col player">
          <span class="lb-ign">${escapeHtml(e.ign ?? "—")}</span>
          <span class="lb-addr" title="${escapeHtml(e.address)}">${shortAddr(e.address)}</span>
          ${prizeChip(PRIZES_WORLD_ENDER[e.rank])}
        </span>
        <span class="lb-col time">${formatMs(e.ms)}</span>
        ${loadoutBtnHtml(e.rank <= 10, "we", e.address, e.ign ?? "—", 50)}
      </div>
    `;
  }).join("");
}

function fillHighestFloor(elId: string, entries: HighestFloorEntry[], shopRevenue: number, myAddr: string | null): void {
  const el = document.getElementById(elId);
  if (!el) return;
  // Top 3 split 50/30/20% of total shop RON; 5 rows rendered so the unclaimed
  // ranks 4-5 still show as empty slots.
  const SLOT_COUNT = 5;
  const display: (HighestFloorEntry | null)[] = [];
  for (let i = 0; i < SLOT_COUNT; i++) display.push(entries[i] ?? null);
  el.innerHTML = display.map((e, idx) => {
    const rank = idx + 1;
    if (!e) {
      return `
        <div class="lb-row lb-row-empty">
          <span class="lb-col rank">${rank}</span>
          <span class="lb-col player">
            <span class="lb-ign dim">—</span>
            ${floorPrizeChip(rank, shopRevenue)}
          </span>
          <span class="lb-col floor dim">—</span>
        </div>
      `;
    }
    const isMe = myAddr !== null && e.address.toLowerCase() === myAddr;
    return `
      <div class="lb-row ${isMe ? "me" : ""}">
        <span class="lb-col rank">${e.rank}</span>
        <span class="lb-col player">
          <span class="lb-ign">${escapeHtml(e.ign ?? "—")}</span>
          <span class="lb-addr" title="${escapeHtml(e.address)}">${shortAddr(e.address)}</span>
          ${floorPrizeChip(e.rank, shopRevenue)}
        </span>
        <span class="lb-col floor">${e.floor}</span>
      </div>
    `;
  }).join("");
}

interface FillOpts {
  mode: "survival" | "boss_raid";
  hideFloor?: boolean;
}

function fillRows(elId: string, entries: LbEntry[], myAddr: string | null, opts: FillOpts): void {
  const el = document.getElementById(elId);
  if (!el) return;
  // Show top 7 only. With the stacked 2-line row layout, 7 rows fit the
  // 4-across board height without a scrollbar; ranks 6-7 render as empty
  // slots (no prize — prizes stop at rank 5).
  const SLOT_COUNT = 7;
  const display: (LbEntry | null)[] = [];
  for (let i = 0; i < SLOT_COUNT; i++) {
    display.push(entries[i] ?? null);
  }
  el.innerHTML = display.map((e, idx) => {
    const rank = idx + 1;
    if (!e) return emptyRunRowHtml(rank, PRIZES_RUN[rank]);
    return rowHtml(e, myAddr, opts);
  }).join("");
}

/** Empty Survival/Boss-Raid slot — matches the stacked .lb-run-row layout
 *  used by filled rows so the column doesn't jump between row styles. */
function emptyRunRowHtml(rank: number, prize: number | undefined): string {
  return `
    <div class="lb-row lb-run-row lb-row-empty">
      <div class="lb-run-top">
        <span class="lb-col rank">${rank}</span>
        <span class="lb-ign dim">—</span>
      </div>
      <div class="lb-run-bottom">
        ${prizeChip(prize)}
        <span class="lb-run-meta-item dim">—:—</span>
      </div>
    </div>
  `;
}

/** Empty-rank row: shows the rank and (if any) RON reward, nothing else. */
function emptySlotRowHtml(rank: number, prize: number | undefined, hideFloor?: boolean): string {
  return `
    <div class="lb-row lb-row-empty">
      <span class="lb-col rank">${rank}</span>
      <span class="lb-col player">
        <span class="lb-ign dim">—</span>
        ${prizeChip(prize)}
      </span>
      ${hideFloor ? "" : `<span class="lb-col floor dim">—</span>`}
      <span class="lb-col time dim">—:—</span>
    </div>
  `;
}

function fillFirstConquer(elId: string, fc: FirstConquerEntry | null, myAddr: string | null): void {
  const el = document.getElementById(elId);
  if (!el) return;
  if (!fc) {
    el.innerHTML = `
      <div class="lb-row lb-conquer-row lb-row-empty">
        <span class="lb-col rank">★</span>
        <span class="lb-col player">
          <span class="lb-ign dim">No conqueror yet</span>
          ${prizeChip(PRIZE_FIRST_CONQUER)}
        </span>
      </div>
    `;
    return;
  }
  const isMe = myAddr !== null && fc.address.toLowerCase() === myAddr;
  const date = new Date(fc.when).toLocaleDateString();
  // Phase 3: show the party on the floor-50 finish (no replay button).
  const partyHtml = fc.party && fc.party.length > 0
    ? `<div class="lb-conquer-party">${fc.party.map(conquerPartyCardHtml).join("")}</div>`
    : "";
  el.innerHTML = `
    <div class="lb-row lb-conquer-row ${isMe ? "me" : ""}">
      <span class="lb-col rank">★</span>
      <span class="lb-col player">
        <span class="lb-ign">${escapeHtml(fc.ign ?? "—")}</span>
        <span class="lb-addr" title="${escapeHtml(fc.address)}">${shortAddr(fc.address)}</span>
        <span class="lb-conquer-date">${escapeHtml(date)}</span>
        ${prizeChip(PRIZE_FIRST_CONQUER)}
      </span>
    </div>
    ${partyHtml}
  `;
}

function conquerPartyCardHtml(m: { templateId: string; classId?: string; level: number; customStats: Record<string, number>; equippedSkills: string[] }): string {
  // Stat allocation is intentionally hidden from the loadout viewer so other
  // players can't copy the exact build that won the placement. Class +
  // equipped skills are still shown — those are the strategic surface;
  // stats are the deeper trade secret.
  const skills = m.equippedSkills.length > 0
    ? m.equippedSkills.map(s => `<span class="lb-skill-chip">${escapeHtml(s)}</span>`).join("")
    : `<span class="lb-skill-chip dim">(none)</span>`;
  return `
    <div class="lb-conquer-card">
      <div class="lb-conquer-head">
        <span class="lb-conquer-unit">${escapeHtml(m.templateId)}</span>
        <span class="lv-inline">Lv${m.level}</span>
        ${m.classId ? `<span class="lb-conquer-class">${escapeHtml(m.classId)}</span>` : ""}
      </div>
      <div class="lb-conquer-skills">${skills}</div>
    </div>
  `;
}

function rowHtml(e: LbEntry, myAddr: string | null, opts: FillOpts): string {
  const isMe = myAddr !== null && e.address.toLowerCase() === myAddr;
  const name = e.ign ?? "—";
  // Show the View Loadout button for ALL ranked entries (was top 3 only when
  // it was a Replay button). Seeing a leader's build is useful at every tier.
  const showLoadout = e.rank <= 10;
  const scope = opts.mode === "survival" ? "lb_survival" : "lb_bossraid";
  // Survival = floors climbed; Boss Raid = bosses downed. Label the count
  // accordingly instead of a bare number.
  const progressLabel = opts.mode === "survival" ? "Floor" : "Boss";
  // Stacked 2-line layout: line 1 = rank + name + loadout button; line 2 =
  // address + progress + time + prize. The narrow 4-across board can't fit
  // all of that on one row (player names were truncating to "H..."), so the
  // name gets the full width of line 1.
  return `
    <div class="lb-row lb-run-row ${isMe ? "me" : ""}">
      <div class="lb-run-top">
        <span class="lb-col rank">${e.rank}</span>
        <span class="lb-ign" title="${escapeAttr(e.address)}">${escapeHtml(name)}</span>
        ${loadoutBtnHtml(showLoadout, scope, e.address, name, e.floor)}
      </div>
      <div class="lb-run-bottom">
        <span class="lb-addr" title="${escapeAttr(e.address)}">${shortAddr(e.address)}</span>
        ${opts.hideFloor ? "" : `<span class="lb-run-meta-item">${progressLabel} ${e.floor}</span>`}
        <span class="lb-run-meta-item">${formatMs(e.ms)}</span>
        ${prizeChip(PRIZES_RUN[e.rank])}
      </div>
    </div>
  `;
}

/** Renders the View Loadout button. Click opens a modal that pulls the
 *  starting party (levels, class, stats, equipped skills) from the same
 *  replay blob the old Replay button used to play. */
function loadoutBtnHtml(show: boolean, scope: string, address: string, ign: string, floor: number): string {
  if (!show) return "";
  return `<button class="lb-loadout-btn" type="button"
    data-replay-scope="${escapeAttr(scope)}"
    data-replay-addr="${escapeAttr(address)}"
    data-replay-ign="${escapeAttr(ign)}"
    data-replay-floor="${floor}">👁 Loadout</button>`;
}

function escapeAttr(s: string): string { return escapeHtml(s); }

function shortAddr(a: string): string {
  if (a.length < 12) return escapeHtml(a);
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  } as Record<string, string>)[c]);
}
