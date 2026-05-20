import { loadSettings } from "./settings";
import { getEnergy, ENERGY_MAX, msUntilNextRefill } from "../core/energy";
import { startEnergyTimerLoop, formatRefillCountdown } from "./energyTimer";
import { fetchDailyStatus, claimDailyBonus, DailyStatus } from "../core/daily";
import { setEnergy } from "../core/energy";
import { refreshSeasonStatus, getCachedSeasonStatus } from "../core/season";
import { alertModal } from "./confirmModal";
import { fetchReferralClaimable } from "../core/referral";

export type HomeAction = "tower" | "units" | "settings" | "tutorial" | "leaderboard" | "codex" | "shop" | "inventory" | "referral";

export function renderHome(root: HTMLElement, onAction: (a: HomeAction) => void): void {
  const s = loadSettings();
  const energy = getEnergy();
  root.innerHTML = `
    <div class="home-screen">
      <button class="gear-btn" id="open-settings" type="button" title="Settings">⚙</button>
      <button class="gear-btn tutorial-btn" id="open-tutorial" type="button" title="Replay tutorial">?</button>
      <button class="gear-btn codex-btn" id="open-codex" type="button" title="Codex — stats, actions, effects">📖</button>
      <button class="gear-btn inventory-btn" id="open-inventory" type="button" title="Inventory (Backpack)" aria-label="Inventory">
        <svg class="inv-icon-svg" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
          <!-- Top strap loop -->
          <path d="M11 5 Q11 1 16 1 Q21 1 21 5 L21 9 L19 9 L19 5 Q19 3 16 3 Q13 3 13 5 L13 9 L11 9 Z" fill="#3a200d"/>
          <!-- Bag body (rounded square) -->
          <rect x="5" y="8" width="22" height="22" rx="4" fill="#8b5a2b" stroke="#3a200d" stroke-width="1.2"/>
          <!-- Front pocket -->
          <rect x="9" y="17" width="14" height="9" rx="1.5" fill="#6b4321" stroke="#3a200d" stroke-width="1"/>
          <!-- Pocket buckle -->
          <rect x="14" y="20" width="4" height="3" rx="0.5" fill="#d4a93e" stroke="#7a5a14" stroke-width="0.5"/>
          <!-- Top flap line -->
          <line x1="6" y1="13" x2="26" y2="13" stroke="#3a200d" stroke-width="0.8" opacity="0.55"/>
        </svg>
      </button>
      <div class="energy-pill" title="Energy">
        <span class="energy-icon">⚡</span>
        <span>${energy} / ${ENERGY_MAX}</span>
        <span class="energy-timer" data-energy-timer>${formatRefillCountdown(msUntilNextRefill())}</span>
      </div>
      <div class="daily-slot" id="daily-slot"></div>
      <div class="season-halt-banner" id="season-halt-banner" hidden></div>
      <div class="home-header">
        <div class="home-greeting">Welcome, ${escapeHtml(s.playerName)}</div>
        <h1 class="home-title">Gauntlet Tower</h1>
      </div>
      <div class="home-tiles">
        <button class="home-tile primary" data-action="tower" type="button">
          <div class="tile-title">Ascend!</div>
        </button>
        <button class="home-tile" data-action="units" type="button">
          <div class="tile-title">Units</div>
        </button>
        <button class="home-tile" data-action="shop" type="button">
          <div class="tile-title">Shop</div>
        </button>
        <button class="home-tile" data-action="leaderboard" type="button">
          <div class="tile-title">Leaderboard</div>
        </button>
        <button class="home-tile" data-action="referral" type="button">
          <div class="tile-title">Refer a Friend</div>
          <span class="home-tile-badge" id="referral-badge" hidden></span>
        </button>
      </div>
    </div>
  `;
  startEnergyTimerLoop();
  root.querySelector("#open-settings")?.addEventListener("click", () => onAction("settings"));
  root.querySelector("#open-tutorial")?.addEventListener("click", () => onAction("tutorial"));
  root.querySelector("#open-codex")?.addEventListener("click", () => onAction("codex"));
  root.querySelector("#open-inventory")?.addEventListener("click", () => onAction("inventory"));
  // Run-start gate: if season is halted, the "Ascend!" tile shows an alert
  // explaining the pause instead of navigating into the tower. The actual
  // server enforcement still runs — this is just a faster UX path so the
  // player doesn't have to start a run before learning it's blocked.
  root.querySelectorAll<HTMLButtonElement>(".home-tile").forEach(btn => {
    btn.addEventListener("click", async () => {
      const action = btn.dataset.action as HomeAction;
      if (getCachedSeasonStatus().halted && (action === "tower" || action === "shop")) {
        await alertModal({
          kind: "info",
          title: "Season Ended",
          message: action === "tower"
            ? "The current season is over — run starts are paused until the next season begins. Your <strong>Inventory</strong> is still open if you want to use items you already own."
            : "The shop is closed for the off-season — new purchases are paused until the next season starts. Your <strong>Inventory</strong> still has everything you bought, and items there still work.",
        });
        return;
      }
      onAction(action);
    });
  });

  void mountDailyWidget(root);
  void mountSeasonBanner(root);

  // Referral notification bubble — if the wallet has unclaimed referral
  // energy, badge the "Refer a Friend" tile with the amount. No popup; the
  // player sees the bubble, opens the referral screen, and claims there.
  void fetchReferralClaimable().then(claimable => {
    if (claimable <= 0) return;
    const badge = root.querySelector<HTMLElement>("#referral-badge");
    if (badge) {
      badge.textContent = claimable > 99 ? "99+" : String(claimable);
      badge.hidden = false;
    }
  }).catch(() => undefined);
}

