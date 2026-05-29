// Persistent settings stored in localStorage.
import { addEnergy, getEnergy, ENERGY_MAX, msUntilNextRefill } from "../core/energy";
import { getMaxCleared } from "../core/clears";
import { isAdmin } from "../core/admin";
import { scopedKey } from "../auth/scope";
import { saveServerIgn, formatCooldown } from "../auth/ign";
import { adminGrantServerEnergy, adminFillServerEnergy, adminWipeAllProdData, adminForceResetWallet, adminForceResetExcept, adminConsumeOneTimeOffers, adminGrantEnergyToWallet, adminTestOnChainCheckIn, adminGrantSampleVouchers, adminDiagnoseWallet, adminSetMaxFloor, adminSetHighestFloorLbOnly, adminSubmitLbScore, adminLbActivity, adminLbFreezeStatus, adminLbFreezeSnapshot, adminLbFreezeToggle, adminLbFreezeSchedule, adminLbFreezeCancelSchedule, adminRemoveLbEntry, type WalletDiagnosis } from "../auth/energyApi";
import { fetchSeasonStatus, adminSetSeasonHalt, setCachedSeasonStatus } from "../core/season";
import { isDevBuild } from "../auth/devBuild";
import { confirmModal, alertModal, promptModal } from "./confirmModal";
import { showPrivacyModal } from "./privacy";
import { clearSession } from "../auth/session";
import { getSfxVolume, setSfxVolume, sfx } from "../core/audio";
import { getBgmVolume, setBgmVolume } from "../core/bgm";

export interface Settings {
  playerName: string;
  walletAddress: string;
  sfxOn: boolean;
  bgmOn: boolean;
  /** Dev override: when true, the units screen lets you change classes anytime. */
  devUnlockClass: boolean;
  /** Combat UI: when true, every player unit's action bar shows BOTH the
   *  basic actions (Idle/Attack/Guard) AND the skill list at the same time
   *  — no tab switching. Unlocks after clearing Floor 50. */
  showBothActions: boolean;
  /** True once the "this option is now available" tutorial modal has been
   *  shown to this wallet. Prevents re-firing on every home visit. */
  showBothActionsTutorialSeen: boolean;
}

const KEY = () => scopedKey("stat-battler.settings.v1");

const DEFAULTS: Settings = {
  playerName: "",
  walletAddress: "",
  sfxOn: true,
  bgmOn: true,
  devUnlockClass: false,
  showBothActions: false,
  showBothActionsTutorialSeen: false,
};

/** Floor a player must clear before the "show both action groups" toggle
 *  becomes available in Settings. */
export const SHOW_BOTH_ACTIONS_UNLOCK_FLOOR = 50;

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY());
    if (!raw) return { ...DEFAULTS };
    const parsed = JSON.parse(raw);
    return { ...DEFAULTS, ...parsed };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(KEY(), JSON.stringify(s));
  } catch {
    // ignore quota / privacy-mode errors
  }
}

