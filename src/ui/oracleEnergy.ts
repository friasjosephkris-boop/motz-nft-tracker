// Oracle Energy modal — the 50/50 RON gamble in the shop's energy section.
//
// Flow: open → intro art + mechanics + "Consult the Oracle" button →
// pick wallet → pay 1.5 RON → server flips a crypto coin → swap to the
// win (+3) or lose (+1) art and show the energy gained. The player can
// consult again until the daily cap (10/day) is spent.
//
// The coin flip + payment verification are entirely server-side, so a
// tampered client cannot fix the outcome or skip paying.

import { pickWalletModal } from "./walletPicker";
import { payWithWallet } from "../auth/payment";
import { showTxProgress } from "./txProgressOverlay";
import { alertModal } from "./confirmModal";
import { setEnergy } from "../core/energy";
import { fetchOracleStatus, playOracleWithRon } from "../core/oracleEnergy";

// 1.5 RON in wei. Mirrors the server's ITEM_PRICES_WEI["oracle_energy"].
const ORACLE_PRICE_WEI: bigint = 15n * 10n ** 17n;

let modalOpen = false;

/** Open the Oracle Energy gamble modal. Safe to call repeatedly — no-ops if
 *  a modal is already open. */
export async function openOracleModal(): Promise<void> {
  if (modalOpen) return;
  modalOpen = true;

  const overlay = document.createElement("div");
  overlay.className = "oracle-modal";
  const status = await fetchOracleStatus();
  let playsRemaining = status?.playsRemaining ?? 0;
  const cap = status?.cap ?? 10;
  const winEnergy = status?.win ?? 3;
  const loseEnergy = status?.lose ?? 1;
  // null status = server unreachable; allow the attempt anyway (server is the
  // hard gate) but show a neutral remaining count.
  const playsKnown = status !== null;

  overlay.innerHTML = cardHtml("intro", { playsRemaining, cap, winEnergy, loseEnergy, playsKnown });
  document.body.appendChild(overlay);

  const close = () => {
    try { overlay.remove(); } catch { /* ignore */ }
    modalOpen = false;
  };

  // Backdrop click + Esc close — this is a shop modal, not a one-shot offer.
  overlay.addEventListener("click", e => { if (e.target === overlay) close(); });
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") { close(); document.removeEventListener("keydown", onKey); }
  };
  document.addEventListener("keydown", onKey);

  /** Re-render the card for a given state and (re)wire its buttons. */
  const render = (
    state: "intro" | "win" | "lose",
    opts: { energyGained?: number } = {},
  ): void => {
    overlay.innerHTML = cardHtml(state, {
      playsRemaining, cap, winEnergy, loseEnergy, playsKnown,
      energyGained: opts.energyGained,
    });
    wire();
  };

  /** Wire the close + consult buttons on the currently-rendered card. */
  const wire = (): void => {
    overlay.querySelector<HTMLButtonElement>(".oracle-close")
      ?.addEventListener("click", () => { close(); document.removeEventListener("keydown", onKey); });

    const consultBtn = overlay.querySelector<HTMLButtonElement>(".oracle-consult");
    consultBtn?.addEventListener("click", async () => {
      if (playsRemaining <= 0 && playsKnown) {
        await alertModal({
          kind: "info",
          title: "Daily Limit Reached",
          message: `You've used all ${cap} Oracle consultations today. The Oracle rests until <strong>8 AM PH</strong>.`,
        });
        return;
      }
      consultBtn.disabled = true;

      // 1. Pick the paying wallet.
      const chosen = await pickWalletModal({
        title: "Pay With Which Wallet?",
        subtitle: "Offering 1.5 RON to the Oracle",
      });
      if (!chosen) { consultBtn.disabled = false; return; }

      // 2. Send the 1.5 RON tx.
      const tx = showTxProgress({
        itemName: "Oracle Energy",
        itemIcon: "🔮",
        priceLabel: "1.5 RON",
        walletName: chosen.name,
        walletIcon: chosen.icon,
        walletIconUrl: chosen.iconUrl,
      });
      const pay = await payWithWallet(chosen, ORACLE_PRICE_WEI);
      if (!pay.ok || !pay.txHash) {
        tx.setState("failed", { reason: pay.reason ?? "Wallet didn't return a transaction hash." });
        await tx.closed;
        consultBtn.disabled = false;
        return;
      }

      // 3. Hand the hash to the server — it verifies payment, flips the
      //    coin, grants energy. Retry while the RPC hasn't indexed the tx.
      tx.setState("verifying", { txHash: pay.txHash });
      const MAX_ATTEMPTS = 8;
      const RETRY_MS = 4000;
      let result = await playOracleWithRon(pay.txHash);
      let attempt = 1;
      while (result.pending && attempt < MAX_ATTEMPTS) {
        attempt += 1;
        tx.setState("verifying", {
          txHash: pay.txHash,
          reason: `Waiting for the Ronin RPC to index your transaction (attempt ${attempt} of ${MAX_ATTEMPTS})…`,
        });
        await new Promise<void>(r => setTimeout(r, RETRY_MS));
        result = await playOracleWithRon(pay.txHash);
      }
      if (!result.ok) {
        tx.setState("failed", { reason: result.reason ?? "The Oracle couldn't be reached.", txHash: pay.txHash });
        await tx.closed;
        consultBtn.disabled = false;
        return;
      }

      // 4. Success — close the tx overlay, reveal the result.
      tx.setState("complete", { txHash: pay.txHash });
      if (typeof result.balance === "number") setEnergy(result.balance);
      if (typeof result.playsRemaining === "number") playsRemaining = result.playsRemaining;
      await tx.closed;
      refreshEnergyPill();
      render(result.won ? "win" : "lose", { energyGained: result.energyGranted });
    });
  };

  wire();
}

