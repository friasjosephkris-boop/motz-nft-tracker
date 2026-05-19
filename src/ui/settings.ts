// Persistent settings stored in localStorage.
import { addEnergy, getEnergy, ENERGY_MAX, msUntilNextRefill } from "../core/energy";
import { isAdmin } from "../core/admin";
import { scopedKey } from "../auth/scope";
import { saveServerIgn, formatCooldown } from "../auth/ign";
import { adminGrantServerEnergy, adminFillServerEnergy, adminWipeAllProdData, adminForceResetWallet, adminForceResetExcept, adminConsumeOneTimeOffers, adminGrantEnergyToWallet, adminTestOnChainCheckIn } from "../auth/energyApi";
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
              <span class="admin-info">⛓ <strong>Test On-Chain Daily Check-In</strong> — fires checkIn(wallet) on the Ronin contract WITHOUT touching the in-game daily lock. Use to verify env-var wiring (contract addr / chain id / relayer pk) without burning a real daily slot or waiting for UTC reset.</span>
              <div style="display:flex; gap:6px; flex-wrap:wrap; align-items:center;">
                <input type="text" id="admin-onchain-checkin-wallet" placeholder="0x..." style="font-family:monospace; padding:4px 8px; min-width:340px;" />
                <button class="ghost-btn" id="admin-onchain-checkin-btn" type="button" style="border-color:#9bcfff;color:#cce4ff;">⛓ Fire checkIn()</button>
              </div>
              <span class="setting-hint">Note: the contract rejects double-checkin in the same period — testing the same wallet twice in 24h will revert with "already checked in this period".</span>
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
    if (btn) { btn.disabled = true; btn.textContent = "⛓ Firing… (~5s)"; }
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
          message: "DAILY_CHECKIN_* env vars are missing on this environment. Set DAILY_CHECKIN_ENABLED, DAILY_CHECKIN_CONTRACT_ADDR, DAILY_CHECKIN_CHAIN_ID, DAILY_CHECKIN_RELAYER_PK in Vercel and redeploy.",
        });
        return;
      }
      if (!r.ok) {
        await alertModal({ kind: "error", title: "On-Chain Tx Failed", message: `Reason: ${r.reason ?? "unknown"}${r.txHash ? `<br>txHash: <span style="font-family:monospace;">${r.txHash}</span>` : ""}` });
        return;
      }
      const explorerUrl = r.txHash ? `https://app.roninchain.com/tx/${r.txHash}` : null;
      await alertModal({
        kind: "success",
        title: "On-Chain checkIn() Succeeded",
        message: `Fired <code>checkIn(${wallet})</code> on the Ronin contract.<br>txHash: <span style="font-family:monospace;">${r.txHash ?? "(missing)"}</span>${explorerUrl ? `<br><a href="${explorerUrl}" target="_blank" rel="noopener">View on Ronin Explorer ↗</a>` : ""}`,
      });
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = "⛓ Fire checkIn()"; }
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