export function renderSettings(root: HTMLElement, onClose: () => void): void {
  const s = loadSettings();
  root.innerHTML = `
    <div class="screen-frame">
      ${topBarHtml("Settings", true)}
      <div class="settings-panel">
        <label class="setting-row">
          <span class="setting-label">Player name</span>
          <input id="setting-name" type="text" maxlength="24" value="${escapeAttr(s.playerName)}" />
          <span class="setting-hint">You can only change your name once every 7 days.</span>
          <span id="ign-status" class="setting-hint" style="color: var(--gold-bright);"></span>
        </label>

        <label class="setting-row">
          <span class="setting-label">Wallet address</span>
          <input id="setting-wallet" type="text" value="${escapeAttr(s.walletAddress)}" readonly />
          <span class="setting-hint">Linked via Ronin wallet at sign-in.</span>
        </label>

        <div class="setting-row">
          <span class="setting-label">Wallet session</span>
          <div class="wallet-actions">
            <button class="ghost-btn wallet-sign-out" id="setting-sign-out" type="button">Sign Out</button>
          </div>
          <span class="setting-hint">
            <strong>Sign Out</strong> ends this session. Next login requires a fresh signature in your wallet —
            session caching is bypassed, so a tampered localStorage can't impersonate you. To use a different
            wallet, sign out and sign in again with the new wallet.
          </span>
        </div>

        <div class="setting-row">
          <span class="setting-label">Audio</span>
          <div class="audio-toggles">
            <label class="toggle">
              <input type="checkbox" id="setting-sfx" ${s.sfxOn ? "checked" : ""} />
              <span>Sound effects</span>
            </label>
            <div class="volume-row">
              <span class="volume-label">SFX volume</span>
              <input type="range" id="setting-sfx-volume" min="0" max="100" step="1" value="${Math.round(getSfxVolume() * 100)}" />
              <span class="volume-value" id="setting-sfx-volume-value">${Math.round(getSfxVolume() * 100)}</span>
            </div>

            <label class="toggle">
              <input type="checkbox" id="setting-bgm" ${s.bgmOn ? "checked" : ""} />
              <span>Background music</span>
            </label>
            <div class="volume-row">
              <span class="volume-label">Music volume</span>
              <input type="range" id="setting-bgm-volume" min="0" max="100" step="1" value="${Math.round(getBgmVolume() * 100)}" />
              <span class="volume-value" id="setting-bgm-volume-value">${Math.round(getBgmVolume() * 100)}</span>
            </div>
          </div>
        </div>

        <div class="setting-row">
          <span class="setting-label">Combat</span>
          ${(() => {
            const unlocked = getMaxCleared() >= SHOW_BOTH_ACTIONS_UNLOCK_FLOOR;
            const lockedHint = `🔒 Unlocks after clearing Floor ${SHOW_BOTH_ACTIONS_UNLOCK_FLOOR}.`;
            return `
              <label class="toggle ${unlocked ? "" : "toggle-locked"}">
                <input type="checkbox" id="setting-show-both-actions" ${s.showBothActions ? "checked" : ""} ${unlocked ? "" : "disabled"} />
                <span>Show basic actions + skills side by side</span>
              </label>
              <span class="setting-hint">
                ${unlocked
                  ? "When on, every unit's action bar shows BOTH the basic actions (Idle / Attack / Guard) and its skills at once — no tab switching during fights."
                  : lockedHint}
              </span>
            `;
          })()}
        </div>

        <div class="setting-row">
          <span class="setting-label">Privacy &amp; Data</span>
          <div class="wallet-actions">
            <button class="ghost-btn" id="setting-privacy" type="button">View Privacy Notice</button>
          </div>
          <span class="setting-hint">
            What the game stores and why. Gauntlet Tower uses <strong>no cookies</strong>
            and <strong>no third-party tracking</strong>.
          </span>
        </div>

        ${isAdmin() ? `
          <div class="setting-row">
            <span class="setting-label">Admin</span>
            <div class="admin-row">
              <span class="admin-info">Energy ${getEnergy()}/${ENERGY_MAX} · refills in ${formatHrs(msUntilNextRefill())}</span>
              <button class="ghost-btn" id="admin-add-energy" type="button">+5 Energy</button>
              <button class="ghost-btn" id="admin-fill-energy" type="button">Refill Max</button>
            </div>
            <div class="admin-row" style="flex-direction: column; align-items: flex-start; gap: 4px;">
              <span class="admin-info">🔍 <strong>Diagnose Wallet Progress</strong> — reads a wallet's per-wallet maxfloor key AND its score on ALL three leaderboards (Highest Floor / Survival / Boss Raid). Spots both <em>drift</em> (per-wallet vs LB mismatch, from a dropped campaign clear) AND <em>lost runs</em> (survival/boss raid LB doesn't reflect a run the player claims to have finished — usually a tab-close before /run/end fired).</span>
              <div style="display:flex; gap:6px; flex-wrap:wrap; align-items:center;">
                <input type="text" id="admin-diag-wallet" placeholder="0x..." style="font-family:monospace; padding:4px 8px; min-width:340px;" />
                <button class="ghost-btn" id="admin-diag-btn" type="button" style="border-color:#9bcfff;color:#cce4ff;">🔍 Diagnose</button>
              </div>
              <div style="display:flex; gap:6px; flex-wrap:wrap; align-items:center; margin-top:6px;">
                <span class="admin-info" style="font-size:10px;">Campaign repair:</span>
                <input type="number" id="admin-diag-floor" placeholder="177" min="1" max="500" style="width:80px; padding:4px 6px;" />
                <button class="ghost-btn" id="admin-set-max-btn" type="button" style="border-color:#ffb14a;color:#ffd29a;" title="Sets BOTH per-wallet maxfloor AND Highest Floor LB. Lowering the per-wallet key freezes the player at floor+1 until they re-clear.">🛠 Set Max Floor (both)</button>
                <button class="ghost-btn" id="admin-set-lb-only-btn" type="button" style="border-color:#9bcfff;color:#cce4ff;" title="Sets ONLY the Highest Floor LB score — leaves the player's gameplay progression untouched.">🎯 Set LB Only</button>
              </div>
              <div style="display:flex; gap:6px; flex-wrap:wrap; align-items:center; margin-top:6px;">
                <span class="admin-info" style="font-size:10px;">Survival / Boss Raid repair:</span>
                <select id="admin-lb-mode" style="padding:4px 6px;">
                  <option value="survival">Survival</option>
                  <option value="boss_raid">Boss Raid</option>
                </select>
                <input type="number" id="admin-lb-floor" placeholder="floor" min="1" max="500" style="width:70px; padding:4px 6px;" />
                <input type="number" id="admin-lb-ms" placeholder="total ms" min="0" max="1000000000" style="width:100px; padding:4px 6px;" />
                <button class="ghost-btn" id="admin-submit-lb-btn" type="button" style="border-color:#ffb14a;color:#ffd29a;">📤 Submit LB Score</button>
              </div>
              <div style="display:flex; gap:6px; flex-wrap:wrap; align-items:center; margin-top:6px;">
                <span class="admin-info" style="font-size:10px;">Remove a single entry:</span>
                <select id="admin-remove-mode" style="padding:4px 6px;">
                  <option value="boss_raid">Boss Raid</option>
                  <option value="survival">Survival</option>
                  <option value="highest_floor">Highest Floor</option>
                  <option value="world_ender">Fastest World Ender</option>
                </select>
                <button class="ghost-btn" id="admin-remove-lb-btn" type="button" style="border-color:#ff5a6b;color:#ffb8c0;">🗑 Remove LB Entry</button>
              </div>
              <span class="admin-info" id="admin-diag-result" style="font-family:monospace; font-size:11px; color:#cce4ff;"></span>
            </div>
            <div class="admin-row" style="flex-direction: column; align-items: flex-start; gap: 4px;">
              <span class="admin-info">📊 <strong>LB Activity Audit (Survival / Boss Raid / Highest Floor)</strong> — for the chosen LB, lists the top-N current entries with whatever submission timestamps we have, AND every wallet that was active today. Timestamps marked ✨ are after today's 8 AM PH boundary. Pre-rollout entries may show "no ts" — only submissions/clears made after this build deploys are timestamped precisely. For Highest Floor, "active today" comes from the submission-timestamp hash (every campaign clear writes it) rather than a daily attempts counter.</span>
              <div style="display:flex; gap:6px; flex-wrap:wrap; align-items:center;">
                <select id="admin-activity-mode" style="padding:4px 6px;">
                  <option value="boss_raid">Boss Raid</option>
                  <option value="survival">Survival</option>
                  <option value="highest_floor">Highest Floor (campaign)</option>
                </select>
                <input type="number" id="admin-activity-topn" placeholder="topN" min="1" max="50" value="10" style="width:70px; padding:4px 6px;" />
                <button class="ghost-btn" id="admin-activity-btn" type="button" style="border-color:#9bcfff;color:#cce4ff;">📊 Audit Activity</button>
              </div>
              <span class="admin-info" id="admin-activity-result" style="font-family:monospace; font-size:11px; color:#cce4ff;"></span>
            </div>
            <div class="admin-row" style="flex-direction: column; align-items: flex-start; gap: 4px;">
              <span class="admin-info">🏆 <strong>End-of-Season Leaderboard Freeze</strong> — capture the CURRENT live state of every leaderboard into a snapshot, then flip Freeze ON so every player sees that exact snapshot regardless of new submissions. Status, Capture, and Toggle are separate so you can re-capture without unfreezing and vice versa. Players see a gold "Season Final" banner above the boards when frozen.</span>
              <div style="display:flex; gap:6px; flex-wrap:wrap; align-items:center;">
                <input type="text" id="admin-freeze-label" placeholder="Season 1 Final" maxlength="60" style="padding:4px 8px; min-width:200px;" />
                <button class="ghost-btn" id="admin-freeze-status-btn" type="button" style="border-color:#9bcfff;color:#cce4ff;">🔍 Status</button>
                <button class="ghost-btn" id="admin-freeze-snapshot-btn" type="button" style="border-color:#ffb14a;color:#ffd29a;">📸 Snapshot Now</button>
                <button class="ghost-btn" id="admin-freeze-on-btn" type="button" style="border-color:#7aff8a;color:#bfffc8;">🏆 Freeze ON</button>
                <button class="ghost-btn" id="admin-freeze-off-btn" type="button" style="border-color:#ff5a6b;color:#ffb8c0;">🔓 Freeze OFF</button>
              </div>
              <div style="display:flex; gap:6px; flex-wrap:wrap; align-items:center; margin-top:6px;">
                <span class="admin-info" style="font-size:10px;">Schedule auto-freeze (PH local time):</span>
                <input type="datetime-local" id="admin-freeze-schedule-at" style="padding:4px 6px;" />
                <button class="ghost-btn" id="admin-freeze-schedule-btn" type="button" style="border-color:#ffb14a;color:#ffd29a;" title="Pin a future moment to auto-capture + freeze the LB. Fires lazily on the first LB/run-end request after that moment.">⏰ Schedule Auto-Freeze (PH)</button>
                <button class="ghost-btn" id="admin-freeze-cancel-schedule-btn" type="button" style="border-color:#9bcfff;color:#cce4ff;">✖ Cancel Schedule</button>
              </div>
              <span class="admin-info" id="admin-freeze-result" style="font-family:monospace; font-size:11px; color:#cce4ff;"></span>
            </div>
            <div class="admin-row" style="flex-direction: column; align-items: flex-start; gap: 4px;">
              <span class="admin-info">🎟 <strong>Grant Sample bRON Vouchers</strong> — pushes a mixed set to your own inventory so you can preview the voucher-pay path in the shop. Server enforces admin gate AND that the target is the caller, so no cross-wallet grant is possible.</span>
              <div style="display:flex; gap:6px; flex-wrap:wrap;">
                <button class="ghost-btn" id="admin-grant-vouchers-small" type="button" style="border-color:#9bcfff;color:#cce4ff;">🎟 +Small (3×t1, 2×t2, 1×t3)</button>
                <button class="ghost-btn" id="admin-grant-vouchers-mixed" type="button" style="border-color:#9bcfff;color:#cce4ff;">🎟 +Mixed (5 of each)</button>
                <button class="ghost-btn" id="admin-grant-vouchers-big" type="button" style="border-color:#9bcfff;color:#cce4ff;">🎟 +Big (10×t4, 5×t5)</button>
              </div>
            </div>
            <label class="toggle">
              <input type="checkbox" id="setting-dev-class" ${s.devUnlockClass ? "checked" : ""} />
              <span>Allow class re-pick anytime</span>
            </label>
            <!-- Destructive admin panels: visible on BOTH dev + main since the
                 same admin wallet controls both and there's no separate dev
                 admin role. All actions are server-side admin-gated, multi-step
                 confirmed, and target the *active* environment's Redis only. -->
            <div class="admin-row admin-wipe-prod-row" style="margin-top: 8px; flex-direction: column; align-items: flex-start; gap: 4px;">
              <span class="admin-info" style="color:#ff5a6b;">☠ <strong>${isDevBuild() ? "DEV " : "PRODUCTION "}WIPE</strong> — irreversibly deletes EVERY wallet's progress, energy, vouchers, leaderboards, shop inventory, run state, and analytics on the <strong>${isDevBuild() ? "dev" : "production"}</strong> environment. Three confirmations required.</span>
              <button class="ghost-btn admin-wipe-prod-btn" id="admin-wipe-prod" type="button">☠ Wipe ALL ${isDevBuild() ? "Dev" : "Production"} Data</button>
            </div>
            <div class="admin-row" style="margin-top: 8px; flex-direction: column; align-items: flex-start; gap: 4px;">
              <span class="admin-info">🎯 <strong>Force-Reset Wallets</strong> — nukes server data for one or more wallets AND forces their browsers to clear cached state on next session check. Use when a full wipe isn't viable. Paste one wallet per line (or comma-separated).</span>
              <textarea id="admin-force-reset-wallet" placeholder="0x...&#10;0x...&#10;0x..." style="font-family:monospace; padding:6px 8px; min-width:380px; min-height:80px; resize:vertical;"></textarea>
              <div style="display:flex; gap:6px; flex-wrap:wrap;">
                <button class="ghost-btn" id="admin-force-reset-btn" type="button" style="border-color:#ffb14a;color:#ffd29a;">🎯 Reset These Wallets</button>
                <button class="ghost-btn" id="admin-force-reset-except-btn" type="button" style="border-color:#ff5a6b;color:#ffb8c0;">🔁 Reset EVERYONE EXCEPT These</button>
              </div>
            </div>
            <div class="admin-row" style="margin-top: 8px; flex-direction: column; align-items: flex-start; gap: 4px;">
              <span class="admin-info">🎁 <strong>Comp a Wallet (Grant Energy + Close Offers)</strong> — paste a wallet, then add energy directly to their pool and/or mark their one-time offer(s) as consumed so the modal won't reappear. Use when a player paid for the wrong bundle.</span>
              <input type="text" id="admin-comp-wallet" placeholder="0x..." style="font-family:monospace; padding:4px 8px; min-width:340px;" />
              <div style="display:flex; gap:6px; flex-wrap:wrap; align-items:center;">
                <input type="number" id="admin-comp-energy-amt" placeholder="35" min="-999" max="999" value="35" style="width:80px; padding:4px 6px;" />
                <button class="ghost-btn" id="admin-comp-energy-btn" type="button" style="border-color:#9bff9b;color:#c5f0c5;">⚡ Grant Energy</button>
              </div>
              <div style="display:flex; gap:6px; flex-wrap:wrap;">
                <button class="ghost-btn" id="admin-close-offer-first-btn" type="button">Close First-Energy</button>
                <button class="ghost-btn" id="admin-close-offer-floor20-btn" type="button">Close Floor-20</button>
                <button class="ghost-btn" id="admin-close-offer-both-btn" type="button">Close Both Offers</button>
              </div>
            </div>
            <div class="admin-row" style="margin-top: 8px; flex-direction: column; align-items: flex-start; gap: 4px;">
              <span class="admin-info">⛓ <strong>Query On-Chain Daily Check-In</strong> — read-only contract query. Returns whether this wallet has an on-chain check-in for today and their current streak. Use to verify contract reachability + spot-check a player's claim status.</span>
              <div style="display:flex; gap:6px; flex-wrap:wrap; align-items:center;">
                <input type="text" id="admin-onchain-checkin-wallet" placeholder="0x..." style="font-family:monospace; padding:4px 8px; min-width:340px;" />
                <button class="ghost-btn" id="admin-onchain-checkin-btn" type="button" style="border-color:#9bcfff;color:#cce4ff;">⛓ Query Status</button>
              </div>
              <span class="setting-hint">Read-only — does not change anything on-chain. The contract uses msg.sender semantics now, so only the player can sign their own check-in (from their wallet, via the in-game Daily Claim button).</span>
            </div>
            <div class="admin-row" style="margin-top: 8px; flex-direction: column; align-items: flex-start; gap: 6px;">
              <span class="admin-info" id="admin-season-status">Season state: loading…</span>
              <div style="display:flex; gap:8px; flex-wrap:wrap;">
                <button class="ghost-btn" id="admin-season-halt" type="button" style="border-color:#ffb14a;color:#ffd29a;">⏸ Halt Season (block all runs)</button>
                <button class="ghost-btn" id="admin-season-resume" type="button" style="border-color:#7aff8a;color:#bfffc8;">▶ Resume Season</button>
              </div>
              <span class="setting-hint">Halting blocks every wallet from starting campaign / survival / boss raid runs server-side. The shop stays open. Toggle is global and persists across deploys.</span>
            </div>
          </div>
        ` : ""}

        <div class="setting-actions">
          <button class="confirm-btn" id="save-settings" type="button">Save</button>
        </div>
      </div>
    </div>
  `;

  root.querySelector("#back-btn")?.addEventListener("click", onClose);

  root.querySelector<HTMLButtonElement>("#setting-privacy")?.addEventListener("click", () => {
    showPrivacyModal();
  });

  // Volume sliders — apply live (no need to hit Save) so the user hears the
  // change immediately. Persistence is in their own localStorage keys
  // (toz.sfx.volume / toz.bgm.volume) separate from the main settings blob.
  const sfxVolEl = root.querySelector<HTMLInputElement>("#setting-sfx-volume");
  const sfxVolValueEl = root.querySelector<HTMLElement>("#setting-sfx-volume-value");
  sfxVolEl?.addEventListener("input", () => {
    const n = Number(sfxVolEl.value);
    if (sfxVolValueEl) sfxVolValueEl.textContent = String(n);
    setSfxVolume(n / 100);
  });
  sfxVolEl?.addEventListener("change", () => {
    // Single sample on release so the user can hear the new level without
    // spamming clicks during the drag.
    sfx.click();
  });

  const bgmVolEl = root.querySelector<HTMLInputElement>("#setting-bgm-volume");
  const bgmVolValueEl = root.querySelector<HTMLElement>("#setting-bgm-volume-value");
  bgmVolEl?.addEventListener("input", () => {
    const n = Number(bgmVolEl.value);
    if (bgmVolValueEl) bgmVolValueEl.textContent = String(n);
    setBgmVolume(n / 100);
  });

  root.querySelector<HTMLButtonElement>("#save-settings")?.addEventListener("click", async () => {
    const newName = (root.querySelector<HTMLInputElement>("#setting-name")?.value || DEFAULTS.playerName).trim();
    const status = root.querySelector<HTMLElement>("#ign-status");

    let finalName = newName;
    if (newName !== s.playerName && newName) {
      const result = await saveServerIgn(newName);
      if (!result.ok) {
        if (result.reason === "cooldown") {
          if (status) status.textContent = `Name change on cooldown — try again in ${formatCooldown(result.nextAllowedAt)}.`;
          finalName = result.serverIgn;
          const input = root.querySelector<HTMLInputElement>("#setting-name");
          if (input) input.value = result.serverIgn;
          // Don't close — let the user see the error.
          // Still save the other settings below.
        } else if (result.reason === "invalid") {
          if (status) status.textContent = "Name is invalid (empty or too long).";
          return;
        } else {
          if (status) status.textContent = "Couldn't reach the server — name not saved online.";
        }
      }
    }

    const next: Settings = {
      playerName: finalName,
      walletAddress: s.walletAddress,
      sfxOn: !!root.querySelector<HTMLInputElement>("#setting-sfx")?.checked,
      bgmOn: !!root.querySelector<HTMLInputElement>("#setting-bgm")?.checked,
      devUnlockClass: !!root.querySelector<HTMLInputElement>("#setting-dev-class")?.checked,
      // Locked checkboxes can't be toggled by the user, so a disabled-input
      // value safely falls back to the existing setting.
      showBothActions: getMaxCleared() >= SHOW_BOTH_ACTIONS_UNLOCK_FLOOR
        ? !!root.querySelector<HTMLInputElement>("#setting-show-both-actions")?.checked
        : s.showBothActions,
      showBothActionsTutorialSeen: s.showBothActionsTutorialSeen,
    };
    saveSettings(next);
    if (finalName === newName) onClose();
  });

  root.querySelector<HTMLButtonElement>("#admin-add-energy")?.addEventListener("click", async () => {
    const amt = await adminGrantServerEnergy(5);
    if (amt === null) {
      addEnergy(5);
      await alertModal({ kind: "warning", title: "Server Unreachable", message: "Granted <strong>+5 energy locally only</strong> — this won't persist across reloads." });
    }
    onClose(); renderSettings(root, onClose);
  });
  root.querySelector<HTMLButtonElement>("#admin-fill-energy")?.addEventListener("click", async () => {
    const amt = await adminFillServerEnergy();
    if (amt === null) {
      addEnergy(ENERGY_MAX);
      await alertModal({ kind: "warning", title: "Server Unreachable", message: "Filled energy <strong>locally only</strong> — this won't persist across reloads." });
    }
    onClose(); renderSettings(root, onClose);
  });

  // ---- Wallet progress diagnostic + repair ----
  // Read-only diagnose first, then optional repairs:
  //   • "Set Max Floor"   — fix campaign drift (per-wallet maxfloor + Highest Floor LB)
  //   • "Submit LB Score" — push a survival / boss-raid score for a lost run
  // The diagnostic surfaces both drift cases AND missing-LB-entry cases.
  const setDiagOut = (msg: string, kind: "ok" | "warn" | "err" = "ok"): void => {
    const out = root.querySelector<HTMLElement>("#admin-diag-result");
    if (!out) return;
    out.style.color = kind === "err" ? "#ffb8c0" : kind === "warn" ? "#ffd485" : "#cce4ff";
    out.innerHTML = msg;
  };
  const diagWalletInput = (): string =>
    (root.querySelector<HTMLInputElement>("#admin-diag-wallet")?.value || "").trim();
  /** Format a duration in ms as Mm Ss for the result panel. */
  const fmtMs = (ms: number | null): string => {
    if (ms === null) return "—";
    const total = Math.floor(ms / 1000);
    const m = Math.floor(total / 60);
    const s = total % 60;
    return `${m}m ${s.toString().padStart(2, "0")}s`;
  };
  /** Render a multi-LB diagnosis result block. */
  const renderDiag = (wallet: string, d: WalletDiagnosis, intro = ""): string => {
    const drift = (d.highestFloor.floor ?? 0) !== d.serverMaxFloor;
    const driftNote = drift
      ? `<br><strong style="color:#ff9c9c;">⚠ DRIFT (campaign): per-wallet=${d.serverMaxFloor} but Highest Floor LB=${d.highestFloor.floor ?? "—"}</strong>`
      : `<br><span style="color:#bfffc8;">✓ Campaign in sync</span>`;
    const lbLine = (label: string, lb: { floor: number | null; ms: number | null; rank: number | null }): string => {
      if (lb.floor === null) return `${label}: <span style="opacity:0.5;">(not on LB)</span>`;
      const msPart = lb.ms !== null ? ` · ${fmtMs(lb.ms)}` : "";
      const rankPart = lb.rank !== null ? ` · rank <strong>#${lb.rank}</strong>` : "";
      return `${label}: <strong>floor ${lb.floor}</strong>${msPart}${rankPart}`;
    };
    return `
      ${intro}
      Wallet: ${wallet}<br>
      IGN: <strong>${d.ign ?? "(none)"}</strong><br>
      Server max floor (per-wallet): <strong>${d.serverMaxFloor}</strong><br>
      ${lbLine("Highest Floor LB", d.highestFloor)}<br>
      ${lbLine("Survival LB", d.survival)}<br>
      ${lbLine("Boss Raid LB", d.bossRaid)}
      ${driftNote}
    `;
  };
  root.querySelector<HTMLButtonElement>("#admin-diag-btn")?.addEventListener("click", async () => {
    const wallet = diagWalletInput();
    if (!/^0x[0-9a-fA-F]{40}$/.test(wallet)) { setDiagOut("Enter a 0x-prefixed 40-hex wallet first.", "err"); return; }
    setDiagOut("Querying…");
    const r = await adminDiagnoseWallet(wallet);
    if (!r.ok || !r.diag) { setDiagOut(`Diagnose failed: ${r.error ?? "unknown"}`, "err"); return; }
    const drift = (r.diag.highestFloor.floor ?? 0) !== r.diag.serverMaxFloor;
    setDiagOut(renderDiag(wallet, r.diag), drift ? "warn" : "ok");
  });
  root.querySelector<HTMLButtonElement>("#admin-set-max-btn")?.addEventListener("click", async () => {
    const wallet = diagWalletInput();
    const floor = Number(root.querySelector<HTMLInputElement>("#admin-diag-floor")?.value);
    if (!/^0x[0-9a-fA-F]{40}$/.test(wallet)) { setDiagOut("Enter a 0x-prefixed 40-hex wallet first.", "err"); return; }
    if (!Number.isFinite(floor) || floor < 1 || floor > 500) { setDiagOut("Floor must be 1..500.", "err"); return; }
    // Peek at the current values so the confirm modal can show "X → Y"
    // and clearly call out a DEMOTION case. Falls back gracefully if
    // the diagnose preview fails — we still allow the set.
    setDiagOut("Checking current value…");
    const preview = await adminDiagnoseWallet(wallet);
    const curMax = preview.diag?.serverMaxFloor ?? null;
    const curLb = preview.diag?.highestFloor.floor ?? null;
    const demoting = (curMax !== null && curMax > floor) || (curLb !== null && curLb > floor);
    const beforeLine = curMax !== null
      ? `Currently — per-wallet: <strong>${curMax}</strong>, LB: <strong>${curLb ?? "(not on LB)"}</strong><br><br>`
      : "";
    const warningLine = demoting
      ? `<br><strong style="color:#ff9c9c;">⚠ This is a DEMOTION</strong> — the wallet currently holds a higher floor. The new value overwrites that. The player will need to re-clear intermediate floors to advance past ${floor} again.<br>`
      : "";
    const ok = await confirmModal({
      title: "Set Wallet's Campaign Max Floor?",
      message: `${beforeLine}This will <strong>SET</strong> <strong>${wallet}</strong>'s server max floor and Highest Floor LB score to exactly <strong>${floor}</strong>.<br>${warningLine}<br>Use to repair drift OR to pin a wallet to an exact value (e.g. their official end-of-season standing). Always overwrites — no GT guard.`,
      confirmLabel: demoting ? "Confirm Demotion" : "Set Max Floor",
      cancelLabel: "Cancel",
      danger: demoting,
    });
    if (!ok) return;
    setDiagOut("Setting…");
    const r = await adminSetMaxFloor(wallet, floor);
    if (!r.ok || !r.diag) { setDiagOut(`Set failed: ${r.error ?? "unknown"}`, "err"); return; }
    const snapNote = r.snapshotRefreshed ? ` · 📸 frozen snapshot refreshed` : "";
    const changeLine = `✓ Set complete — per-wallet ${r.prevMax ?? "?"} → <strong>${r.newMax ?? "?"}</strong>, LB ${r.prevLb ?? "—"} → <strong>${r.diag.highestFloor.floor ?? "—"}</strong>${snapNote}<br>`;
    setDiagOut(renderDiag(wallet, r.diag, changeLine), demoting ? "warn" : "ok");
  });

  // ---- Set LB Only (Highest Floor) ----
  // Sibling to Set Max Floor that ONLY touches the Highest Floor LB score.
  // The player's per-wallet maxfloor key stays put, so their gameplay
  // progression isn't affected by the public-ranking change. Designed
  // for end-of-season snapshots where we want the LB to show "their 8 AM
  // standing" but the player should still be able to keep playing post-cutoff.
  root.querySelector<HTMLButtonElement>("#admin-set-lb-only-btn")?.addEventListener("click", async () => {
    const wallet = diagWalletInput();
    const floor = Number(root.querySelector<HTMLInputElement>("#admin-diag-floor")?.value);
    if (!/^0x[0-9a-fA-F]{40}$/.test(wallet)) { setDiagOut("Enter a 0x-prefixed 40-hex wallet first.", "err"); return; }
    if (!Number.isFinite(floor) || floor < 1 || floor > 500) { setDiagOut("Floor must be 1..500.", "err"); return; }
    setDiagOut("Checking current value…");
    const preview = await adminDiagnoseWallet(wallet);
    const curLb = preview.diag?.highestFloor.floor ?? null;
    const curMax = preview.diag?.serverMaxFloor ?? null;
    const demoting = curLb !== null && curLb > floor;
    const beforeLine = curLb !== null
      ? `Currently — LB: <strong>${curLb}</strong>${curMax !== null ? ` (per-wallet maxfloor stays at <strong>${curMax}</strong>)` : ""}<br><br>`
      : "";
    const warningLine = demoting
      ? `<br><strong style="color:#ff9c9c;">⚠ This DEMOTES the LB score.</strong> Player progression is NOT affected — they can still play floor ${curMax !== null ? curMax + 1 : "N+1"} after this.<br>`
      : "";
    const ok = await confirmModal({
      title: "Set Highest Floor LB Only?",
      message: `${beforeLine}This sets <strong>${wallet}</strong>'s <strong>Highest Floor LB score</strong> to exactly <strong>${floor}</strong>, while leaving their per-wallet maxfloor key untouched.<br>${warningLine}<br>Use for end-of-season pinning — the public ranking reflects the chosen value, but the player can still advance past it in their own progression.`,
      confirmLabel: demoting ? "Confirm Demotion" : "Set LB Score",
      cancelLabel: "Cancel",
      danger: demoting,
    });
    if (!ok) return;
    setDiagOut("Setting LB…");
    const r = await adminSetHighestFloorLbOnly(wallet, floor);
    if (!r.ok || !r.diag) { setDiagOut(`Set failed: ${r.error ?? "unknown"}`, "err"); return; }
    const snapNote = r.snapshotRefreshed ? ` · 📸 frozen snapshot refreshed` : "";
    const changeLine = `✓ LB-only set — Highest Floor LB ${r.prevLb ?? "—"} → <strong>${r.diag.highestFloor.floor ?? "—"}</strong> · per-wallet untouched (<strong>${r.diag.serverMaxFloor}</strong>)${snapNote}<br>`;
    setDiagOut(renderDiag(wallet, r.diag, changeLine), demoting ? "warn" : "ok");
  });

  // ---- End-of-Season Leaderboard Freeze ----
  // Status / Snapshot / Toggle live as three discrete buttons so the admin can
  // re-capture without flipping freeze, or unfreeze without dropping the
  // snapshot. The Status button is a non-mutating sanity check.
  const setFreezeOut = (msg: string, kind: "ok" | "warn" | "err" = "ok"): void => {
    const out = root.querySelector<HTMLElement>("#admin-freeze-result");
    if (!out) return;
    out.style.color = kind === "err" ? "#ffb8c0" : kind === "warn" ? "#ffd485" : "#cce4ff";
    out.innerHTML = msg;
  };
  // Always format freeze-related timestamps in PH time. The admin schedules
  // via a PH-anchored datetime picker; rendering them back in the browser's
  // local timezone (which may be hours behind PH) made "May 29 8 AM PH"
  // display as "May 28 4 PM" for west-coast admins. Explicit Asia/Manila +
  // a "PH" timeZoneName suffix keeps the round-trip unambiguous regardless
  // of where the admin's browser thinks it is.
  const fmtFreezeDate = (ms: number): string =>
    new Date(ms).toLocaleString("en-US", { timeZone: "Asia/Manila", timeZoneName: "short" });
  const renderFreezeStatus = (s: { frozen: boolean; snapshot: { capturedAt: number; capturedBy: string; label: string; counts: { survival: number; bossRaid: number; highestFloor: number; worldEnder: number; firstConquer: number } } | null; scheduled: { at: number; label: string; by: string; scheduledAt: number } | null }): string => {
    const lock = s.frozen ? "🏆 <strong>FROZEN</strong>" : "🔓 Live";
    const snapLine = !s.snapshot
      ? `<em>no snapshot captured yet</em>`
      : (() => {
          const c = s.snapshot.counts;
          return `Snapshot label: <strong>${escapeHtml(s.snapshot.label)}</strong><br>
            Captured: ${fmtFreezeDate(s.snapshot.capturedAt)} by ${s.snapshot.capturedBy}<br>
            Counts → Survival: ${c.survival} · Boss Raid: ${c.bossRaid} · Highest Floor: ${c.highestFloor} · World Ender: ${c.worldEnder} · First Conquer: ${c.firstConquer}`;
        })();
    const schedLine = s.scheduled
      ? `<br>⏰ Scheduled auto-freeze: <strong>${fmtFreezeDate(s.scheduled.at)}</strong> · label: <strong>${escapeHtml(s.scheduled.label)}</strong> · in ${Math.max(0, Math.round((s.scheduled.at - Date.now()) / 60000))} min`
      : `<br>⏰ Scheduled auto-freeze: <em>none</em>`;
    return `${lock}<br>${snapLine}${schedLine}`;
  };
  root.querySelector<HTMLButtonElement>("#admin-freeze-status-btn")?.addEventListener("click", async () => {
    setFreezeOut("Reading…");
    const r = await adminLbFreezeStatus();
    if (!r.ok || !r.status) { setFreezeOut(`Status failed: ${r.error ?? "unknown"}`, "err"); return; }
    setFreezeOut(renderFreezeStatus(r.status), r.status.frozen ? "ok" : "warn");
  });
  root.querySelector<HTMLButtonElement>("#admin-freeze-snapshot-btn")?.addEventListener("click", async () => {
    const label = (root.querySelector<HTMLInputElement>("#admin-freeze-label")?.value || "").trim() || "Season Final";
    const ok = await confirmModal({
      title: "Capture LB Snapshot?",
      message: `Capture the CURRENT live state of every leaderboard into a snapshot labelled <strong>${escapeHtml(label)}</strong>?<br><br>This <strong>does NOT enable freeze mode</strong> — players still see live data until you flip Freeze ON. Re-capturing replaces the previous snapshot.`,
      confirmLabel: "Capture",
      cancelLabel: "Cancel",
    });
    if (!ok) return;
    setFreezeOut("Capturing…");
    const r = await adminLbFreezeSnapshot(label);
    if (!r.ok) { setFreezeOut(`Capture failed: ${r.error ?? "unknown"}`, "err"); return; }
    const c = r.counts ?? { survival: 0, bossRaid: 0, highestFloor: 0, worldEnder: 0, firstConquer: 0 };
    setFreezeOut(`📸 Snapshot captured at ${r.capturedAt ? fmtFreezeDate(r.capturedAt) : "now"}<br>
      Label: <strong>${escapeHtml(r.label ?? label)}</strong><br>
      Survival: ${c.survival} · Boss Raid: ${c.bossRaid} · Highest Floor: ${c.highestFloor} · World Ender: ${c.worldEnder} · First Conquer: ${c.firstConquer}`, "ok");
  });
  root.querySelector<HTMLButtonElement>("#admin-freeze-on-btn")?.addEventListener("click", async () => {
    const ok = await confirmModal({
      title: "Freeze the Leaderboard?",
      message: `Flip freeze <strong>ON</strong>. Every player will see the captured snapshot — new runs no longer change the displayed standings.<br><br>If no snapshot has been captured yet, this is rejected.`,
      confirmLabel: "Freeze ON",
      cancelLabel: "Cancel",
    });
    if (!ok) return;
    setFreezeOut("Flipping ON…");
    const r = await adminLbFreezeToggle(true);
    if (!r.ok) { setFreezeOut(`Freeze ON failed: ${r.error ?? "unknown"}`, "err"); return; }
    setFreezeOut(`🏆 Freeze is now <strong>${r.frozen ? "ON" : "OFF"}</strong>.`, r.frozen ? "ok" : "warn");
  });
  root.querySelector<HTMLButtonElement>("#admin-freeze-off-btn")?.addEventListener("click", async () => {
    const ok = await confirmModal({
      title: "Unfreeze the Leaderboard?",
      message: `Flip freeze <strong>OFF</strong>. Players will see live data again. The snapshot stays intact — re-enable freeze any time without re-capturing.`,
      confirmLabel: "Freeze OFF",
      cancelLabel: "Cancel",
      danger: true,
    });
    if (!ok) return;
    setFreezeOut("Flipping OFF…");
    const r = await adminLbFreezeToggle(false);
    if (!r.ok) { setFreezeOut(`Freeze OFF failed: ${r.error ?? "unknown"}`, "err"); return; }
    setFreezeOut(`🔓 Freeze is now <strong>${r.frozen ? "ON" : "OFF"}</strong> — live data is being served again.`, r.frozen ? "warn" : "ok");
  });

  // ---- Scheduled auto-freeze ----
  // The datetime-local input is timezone-naive; we treat the entered
  // value as PH local (UTC+8). Conversion: append the explicit "+08:00"
  // offset so Date.parse returns the correct UTC ms epoch.
  root.querySelector<HTMLButtonElement>("#admin-freeze-schedule-btn")?.addEventListener("click", async () => {
    const phLocalRaw = (root.querySelector<HTMLInputElement>("#admin-freeze-schedule-at")?.value || "").trim();
    if (!phLocalRaw) { setFreezeOut("Pick a date + time first (PH local).", "err"); return; }
    const label = (root.querySelector<HTMLInputElement>("#admin-freeze-label")?.value || "").trim() || "Season Final";
    // datetime-local gives "YYYY-MM-DDTHH:MM" — append ":00+08:00" for explicit PH.
    const phIso = `${phLocalRaw}:00+08:00`;
    const at = Date.parse(phIso);
    if (!Number.isFinite(at)) { setFreezeOut("Couldn't parse the date.", "err"); return; }
    if (at <= Date.now()) {
      const ok = await confirmModal({
        title: "Schedule a Past Moment?",
        message: `The chosen time (<strong>${new Date(at).toLocaleString()}</strong>) is in the past. Scheduling will fire the freeze on the very next request. Continue?`,
        confirmLabel: "Schedule Anyway",
        cancelLabel: "Cancel",
      });
      if (!ok) return;
    }
    const phPretty = new Date(at).toLocaleString("en-US", { timeZone: "Asia/Manila", timeZoneName: "short" });
    const ok2 = await confirmModal({
      title: "Schedule Auto-Freeze?",
      message: `Schedule an automatic LB capture + freeze for:<br>
        <strong>${phPretty}</strong> (PH)<br>
        Label: <strong>${escapeHtml(label)}</strong><br><br>
        At that moment, the first /api/leaderboard/top or /api/run/end request triggers the snapshot + freeze (idempotent, locked, no cron required). Overwrites any prior schedule.`,
      confirmLabel: "Schedule",
      cancelLabel: "Cancel",
    });
    if (!ok2) return;
    setFreezeOut("Scheduling…");
    const r = await adminLbFreezeSchedule(at, label);
    if (!r.ok || !r.scheduled) { setFreezeOut(`Schedule failed: ${r.error ?? "unknown"}`, "err"); return; }
    const minsUntil = Math.max(0, Math.round((r.scheduled.at - Date.now()) / 60000));
    setFreezeOut(`⏰ Auto-freeze scheduled<br>
      Fires at: <strong>${fmtFreezeDate(r.scheduled.at)}</strong> (in ${minsUntil} min)<br>
      Label: <strong>${escapeHtml(r.scheduled.label)}</strong><br>
      Scheduled by: ${r.scheduled.by}`, "ok");
  });
  root.querySelector<HTMLButtonElement>("#admin-freeze-cancel-schedule-btn")?.addEventListener("click", async () => {
    const ok = await confirmModal({
      title: "Cancel Scheduled Auto-Freeze?",
      message: `Drop any pending scheduled freeze. (Already-frozen state and existing snapshot are untouched.)`,
      confirmLabel: "Cancel Schedule",
      cancelLabel: "Keep",
    });
    if (!ok) return;
    setFreezeOut("Canceling…");
    const r = await adminLbFreezeCancelSchedule();
    if (!r.ok) { setFreezeOut(`Cancel failed: ${r.error ?? "unknown"}`, "err"); return; }
    setFreezeOut(r.removed ? "✖ Scheduled auto-freeze canceled." : "<em>No schedule was pending.</em>", r.removed ? "ok" : "warn");
  });

  root.querySelector<HTMLButtonElement>("#admin-activity-btn")?.addEventListener("click", async () => {
    const mode = (root.querySelector<HTMLSelectElement>("#admin-activity-mode")?.value || "boss_raid") as "survival" | "boss_raid" | "highest_floor";
    const topN = Number(root.querySelector<HTMLInputElement>("#admin-activity-topn")?.value || 10);
    const out = root.querySelector<HTMLElement>("#admin-activity-result");
    if (!out) return;
    out.style.color = "#cce4ff";
    out.innerHTML = "Querying…";
    const r = await adminLbActivity(mode, topN);
    if (!r.ok || !r.report) {
      out.style.color = "#ffb8c0";
      out.innerHTML = `Audit failed: ${r.error ?? "unknown"}`;
      return;
    }
    const rep = r.report;
    const boundary = rep.phDayBoundary;
    const fmtDate = (ms: number): string => new Date(ms).toLocaleString();
    const star = (ts: number | null): string => ts === null ? "" : ts >= boundary ? "✨" : "·";
    const tsLine = (e: { lbSubmittedAt: number | null; replayRecordedAt: number | null }): string => {
      if (e.replayRecordedAt !== null) return `replay ${star(e.replayRecordedAt)} ${fmtDate(e.replayRecordedAt)}`;
      if (e.lbSubmittedAt !== null) return `hash ${star(e.lbSubmittedAt)} ${fmtDate(e.lbSubmittedAt)}`;
      return `<span style="opacity:0.5;">no ts (pre-rollout)</span>`;
    };
    const modeLabel =
      mode === "boss_raid" ? "Boss Raid" :
      mode === "survival" ? "Survival" :
      "Highest Floor (campaign)";
    // Highest Floor: score IS the floor (no ms component); other modes
    // carry a run time too. Adjust the per-entry line accordingly.
    const entryLines = rep.entries.map(e => {
      const meta = mode === "highest_floor"
        ? `floor <strong>${e.floor}</strong>`
        : `floor <strong>${e.floor}</strong> · ${fmtMs(e.ms)}`;
      return `#${e.rank} ${e.address.slice(0, 10)}… (${e.ign ?? "—"}) — ${meta}<br>
        &nbsp;&nbsp;${tsLine(e)}`;
    }).join("<br>");
    // For highest_floor we don't track per-day attempt counts, so the
    // "attempts" count is always 1 (one or more advances today). Phrase
    // accordingly so the UI doesn't lie about a precise count.
    const attemptedLine = (a: { address: string; ign: string | null; attempts: number }): string => {
      if (mode === "highest_floor") {
        return `&nbsp;&nbsp;${a.address.slice(0, 10)}… (${a.ign ?? "—"}) — cleared a floor today`;
      }
      return `&nbsp;&nbsp;${a.address.slice(0, 10)}… (${a.ign ?? "—"}) — ${a.attempts} attempt${a.attempts === 1 ? "" : "s"}`;
    };
    const attemptedLines = rep.attemptedToday.length === 0
      ? `<span style="opacity:0.6;">(none)</span>`
      : rep.attemptedToday.map(attemptedLine).join("<br>");
    const activeLabel = mode === "highest_floor"
      ? "Wallets that advanced their campaign max-floor today:"
      : "Wallets that attempted today (regardless of LB improvement):";
    out.innerHTML = `
      Mode: <strong>${modeLabel}</strong><br>
      Today's 8 AM PH boundary: ${fmtDate(boundary)}<br>
      <br>
      <strong>Top ${rep.entries.length} LB entries:</strong><br>
      ${entryLines || "<em>(LB is empty)</em>"}
      <br><br>
      <strong>${activeLabel}</strong><br>
      ${attemptedLines}
    `;
  });

  root.querySelector<HTMLButtonElement>("#admin-remove-lb-btn")?.addEventListener("click", async () => {
    const wallet = diagWalletInput();
    const mode = (root.querySelector<HTMLSelectElement>("#admin-remove-mode")?.value || "boss_raid") as "survival" | "boss_raid" | "highest_floor" | "world_ender";
    if (!/^0x[0-9a-fA-F]{40}$/.test(wallet)) { setDiagOut("Enter a 0x-prefixed 40-hex wallet first.", "err"); return; }
    const modeLabel =
      mode === "boss_raid" ? "Boss Raid" :
      mode === "survival" ? "Survival" :
      mode === "highest_floor" ? "Highest Floor" :
      "Fastest World Ender";
    const ok = await confirmModal({
      title: `Remove ${modeLabel} Entry?`,
      message: `This permanently removes <strong>${wallet}</strong>'s entry from the <strong>${modeLabel}</strong> leaderboard.<br><br>
        Also deletes:<br>
        • The saved replay blob (loadout viewer) for this wallet on this LB<br>
        • The submission-timestamp hash field<br><br>
        The wallet's per-wallet progress (maxfloor / energy / shop inventory) is NOT touched — only this one LB entry. <strong>Cannot be undone</strong>; if you remove the wrong run the player has to re-submit a new one.`,
      confirmLabel: "Remove Entry",
      cancelLabel: "Cancel",
      danger: true,
    });
    if (!ok) return;
    setDiagOut("Removing…");
    const r = await adminRemoveLbEntry(wallet, mode);
    if (!r.ok || !r.diag) { setDiagOut(`Remove failed: ${r.error ?? "unknown"}`, "err"); return; }
    const lines: string[] = [];
    lines.push(`✓ Remove complete on <strong>${modeLabel}</strong>`);
    lines.push(`&nbsp;&nbsp;LB entry: ${r.removedFromLb ? "removed" : "<span style=\"opacity:0.6;\">(was not present)</span>"}`);
    lines.push(`&nbsp;&nbsp;Replay blob: ${r.removedReplay ? "removed" : "<span style=\"opacity:0.6;\">(none stored)</span>"}`);
    lines.push(`&nbsp;&nbsp;Timestamp hash: ${r.removedTimestamp ? "removed" : "<span style=\"opacity:0.6;\">(none stored)</span>"}`);
    if (r.snapshotRefreshed) lines.push(`&nbsp;&nbsp;📸 Frozen snapshot refreshed — public LB updated.`);
    setDiagOut(renderDiag(wallet, r.diag, `${lines.join("<br>")}<br>`), "ok");
  });

  root.querySelector<HTMLButtonElement>("#admin-submit-lb-btn")?.addEventListener("click", async () => {
    const wallet = diagWalletInput();
    const mode = (root.querySelector<HTMLSelectElement>("#admin-lb-mode")?.value || "survival") as "survival" | "boss_raid";
    const floor = Number(root.querySelector<HTMLInputElement>("#admin-lb-floor")?.value);
    const ms = Number(root.querySelector<HTMLInputElement>("#admin-lb-ms")?.value);
    if (!/^0x[0-9a-fA-F]{40}$/.test(wallet)) { setDiagOut("Enter a 0x-prefixed 40-hex wallet first.", "err"); return; }
    if (!Number.isFinite(floor) || floor < 1 || floor > 500) { setDiagOut("LB floor must be 1..500.", "err"); return; }
    if (!Number.isFinite(ms) || ms < 0 || ms > 1_000_000_000) { setDiagOut("LB ms must be 0..1e9 (try ~60000 × floor for a realistic time).", "err"); return; }
    const ok = await confirmModal({
      title: `Submit ${mode === "survival" ? "Survival" : "Boss Raid"} LB Score?`,
      message: `This will submit a <strong>${mode === "survival" ? "Survival" : "Boss Raid"}</strong> LB score for <strong>${wallet}</strong>:<br>
        • floor: <strong>${floor}</strong><br>
        • ms: <strong>${ms.toLocaleString()}</strong> (${fmtMs(ms)})<br><br>
        Use this to repair a "lost run" (player finished a run but the /run/end POST didn't land — score never reached the LB). <strong>Raises only</strong>; if the wallet already has a better score it stays put.`,
      confirmLabel: "Submit LB Score",
      cancelLabel: "Cancel",
    });
    if (!ok) return;
    setDiagOut("Submitting…");
    const r = await adminSubmitLbScore(wallet, mode, floor, ms);
    if (!r.ok || !r.diag) { setDiagOut(`Submit failed: ${r.error ?? "unknown"}`, "err"); return; }
    const improvedNote = r.improved ? "✓ Submitted (improved score)" : "✓ Submitted (no improvement — existing score was better or equal)";
    const snapNote = r.snapshotRefreshed ? `<br>📸 Frozen snapshot refreshed — the displayed LB now reflects this edit.` : "";
    setDiagOut(renderDiag(wallet, r.diag, `${improvedNote}${snapNote}<br>`), r.improved ? "ok" : "warn");
  });

  // ---- Sample voucher grants (admin only, caller-only target) ----
  // Three preset sizes so we can quickly seed inventory for shop-UI testing
  // (voucher-pay buttons, change-credit math, sufficiency hints) without
  // typing voucher counts in a prompt every time.
  const grantVouchers = async (grant: { t1?: number; t2?: number; t3?: number; t4?: number; t5?: number }, label: string): Promise<void> => {
    const result = await adminGrantSampleVouchers(grant);
    if (!result) {
      await alertModal({ kind: "error", title: "Grant Failed", message: "Couldn't reach the server (or admin gate rejected the request)." });
      return;
    }
    const total =
      result.t1 * 5 + result.t2 * 10 + result.t3 * 20 + result.t4 * 50 + result.t5 * 200;
    await alertModal({
      kind: "success",
      title: `🎟 ${label} Granted`,
      message: `Inventory now holds:<br>
        • Tier 1 (5 bRON): <strong>${result.t1}</strong><br>
        • Tier 2 (10 bRON): <strong>${result.t2}</strong><br>
        • Tier 3 (20 bRON): <strong>${result.t3}</strong><br>
        • Tier 4 (50 bRON): <strong>${result.t4}</strong><br>
        • Tier 5 (200 bRON): <strong>${result.t5}</strong><br><br>
        <strong>Total value: ${total} bRON.</strong> Open the Shop to test the voucher-pay buttons.`,
    });
  };
  root.querySelector<HTMLButtonElement>("#admin-grant-vouchers-small")?.addEventListener("click", () => {
    void grantVouchers({ t1: 3, t2: 2, t3: 1, t4: 0, t5: 0 }, "Small voucher set");
  });
  root.querySelector<HTMLButtonElement>("#admin-grant-vouchers-mixed")?.addEventListener("click", () => {
    void grantVouchers({ t1: 5, t2: 5, t3: 5, t4: 5, t5: 5 }, "Mixed voucher set");
  });
  root.querySelector<HTMLButtonElement>("#admin-grant-vouchers-big")?.addEventListener("click", () => {
    void grantVouchers({ t1: 0, t2: 0, t3: 0, t4: 10, t5: 5 }, "Big voucher set");
  });
  // ---- PRODUCTION wipe (main builds only) ----
  // Three-layer confirmation gauntlet. Each layer escalates the consequences
  // so the admin can't button-mash through it. The final layer asks the
  // admin to type a phrase verbatim — no accidental confirms possible.
  root.querySelector<HTMLButtonElement>("#admin-wipe-prod")?.addEventListener("click", async () => {
    // Layer 1: scary preamble + admit it's a real prod wipe.
    const ok1 = await confirmModal({
      title: "☠ Wipe ALL Production Data?",
      message: `This <strong>permanently and irreversibly</strong> deletes:<br>
        • Every wallet's level / XP / stats / class<br>
        • Every wallet's energy / inventory / vouchers<br>
        • All leaderboards, replays, and conqueror trophies<br>
        • All season halt state, shop revenue counters, analytics<br><br>
        <strong style="color:#ff5a6b;">There is no undo.</strong> Are you sure?`,
      confirmLabel: "I understand — continue",
      cancelLabel: "Cancel",
      danger: true,
    });
    if (!ok1) return;
    // Layer 2: financial / community impact reminder.
    const ok2 = await confirmModal({
      title: "☠ Final Warning — Are You ABSOLUTELY Sure?",
      message: `Players who have <strong>spent real RON</strong> in the shop will <strong>lose their purchases</strong>. Leaderboard standings from this season will be permanently gone. Voucher holders will be wiped.<br><br>
        Only continue if you are deliberately resetting the season or recovering from a catastrophic data issue.`,
      confirmLabel: "Yes — I am ABSOLUTELY sure",
      cancelLabel: "Cancel",
      danger: true,
    });
    if (!ok2) return;
    // Layer 3: type-to-confirm phrase. Closes the door on autofill / muscle memory.
    const phrase = await promptModal({
      title: "Type to Confirm",
      message: `To proceed, type the following phrase EXACTLY (uppercase included):<br><br><strong style="font-family:monospace; font-size:14px;">DELETE ALL DATA</strong>`,
      placeholder: "DELETE ALL DATA",
      confirmLabel: "Wipe Everything",
      cancelLabel: "Cancel",
      danger: true,
    });
    if (phrase !== "DELETE ALL DATA") {
      if (phrase !== null) {
        await alertModal({ kind: "warning", title: "Wipe Aborted", message: "Phrase did not match. Nothing was deleted." });
      }
      return;
    }
    // All three gates passed — fire it.
    const r = await adminWipeAllProdData();
    if (!r.ok) {
      await alertModal({ kind: "error", title: "Wipe Failed", message: `Server returned: ${r.error ?? "unknown error"}` });
      return;
    }
    try { localStorage.clear(); } catch { /* ignore */ }
    clearSession();
    await alertModal({
      kind: "success",
      title: "Production Wipe Complete",
      message: `Scanned <strong>${r.scanned}</strong> keys, deleted <strong>${r.deleted}</strong>. Reloading now — the game is now in a fresh-season state.`,
    });
    location.reload();
  });

  // ---- Targeted per-wallet force reset (main builds only) ----
  // Use when a global wipe isn't viable (e.g. fresh players already mid-run).
  // Nukes one wallet's server-side keys AND forces their client to clear
  // localStorage + reload on next session check.
  root.querySelector<HTMLButtonElement>("#admin-force-reset-btn")?.addEventListener("click", async () => {
    const input = root.querySelector<HTMLTextAreaElement>("#admin-force-reset-wallet");
    const raw = (input?.value ?? "").trim();
    // Accept newline-, comma-, or whitespace-separated lists.
    const tokens = raw.split(/[\s,]+/).map(s => s.trim()).filter(Boolean);
    const wallets: string[] = [];
    const bad: string[] = [];
    for (const t of tokens) {
      if (/^0x[0-9a-fA-F]{40}$/.test(t)) wallets.push(t.toLowerCase());
      else bad.push(t);
    }
    if (wallets.length === 0) {
      await alertModal({ kind: "warning", title: "No Valid Wallets", message: "Paste at least one 0x-prefixed 40-hex address. Whitespace, newlines, and commas all work as separators." });
      return;
    }
    const summary = wallets.map(w => `<div style="font-family:monospace; font-size:11px;">${w}</div>`).join("");
    const badNote = bad.length > 0 ? `<br><span style="color:#ffb14a;">Skipping ${bad.length} invalid token(s).</span>` : "";
    const ok = await confirmModal({
      title: `🎯 Force-Reset ${wallets.length} Wallet${wallets.length === 1 ? "" : "s"}?`,
      message: `Wipe all server-side data for the wallets below and force their browsers to clear cached state on next session check (~within 5 min, or instantly on next page load).<br><br>${summary}${badNote}<br>Other players are unaffected.`,
      confirmLabel: `Reset ${wallets.length} Wallet${wallets.length === 1 ? "" : "s"}`,
      cancelLabel: "Cancel",
      danger: true,
    });
    if (!ok) return;
    const results: { wallet: string; ok: boolean; deleted: number; error?: string }[] = [];
    for (const w of wallets) {
      const r = await adminForceResetWallet(w);
      const deletedCount = r.deleted ? Object.values(r.deleted).reduce((a, b) => a + b, 0) : 0;
      results.push({ wallet: w, ok: r.ok, deleted: deletedCount, error: r.error });
    }
    const successCount = results.filter(r => r.ok).length;
    const failCount = results.length - successCount;
    const rows = results.map(r =>
      `<div style="font-family:monospace; font-size:11px; color:${r.ok ? "#9bff9b" : "#ff8888"};">${r.ok ? "✓" : "✗"} ${r.wallet} — ${r.ok ? `${r.deleted} keys` : (r.error ?? "failed")}</div>`
    ).join("");
    await alertModal({
      kind: failCount === 0 ? "success" : "warning",
      title: `Reset Complete (${successCount}/${results.length})`,
      message: `${rows}<br>Affected clients will auto-clear + reload on next session poll.`,
    });
    if (input && failCount === 0) input.value = "";
  });

  // ---- Reset everyone EXCEPT the allowlist (main builds only) ----
  // Same per-wallet reset semantics, but inverted: enumerate all wallets that
  // have any data and reset everyone NOT in the textarea. Useful when most
  // players need a re-sync but a few legit fresh-starters must be preserved.
  root.querySelector<HTMLButtonElement>("#admin-force-reset-except-btn")?.addEventListener("click", async () => {
    const input = root.querySelector<HTMLTextAreaElement>("#admin-force-reset-wallet");
    const raw = (input?.value ?? "").trim();
    const tokens = raw.split(/[\s,]+/).map(s => s.trim()).filter(Boolean);
    const keep: string[] = [];
    const bad: string[] = [];
    for (const t of tokens) {
      if (/^0x[0-9a-fA-F]{40}$/.test(t)) keep.push(t.toLowerCase());
      else bad.push(t);
    }
    if (keep.length === 0) {
      await alertModal({ kind: "warning", title: "No Allowlist", message: "Paste at least one wallet to PRESERVE. To wipe absolutely everyone, use the full Production Wipe button instead." });
      return;
    }
    const summary = keep.map(w => `<div style="font-family:monospace; font-size:11px; color:#9bff9b;">✓ KEEP ${w}</div>`).join("");
    const badNote = bad.length > 0 ? `<br><span style="color:#ffb14a;">Skipping ${bad.length} invalid token(s).</span>` : "";
    const ok = await confirmModal({
      title: "🔁 Reset EVERYONE Except These?",
      message: `This will force-reset <strong>every wallet that has any data</strong> — except the ${keep.length} below — and force their browsers to clear cached state on next session check.<br><br>${summary}${badNote}<br><strong style="color:#ff5a6b;">This affects many players at once.</strong> Are you sure?`,
      confirmLabel: `Reset Everyone Except ${keep.length}`,
      cancelLabel: "Cancel",
      danger: true,
    });
    if (!ok) return;
    const r = await adminForceResetExcept(keep);
    if (!r.ok) {
      await alertModal({ kind: "error", title: "Reset Failed", message: `Server returned: ${r.error ?? "unknown error"}` });
      return;
    }
    const rows = (r.results ?? []).map(x =>
      `<div style="font-family:monospace; font-size:11px; color:${x.ok ? "#9bff9b" : "#ff8888"};">${x.ok ? "✓" : "✗"} ${x.wallet} — ${x.ok ? `${x.deleted} keys` : (x.error ?? "failed")}</div>`
    ).join("");
    await alertModal({
      kind: (r.failCount ?? 0) === 0 ? "success" : "warning",
      title: `Reset Complete (${r.resetCount}/${(r.resetCount ?? 0) + (r.failCount ?? 0)})`,
      message: `<div>Total wallets scanned: <strong>${r.totalWallets}</strong></div><div>Kept (allowlist): <strong>${keep.length}</strong></div><div>Reset: <strong>${r.resetCount}</strong>, Failed: <strong>${r.failCount}</strong></div><br>${rows}<br>Affected clients will auto-clear + reload on next session poll.`,
    });
  });

  // ---- Close one-time offers on a single wallet ----
  // Marks first-energy / floor-20 / both as consumed for the named wallet so
  // the modal won't pop again. Used after a comp-grant (player paid for the
  // wrong bundle, admin manually grants the missing reward + closes the
  // offer so it doesn't haunt them later).
  // Shared wallet input lookup — the comp form reuses #admin-comp-wallet for
  // both the energy-grant button and the close-offer buttons.
  function readCompWallet(): string {
    const input = root.querySelector<HTMLInputElement>("#admin-comp-wallet");
    return (input?.value ?? "").trim();
  }
  root.querySelector<HTMLButtonElement>("#admin-comp-energy-btn")?.addEventListener("click", async () => {
    const wallet = readCompWallet();
    if (!/^0x[0-9a-fA-F]{40}$/.test(wallet)) {
      await alertModal({ kind: "warning", title: "Invalid Wallet", message: "Paste a 0x-prefixed 40-hex address first." });
      return;
    }
    const amtInput = root.querySelector<HTMLInputElement>("#admin-comp-energy-amt");
    const delta = Number(amtInput?.value ?? "0") | 0;
    if (delta === 0 || Math.abs(delta) > 999) {
      await alertModal({ kind: "warning", title: "Invalid Amount", message: "Energy delta must be a non-zero integer between -999 and 999." });
      return;
    }
    const r = await adminGrantEnergyToWallet(wallet, delta);
    if (!r.ok) {
      await alertModal({ kind: "error", title: "Grant Failed", message: `Server: ${r.error ?? "unknown"}` });
      return;
    }
    await alertModal({
      kind: "success",
      title: "Energy Granted",
      message: `Granted <strong>${delta >= 0 ? "+" : ""}${delta}</strong> energy to <strong style="font-family:monospace;">${wallet}</strong>.<br>New balance: <strong>${r.amount}</strong>.`,
    });
  });

  root.querySelector<HTMLButtonElement>("#admin-onchain-checkin-btn")?.addEventListener("click", async () => {
    const input = root.querySelector<HTMLInputElement>("#admin-onchain-checkin-wallet");
    const wallet = (input?.value ?? "").trim();
    if (!/^0x[0-9a-fA-F]{40}$/.test(wallet)) {
      await alertModal({ kind: "warning", title: "Invalid Wallet", message: "Paste a 0x-prefixed 40-hex address first." });
      return;
    }
    const btn = root.querySelector<HTMLButtonElement>("#admin-onchain-checkin-btn");
    if (btn) { btn.disabled = true; btn.textContent = "⛓ Querying…"; }
    try {
      const r = await adminTestOnChainCheckIn(wallet);
      if (r.error) {
        await alertModal({ kind: "error", title: "Request Failed", message: `Server: ${r.error}` });
        return;
      }
      if (r.enabled === false) {
        await alertModal({
          kind: "warning",
          title: "On-Chain Not Configured",
          message: "DAILY_CHECKIN_* env vars are missing on this environment. Set DAILY_CHECKIN_ENABLED, DAILY_CHECKIN_CONTRACT_ADDR, DAILY_CHECKIN_CHAIN_ID in Vercel and redeploy.",
        });
        return;
      }
      if (!r.ok) {
        await alertModal({ kind: "error", title: "Query Failed", message: `Reason: ${r.reason ?? "unknown"}` });
        return;
      }
      const checked = r.hasCheckedInToday === true;
      const streak = r.currentStreak ?? 0;
      await alertModal({
        kind: checked ? "success" : "warning",
        title: checked ? "✅ Checked In Today" : "⏳ Not Checked In Today",
        message: `Wallet <span style="font-family:monospace;">${wallet}</span><br><br>
          <strong>On-chain check-in today:</strong> ${checked ? "yes" : "no"}<br>
          <strong>Current streak:</strong> ${streak}<br><br>
          <span style="font-size:11px; opacity:0.7;">Read-only query. ${checked ? "Player has earned Voyages credit for today." : "Player must sign in their wallet via the in-game Daily Claim to record an on-chain check-in."}</span>`,
      });
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = "⛓ Query Status"; }
    }
  });

  async function closeOffersFor(offers: ("first_energy" | "floor20" | "both")[]): Promise<void> {
    const wallet = readCompWallet();
    if (!/^0x[0-9a-fA-F]{40}$/.test(wallet)) {
      await alertModal({ kind: "warning", title: "Invalid Wallet", message: "Wallet must be a 0x-prefixed 40-hex address." });
      return;
    }
    const r = await adminConsumeOneTimeOffers(wallet, offers);
    if (!r.ok) {
      await alertModal({ kind: "error", title: "Close Failed", message: `Server returned: ${r.error ?? "unknown error"}` });
      return;
    }
    const list = (r.closed ?? []).join(", ") || "(none)";
    await alertModal({
      kind: "success",
      title: "Offer(s) Closed",
      message: `Marked consumed for <strong style="font-family:monospace;">${wallet}</strong>:<br>${list}`,
    });
  }
  root.querySelector<HTMLButtonElement>("#admin-close-offer-first-btn")?.addEventListener("click", () => closeOffersFor(["first_energy"]));
  root.querySelector<HTMLButtonElement>("#admin-close-offer-floor20-btn")?.addEventListener("click", () => closeOffersFor(["floor20"]));
  root.querySelector<HTMLButtonElement>("#admin-close-offer-both-btn")?.addEventListener("click", () => closeOffersFor(["both"]));

  // ---- Season halt admin controls ----
  // The two buttons hit admin_season_halt / admin_season_resume on the server.
  // Server re-verifies isAdmin from the JWT — these UI buttons are just a
  // convenient surface, the real authorization is server-side.
  const statusEl = root.querySelector<HTMLElement>("#admin-season-status");
  const updateStatusLabel = (halted: boolean | null, setAt: number | null): void => {
    if (!statusEl) return;
    if (halted === null) { statusEl.textContent = "Season state: unknown (server unreachable)"; return; }
    if (halted) {
      const when = setAt ? new Date(setAt).toLocaleString() : "—";
      statusEl.innerHTML = `Season state: <strong style="color:#ffb14a;">⏸ HALTED</strong> · since ${when}`;
    } else {
      statusEl.innerHTML = `Season state: <strong style="color:#7aff8a;">▶ RUNNING</strong>`;
    }
  };
  if (isAdmin()) {
    void (async (): Promise<void> => {
      const s = await fetchSeasonStatus();
      if (!s) { updateStatusLabel(null, null); return; }
      setCachedSeasonStatus(s);
      updateStatusLabel(s.halted, s.setAt);
    })();
  }
  root.querySelector<HTMLButtonElement>("#admin-season-halt")?.addEventListener("click", async () => {
    const ok = await confirmModal({
      title: "Halt Season?",
      message: "This <strong>blocks every wallet</strong> from starting campaign, survival, and boss raid runs server-side. The shop stays open so players can still spend RON / vouchers. Use this when ending a season.",
      confirmLabel: "Halt Season",
      cancelLabel: "Cancel",
      danger: true,
    });
    if (!ok) return;
    const result = await adminSetSeasonHalt(true);
    if (!result) { await alertModal({ kind: "error", message: "Halt request failed." }); return; }
    setCachedSeasonStatus(result);
    updateStatusLabel(result.halted, result.setAt);
    await alertModal({ kind: "success", title: "Season Halted", message: "All run-starts are now blocked. Visit Resume Season to lift the block." });
  });
  root.querySelector<HTMLButtonElement>("#admin-season-resume")?.addEventListener("click", async () => {
    const ok = await confirmModal({
      title: "Resume Season?",
      message: "This re-enables run starts for all wallets. Use when a new season begins.",
      confirmLabel: "Resume Season",
      cancelLabel: "Cancel",
    });
    if (!ok) return;
    const result = await adminSetSeasonHalt(false);
    if (!result) { await alertModal({ kind: "error", message: "Resume request failed." }); return; }
    setCachedSeasonStatus(result);
    updateStatusLabel(result.halted, result.setAt);
    await alertModal({ kind: "success", title: "Season Resumed", message: "Runs are live again." });
  });

  root.querySelector<HTMLButtonElement>("#link-wallet")?.addEventListener("click", async () => {
    const v = root.querySelector<HTMLInputElement>("#setting-wallet")?.value?.trim() || "";
    await alertModal(v
      ? { kind: "info", title: "Wallet Linked", message: `Wallet <strong>${v.slice(0, 10)}…</strong> linked (placeholder).` }
      : { kind: "warning", title: "No Address", message: "Paste an address first." }
    );
  });

  // ---- Wallet session management ----
  // Sign Out ends the current session and forces a fresh signature on next
  // login. The 24-hour JWT auto-restore in bootstrap() is bypassed because
  // clearSession() wipes the stored token entirely — loadSession() will
  // return null on reload, and the wallet gate's challenge → personal_sign →
  // verify dance is the only way back in. To use a different wallet, sign
  // out and sign back in with that wallet's signature — same flow.
  root.querySelector<HTMLButtonElement>("#setting-sign-out")?.addEventListener("click", async () => {
    const ok = await confirmModal({
      title: "Sign Out?",
      message: "End this session and return to the wallet gate. Next login will require a fresh signature in your wallet — to switch wallets, sign out and sign in again with the new wallet.",
      confirmLabel: "Sign Out",
      cancelLabel: "Cancel",
    });
    if (!ok) return;
    clearSession();
    // Also clear the cached wallet-address so the wallet gate doesn't pre-fill
    // stale info from the previous wallet if the player picks a different one.
    try {
      const cur = loadSettings();
      saveSettings({ ...cur, walletAddress: "" });
    } catch { /* ignore */ }
    location.reload();
  });
}

