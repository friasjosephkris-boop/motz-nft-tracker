// Persistent settings stored in localStorage.
import { addEnergy, getEnergy, ENERGY_MAX, msUntilNextRefill } from "../core/energy";
import { isAdmin } from "../core/admin";
import { scopedKey } from "../auth/scope";
import { saveServerIgn, formatCooldown } from "../auth/ign";
import { adminGrantServerEnergy, adminFillServerEnergy, adminWipeAllProdData, adminForceResetWallet } from "../auth/energyApi";
import { fetchSeasonStatus, adminSetSeasonHalt, setCachedSeasonStatus } from "../core/season";
import { isDevBuild } from "../auth/devBuild";
import { confirmModal, alertModal, promptModal } from "./confirmModal";
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
}

const KEY = () => scopedKey("stat-battler.settings.v1");

const DEFAULTS: Settings = {
  playerName: "",
  walletAddress: "",
  sfxOn: true,
  bgmOn: true,
  devUnlockClass: false,
};

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

        ${isAdmin() ? `
          <div class="setting-row">
            <span class="setting-label">Admin</span>
            <div class="admin-row">
              <span class="admin-info">Energy ${getEnergy()}/${ENERGY_MAX} · refills in ${formatHrs(msUntilNextRefill())}</span>
              <button class="ghost-btn" id="admin-add-energy" type="button">+5 Energy</button>
              <button class="ghost-btn" id="admin-fill-energy" type="button">Refill Max</button>
            </div>
            <label class="toggle">
              <input type="checkbox" id="setting-dev-class" ${s.devUnlockClass ? "checked" : ""} />
              <span>Allow class re-pick anytime</span>
            </label>
            ${!isDevBuild() ? `
              <div class="admin-row admin-wipe-prod-row" style="margin-top: 8px; flex-direction: column; align-items: flex-start; gap: 4px;">
                <span class="admin-info" style="color:#ff5a6b;">☠ <strong>PRODUCTION WIPE</strong> — irreversibly deletes EVERY wallet's progress, energy, vouchers, leaderboards, shop inventory, run state, and analytics. Three confirmations required.</span>
                <button class="ghost-btn admin-wipe-prod-btn" id="admin-wipe-prod" type="button">☠ Wipe ALL Production Data</button>
              </div>
              <div class="admin-row" style="margin-top: 8px; flex-direction: column; align-items: flex-start; gap: 4px;">
                <span class="admin-info">🎯 <strong>Force-Reset One Wallet</strong> — nukes server data for a single wallet AND forces their browser to clear cached state on next session check. Use when a full wipe isn't viable.</span>
                <div style="display:flex; gap:6px; align-items:center; flex-wrap:wrap;">
                  <input type="text" id="admin-force-reset-wallet" placeholder="0x…" style="font-family:monospace; padding:4px 8px; min-width:280px;" />
                  <button class="ghost-btn" id="admin-force-reset-btn" type="button" style="border-color:#ffb14a;color:#ffd29a;">🎯 Force-Reset Wallet</button>
                </div>
              </div>
            ` : ""}
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
    const input = root.querySelector<HTMLInputElement>("#admin-force-reset-wallet");
    const wallet = (input?.value ?? "").trim();
    if (!/^0x[0-9a-fA-F]{40}$/.test(wallet)) {
      await alertModal({ kind: "warning", title: "Invalid Wallet", message: "Wallet must be a 0x-prefixed 40-hex address." });
      return;
    }
    const ok = await confirmModal({
      title: "🎯 Force-Reset This Wallet?",
      message: `Wipe all server-side data for <strong style="font-family:monospace;">${wallet}</strong> and force their browser to clear cached state on next session check (~within 5 min, or instantly on next page load).<br><br>This is a single-wallet operation — other players are unaffected.`,
      confirmLabel: "Reset Wallet",
      cancelLabel: "Cancel",
      danger: true,
    });
    if (!ok) return;
    const r = await adminForceResetWallet(wallet);
    if (!r.ok) {
      await alertModal({ kind: "error", title: "Reset Failed", message: `Server returned: ${r.error ?? "unknown error"}` });
      return;
    }
    const deletedCount = r.deleted ? Object.values(r.deleted).reduce((a, b) => a + b, 0) : 0;
    await alertModal({
      kind: "success",
      title: "Wallet Reset Complete",
      message: `Deleted <strong>${deletedCount}</strong> keys for this wallet. Their client will auto-clear + reload on next session poll.`,
    });
    if (input) input.value = "";
  });

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