/** Build the modal card markup for a given state. */
function cardHtml(
  state: "intro" | "win" | "lose",
  o: {
    playsRemaining: number; cap: number; winEnergy: number; loseEnergy: number;
    playsKnown: boolean; energyGained?: number;
  },
): string {
  const art =
    state === "win" ? "/oracle%203%20energy.webp"
    : state === "lose" ? "/oracle%201%20energy.webp"
    : "/oracle%20energy.webp";

  const playsLine = o.playsKnown
    ? `<div class="oracle-plays">🔮 <strong>${o.playsRemaining}</strong> / ${o.cap} consultations left today</div>`
    : `<div class="oracle-plays">🔮 Oracle ready</div>`;

  const atCap = o.playsKnown && o.playsRemaining <= 0;
  const consultLabel = state === "intro" ? "Consult the Oracle — 1.5 RON" : "Consult Again — 1.5 RON";
  const consultBtn = atCap
    ? `<button class="confirm-btn oracle-consult" type="button" disabled>Daily Limit Reached</button>`
    : `<button class="confirm-btn oracle-consult" type="button">${consultLabel}</button>`;

  let body: string;
  if (state === "intro") {
    body = `
      <div class="oracle-mechanics">
        Offer <strong>1.5 RON</strong> and the Oracle flips fate — a true
        <strong>50 / 50</strong>:
        <div class="oracle-odds">
          <span class="oracle-odd oracle-odd--win">WIN · +${o.winEnergy} Energy</span>
          <span class="oracle-odds-sep">vs</span>
          <span class="oracle-odd oracle-odd--lose">LOSE · +${o.loseEnergy} Energy</span>
        </div>
        Either way you walk away with energy — fortune just decides how much.
        Energy is added <strong>directly</strong> to your pool.
      </div>`;
  } else if (state === "win") {
    body = `
      <div class="oracle-result oracle-result--win">
        <div class="oracle-result-verdict">✨ FORTUNE FAVOURS YOU ✨</div>
        <div class="oracle-result-energy">+${o.energyGained ?? o.winEnergy} Energy</div>
      </div>`;
  } else {
    body = `
      <div class="oracle-result oracle-result--lose">
        <div class="oracle-result-verdict">The Oracle's gaze turns away…</div>
        <div class="oracle-result-energy">+${o.energyGained ?? o.loseEnergy} Energy</div>
      </div>`;
  }

  return `
    <div class="oracle-card oracle-card--${state}">
      <button class="oracle-close" type="button" aria-label="Close">✕</button>
      <div class="oracle-banner">🔮 Oracle Energy</div>
      <div class="oracle-art-wrap">
        <img class="oracle-art" src="${art}" alt="" draggable="false" />
      </div>
      <h2 class="oracle-title">Oracle Energy</h2>
      ${body}
      ${playsLine}
      <div class="oracle-actions">
        ${consultBtn}
      </div>
    </div>
  `;
}

/** Nudge the home-screen energy pill to re-read after a successful play. */
function refreshEnergyPill(): void {
  document.querySelectorAll(".energy-pill").forEach(pill => {
    pill.dispatchEvent(new CustomEvent("toz-energy-changed"));
  });
}
