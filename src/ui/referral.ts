// Referral dashboard screen. Shows the player's shareable link, the friends
// they've brought in, and the energy they've earned. Reached from the
// "Refer a Friend" tile on the home screen.

import { topBarHtml } from "./settings";
import { fetchReferralStatus, referralLink, ReferralStatus } from "../core/referral";

export function renderReferral(root: HTMLElement, onBack: () => void): void {
  root.innerHTML = `
    <div class="screen-frame referral-screen">
      ${topBarHtml("Refer a Friend", true)}
      <div class="referral-body" id="referral-body">
        <div class="referral-loading">Loading your referral dashboard…</div>
      </div>
    </div>
  `;
  root.querySelector("#back-btn")?.addEventListener("click", onBack);

  void fetchReferralStatus().then(status => {
    const body = root.querySelector<HTMLElement>("#referral-body");
    if (!body) return;
    if (!status) {
      body.innerHTML = `<div class="referral-loading">Couldn't load your referral dashboard. Check your connection and try again.</div>`;
      return;
    }
    body.innerHTML = dashboardHtml(status);
    wireDashboard(body, status);
  }).catch(() => {
    const body = root.querySelector<HTMLElement>("#referral-body");
    if (body) body.innerHTML = `<div class="referral-loading">Couldn't load your referral dashboard.</div>`;
  });
}

function dashboardHtml(s: ReferralStatus): string {
  const link = referralLink(s.code);
  const refereeCount = s.referees.length;
  const referredByLine = s.referredBy
    ? `<div class="referral-referred-by">You were referred by <strong>${escapeHtml(s.referredByIgn || shortAddr(s.referredBy))}</strong> 🤝</div>`
    : "";

  const refereeRows = refereeCount === 0
    ? `<div class="referral-empty">No friends yet. Share your link to start earning energy together!</div>`
    : s.referees.map(r => `
        <div class="referral-referee-row">
          <span class="referral-referee-name">${escapeHtml(r.ign || shortAddr(r.address))}</span>
          <span class="referral-referee-joined">joined ${formatDate(r.joinedAt)}</span>
          <span class="referral-referee-energy">+${r.energyEarned} ⚡</span>
        </div>
      `).join("");

  return `
    <div class="referral-intro">
      Share your link with friends. When a friend signs up with it, <strong>you both earn energy</strong>
      as they climb the tower.
    </div>

    <div class="referral-card referral-link-card">
      <div class="referral-card-label">Your referral code</div>
      <div class="referral-code">${escapeHtml(s.code)}</div>
      <div class="referral-link-row">
        <input type="text" id="referral-link-input" class="referral-link-input" readonly value="${escapeAttr(link)}" />
        <button class="confirm-btn" id="referral-copy-btn" type="button">Copy Link</button>
      </div>
      <div class="referral-copy-status" id="referral-copy-status"></div>
    </div>

    <div class="referral-card referral-rewards-card">
      <div class="referral-card-label">How rewards work</div>
      <ul class="referral-reward-list">
        <li><strong>+5 ⚡ each</strong> — when your friend clears Floor <strong>20, 40, 60, 80 &amp; 100</strong> (5 rewards as they climb).</li>
        <li><strong>+5 ⚡ each</strong> — when your friend spends <strong>10 RON</strong> or more in the shop / on an offer (one-time).</li>
      </ul>
      <div class="referral-reward-note">Both you and your friend receive the energy. Rewards arrive automatically — no claiming needed.</div>
    </div>

    <div class="referral-stats">
      <div class="referral-stat">
        <div class="referral-stat-value">${refereeCount}</div>
        <div class="referral-stat-label">Friend${refereeCount === 1 ? "" : "s"} Referred</div>
      </div>
      <div class="referral-stat">
        <div class="referral-stat-value">${s.totalEnergyEarned} ⚡</div>
        <div class="referral-stat-label">Energy Earned</div>
      </div>
    </div>

    <div class="referral-card">
      <div class="referral-card-label">Your referred friends</div>
      <div class="referral-referee-list">${refereeRows}</div>
    </div>

    ${referredByLine}
  `;
}

function wireDashboard(body: HTMLElement, s: ReferralStatus): void {
  const copyBtn = body.querySelector<HTMLButtonElement>("#referral-copy-btn");
  const input = body.querySelector<HTMLInputElement>("#referral-link-input");
  const statusEl = body.querySelector<HTMLElement>("#referral-copy-status");
  copyBtn?.addEventListener("click", async () => {
    const link = referralLink(s.code);
    let copied = false;
    try {
      await navigator.clipboard.writeText(link);
      copied = true;
    } catch {
      // Clipboard API blocked (insecure context / permissions) — fall back
      // to selecting the text so the player can copy it manually.
      if (input) {
        input.focus();
        input.select();
        try { copied = document.execCommand("copy"); } catch { copied = false; }
      }
    }
    if (statusEl) {
      statusEl.textContent = copied ? "✓ Link copied to clipboard!" : "Press Ctrl+C to copy the selected link.";
      statusEl.classList.toggle("ok", copied);
    }
  });
}

function formatDate(ms: number): string {
  if (!ms) return "—";
  try { return new Date(ms).toLocaleDateString(); } catch { return "—"; }
}

function shortAddr(a: string): string {
  if (!a || a.length < 12) return a ?? "";
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  } as Record<string, string>)[c]);
}
function escapeAttr(s: string): string { return escapeHtml(s); }
