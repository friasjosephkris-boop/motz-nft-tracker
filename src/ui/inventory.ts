// Inventory screen — central place for everything the player owns from the
// Shop. Energy packs are USED here (server-authoritative grant); campaign
// buffs are slotted here for the next battle; unit entitlements show a
// pointer to the Units screen.

import { topBarHtml } from "./settings";
import { getEnergy, ENERGY_MAX } from "../core/energy";
import {
  SHOP_CATALOG, ShopItemDef, ShopItemId,
  fetchShopStatus, useEnergyItem,
} from "../core/shop";
import { alertModal } from "./confirmModal";

export async function renderInventory(root: HTMLElement, onBack: () => void): Promise<void> {
  root.innerHTML = `
    <div class="screen-frame inventory-screen">
      ${topBarHtml("Inventory", true)}
      <div class="inv-header">
        <div class="inv-title-row">
          <svg class="inv-title-icon" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
            <path d="M11 5 Q11 1 16 1 Q21 1 21 5 L21 9 L19 9 L19 5 Q19 3 16 3 Q13 3 13 5 L13 9 L11 9 Z" fill="#3a200d"/>
            <rect x="5" y="8" width="22" height="22" rx="4" fill="#8b5a2b" stroke="#3a200d" stroke-width="1.2"/>
            <rect x="9" y="17" width="14" height="9" rx="1.5" fill="#6b4321" stroke="#3a200d" stroke-width="1"/>
            <rect x="14" y="20" width="4" height="3" rx="0.5" fill="#d4a93e" stroke="#7a5a14" stroke-width="0.5"/>
            <line x1="6" y1="13" x2="26" y2="13" stroke="#3a200d" stroke-width="0.8" opacity="0.55"/>
          </svg>
          <div class="inv-title">Backpack</div>
        </div>
        <div class="inv-title-rule"></div>
        <div class="inv-sub">Items you've bought from the <strong>Shop</strong> or earned in battle. Click <strong>Use</strong> on energy packs to refill, then visit Squad Select to pick a Campaign Buff for your next floor.</div>
        <div class="inv-pills">
          <div class="inv-energy-pill">⚡ ${getEnergy()} / ${ENERGY_MAX}</div>
        </div>
      </div>
      <div class="inv-body" id="inv-body">
        <div class="inv-loading">Loading inventory…</div>
      </div>
    </div>
  `;
  root.querySelector("#back-btn")?.addEventListener("click", onBack);

  await draw(root);
}

async function draw(root: HTMLElement): Promise<void> {
  const body = root.querySelector<HTMLElement>("#inv-body");
  if (!body) return;
  const status = await fetchShopStatus();
  if (!status) {
    body.innerHTML = `<div class="inv-loading">Couldn't reach the server. Please refresh.</div>`;
    return;
  }
  const owned = SHOP_CATALOG
    .map(def => ({ def, count: status.inventory.buffs[def.id] ?? 0 }))
    .filter(x => x.count > 0);

  const tempKeyActive = !!status.tempMotzKey?.active;
  const vouchers = status.inventory.vouchers ?? {};
  const totalVouchers =
    (vouchers.t1 ?? 0) + (vouchers.t2 ?? 0) + (vouchers.t3 ?? 0) +
    (vouchers.t4 ?? 0) + (vouchers.t5 ?? 0);

  if (owned.length === 0 && !tempKeyActive && totalVouchers === 0) {
    body.innerHTML = `
      <div class="inv-empty">
        <div class="inv-empty-icon">🎒</div>
        <div class="inv-empty-title">Your backpack is empty</div>
        <div class="inv-empty-sub">Visit the <strong>Shop</strong> on the home screen to buy energy packs, campaign buffs, or unit utilities.</div>
      </div>
    `;
    return;
  }

  const sections: { label: string; cat: ShopItemDef["category"] }[] = [
    { label: "Energy Packs", cat: "energy" },
    { label: "Campaign Buffs", cat: "buff" },
    { label: "Unit Utilities", cat: "unit" },
  ];

  const sectionsHtml = sections.map(sec => {
    const items = owned.filter(x => x.def.category === sec.cat);
    // The Unit Utilities section gets an extra "active pass" card when the
    // seasonal MoTZ key is live, even if no other entitlements are owned.
    const tempKeyHere = sec.cat === "unit" && tempKeyActive
      ? tempKeyCardHtml(status.tempMotzKey.expiresAt ?? 0)
      : "";
    if (items.length === 0 && !tempKeyHere) return "";
    return `
      <div class="inv-section">
        <div class="inv-section-title">${sec.label}</div>
        <div class="inv-items">
          ${tempKeyHere}
          ${items.map(x => itemRowHtml(x.def, x.count)).join("")}
        </div>
      </div>
    `;
  }).join("");
  const vouchersHtml = totalVouchers > 0 ? ronVouchersSectionHtml(vouchers) : "";
  body.innerHTML = vouchersHtml + sectionsHtml;

  // Wire energy "Use" buttons.
  body.querySelectorAll<HTMLButtonElement>("[data-use-energy]").forEach(btn => {
    const id = btn.dataset.useEnergy as "energy_5" | "energy_10" | "energy_20";
    btn.addEventListener("click", async () => {
      btn.disabled = true;
      btn.textContent = "Using…";
      const result = await useEnergyItem(id);
      if (!result.ok) {
        await alertModal({ kind: "error", title: "Couldn't Use Item", message: escapeHtml(result.reason ?? "Failed to use item.") });
      }
      // Re-render to reflect new inventory count + energy pill.
      const pill = root.querySelector<HTMLElement>(".inv-energy-pill");
      if (pill) pill.textContent = `⚡ ${getEnergy()} / ${ENERGY_MAX}`;
      await draw(root);
    });
  });

  // Buffs are chosen from Squad Select now — no buff button handler here.
}

