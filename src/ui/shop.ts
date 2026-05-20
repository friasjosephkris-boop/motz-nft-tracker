// Shop screen — MoTZ glass cards in three sections (Energy / Unit / Buffs).
// Each item is 1-purchase-per-PH-day, server-enforced. Crypto payment is not
// wired yet (beta): purchases succeed for free but the UI labels them as paid
// so users can preview the shop.

import { getEnergy, ENERGY_MAX } from "../core/energy";
import {
  SHOP_CATALOG, ShopItemDef, ShopItemId,
  fetchShopStatus, buyShopItem,
  buyShopItemWithVouchers, pickVouchersToSpend, previewChange,
  type ShopStatus,
} from "../core/shop";
import { confirmModal, alertModal } from "./confirmModal";
import { loadSession, validateSession, setVerifiedPerks } from "../auth/session";
import { payWithWallet } from "../auth/payment";
import { pickWalletModal } from "./walletPicker";
import { showTxProgress } from "./txProgressOverlay";

export async function renderShop(root: HTMLElement, onBack: () => void): Promise<void> {
  // Initial paint — empty list while we wait on the status fetch.
  root.innerHTML = `
    <div class="screen-frame shop-screen">
      <div class="shop-banner">
        <button class="back-btn shop-back-btn" id="back-btn" type="button">← Back</button>
        <svg class="shop-scene" viewBox="0 0 960 200" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
          <defs>
            <linearGradient id="shop-svg-wall" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stop-color="#2a1a3e"/>
              <stop offset="100%" stop-color="#150a24"/>
            </linearGradient>
            <radialGradient id="shop-svg-lamp" cx="50%" cy="35%" r="65%">
              <stop offset="0%" stop-color="#FFE7B0"/>
              <stop offset="100%" stop-color="#7a4a12"/>
            </radialGradient>
          </defs>
          <rect width="960" height="200" fill="url(#shop-svg-wall)"/>
          <rect x="0" y="170" width="960" height="30" fill="#1c1024"/>
          <g stroke="rgba(0,0,0,0.4)" stroke-width="2"><line x1="120" y1="170" x2="120" y2="200"/><line x1="320" y1="170" x2="320" y2="200"/><line x1="520" y1="170" x2="520" y2="200"/><line x1="720" y1="170" x2="720" y2="200"/><line x1="880" y1="170" x2="880" y2="200"/></g>
          <circle cx="78" cy="46" r="30" fill="#1a2540"/>
          <circle cx="88" cy="38" r="13" fill="#cdbce8"/>
          <circle cx="78" cy="46" r="30" fill="none" stroke="#4a2e14" stroke-width="4"/>
          <line x1="48" y1="46" x2="108" y2="46" stroke="#4a2e14" stroke-width="3"/>
          <line x1="78" y1="16" x2="78" y2="76" stroke="#4a2e14" stroke-width="3"/>
          <g>
            <line x1="300" y1="0" x2="300" y2="22" stroke="#5a4a2a" stroke-width="2"/>
            <path d="M286 22 h28 l-6 14 h-16 Z" fill="#3a2a18"/>
            <circle cx="300" cy="40" r="10" fill="url(#shop-svg-lamp)"/>
            <line x1="660" y1="0" x2="660" y2="30" stroke="#5a4a2a" stroke-width="2"/>
            <path d="M646 30 h28 l-6 14 h-16 Z" fill="#3a2a18"/>
            <circle cx="660" cy="48" r="10" fill="url(#shop-svg-lamp)"/>
          </g>
          <g fill="#4a2f15">
            <rect x="120" y="74" width="720" height="9"/>
            <rect x="120" y="118" width="720" height="9"/>
            <rect x="120" y="162" width="720" height="9"/>
          </g>
          <g fill="#2a1708">
            <rect x="120" y="83" width="720" height="3"/><rect x="120" y="127" width="720" height="3"/><rect x="120" y="171" width="720" height="3"/>
          </g>
          <g>
            <rect x="150" y="50" width="16" height="24" rx="3" fill="#FF2A55"/><rect x="153" y="44" width="10" height="8" fill="#7a4a12"/>
            <path d="M182 74 v-14 a10 10 0 0 1 20 0 v14 Z" fill="#9A6BFF"/><rect x="189" y="42" width="6" height="8" fill="#7a4a12"/>
            <rect x="222" y="54" width="14" height="20" rx="7" fill="#2FD27A"/><rect x="225" y="48" width="8" height="7" fill="#7a4a12"/>
            <path d="M260 74 v-18 l8 -8 8 8 v18 Z" fill="#FBBF24"/><rect x="264" y="44" width="8" height="6" fill="#7a4a12"/>
            <rect x="300" y="46" width="18" height="28" rx="3" fill="#4DA3FF"/><rect x="304" y="40" width="10" height="7" fill="#7a4a12"/>
            <circle cx="350" cy="64" r="11" fill="#FF6B8A"/><rect x="345" y="48" width="10" height="9" fill="#7a4a12"/>
            <rect x="392" y="52" width="15" height="22" rx="3" fill="#9A6BFF"/><rect x="395" y="46" width="9" height="7" fill="#7a4a12"/>
          </g>
          <g>
            <path d="M150 118 v-16 a9 9 0 0 1 18 0 v16 Z" fill="#FBBF24"/><rect x="155" y="92" width="8" height="7" fill="#7a4a12"/>
            <rect x="186" y="92" width="16" height="26" rx="3" fill="#2FD27A"/><rect x="190" y="86" width="9" height="7" fill="#7a4a12"/>
            <circle cx="232" cy="106" r="12" fill="#FF2A55"/><rect x="227" y="88" width="10" height="9" fill="#7a4a12"/>
            <rect x="270" y="96" width="14" height="22" rx="7" fill="#4DA3FF"/><rect x="273" y="90" width="8" height="7" fill="#7a4a12"/>
            <path d="M306 118 v-14 a10 10 0 0 1 20 0 v14 Z" fill="#FF6B8A"/><rect x="312" y="86" width="7" height="8" fill="#7a4a12"/>
            <rect x="346" y="90" width="17" height="28" rx="3" fill="#9A6BFF"/><rect x="350" y="84" width="10" height="7" fill="#7a4a12"/>
            <rect x="384" y="98" width="14" height="20" rx="6" fill="#FBBF24"/><rect x="387" y="92" width="8" height="7" fill="#7a4a12"/>
          </g>
          <g>
            <rect x="566" y="50" width="16" height="24" rx="3" fill="#4DA3FF"/><rect x="569" y="44" width="10" height="8" fill="#7a4a12"/>
            <circle cx="616" cy="62" r="11" fill="#FBBF24"/><rect x="611" y="46" width="10" height="9" fill="#7a4a12"/>
            <path d="M654 74 v-16 a9 9 0 0 1 18 0 v16 Z" fill="#FF2A55"/><rect x="659" y="48" width="8" height="7" fill="#7a4a12"/>
            <rect x="696" y="52" width="15" height="22" rx="3" fill="#2FD27A"/><rect x="699" y="46" width="9" height="7" fill="#7a4a12"/>
            <rect x="738" y="48" width="17" height="26" rx="3" fill="#9A6BFF"/><rect x="742" y="42" width="10" height="7" fill="#7a4a12"/>
            <circle cx="792" cy="62" r="12" fill="#FF6B8A"/><rect x="787" y="44" width="10" height="9" fill="#7a4a12"/>
            <rect x="566" y="94" width="16" height="24" rx="3" fill="#FF6B8A"/><rect x="569" y="88" width="10" height="7" fill="#7a4a12"/>
            <path d="M604 118 v-16 a9 9 0 0 1 18 0 v16 Z" fill="#2FD27A"/><rect x="609" y="92" width="8" height="7" fill="#7a4a12"/>
            <circle cx="654" cy="106" r="12" fill="#9A6BFF"/><rect x="649" y="88" width="10" height="9" fill="#7a4a12"/>
            <rect x="690" y="96" width="14" height="22" rx="7" fill="#FBBF24"/><rect x="693" y="90" width="8" height="7" fill="#7a4a12"/>
            <rect x="728" y="92" width="17" height="26" rx="3" fill="#FF2A55"/><rect x="732" y="86" width="10" height="7" fill="#7a4a12"/>
            <path d="M772 118 v-14 a10 10 0 0 1 20 0 v14 Z" fill="#4DA3FF"/><rect x="778" y="86" width="7" height="8" fill="#7a4a12"/>
          </g>
          <g>
            <rect x="120" y="138" width="720" height="24" fill="#3a2412"/>
            <rect x="120" y="138" width="720" height="4" fill="#5a3a1c"/>
          </g>
        </svg>
        <div class="shop-scrim"></div>
        <h1 class="shop-wordmark">Shop</h1>
      </div>
      <div class="shop-header">
        <div class="shop-title">Tower Exchange</div>
        <div class="shop-sub">Each item can be purchased <strong>once per day</strong>. Resets at 8 AM PH.</div>
        <div class="shop-revenue" id="shop-revenue">
          <span class="shop-revenue-label">Total RON Earned by Shop</span>
          <span class="shop-revenue-value" id="shop-revenue-value">…</span>
        </div>
      </div>
      <div class="shop-one-buff-notice">
        ⚡ <strong>Only ONE campaign buff can be chosen per floor.</strong> Each charge applies to a single battle — pick the buff that matters most for the fight you're about to enter.
      </div>
      <div class="shop-floor50-notice">
        🌑 <strong>Campaign buffs are disabled on Floor 50 (World Ender).</strong> The capstone fight is fair-fight only — slotted buffs are not consumed and have no effect there.
      </div>
      <div class="shop-grid" id="shop-grid">
        <div class="shop-loading">Loading inventory…</div>
      </div>
    </div>
  `;
  root.querySelector("#back-btn")?.addEventListener("click", onBack);

  const status = await fetchShopStatus();
  const grid = root.querySelector<HTMLElement>("#shop-grid");
  if (!grid) return;

  if (!status) {
    grid.innerHTML = `<div class="shop-loading">Couldn't reach server. Please refresh.</div>`;
    return;
  }

  // Populate the community revenue stat in the header.
  const revenueEl = root.querySelector<HTMLElement>("#shop-revenue-value");
  if (revenueEl) {
    revenueEl.textContent = `${status.totalShopRevenue.toLocaleString()} RON`;
  }

  const sections: { label: string; cat: ShopItemDef["category"] }[] = [
    { label: "Energy", cat: "energy" },
    { label: "Unit Utilities", cat: "unit" },
    { label: "Campaign Buffs", cat: "buff" },
  ];

  grid.innerHTML = sections.map(sec => {
    const items = SHOP_CATALOG.filter(i => i.category === sec.cat);
    if (items.length === 0) return "";
    return `
      <div class="shop-section">
        <div class="shop-section-title">${sec.label}</div>
        <div class="shop-items">
          ${items.map(i => shopCardHtml(i, status)).join("")}
        </div>
      </div>
    `;
  }).join("");

  // Buy button handlers.
  grid.querySelectorAll<HTMLButtonElement>("[data-buy]").forEach(btn => {
    const id = btn.dataset.buy as ShopItemId;
    btn.addEventListener("click", async () => {
      const def = SHOP_CATALOG.find(i => i.id === id);
      if (!def) return;
      if (def.comingSoon) { await alertModal({ kind: "info", title: "Coming Soon", message: "This item isn't ready yet — check back soon." }); return; }
      const priceWeiStr = status.pricesWei?.[id];
      if (!priceWeiStr) { await alertModal({ kind: "warning", message: "Price not available — refresh and try again." }); return; }
      const ok = await confirmModal({
        title: "Confirm Purchase",
        message: `Buy <strong>${def.name}</strong> for <strong>${def.priceLabel}</strong>?<br><br>${def.description}<br><br>💸 You'll pick a wallet next, then approve a <strong>${def.priceLabel}</strong> transfer on the <strong>Ronin network</strong>. The item is added to your Inventory once the payment is confirmed on-chain (a few seconds).`,
        confirmLabel: "Choose Wallet",
        cancelLabel: "Cancel",
      });
      if (!ok) return;
      btn.disabled = true;
      btn.textContent = "Pick wallet…";
      // 1. Player picks the wallet they want to pay from.
      const chosen = await pickWalletModal({
        title: "Pay With Which Wallet?",
        subtitle: `Approving ${def.priceLabel} to the shop treasury`,
      });
      if (!chosen) {
        btn.disabled = false;
        btn.textContent = "Buy";
        return;
      }
      let priceWei: bigint;
      try { priceWei = BigInt(priceWeiStr); }
      catch {
        btn.disabled = false; btn.textContent = "Buy";
        await alertModal({ kind: "error", message: "Bad price format from server." });
        return;
      }
      // Open the blocking transaction-progress overlay. From this point the
      // player can't do anything else until the flow resolves to complete or
      // failed; they can only Cancel during the "approving" state.
      const tx = showTxProgress({
        itemName: def.name,
        itemIcon: iconFor(def),
        priceLabel: def.priceLabel,
        walletName: chosen.name,
        walletIcon: chosen.icon,
        walletIconUrl: chosen.iconUrl,
      });
      // 2. Send the tx through the chosen wallet.
      const pay = await payWithWallet(chosen, priceWei);
      if (!pay.ok || !pay.txHash) {
        tx.setState("failed", {
          reason: pay.reason ?? "Wallet didn't return a transaction hash.",
        });
        await tx.closed;
        btn.disabled = false;
        btn.textContent = "Buy";
        return;
      }
      // 3. Hand the tx hash to the server. Server polls Ronin RPC, validates
      //    the receipt against treasury / wallet / price / used-set, then grants.
      //    The server has only ~8s per request before Vercel cuts it off, so
      //    when the receipt isn't indexed yet it returns 202 pending → we
      //    retry up to MAX_VERIFY_ATTEMPTS with a delay between attempts.
      const MAX_VERIFY_ATTEMPTS = 8;
      const RETRY_DELAY_MS = 4000;
      tx.setState("verifying", { txHash: pay.txHash });
      let result = await buyShopItem(id, pay.txHash);
      let attempt = 1;
      while (result.pending && attempt < MAX_VERIFY_ATTEMPTS) {
        attempt += 1;
        tx.setState("verifying", {
          txHash: pay.txHash,
          // Pass the attempt counter through reason so the overlay can show progress.
          reason: `Waiting for the Ronin RPC to index your transaction (attempt ${attempt} of ${MAX_VERIFY_ATTEMPTS})…`,
        });
        await new Promise<void>(r => setTimeout(r, RETRY_DELAY_MS));
        result = await buyShopItem(id, pay.txHash);
      }
      if (result.pending) {
        tx.setState("failed", {
          reason: "We couldn't confirm your transaction within the wait window. The tx may still finalize — wait a minute, then try buying this item again with the same hash (you won't be double-charged because the daily cap blocks re-buys).",
          txHash: pay.txHash,
        });
        await tx.closed;
        await renderShop(root, onBack);
        return;
      }
      if (!result.ok) {
        tx.setState("failed", {
          reason: result.reason ?? "Something went wrong on the server.",
          txHash: pay.txHash,
        });
        await tx.closed;
        // Re-fetch + re-render to refresh "Bought today" state.
        await renderShop(root, onBack);
        return;
      }
      tx.setState("complete", { txHash: pay.txHash });
      await tx.closed;
      // Temp MoTZ Key applies to perks immediately — refresh the verified
      // perks cache so locked unit overlays clear without waiting for the
      // next periodic /auth/me poll.
      if (id === "unit_temp_motz_key") {
        const sess = loadSession();
        if (sess) {
          const refreshed = await validateSession(sess.token);
          if (refreshed.status === "valid") setVerifiedPerks(refreshed.perks);
        }
      }
      // Successful — re-render to reflect new state.
      await renderShop(root, onBack);
    });
  });

  // ---- Voucher-pay buttons ----
  // The voucher path bypasses the on-chain payment entirely (no signature) but
  // is just as devtool-proof: the server re-reads inventory, validates voucher
  // ownership + total value, and grants atomically. No tx overlay shown
  // because there's no wallet round-trip — the call resolves instantly.
  grid.querySelectorAll<HTMLButtonElement>("[data-buy-vouchers]").forEach(btn => {
    const id = btn.dataset.buyVouchers as ShopItemId;
    btn.addEventListener("click", async () => {
      const def = SHOP_CATALOG.find(i => i.id === id);
      if (!def) return;
      if (def.comingSoon) { await alertModal({ kind: "info", title: "Coming Soon", message: "This item isn't ready yet — check back soon." }); return; }
      const priceRon = status.pricesRon?.[id];
      if (typeof priceRon !== "number") { await alertModal({ kind: "warning", message: "Price not available — refresh and try again." }); return; }
      const spend = pickVouchersToSpend(
        status.inventory.vouchers ?? {},
        status.voucherValuesRon,
        priceRon,
      );
      if (!spend) {
        await alertModal({
          kind: "warning",
          title: "Not Enough Vouchers",
          message: `You need <strong>${priceRon} bRON</strong> in voucher value to buy this. Earn more vouchers from mob/boss kills (drops are random).`,
        });
        return;
      }
      // Build a human-readable breakdown of which tiers we're about to burn.
      const spendLabel = (["t5", "t4", "t3", "t2", "t1"] as const)
        .filter(t => (spend[t] ?? 0) > 0)
        .map(t => `${spend[t]} × Tier ${t.slice(1)} (${status.voucherValuesRon[t]} bRON)`)
        .join(" + ");
      const totalSpent =
        (spend.t1 ?? 0) * status.voucherValuesRon.t1 +
        (spend.t2 ?? 0) * status.voucherValuesRon.t2 +
        (spend.t3 ?? 0) * status.voucherValuesRon.t3 +
        (spend.t4 ?? 0) * status.voucherValuesRon.t4 +
        (spend.t5 ?? 0) * status.voucherValuesRon.t5;
      const wasted = totalSpent - priceRon;
      let wasteLine: string;
      if (wasted > 0) {
        const change = previewChange(wasted, status.voucherValuesRon);
        const changeLabel = (["t5", "t4", "t3", "t2", "t1"] as const)
          .filter(t => change[t] > 0)
          .map(t => `${change[t]} × Tier ${t.slice(1)} (${status.voucherValuesRon[t]} bRON)`)
          .join(" + ") || "—";
        wasteLine = `<br><br>You'll spend <strong>${totalSpent} bRON</strong> total and receive <strong>${wasted} bRON in change</strong>: <strong>${changeLabel}</strong>. (Change is credited as smaller-tier vouchers, largest first.)`;
      } else {
        wasteLine = `<br><br>✓ Exact cover — no change needed.`;
      }
      const ok = await confirmModal({
        title: "Pay With bRON Vouchers?",
        message: `Buy <strong>${def.name}</strong> for <strong>${priceRon} RON</strong> worth of vouchers?<br><br>Spend: <strong>${spendLabel}</strong>${wasteLine}<br><br>No wallet signature required — vouchers are deducted server-side and the item lands in your Inventory immediately.`,
        confirmLabel: "Spend Vouchers",
        cancelLabel: "Cancel",
      });
      if (!ok) return;
      btn.disabled = true;
      btn.textContent = "Spending…";
      const result = await buyShopItemWithVouchers(id, spend);
      if (!result.ok) {
        btn.disabled = false;
        btn.textContent = "Pay with Vouchers";
        await alertModal({
          kind: "error",
          title: "Voucher Purchase Failed",
          message: result.reason ?? "Server rejected the spend.",
        });
        return;
      }
      // Refresh perks if a Temp MoTZ Key was just granted (same as RON-path).
      if (id === "unit_temp_motz_key") {
        const sess = loadSession();
        if (sess) {
          const refreshed = await validateSession(sess.token);
          if (refreshed.status === "valid") setVerifiedPerks(refreshed.perks);
        }
      }
      await alertModal({
        kind: "success",
        title: "Purchase Complete",
        message: `<strong>${def.name}</strong> is now in your Inventory (Backpack icon).`,
      });
      await renderShop(root, onBack);
    });
  });

  // Buff "choose" UX lives on the Inventory + Squad-Select screens — the Shop
  // is purchase-only. No slot handler wired here on purpose.
}

