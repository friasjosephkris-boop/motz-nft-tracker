// One-time floor-20-clear offer.
//
// Triggered the first time a player clears campaign floor 20. Offers a
// full campaign-buff bundle (one grant of every SHOP_BUFF) for 20 RON
// (on-chain) OR 20 bRON in vouchers (off-chain). Strict one-shot:
// once claimed or dismissed, never offered again to this wallet.
//
// State storage (Redis JSON at `floor20offer:<wallet>`):
//   { status, consumedAt?, via? }
//
// "available"  = floor 20 has been cleared; offer is ready
// "shown"      = modal opened, awaiting decision (refresh-safe)
// "consumed"   = claimed or dismissed; never offer again
// "pending"    = floor 20 not yet cleared (default if no record)

import { getJson, setJson, del } from "./redis.js";
import { readShopInventory, writeShopInventory, mutateShopInventory, SHOP_BUFF_IDS, BUFF_GRANT_SIZE, VOUCHER_VALUES_RON, ShopItemId } from "./runState.js";

export const FLOOR20_OFFER_RON_PRICE = 20; // whole RON / bRON

export type Floor20OfferStatus = "pending" | "available" | "shown" | "consumed";

interface Floor20OfferState {
  status: Floor20OfferStatus;
  consumedAt?: number;
  via?: "ron" | "voucher" | "dismiss";
}

function key(address: string): string { return `floor20offer:${address.toLowerCase()}`; }

export async function readFloor20Offer(address: string): Promise<Floor20OfferState> {
  const raw = await getJson<Floor20OfferState>(key(address));
  if (!raw) return { status: "pending" };
  const validStates = ["pending", "available", "shown", "consumed"];
  if (!validStates.includes(raw.status)) return { status: "pending" };
  return raw;
}

async function write(address: string, state: Floor20OfferState): Promise<void> {
  await setJson(key(address), state, 60 * 60 * 24 * 365);
}

/** Called from recordFloorModeClear when the wallet just crossed floor 20.
 *  Promotes "pending" → "available". If already past that state (e.g. a
 *  wipe-then-reclear), leaves it alone. */
export async function markFloor20OfferAvailable(address: string): Promise<void> {
  const cur = await readFloor20Offer(address);
  if (cur.status === "pending") {
    await write(address, { status: "available" });
  }
}

export async function markFloor20OfferShown(address: string): Promise<Floor20OfferState> {
  const cur = await readFloor20Offer(address);
  if (cur.status === "available") {
    const next: Floor20OfferState = { status: "shown" };
    await write(address, next);
    return next;
  }
  return cur;
}

export async function dismissFloor20Offer(address: string): Promise<Floor20OfferState> {
  const cur = await readFloor20Offer(address);
  if (cur.status === "consumed") return cur;
  const next: Floor20OfferState = { status: "consumed", consumedAt: Date.now(), via: "dismiss" };
  await write(address, next);
  return next;
}

/** Grant the campaign-buff bundle: one full BUFF_GRANT_SIZE pack of every
 *  SHOP_BUFF. Marks the offer consumed. Caller must have already verified
 *  payment (on-chain RON tx OR consumed vouchers). */
export async function grantFloor20Bundle(
  address: string,
  via: "ron" | "voucher",
): Promise<{ ok: boolean; reason?: string; grants?: Record<string, number> }> {
  const cur = await readFloor20Offer(address);
  if (cur.status === "consumed") return { ok: false, reason: "offer already consumed" };
  if (cur.status === "pending") return { ok: false, reason: "floor 20 not yet cleared" };

  const grants: Record<string, number> = {};
  const result = await mutateShopInventory<Record<string, number> | null>(address, inv => {
    for (const buffId of SHOP_BUFF_IDS) {
      const qty = BUFF_GRANT_SIZE[buffId] ?? 1;
      inv.buffs[buffId] = (inv.buffs[buffId] ?? 0) + qty;
      grants[buffId] = qty;
    }
    return { next: inv, result: grants };
  });
  if (!result) return { ok: false, reason: "inventory locked, please retry" };

  await write(address, { status: "consumed", consumedAt: Date.now(), via });
  return { ok: true, grants: result };
}

