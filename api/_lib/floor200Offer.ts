// One-time floor-200 energy offer.
//
// Triggered the first time a player clears campaign floor 200. Offers
// 50 energy for 25 RON (on-chain) OR 25 bRON in vouchers (off-chain).
// Strict one-shot: once claimed or dismissed, never offered again.
//
// Mirrors firstEnergyOffer.ts (energy grant) + floor20Offer.ts (floor-clear
// trigger via markAvailable). State storage (Redis JSON `floor200offer:<wallet>`):
//   { status, consumedAt?, via? }
//   "pending"   = floor 200 not yet cleared (default if no record)
//   "available" = floor 200 cleared; offer is ready
//   "shown"     = modal opened, awaiting decision (refresh-safe)
//   "consumed"  = claimed or dismissed; never offer again

import { getJson, setJson, del } from "./redis.js";
import { readShopInventory, mutateShopInventory, VOUCHER_VALUES_RON } from "./runState.js";
import { getEnergy, ENERGY_MAX } from "./energy.js";

export const FLOOR200_OFFER_ENERGY_GRANT = 50;
export const FLOOR200_OFFER_RON_PRICE = 25; // whole RON (also bRON face value)

export type Floor200OfferStatus = "pending" | "available" | "shown" | "consumed";

interface Floor200OfferState {
  status: Floor200OfferStatus;
  consumedAt?: number;
  via?: "ron" | "voucher" | "dismiss";
}

function key(address: string): string { return `floor200offer:${address.toLowerCase()}`; }

export async function readFloor200Offer(address: string): Promise<Floor200OfferState> {
  const raw = await getJson<Floor200OfferState>(key(address));
  if (!raw) return { status: "pending" };
  const valid = ["pending", "available", "shown", "consumed"];
  if (!valid.includes(raw.status)) return { status: "pending" };
  return raw;
}

async function write(address: string, state: Floor200OfferState): Promise<void> {
  await setJson(key(address), state, 60 * 60 * 24 * 365);
}

/** Called from recordFloorModeClear when the wallet just crossed floor 200.
 *  Promotes "pending" → "available". Leaves later states alone. */
export async function markFloor200OfferAvailable(address: string): Promise<void> {
  const cur = await readFloor200Offer(address);
  if (cur.status === "pending") {
    await write(address, { status: "available" });
  }
}

/** Mark "shown" so a refresh keeps the modal until the player picks. */
export async function markFloor200OfferShown(address: string): Promise<Floor200OfferState> {
  const cur = await readFloor200Offer(address);
  if (cur.status === "available") {
    const next: Floor200OfferState = { status: "shown" };
    await write(address, next);
    return next;
  }
  return cur;
}

export async function dismissFloor200Offer(address: string): Promise<Floor200OfferState> {
  const cur = await readFloor200Offer(address);
  if (cur.status === "consumed") return cur;
  const next: Floor200OfferState = { status: "consumed", consumedAt: Date.now(), via: "dismiss" };
  await write(address, next);
  return next;
}

/** Grant +50 energy and mark consumed. Caller must have already verified
 *  payment (on-chain RON tx OR consumed vouchers). */
export async function grantFloor200Bundle(
  address: string,
  via: "ron" | "voucher",
): Promise<{ ok: boolean; reason?: string; energy?: number }> {
  const cur = await readFloor200Offer(address);
  if (cur.status === "consumed") return { ok: false, reason: "offer already consumed" };
  if (cur.status === "pending") return { ok: false, reason: "floor 200 not yet cleared" };
  // Add energy directly. Cap at ENERGY_MAX + the grant so a near-full pool
  // still gets the full bonus without unbounded stockpiling — same formula
  // as the first-energy offer.
  const e = await getEnergy(address);
  const newAmount = Math.min(ENERGY_MAX + FLOOR200_OFFER_ENERGY_GRANT, e.amount + FLOOR200_OFFER_ENERGY_GRANT);
  await setJson(`energy:${address.toLowerCase()}`, { amount: newAmount, lastReset: e.lastReset }, 60 * 60 * 24 * 30);
  await write(address, { status: "consumed", consumedAt: Date.now(), via });
  return { ok: true, energy: newAmount };
}

/** Voucher-pay path: validate ≥25 bRON face value, deduct largest-first,
 *  then grant. Same algorithm as the first-energy / floor-20 offers. */
export async function claimFloor200WithVouchers(
  address: string,
): Promise<{ ok: boolean; reason?: string; energy?: number; deducted?: Record<string, number> }> {
  const cur = await readFloor200Offer(address);
  if (cur.status === "consumed") return { ok: false, reason: "offer already consumed" };
  if (cur.status === "pending") return { ok: false, reason: "floor 200 not yet cleared" };

  const inv = await readShopInventory(address);
  const vchs = inv.vouchers ?? {};
  const total = (vchs.t1 ?? 0) * VOUCHER_VALUES_RON.t1
              + (vchs.t2 ?? 0) * VOUCHER_VALUES_RON.t2
              + (vchs.t3 ?? 0) * VOUCHER_VALUES_RON.t3
              + (vchs.t4 ?? 0) * VOUCHER_VALUES_RON.t4
              + (vchs.t5 ?? 0) * VOUCHER_VALUES_RON.t5;
  if (total < FLOOR200_OFFER_RON_PRICE) {
    return { ok: false, reason: `need ${FLOOR200_OFFER_RON_PRICE} bRON, have ${total}` };
  }

  const deductedOut = await mutateShopInventory<Record<string, number> | null>(address, current => {
    const v = current.vouchers ?? { t1: 0, t2: 0, t3: 0, t4: 0, t5: 0 };
    current.vouchers = v;
    let remaining = FLOOR200_OFFER_RON_PRICE;
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

  const grant = await grantFloor200Bundle(address, "voucher");
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
  return { ok: true, energy: grant.energy, deducted: deductedOut };
}

/** Dev-only helper: clear the offer state so the modal will show again. */
export async function adminResetFloor200Offer(address: string): Promise<void> {
  await del(key(address));
}