function ronVouchersSectionHtml(v: { t1?: number; t2?: number; t3?: number; t4?: number; t5?: number }): string {
  const tiers: { id: "t1"|"t2"|"t3"|"t4"|"t5"; label: string; value: number; color: string }[] = [
    { id: "t5", label: "Tier 5", value: 200, color: "var(--gold-bright)" },
    { id: "t4", label: "Tier 4", value: 50,  color: "#ffb05f" },
    { id: "t3", label: "Tier 3", value: 20,  color: "#ffd96f" },
    { id: "t2", label: "Tier 2", value: 10,  color: "#a0e5ff" },
    { id: "t1", label: "Tier 1", value: 5,   color: "#cfd6e4" },
  ];
  const totalRon = tiers.reduce((s, t) => s + (v[t.id] ?? 0) * t.value, 0);
  const cards = tiers
    .filter(t => (v[t.id] ?? 0) > 0)
    .map(t => {
      const count = v[t.id] ?? 0;
      const subtotal = count * t.value;
      return `
        <div class="inv-voucher" style="--vchr-color:${t.color}">
          <div class="inv-voucher-icon">💰</div>
          <div class="inv-voucher-body">
            <div class="inv-voucher-head">
              <span class="inv-voucher-name">${t.label} Voucher</span>
              <span class="inv-voucher-count">×${count}</span>
            </div>
            <div class="inv-voucher-meta">${t.value} bRON each · subtotal <strong>${subtotal.toLocaleString()}</strong> bRON</div>
          </div>
        </div>
      `;
    }).join("");
  return `
    <div class="inv-section">
      <div class="inv-section-title">
        bRON Vouchers
        <span class="inv-section-aside">Total value: <strong>${totalRon.toLocaleString()}</strong> bRON · Redeem at end of season <em class="inv-section-aside-note">(not redeemable on first playtest)</em></span>
      </div>
      <div class="inv-voucher-grid">${cards}</div>
    </div>
  `;
}

function tempKeyCardHtml(expiresAt: number): string {
  const msLeft = Math.max(0, expiresAt - Date.now());
  const dayMs = 24 * 60 * 60 * 1000;
  const hourMs = 60 * 60 * 1000;
  const daysLeft = Math.floor(msLeft / dayMs);
  const hoursLeft = Math.floor((msLeft % dayMs) / hourMs);
  const remainStr = daysLeft >= 1
    ? `${daysLeft} day${daysLeft === 1 ? "" : "s"}${hoursLeft > 0 ? `, ${hoursLeft}h` : ""} remaining`
    : `${Math.max(1, hoursLeft)}h remaining`;
  const expiryDate = new Date(expiresAt).toLocaleString();
  return `
    <div class="inv-item inv-item-active-pass">
      <div class="inv-item-icon">🗝</div>
      <div class="inv-item-body">
        <div class="inv-item-head">
          <span class="inv-item-name">Temporary MoTZ Key</span>
          <span class="inv-item-active-badge">ACTIVE · ${escapeHtml(remainStr)}</span>
        </div>
        <div class="inv-item-desc">
          Seasonal pass — Hera, Nova, Oge, and Shego are unlocked while this is active.
          Expires <strong>${escapeHtml(expiryDate)}</strong>. Buy again to extend.
        </div>
      </div>
      <div class="inv-item-action">
        <div class="inv-action-hint">Active — perks applied automatically.</div>
      </div>
    </div>
  `;
}

function itemRowHtml(def: ShopItemDef, count: number): string {
  const icon = iconFor(def.id);
  let action = "";
  if (def.category === "energy") {
    action = `<button class="confirm-btn inv-use-btn" data-use-energy="${def.id}" type="button">Use</button>`;
  } else if (def.category === "buff") {
    // Buffs are chosen from the Squad Select screen before a battle starts,
    // not from here. We just show the count + a pointer.
    action = `<div class="inv-action-hint">Choose before a battle on the <strong>Squad Select</strong> screen.</div>`;
  } else {
    action = `<div class="inv-action-hint">Spend on the <strong>Units</strong> screen</div>`;
  }
  return `
    <div class="inv-item">
      <div class="inv-item-icon">${icon}</div>
      <div class="inv-item-body">
        <div class="inv-item-head">
          <span class="inv-item-name">${escapeHtml(def.name)}</span>
          <span class="inv-item-count">×${count}</span>
        </div>
        <div class="inv-item-desc">${escapeHtml(def.description)}</div>
      </div>
      <div class="inv-item-action">${action}</div>
    </div>
  `;
}

function iconFor(id: ShopItemId): string {
  switch (id) {
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
