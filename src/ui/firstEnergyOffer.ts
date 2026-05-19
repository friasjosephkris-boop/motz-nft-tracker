// One-time first-energy-bundle offer modal.
//
// Triggered automatically when the player hits 0 energy AND the server says
// the offer is still available for this wallet. Strict one-shot — any of
// {pay with RON, pay with vouchers, dismiss} resolves the offer permanently.

import { alertModal } from "./confirmModal";
import { pickWalletModal } from "./walletPicker";
import { payWithWallet } from "../auth/payment";
import { showTxProgress } from "./txProgressOverlay";
import { fetchFirstOfferStatus, claimFirstOfferWithRon, claimFirstOfferWithVouchers, dismissFirstOffer } from "../core/firstEnergyOffer";
import { setEnergy } from "../core/energy";
import { isOneTimeOfferOpen, lockOneTimeOffer, unlockOneTimeOffer } from "./oneTimeOfferLock";

// 20 RON in wei. Mirrors the server's ITEM_PRICES_WEI["energy_first_offer"].
const OFFER_PRICE_WEI: bigint = 20n * 10n ** 18n;

let modalOpen = false;
let checkInFlight = false;

/** Called by the energy-decrement path when energy reaches 0. Idempotent and
 *  rate-limited so we don't spam status checks if the player keeps hitting
 *  empty-energy walls. Resolves once the modal closes (or immediately if the
 *  offer is no longer available). */
export async function maybeShowFirstEnergyOffer(): Promise<void> {
  if (modalOpen || checkInFlight) return;
  // Cross-offer lock: never stack a second one-time-offer modal on top of an
  // already-visible one. Player otherwise pays for the visible modal while
  // thinking they're paying for the one underneath (gioblo incident).
  if (isOneTimeOfferOpen()) return;
  checkInFlight = true;
  try {
    const status = await fetchFirstOfferStatus();
    if (!status || !status.ok) return;
    if (status.status === "consumed") return; // already used or dismissed — done forever
    if (isOneTimeOfferOpen()) return; // another modal opened during the await
    await openOfferModal(status.energy ?? 35, status.priceRon ?? 20);
  } finally {
    checkInFlight = false;
  }
}