async function mountSeasonBanner(root: HTMLElement): Promise<void> {
  const banner = root.querySelector<HTMLElement>("#season-halt-banner");
  const towerTile = root.querySelector<HTMLButtonElement>('.home-tile[data-action="tower"]');
  const shopTile = root.querySelector<HTMLButtonElement>('.home-tile[data-action="shop"]');
  const s = await refreshSeasonStatus();
  if (!banner) return;
  if (s.halted) {
    banner.hidden = false;
    banner.innerHTML = `
      <span class="season-halt-icon">⏸</span>
      <div class="season-halt-text">
        <strong>Season Ended</strong>
        <span>Run starts AND new shop purchases are paused. Your Inventory still works.</span>
      </div>
    `;
    const grayTile = (tile: HTMLButtonElement | null, label: string): void => {
      if (!tile) return;
      tile.classList.add("home-tile-disabled");
      const titleEl = tile.querySelector<HTMLElement>(".tile-title");
      if (titleEl) titleEl.textContent = label;
    };
    grayTile(towerTile, "Ascend (Paused)");
    grayTile(shopTile, "Shop (Closed)");
  } else {
    banner.hidden = true;
  }
}

async function mountDailyWidget(root: HTMLElement): Promise<void> {
  const slot = root.querySelector<HTMLElement>("#daily-slot");
  if (!slot) return;
  const status = await fetchDailyStatus();
  if (!status) { slot.innerHTML = ""; return; }
  renderDailyWidget(slot, status);
}

function renderDailyWidget(slot: HTMLElement, status: DailyStatus): void {
  const next = status.todayReward;
  const streakDisplay = status.claimedToday ? status.streak : Math.max(1, status.streak + 1);
  if (status.claimedToday) {
    slot.innerHTML = `
      <div class="daily-card claimed">
        <div class="daily-streak">🔥 Day ${status.streak}</div>
        <div class="daily-claimed-text">Daily reward claimed</div>
        <div class="daily-bonus-line">${formatBonus(status.todayReward, /*active*/ true)}</div>
      </div>
    `;
    return;
  }
  slot.innerHTML = `
    <div class="daily-card">
      <div class="daily-streak">🔥 Day ${streakDisplay}</div>
      <button class="daily-claim-btn" id="daily-claim-btn" type="button">Claim Daily Reward</button>
      <div class="daily-bonus-line">${formatBonus(next, /*active*/ false)}</div>
    </div>
  `;
  slot.querySelector<HTMLButtonElement>("#daily-claim-btn")?.addEventListener("click", async () => {
    const btn = slot.querySelector<HTMLButtonElement>("#daily-claim-btn");
    if (btn) btn.disabled = true;
    // Surface the on-chain signing step in the button label so the player
    // knows the wallet popup is expected. Without this the button just
    // freezes for 5-10s while waiting for the signature, looking broken.
    const result = await claimDailyBonus(phase => {
      if (!btn) return;
      if (phase === "signing") btn.textContent = "⛓ Sign in wallet…";
      else if (phase === "submitted") btn.textContent = "⏳ Confirming…";
    });
    if (btn) btn.textContent = "Claim Daily Reward";
    if (!result) {
      if (btn) btn.disabled = false;
      await alertModal({
        kind: "error",
        title: "Couldn't Reach Server",
        message: "We couldn't claim your daily bonus right now. Check your connection and try again.",
      });
      return;
    }
    if (!result.ok) {
      // Player cancelled the wallet popup — silent close, no error toast.
      // Just re-enable the button so they can try again when ready.
      if (result.reason === "user_cancelled") {
        if (btn) btn.disabled = false;
        return;
      }
      // On-chain signature missing / verification failed — server held back
      // the in-game reward. Surface the actual reason so the player knows
      // what to fix (e.g. "insufficient funds for gas", "tx too old", etc.).
      if (result.reason === "onchain_failed" || result.reason === "onchain_required") {
        if (btn) btn.disabled = false;
        await alertModal({
          kind: "error",
          title: "On-Chain Check-In Failed",
          message: `The on-chain Daily Check-In couldn't complete, so the in-game reward was held back. You also need this signature to earn Gauntlet Energy and XP multiplier.<br><br><span style="font-family:monospace; font-size:11px; opacity:0.8;">${result.onchainError ?? "unknown error"}</span><br><br>Try again in a moment.`,
        });
        return;
      }
      // Race: another tab claimed first; refresh to claimed view.
      renderDailyWidget(slot, {
        streak: result.streak, claimedToday: true,
        todayReward: result.reward, multiplier: result.multiplier,
      });
      return;
    }
    setEnergy(result.energy);
    // Update the energy pill so the bonus shows immediately.
    const pill = document.querySelector<HTMLElement>(".energy-pill span:nth-child(2)");
    if (pill) pill.textContent = `${result.energy} / ${ENERGY_MAX}`;
    renderDailyWidget(slot, {
      streak: result.streak, claimedToday: true,
      todayReward: result.reward, multiplier: result.multiplier,
    });
  });
}

function formatBonus(reward: { energy: number; multiplier: number }, active: boolean): string {
  const verb = active ? "Active today:" : "Today's reward:";
  const mulPart = reward.multiplier > 1 ? ` · ${reward.multiplier}× XP` : "";
  return `${verb} +${reward.energy} energy${mulPart}`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  } as Record<string, string>)[c]);
}
