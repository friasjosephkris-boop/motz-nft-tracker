// Always-visible wallet-status pill anchored to the bottom-right of the screen.
// Shows the player's currently-active wallet account and whether it matches
// the wallet they logged in with. Updates on:
//   - mount (once at app start)
//   - the provider's `accountsChanged` event
//   - a 10s polling fallback in case the event doesn't fire (some wallets
//     are flaky here, esp. when the user switches accounts via the wallet UI
//     while the dApp tab is in the background)

import { discoverWallets, readActiveAccount, onAccountsChanged, WalletOption } from "../auth/payment";
import { getVerifiedAddress } from "../auth/session";

let mounted = false;
let unsubscribeAccountsChanged: (() => void) | null = null;
let refreshTimer: ReturnType<typeof setInterval> | null = null;

/** Idempotent mount — call once from main.ts after the app boots. */
export function mountWalletStatusBadge(): void {
  if (mounted) return;
  if (typeof document === "undefined") return;
  mounted = true;

  const el = document.createElement("div");
  el.id = "wallet-status-badge";
  el.className = "wsb-host";
  document.body.appendChild(el);

  void refresh();
  // Re-check periodically — backup in case accountsChanged doesn't fire
  // (e.g., the user switches accounts in their wallet UI in a different tab).
  refreshTimer = setInterval(() => { void refresh(); }, 10_000);
}

/** Forces an immediate refresh — call after auth changes (sign-in / sign-out). */
export function refreshWalletStatusBadge(): void {
  void refresh();
}

async function refresh(): Promise<void> {
  const el = document.getElementById("wallet-status-badge");
  if (!el) return;

  const session = getVerifiedAddress();
  if (!session) {
    el.style.display = "none";
    if (unsubscribeAccountsChanged) {
      unsubscribeAccountsChanged();
      unsubscribeAccountsChanged = null;
    }
    return;
  }

  // Find the wallet whose currently-active account matches the session wallet,
  // OR (if no match) the first wallet with any active account so we can show
  // the mismatch banner with the wallet info.
  const wallets = await discoverWallets();
  let matching: { wallet: WalletOption; account: string } | null = null;
  let firstConnected: { wallet: WalletOption; account: string } | null = null;

  for (const w of wallets) {
    if (!w.detected) continue;
    const provider = await w.getProvider();
    if (!provider) continue;
    const acct = await readActiveAccount(provider);
    if (!acct) continue;
    if (!firstConnected) firstConnected = { wallet: w, account: acct };
    if (acct.toLowerCase() === session.toLowerCase()) {
      matching = { wallet: w, account: acct };
      // Subscribe to account changes on this provider so the badge updates
      // immediately when the user switches accounts.
      if (unsubscribeAccountsChanged) unsubscribeAccountsChanged();
      unsubscribeAccountsChanged = onAccountsChanged(provider, () => void refresh());
      break;
    }
  }

  // If no matching wallet, still subscribe to the first connected one so
  // we can react to the user switching to the right account.
  if (!matching && firstConnected) {
    const provider = await firstConnected.wallet.getProvider();
    if (provider) {
      if (unsubscribeAccountsChanged) unsubscribeAccountsChanged();
      unsubscribeAccountsChanged = onAccountsChanged(provider, () => void refresh());
    }
  }

  el.style.display = "";
  // Credit box stacks ABOVE the wallet pill (flex-column on .wsb-host).
  el.innerHTML = renderCreditBox() + renderBadge({ matching, firstConnected, session });
  // The MoTZ logo lives at /public/motz-icon.png. If that asset isn't present
  // yet, hide the <img> so the box still looks clean (text-only) rather than
  // showing a broken-image glyph.
  const logo = el.querySelector<HTMLImageElement>(".motz-credit-logo");
  if (logo) logo.onerror = (): void => { logo.style.display = "none"; };
}

/** Static "Created by MoTZ" credit box shown directly above the wallet pill.
 *  The whole box is a link to the MoTZ Discord. */
function renderCreditBox(): string {
  return `
    <a class="motz-credit" href="https://discord.gg/motz" target="_blank" rel="noopener noreferrer"
       title="Join the MoTZ Discord — discord.gg/motz">
      <img class="motz-credit-logo" src="/motz-icon.png" alt="" />
      <div class="motz-credit-text">
        <span class="motz-credit-by">Created by MoTZ</span>
        <span class="motz-credit-link">discord.gg/motz</span>
      </div>
    </a>
  `;
}

function renderBadge(args: {
  matching: { wallet: WalletOption; account: string } | null;
  firstConnected: { wallet: WalletOption; account: string } | null;
  session: string;
}): string {
  const { matching, firstConnected, session } = args;

  if (matching) {
    // Active wallet matches the logged-in wallet — green dot, clean state.
    const w = matching.wallet;
    const iconHtml = w.iconUrl
      ? `<img class="wsb-icon-img" src="${escapeAttr(w.iconUrl)}" alt="" />`
      : `<span class="wsb-icon-glyph">${w.icon}</span>`;
    return `
      <div class="wsb-card wsb-match" title="Wallet matches your logged-in account">
        ${iconHtml}
        <div class="wsb-body">
          <div class="wsb-name">${escapeText(w.name)}</div>
          <div class="wsb-addr">${shortAddr(matching.account)}</div>
        </div>
        <span class="wsb-dot wsb-dot-ok" aria-label="Match"></span>
      </div>
    `;
  }

  if (firstConnected) {
    // A wallet is active but on the WRONG account. Show what's wrong + what
    // the player should switch to.
    const w = firstConnected.wallet;
    const iconHtml = w.iconUrl
      ? `<img class="wsb-icon-img" src="${escapeAttr(w.iconUrl)}" alt="" />`
      : `<span class="wsb-icon-glyph">${w.icon}</span>`;
    return `
      <div class="wsb-card wsb-mismatch" title="The active wallet account doesn't match your logged-in account — purchases will be blocked">
        ${iconHtml}
        <div class="wsb-body">
          <div class="wsb-name">${escapeText(w.name)}</div>
          <div class="wsb-addr">${shortAddr(firstConnected.account)}</div>
          <div class="wsb-warn">Switch to ${shortAddr(session)}</div>
        </div>
        <span class="wsb-dot wsb-dot-err" aria-label="Mismatch"></span>
      </div>
    `;
  }

  // Logged in, but no wallet currently exposes an account. Likely the user
  // hasn't approved the connection in their wallet for this session.
  return `
    <div class="wsb-card wsb-disconnected" title="No active wallet account detected for your logged-in address">
      <span class="wsb-icon-glyph">🔌</span>
      <div class="wsb-body">
        <div class="wsb-name">Logged In</div>
        <div class="wsb-addr">${shortAddr(session)}</div>
        <div class="wsb-warn">Wallet not connected</div>
      </div>
      <span class="wsb-dot wsb-dot-warn" aria-label="Disconnected"></span>
    </div>
  `;
}

function shortAddr(a: string): string {
  if (!a || a.length < 10) return a ?? "";
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}
function escapeText(s: string): string {
  return s.replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  } as Record<string, string>)[c]);
}
function escapeAttr(s: string): string { return escapeText(s); }

// Suppress unused-var warning when the file is tree-shaken in non-browser builds.
void refreshTimer;
