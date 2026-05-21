// Per-wallet shop purchase history.
//
// Every successful purchase (RON or voucher) — regular shop items, the
// Oracle Energy gamble, and the one-time offers — appends an entry here so
// the player can review what they bought, when, and how they paid.
//
// Storage: a single JSON array per wallet (`shophistory:<wallet>`), newest
// first, capped at MAX_ENTRIES. Writes go through a per-wallet lock so two
// near-simultaneous purchases can't clobber each other's append. History is
// cosmetic — a lost entry under extreme contention is harmless, so callers
// fire-and-forget (void + catch) and never let a record failure break a
// purchase.

import { getJson, setJson, withWalletLock } from "./redis.js";

const MAX_ENTRIES = 60;
const TTL_SECONDS = 60 * 60 * 24 * 365; // 1 year

/** Display labels for every purchasable id. Keeps the history self-describing
 *  even for offer items the client shop catalog doesn't list. */
const ITEM_LABELS: Record<string, string> = {
  energy_5: "+5 Energy Pack",
  energy_10: "+10 Energy Pack",
  energy_20: "+20 Energy Pack",
  unit_stat_reset: "Unit Stat Reset",
  unit_class_change: "Unit Class Change",
  unit_temp_motz_key: "Temporary MoTZ Key",
  buff_battle_cry: "Battle Cry",
  buff_phoenix_embers: "Phoenix Embers",
  buff_scholars_insight: "Scholar's Insight",
  buff_quickdraw: "Quickdraw",
  buff_last_stand: "Last Stand",
  energy_first_offer: "First Energy Bundle",
  energy_floor200_offer: "Floor 200 Energy Bundle",
  floor20_offer_bundle: "Floor 20 Buff Bundle",
  oracle_energy: "Oracle Energy",
};

/** Emoji icon per item, mirrors the shop card icons. */
const ITEM_ICONS: Record<string, string> = {
  energy_5: "⚡", energy_10: "⚡", energy_20: "⚡",
  unit_stat_reset: "🔄", unit_class_change: "🛡", unit_temp_motz_key: "🗝",
  buff_battle_cry: "📯", buff_phoenix_embers: "🔥", buff_scholars_insight: "📖",
  buff_quickdraw: "⚡", buff_last_stand: "🗡",
  energy_first_offer: "🎁", energy_floor200_offer: "🏆", floor20_offer_bundle: "🎁",
  oracle_energy: "🔮",
};

export interface ShopHistoryEntry {
  /** Purchase timestamp (ms since epoch). */
  at: number;
  /** Purchasable id. */
  item: string;
  /** Display name (resolved server-side so old/offer items still render). */
  name: string;
  /** Emoji icon. */
  icon: string;
  /** Short human note about what was granted (e.g. "Won — +3 Energy"). */
  detail: string;
  /** Cost as a display string (e.g. "1.5 RON", "20 bRON in vouchers"). */
  cost: string;
  /** Payment method. */
  via: "ron" | "voucher";
  /** On-chain tx hash for RON payments (omitted for voucher buys). */
  txHash?: string;
}

function key(address: string): string { return `shophistory:${address.toLowerCase()}`; }

/** Most-recent-first list of this wallet's purchases. */
export async function readPurchaseHistory(address: string): Promise<ShopHistoryEntry[]> {
  const raw = await getJson<ShopHistoryEntry[]>(key(address));
  return Array.isArray(raw) ? raw : [];
}

/** Append a purchase to the wallet's history. Fire-and-forget safe — never
 *  throws into the caller (callers should still `.catch()` for lint). */
export async function recordPurchase(
  address: string,
  p: { item: string; detail?: string; cost: string; via: "ron" | "voucher"; txHash?: string },
): Promise<void> {
  const entry: ShopHistoryEntry = {
    at: Date.now(),
    item: p.item,
    name: ITEM_LABELS[p.item] ?? p.item,
    icon: ITEM_ICONS[p.item] ?? "🛒",
    detail: p.detail ?? "",
    cost: p.cost,
    via: p.via,
    ...(p.txHash ? { txHash: p.txHash } : {}),
  };
  await withWalletLock(`shophistory:lock:${address.toLowerCase()}`, async () => {
    const cur = await readPurchaseHistory(address);
    cur.unshift(entry);
    await setJson(key(address), cur.slice(0, MAX_ENTRIES), TTL_SECONDS);
  }, { ttlSeconds: 5, retries: 6, retryMs: 60 });
}