export function topBarHtml(title: string, withBack: boolean): string {
  return `
    <div class="top-bar">
      ${withBack ? `<button class="back-btn" id="back-btn" type="button">← Back</button>` : `<div></div>`}
      <h1 class="screen-title">${escapeHtml(title)}</h1>
      <div></div>
    </div>
  `;
}

/** One-time tutorial announcing the "show basic + skills side by side"
 *  toggle. Fires the first time the wallet has cleared Floor 50 AND hasn't
 *  yet seen the tutorial. Idempotent — re-calling after dismissal is a
 *  no-op. Safe to call from the floor-50 victory path AND the home-screen
 *  safety net (catches players who cleared 50 before this build shipped). */
export async function maybeShowActionBarTutorial(): Promise<void> {
  const s = loadSettings();
  if (s.showBothActionsTutorialSeen) return;
  if (getMaxCleared() < SHOW_BOTH_ACTIONS_UNLOCK_FLOOR) return;
  // Mark seen BEFORE the await so a fast double-call (e.g. floor-50 hook
  // racing with home safety-net) can't double-fire. The actual alert is
  // shown regardless of whether it succeeds.
  saveSettings({ ...s, showBothActionsTutorialSeen: true });
  await alertModal({
    kind: "success",
    title: "✨ Battle UI Option Unlocked",
    message: `You've cleared <strong>Floor ${SHOW_BOTH_ACTIONS_UNLOCK_FLOOR}</strong>!<br><br>
      A new option is now available in <strong>Settings → Combat</strong>:
      <em>"Show basic actions + skills side by side."</em><br><br>
      Turn it on and every unit's action bar will show its
      <strong>basic actions (Idle / Attack / Guard)</strong> AND its
      <strong>skills</strong> at the same time — no more tab switching
      mid-fight.<br><br>
      Off by default; flip it on whenever you want.`,
  });
}

function formatHrs(ms: number): string {
  const h = Math.max(0, Math.floor(ms / 3600000));
  const m = Math.max(0, Math.floor((ms % 3600000) / 60000));
  return `${h}h ${m}m`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  } as Record<string, string>)[c]);
}
function escapeAttr(s: string): string { return escapeHtml(s); }