/** Voucher-pay path: validate ≥20 bRON face value, deduct largest-first,
 *  then grant. Same algorithm as the first-energy-offer voucher path. */
export async function claimFloor20WithVouchers(address: string): Promise<{ ok: boolean; reason?: string; grants?: Record<string, number>; deducted?: Record<string, number> }> {
  const cur = await readFloor20Offer(address);
  if (cur.status === "consumed") return { ok: false, reason: "offer already consumed" };
  if (cur.status === "pending") return { ok: false, reason: "floor 20 not yet cleared" };

  const inv = await readShopInventory(address);
  const vchs = inv.vouchers ?? {};
  const total = (vchs.t1 ?? 0) * VOUCHER_VALUES_RON.t1
              + (vchs.t2 ?? 0) * VOUCHER_VALUES_RON.t2
              + (vchs.t3 ?? 0) * VOUCHER_VALUES_RON.t3
              + (vchs.t4 ?? 0) * VOUCHER_VALUES_RON.t4
              + (vchs.t5 ?? 0) * VOUCHER_VALUES_RON.t5;
  if (total < FLOOR20_OFFER_RON_PRICE) {
    return { ok: false, reason: `need ${FLOOR20_OFFER_RON_PRICE} bRON, have ${total}` };
  }

  const deductedOut = await mutateShopInventory<Record<string, number> | null>(address, current => {
    const v = current.vouchers ?? { t1: 0, t2: 0, t3: 0, t4: 0, t5: 0 };
    current.vouchers = v;
    let remaining = FLOOR20_OFFER_RON_PRICE;
    const used: Record<string, number> = { t1: 0, t2: 0, t3: 0, t4: 0, t5: 0 };
    const tiers: Array<{ k: "t5" | "t4" | "t3" | "t2" | "t1"; v: number }> = [
      { k: "t5", v: VOUCHER_VALUES_RON.t5 },
      { k: "t4", v: VOUCHER_VALUES_RON.t4 },
      { k: "t3", v: VOUCHER_VALUES_RON.t3 },
      { k: "t2", v: VOUCHER_VALUES_RON.t2 },
      { k: "t1", v: VOUCHER_VALUES_RON.t1 },
    ];
    for (const t of tiers) {
      while (remaining >= t.v && (v[t.k] ?? 0) > 0) {
        v[t.k] = (v[t.k] ?? 0) - 1;
        used[t.k] += 1;
        remaining -= t.v;
      }
    }
    if (remaining > 0) {
      for (let i = tiers.length - 1; i >= 0; i--) {
        const t = tiers[i];
        if (t.v >= remaining && (v[t.k] ?? 0) > 0) {
          v[t.k] = (v[t.k] ?? 0) - 1;
          used[t.k] += 1;
          remaining = 0;
          break;
        }
      }
    }
    if (remaining > 0) return { next: current, result: null };
    return { next: current, result: used };
  });
  if (!deductedOut) return { ok: false, reason: "voucher deduction failed (locked or insufficient)" };

  const grant = await grantFloor20Bundle(address, "voucher");
  if (!grant.ok) {
    // Race rollback: restore the deducted vouchers.
    await mutateShopInventory(address, current => {
      const v = current.vouchers ?? { t1: 0, t2: 0, t3: 0, t4: 0, t5: 0 };
      current.vouchers = v;
      v.t1 = (v.t1 ?? 0) + (deductedOut.t1 ?? 0);
      v.t2 = (v.t2 ?? 0) + (deductedOut.t2 ?? 0);
      v.t3 = (v.t3 ?? 0) + (deductedOut.t3 ?? 0);
      v.t4 = (v.t4 ?? 0) + (deductedOut.t4 ?? 0);
      v.t5 = (v.t5 ?? 0) + (deductedOut.t5 ?? 0);
      return { next: current, result: true };
    });
    return { ok: false, reason: grant.reason };
  }
  return { ok: true, grants: grant.grants, deducted: deductedOut };
}

export async function adminResetFloor20Offer(address: string): Promise<void> {
  await del(key(address));
}

// Avoid "imported but unused" linting where these aren't directly referenced
// in the exported surface (kept for future extension to the offer logic).
void readShopInventory; void writeShopInventory;
type _UnusedExports = ShopItemId;
void (null as unknown as _UnusedExports);
