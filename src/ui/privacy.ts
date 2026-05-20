// In-game Privacy & Data notice.
//
// Plain-language summary of what Gauntlet Tower stores and why. Written from
// an audit of the actual codebase (May 2026): the game uses NO cookies and NO
// third-party tracking — only functional browser storage + wallet-keyed server
// records. This notice is informational, not formal legal advice; have it
// reviewed before relying on it for compliance.
//
// Surface: opened from a "Privacy & Data" link in the Settings screen.

const LAST_UPDATED = "20 May 2026";

/** The notice body as HTML. Kept here as the single source of truth so the
 *  modal — and any future privacy page — render identical text. */
const PRIVACY_HTML = `
  <p>Gauntlet Tower is a browser game. This notice explains, in plain language,
  what data the game handles and why. It is informational and not a substitute
  for formal legal advice.</p>

  <h4>Stored on your device</h4>
  <p>The game saves data in your browser's local storage so it can work: your
  login token, game progress, energy, audio settings, and display name. This
  stays on your device — clearing your browser storage removes it.
  <strong>We use no cookies.</strong></p>

  <h4>Stored on our servers</h4>
  <p>When you sign in with your Ronin wallet, we store the following, linked to
  your wallet address:</p>
  <ul>
    <li>Your wallet address and chosen in-game name (IGN)</li>
    <li>Game progress — levels, XP, floors cleared, leaderboard times</li>
    <li>Activity stats — play time, energy used, and RON spent in the shop</li>
  </ul>
  <p>We use this to run the game, show leaderboards, operate the shop, and
  prevent cheating. Some of these stats are exported to a private spreadsheet
  the team uses to monitor the game.</p>

  <h4>What we do NOT do</h4>
  <ul>
    <li>No cookies</li>
    <li>No third-party analytics, tracking pixels, or ad networks</li>
    <li>We do not sell your data</li>
    <li>We do not collect your real name, email, or location</li>
  </ul>

  <h4>On-chain data</h4>
  <p>Daily check-ins and shop payments are transactions on the Ronin
  blockchain. Anything you sign is public and permanent on-chain — this is
  outside our control and is how all blockchain apps work.</p>

  <h4>Your choices</h4>
  <p>You can sign out at any time from the Settings screen. To request deletion
  of your server-side data, contact the team via our official Discord.</p>

  <p class="privacy-modal-updated">Last updated: ${LAST_UPDATED}</p>
`;

/** Show the Privacy &amp; Data notice in a centered, scrollable modal.
 *  Dismiss with the Close button, Escape, or a backdrop click. */
export function showPrivacyModal(): void {
  // Never stack two — reuse the shared confirm-overlay class for styling.
  document.querySelectorAll(".game-confirm-overlay").forEach(el => el.remove());

  const overlay = document.createElement("div");
  overlay.className = "game-confirm-overlay";
  overlay.innerHTML = `
    <div class="game-confirm-card privacy-modal-card" role="dialog" aria-modal="true" aria-labelledby="privacy-modal-title">
      <div class="game-confirm-title" id="privacy-modal-title">Privacy &amp; Data</div>
      <div class="game-confirm-body privacy-modal-body">${PRIVACY_HTML}</div>
      <div class="game-confirm-actions">
        <button class="confirm-btn game-confirm-ok" type="button">Close</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  const close = (): void => {
    overlay.remove();
    document.removeEventListener("keydown", onKey);
  };
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === "Escape" || e.key === "Enter") close();
  };
  overlay.querySelector<HTMLButtonElement>(".game-confirm-ok")!.addEventListener("click", close);
  overlay.addEventListener("click", e => { if (e.target === overlay) close(); });
  document.addEventListener("keydown", onKey);

  setTimeout(() => overlay.querySelector<HTMLButtonElement>(".game-confirm-ok")?.focus(), 0);
}