function shopCardHtml(def: ShopItemDef, status: ShopStatus): string {
  const bought = !!status.boughtToday[def.id];
  const owned = status.inventory.buffs[def.id] ?? 0;
  const isBuff = def.category === "buff";
  const isEntitlement = def.id === "unit_stat_reset" || def.id === "unit_class_change";
  const ctaLabel = def.comingSoon ? "Coming Soon" : (bought ? "Bought Today" : "Buy");
  const ctaDisabled = def.comingSoon || bought;
  const ownedBadge = (isBuff || isEntitlement) && owned > 0
    ? `<span class="shop-owned">Owned: <strong>${owned}</strong></span>`
    : "";

  // Voucher-pay button: only shown if the player has enough total voucher
  // value AND the item isn't already bought today / coming soon. The button
  // label shows the RON cost so the player knows what they're spending.
  const priceRon = status.pricesRon?.[def.id];
  const ownedVouchers = status.inventory.vouchers ?? {};
  const totalVoucherValue =
    (ownedVouchers.t1 ?? 0) * status.voucherValuesRon.t1 +
    (ownedVouchers.t2 ?? 0) * status.voucherValuesRon.t2 +
    (ownedVouchers.t3 ?? 0) * status.voucherValuesRon.t3 +
    (ownedVouchers.t4 ?? 0) * status.voucherValuesRon.t4 +
    (ownedVouchers.t5 ?? 0) * status.voucherValuesRon.t5;
  const canPayWithVouchers = !def.comingSoon && !bought
    && typeof priceRon === "number" && totalVoucherValue >= priceRon;
  const voucherBtn = typeof priceRon === "number"
    ? `<button class="ghost-btn shop-buy-voucher-btn" data-buy-vouchers="${def.id}" type="button" ${canPayWithVouchers ? "" : "disabled"} title="${canPayWithVouchers ? `Spend ${priceRon} bRON in vouchers` : `Need ${priceRon} bRON in vouchers (you have ${totalVoucherValue})`}">🎟 ${canPayWithVouchers ? `Pay ${priceRon} bRON in Vouchers` : `Need ${priceRon} bRON`}</button>`
    : "";

  return `
    <div class="shop-card ${def.comingSoon ? "shop-card-soon" : ""} ${bought ? "shop-card-bought" : ""}">
      <div class="shop-card-head">
        <span class="shop-card-icon">${iconFor(def)}</span>
        <span class="shop-card-name">${escapeHtml(def.name)}</span>
        ${ownedBadge}
      </div>
      <div class="shop-card-desc">
        ${escapeHtml(def.description)}
        ${def.category === "buff" ? `<div class="shop-card-restrict">⚠ Not usable on Floor 50 (World Ender)</div>` : ""}
      </div>
      <div class="shop-card-foot">
        <span class="shop-card-price">${escapeHtml(def.priceLabel)}</span>
        <div class="shop-card-actions">
          <button class="confirm-btn shop-buy-btn" data-buy="${def.id}" type="button" ${ctaDisabled ? "disabled" : ""}>${escapeHtml(ctaLabel)}</button>
          ${voucherBtn}
        </div>
      </div>
    </div>
  `;
}

function iconFor(def: ShopItemDef): string {
  switch (def.id) {
    case "energy_5": return "⚡";
    case "energy_10": return "⚡⚡";
    case "energy_20": return "⚡⚡⚡";
    case "unit_stat_reset": return "🔄";
    case "unit_class_change": return "🛡";
    case "unit_temp_motz_key": return "🗝";
    case "buff_battle_cry": return "📯";
    case "buff_phoenix_embers": return "🔥";
    case "buff_scholars_insight": return "📖";
    case "buff_quickdraw": return "⚡";
    case "buff_last_stand": return "🗡";
    default: return "❔";
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  } as Record<string, string>)[c]);
}

// Suppress unused-import warning for energy values referenced indirectly.
void getEnergy; void ENERGY_MAX;
