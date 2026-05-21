// One-time floor-200 energy offer modal. Same design as the first-energy
// offer (reuses the .first-offer-* CSS) — triggered the first time a player
// clears campaign floor 200. Strict one-shot: pay-RON / pay-voucher / dismiss
// all resolve the offer permanently.

import { alertModal } from "./confirmModal";
import { pickWalletModal } from "./walletPicker";
import { payWithWallet } from "../auth/payment";
import { showTxProgress } from "./txProgressOverlay";
import { fetchFloor200OfferStatus, claimFloor200WithRon, claimFloor200WithVouchers, dismissFloor200Offer } from "../core/floor200Offer";
import { setEnergy } from "../core/energy";
import { isOneTimeOfferOpen, lockOneTimeOffer, unlockOneTimeOffer } from "./oneTimeOfferLock";

// 25 RON in wei. Mirrors the server's ITEM_PRICES_WEI["energy_floor200_offer"].
const OFFER_PRICE_WEI: bigint = 25n * 10n ** 18n;

let modalOpen = false;
let checkInFlight = false;

/** Call after the player wins floor 200 (and on home-screen entry as a
 *  safety net so a wallet that crossed floor 200 before this build deployed
 *  still gets the modal). Self-rate-limited and idempotent. */
export async function maybeShowFloor200Offer(): Promise<void> {
  if (modalOpen || checkInFlight) return;
  // Cross-offer lock — never stack a second one-time-offer modal.
  if (isOneTimeOfferOpen()) return;
  checkInFlight = true;
  try {
    const status = await fetchFloor200OfferStatus();
    if (!status || !status.ok) return;
    // "pending" = floor 200 not yet cleared; "consumed" = already used.
    if (status.status !== "available" && status.status !== "shown") return;
    if (isOneTimeOfferOpen()) return; // another modal opened during the await
    await openOfferModal(status.energy ?? 50, status.priceRon ?? 25);
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
    <div class="first-offer-card first-offer-card--energy">
      <div class="first-offer-banner">🏆 FLOOR 200 REWARD</div>
      <h2 class="first-offer-title">Floor 200 Energy Bundle</h2>
      <div class="first-offer-deal">
        <span class="first-offer-deal-energy">+${energyGrant} Energy</span>
        <span class="first-offer-deal-sep">·</span>
        <span class="first-offer-deal-price">${priceRon} RON</span>
      </div>
      <div class="first-offer-desc">
        Floor 200, conquered! Claim a hefty energy bundle to power your climb
        deeper into the tower. Energy is added <strong>directly</strong> — no
        inventory step. Pay with <strong>${priceRon} RON</strong> on-chain, or
        <strong>${priceRon} bRON</strong> in vouchers.
      </div>
      <div class="first-offer-warning">
        ⚠ <strong>This offer is shown only once.</strong> If you dismiss it,
        it will never appear again for this wallet.
      </div>
      <div class="first-offer-actions">
        <button class="confirm-btn" id="f200-pay-ron" type="button">Pay ${priceRon} RON</button>
        <button class="confirm-btn secondary" id="f200-pay-voucher" type="button">Pay ${priceRon} bRON Vouchers</button>
        <button class="ghost-btn first-offer-dismiss" id="f200-dismiss" type="button">Dismiss (Don't Show Again)</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  const closeOverlay = () => {
    try { overlay.remove(); } catch { /* ignore */ }
    modalOpen = false;
    unlockOneTimeOffer();
    // After closing, fire the other one-time offers' checks in case one was
    // suppressed by the cross-offer lock. Self-rate-limited server-side, so
    // already-consumed wallets no-op cleanly.
    setTimeout(() => {
      void import("./firstEnergyOffer").then(m => m.maybeShowFirstEnergyOffer()).catch(() => undefined);
      void import("./floor20Offer").then(m => m.maybeShowFloor20Offer()).catch(() => undefined);
    }, 0);
  };

  const ronBtn = overlay.querySelector<HTMLButtonElement>("#f200-pay-ron");
  const voucherBtn = overlay.querySelector<HTMLButtonElement>("#f200-pay-voucher");
  const dismissBtn = overlay.querySelector<HTMLButtonElement>("#f200-dismiss");

  // ---- RON path ----
  ronBtn?.addEventListener("click", async () => {
    if (!ronBtn || !voucherBtn || !dismissBtn) return;
    ronBtn.disabled = voucherBtn.disabled = dismissBtn.disabled = true;
    const chosen = await pickWalletModal({
      title: "Pay With Which Wallet?",
      subtitle: `Approving ${priceRon} RON for the Floor 200 Energy Bundle`,
    });
    if (!chosen) {
      ronBtn.disabled = voucherBtn.disabled = dismissBtn.disabled = false;
      return;
    }
    const tx = showTxProgress({
      itemName: "Floor 200 Energy Bundle",
      itemIcon: "🏆",
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
    const MAX_ATTEMPTS = 8;
    const RETRY_MS = 4000;
    let result = await claimFloor200WithRon(pay.txHash);
    let attempt = 1;
    while (result.pending && attempt < MAX_ATTEMPTS) {
      attempt += 1;
      tx.setState("verifying", {
        txHash: pay.txHash,
        reason: `Waiting for the Ronin RPC to index your transaction (attempt ${attempt} of ${MAX_ATTEMPTS})…`,
      });
      await new Promise<void>(r => setTimeout(r, RETRY_MS));
      result = await claimFloor200WithRon(pay.txHash);
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
    const r = await claimFloor200WithVouchers();
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
    await dismissFloor200Offer();
    closeOverlay();
  });

  // Block backdrop/Esc closing — the player must pick something so they
  // understand it's a one-shot offer.
}

/** Nudge the home-screen energy pill to re-read after a successful claim. */
function refreshEnergyPill(): void {
  document.querySelectorAll(".energy-pill").forEach(pill => {
    pill.dispatchEvent(new CustomEvent("toz-energy-changed"));
  });
}
