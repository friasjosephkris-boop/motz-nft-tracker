// One-time floor-20-clear offer modal. Mirrors firstEnergyOffer.ts pattern.

import { alertModal } from "./confirmModal";
import { pickWalletModal } from "./walletPicker";
import { payWithWallet } from "../auth/payment";
import { showTxProgress } from "./txProgressOverlay";
import { fetchFloor20OfferStatus, claimFloor20WithRon, claimFloor20WithVouchers, dismissFloor20Offer } from "../core/floor20Offer";

const OFFER_PRICE_WEI: bigint = 20n * 10n ** 18n;

let modalOpen = false;
let checkInFlight = false;

/** Call after the player wins floor 20 (and on home screen entry as a
 *  safety net so a wallet that crossed floor 20 before this build deployed
 *  still gets the modal). Self-rate-limited and idempotent. */
export async function maybeShowFloor20Offer(): Promise<void> {
  if (modalOpen || checkInFlight) return;
  checkInFlight = true;
  try {
    const status = await fetchFloor20OfferStatus();
    if (!status || !status.ok) return;
    // "pending" means floor 20 not yet cleared; "consumed" means already used.
    if (status.status !== "available" && status.status !== "shown") return;
    await openOfferModal(status.priceRon ?? 20);
  } finally {
    checkInFlight = false;
  }
}

async function openOfferModal(priceRon: number): Promise<void> {
  if (modalOpen) return;
  modalOpen = true;
  const overlay = document.createElement("div");
  overlay.className = "first-offer-modal";
  overlay.innerHTML = `
    <div class="first-offer-card">
      <div class="first-offer-banner">🏆 FLOOR 20 REWARD</div>
      <h2 class="first-offer-title">Campaign Buff Bundle</h2>
      <div class="first-offer-deal">
        <span class="first-offer-deal-energy">ALL Buffs</span>
        <span class="first-offer-deal-sep">·</span>
        <span class="first-offer-deal-price">${priceRon} RON</span>
      </div>
      <div class="first-offer-desc">
        Congrats on clearing Floor 20! Grab the entire campaign-buff toolkit
        in one package — Battle Cry, Phoenix Embers, Scholar's Insight,
        Quickdraw, Last Stand — for the price of two singles.
        Pay <strong>${priceRon} RON</strong> on-chain or <strong>${priceRon} bRON</strong> in vouchers.
      </div>
      <div class="first-offer-warning">
        ⚠ <strong>This offer is shown only once.</strong> If you dismiss it,
        it will never appear again for this wallet.
      </div>
      <div class="first-offer-actions">
        <button class="confirm-btn" id="fo20-pay-ron" type="button">Pay ${priceRon} RON</button>
        <button class="confirm-btn secondary" id="fo20-pay-voucher" type="button">Pay ${priceRon} bRON Vouchers</button>
        <button class="ghost-btn" id="fo20-dismiss" type="button" style="border-color:#ff8888; color:#ffb8b8;">Dismiss (Don't Show Again)</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  const closeOverlay = () => { try { overlay.remove(); } catch { /* ignore */ } modalOpen = false; };

  const ronBtn = overlay.querySelector<HTMLButtonElement>("#fo20-pay-ron");
  const voucherBtn = overlay.querySelector<HTMLButtonElement>("#fo20-pay-voucher");
  const dismissBtn = overlay.querySelector<HTMLButtonElement>("#fo20-dismiss");

  ronBtn?.addEventListener("click", async () => {
    if (!ronBtn || !voucherBtn || !dismissBtn) return;
    ronBtn.disabled = voucherBtn.disabled = dismissBtn.disabled = true;
    const chosen = await pickWalletModal({
      title: "Pay With Which Wallet?",
      subtitle: `Approving ${priceRon} RON for the Campaign Buff Bundle`,
    });
    if (!chosen) { ronBtn.disabled = voucherBtn.disabled = dismissBtn.disabled = false; return; }
    const tx = showTxProgress({
      itemName: "Campaign Buff Bundle",
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
    let result = await claimFloor20WithRon(pay.txHash);
    let attempt = 1;
    while (result.pending && attempt < MAX_ATTEMPTS) {
      attempt += 1;
      tx.setState("verifying", {
        txHash: pay.txHash,
        reason: `Waiting for the Ronin RPC to index your transaction (attempt ${attempt} of ${MAX_ATTEMPTS})…`,
      });
      await new Promise<void>(r => setTimeout(r, RETRY_MS));
      result = await claimFloor20WithRon(pay.txHash);
    }
    if (!result.ok) {
      tx.setState("failed", { reason: result.reason ?? "Server couldn't grant the bundle.", txHash: pay.txHash });
      await tx.closed;
      ronBtn.disabled = voucherBtn.disabled = dismissBtn.disabled = false;
      return;
    }
    tx.setState("complete", { txHash: pay.txHash });
    await tx.closed;
    closeOverlay();
    await alertModal({
      kind: "success",
      title: "Bundle Claimed",
      message: `All campaign buffs added to your inventory.${grantsSummary(result.grants)}`,
    });
  });

  voucherBtn?.addEventListener("click", async () => {
    if (!ronBtn || !voucherBtn || !dismissBtn) return;
    ronBtn.disabled = voucherBtn.disabled = dismissBtn.disabled = true;
    const r = await claimFloor20WithVouchers();
    if (!r.ok) {
      ronBtn.disabled = voucherBtn.disabled = dismissBtn.disabled = false;
      await alertModal({
        kind: "warning",
        title: "Couldn't Pay With Vouchers",
        message: `${r.reason ?? "unknown error"}<br><br>You can still pay with RON, or dismiss the offer.`,
      });
      return;
    }
    closeOverlay();
    const deductedSummary = r.deducted
      ? Object.entries(r.deducted).filter(([_, v]) => v > 0).map(([k, v]) => `${v}× ${k.toUpperCase()}`).join(", ")
      : "";
    await alertModal({
      kind: "success",
      title: "Bundle Claimed",
      message: `All campaign buffs added.${grantsSummary(r.grants)}${deductedSummary ? `<br><br>Vouchers used: ${deductedSummary}` : ""}`,
    });
  });

  dismissBtn?.addEventListener("click", async () => {
    if (!ronBtn || !voucherBtn || !dismissBtn) return;
    ronBtn.disabled = voucherBtn.disabled = dismissBtn.disabled = true;
    await dismissFloor20Offer();
    closeOverlay();
  });
}

function grantsSummary(grants: Record<string, number> | undefined): string {
  if (!grants) return "";
  const items = Object.entries(grants).map(([k, v]) => `${v}× ${k.replace(/^buff_/, "").replace(/_/g, " ")}`).join(", ");
  return items ? `<br><br>${items}` : "";
}