async function openOfferModal(energyGrant: number, priceRon: number): Promise<void> {
  if (modalOpen) return;
  if (!lockOneTimeOffer()) return; // another offer modal grabbed the lock first
  modalOpen = true;
  const overlay = document.createElement("div");
  overlay.className = "first-offer-modal";
  overlay.innerHTML = `
    <div class="first-offer-card">
      <div class="first-offer-banner">🎁 ONE-TIME OFFER</div>
      <h2 class="first-offer-title">First Energy Bundle</h2>
      <div class="first-offer-deal">
        <span class="first-offer-deal-energy">+${energyGrant} Energy</span>
        <span class="first-offer-deal-sep">·</span>
        <span class="first-offer-deal-price">${priceRon} RON</span>
      </div>
      <div class="first-offer-desc">
        Out of energy for the first time? Grab a bundle to keep playing. Energy
        is added <strong>directly</strong> — no inventory step. Pay with
        <strong>${priceRon} RON</strong> on-chain, or <strong>${priceRon} bRON</strong> in vouchers.
      </div>
      <div class="first-offer-warning">
        ⚠ <strong>This offer is shown only once.</strong> If you dismiss it,
        it will never appear again for this wallet.
      </div>
      <div class="first-offer-actions">
        <button class="confirm-btn" id="fo-pay-ron" type="button">Pay ${priceRon} RON</button>
        <button class="confirm-btn secondary" id="fo-pay-voucher" type="button">Pay ${priceRon} bRON Vouchers</button>
        <button class="ghost-btn" id="fo-dismiss" type="button" style="border-color:#ff8888; color:#ffb8b8;">Dismiss (Don't Show Again)</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  const closeOverlay = () => { try { overlay.remove(); } catch { /* ignore */ } modalOpen = false; unlockOneTimeOffer(); };

  const ronBtn = overlay.querySelector<HTMLButtonElement>("#fo-pay-ron");
  const voucherBtn = overlay.querySelector<HTMLButtonElement>("#fo-pay-voucher");
  const dismissBtn = overlay.querySelector<HTMLButtonElement>("#fo-dismiss");

  // ---- RON path ----
  ronBtn?.addEventListener("click", async () => {
    if (!ronBtn || !voucherBtn || !dismissBtn) return;
    ronBtn.disabled = voucherBtn.disabled = dismissBtn.disabled = true;
    const chosen = await pickWalletModal({
      title: "Pay With Which Wallet?",
      subtitle: `Approving ${priceRon} RON for the First Energy Bundle`,
    });
    if (!chosen) {
      ronBtn.disabled = voucherBtn.disabled = dismissBtn.disabled = false;
      return;
    }
    const tx = showTxProgress({
      itemName: "First Energy Bundle",
      itemIcon: "🎁",
      priceLabel: `${priceRon} RON`,
      walletName: chosen.name,
      walletIcon: chosen.icon,
      walletIconUrl: chosen.iconUrl,
    });
    const pay = await payWithWallet(chosen, OFFER_PRICE_WEI);
    if (!pay.ok || !pay.txHash) {
      tx.setState("failed", { reason: pay.reason ?? "Wallet didn't return a transaction hash." });
      await tx.closed;
      ronBtn.disabled = voucherBtn.disabled = dismissBtn.disabled = false;
      return;
    }
    tx.setState("verifying", { txHash: pay.txHash });
    // Same retry loop as the regular shop — server has ~8s before Vercel
    // cuts it off, and the RPC node may lag a few seconds behind the chain.
    const MAX_ATTEMPTS = 8;
    const RETRY_MS = 4000;
    let result = await claimFirstOfferWithRon(pay.txHash);
    let attempt = 1;
    while (result.pending && attempt < MAX_ATTEMPTS) {
      attempt += 1;
      tx.setState("verifying", {
        txHash: pay.txHash,
        reason: `Waiting for the Ronin RPC to index your transaction (attempt ${attempt} of ${MAX_ATTEMPTS})…`,
      });
      await new Promise<void>(r => setTimeout(r, RETRY_MS));
      result = await claimFirstOfferWithRon(pay.txHash);
    }
    if (!result.ok) {
      tx.setState("failed", { reason: result.reason ?? "Server couldn't grant the bundle.", txHash: pay.txHash });
      await tx.closed;
      ronBtn.disabled = voucherBtn.disabled = dismissBtn.disabled = false;
      return;
    }
    tx.setState("complete", { txHash: pay.txHash });
    if (typeof result.energy === "number") setEnergy(result.energy);
    await tx.closed;
    closeOverlay();
    refreshEnergyPill();
  });

  // ---- Voucher path ----
  voucherBtn?.addEventListener("click", async () => {
    if (!ronBtn || !voucherBtn || !dismissBtn) return;
    ronBtn.disabled = voucherBtn.disabled = dismissBtn.disabled = true;
    const r = await claimFirstOfferWithVouchers();
    if (!r.ok) {
      ronBtn.disabled = voucherBtn.disabled = dismissBtn.disabled = false;
      await alertModal({
        kind: "warning",
        title: "Couldn't Pay With Vouchers",
        message: `${r.reason ?? "unknown error"}<br><br>You can still pay with RON, or dismiss the offer.`,
      });
      return;
    }
    if (typeof r.energy === "number") setEnergy(r.energy);
    const deductedSummary = r.deducted
      ? Object.entries(r.deducted).filter(([_, v]) => v > 0).map(([k, v]) => `${v}× ${k.toUpperCase()}`).join(", ")
      : "";
    closeOverlay();
    refreshEnergyPill();
    await alertModal({
      kind: "success",
      title: "Bundle Claimed",
      message: `+<strong>${energyGrant}</strong> energy added.${deductedSummary ? `<br><br>Vouchers used: ${deductedSummary}` : ""}`,
    });
  });

  // ---- Dismiss ----
  dismissBtn?.addEventListener("click", async () => {
    if (!ronBtn || !voucherBtn || !dismissBtn) return;
    ronBtn.disabled = voucherBtn.disabled = dismissBtn.disabled = true;
    await dismissFirstOffer();
    closeOverlay();
  });

  // Block backdrop/Esc closing — the player must pick something so they
  // understand it's a one-shot offer. (No silent close path.)
}

/** Update the home-screen energy pill text after a successful claim. */
function refreshEnergyPill(): void {
  // The home screen reads energy from getEnergy() on next render, but if the
  // pill is visible right now we patch it directly for instant feedback.
  // Other screens just re-render on their own loops.
  document.querySelectorAll(".energy-pill").forEach(pill => {
    const evt = new CustomEvent("toz-energy-changed");
    pill.dispatchEvent(evt);
  });
}
