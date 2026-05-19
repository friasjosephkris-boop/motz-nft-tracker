// One-time first-energy-bundle offer.
//
// Triggered the first time a player hits 0 energy. Offers 35 energy for
// 20 RON (on-chain) OR 20 bRON in vouchers (off-chain). Strictly one shot —
// once any of {claim, dismiss} happens, the offer is gone forever for that
// wallet. The client must show a clear "this is a one-time offer" warning.
//
// State (Redis JSON at `firstoffer:<wallet>`):
//   { status: "available" | "shown" | "consumed", consumedAt?: number, via?: "ron"|"voucher"|"dismiss" }
//
// "available" = never displayed
// "shown"     = modal opened at least once but no decision yet (so a refresh
//               brings it back — players shouldn't lose the offer to a
//               misclick / reload before they pick)
// "consumed"  = claimed or dismissed; never offer again

import { getJson, setJson, del } from "./redis.js";
import { readShopInventory, writeShopInventory, mutateShopInventory, VOUCHER_VALUES_RON } from "./runState.js";
import { getEnergy, ENERGY_MAX } from "./energy.js";
import { setJson as setRedis } from "./redis.js";

export const FIRST_OFFER_ENERGY_GRANT = 35;
export const FIRST_OFFER_RON_PRICE = 20; // whole RON (also bRON face value)

export type FirstOfferStatus = "available" | "shown" | "consumed";

interface FirstOfferState {
  status: FirstOfferStatus;
  consumedAt?: number;
  via?: "ron" | "voucher" | "dismiss";
}

function key(address: string): string { return `firstoffer:${address.toLowerCase()}`; }

export async function readOffer(address: string): Promise<FirstOfferState> {
  const raw = await getJson<FirstOfferState>(key(address));
  if (!raw) return { status: "available" };
  if (raw.status !== "available" && raw.status !== "shown" && raw.status !== "consumed") {
    return { status: "available" };
  }
  return raw;
}

async function write(address: string, state: FirstOfferState): Promise<void> {
  // 1-year TTL — long enough that the "one-time" promise persists across any
  // reasonable inactivity window, short enough that abandoned wallets free up.
  await setJson(key(address), state, 60 * 60 * 24 * 365);
}

/** Mark the offer as "shown" so a refresh keeps the modal available until the
 *  player explicitly picks (claim or dismiss). Idempotent. */
export async function markOfferShown(address: string): Promise<FirstOfferState> {
  const cur = await readOffer(address);
  if (cur.status === "available") {
    const next: FirstOfferState = { status: "shown" };
    await write(address, next);
    return next;
  }
  return cur;
}

/** Mark the offer permanently consumed via dismissal. */
export async function dismissOffer(address: string): Promise<FirstOfferState> {
  const cur = await readOffer(address);
  if (cur.status === "consumed") return cur; // already gone
  const next: FirstOfferState = { status: "consumed", consumedAt: Date.now(), via: "dismiss" };
  await write(address, next);
  return next;
}

/** Grant the bundle: +35 energy and mark consumed. Caller must have already
 *  verified payment (on-chain RON tx OR consumed enough vouchers).
 *  Idempotency: if the offer is already consumed, this returns a refusal so
 *  the caller can refund / log. */
export async function grantOfferBundle(
  address: string,
  via: "ron" | "voucher",
): Promise<{ ok: boolean; reason?: string; energy?: number }> {
  const cur = await readOffer(address);
  if (cur.status === "consumed") {
    return { ok: false, reason: "offer already consumed" };
  }
  // Add energy DIRECTLY (not into inventory as a pack). Cap at the max so
  // the bonus is always meaningful but doesn't overflow into stockpiling.
  const e = await getEnergy(address);
  const newAmount = Math.min(ENERGY_MAX + FIRST_OFFER_ENERGY_GRANT, e.amount + FIRST_OFFER_ENERGY_GRANT);
  // Re-use the energy storage shape used elsewhere in api/_lib (mirrors
  // setEnergyAmount in daily.ts — we don't import a setter because energy
  // is keyed locally).
  await setRedis(`energy:${address.toLowerCase()}`, { amount: newAmount, lastReset: e.lastReset }, 60 * 60 * 24 * 30);
  await write(address, { status: "consumed", consumedAt: Date.now(), via });
  return { ok: true, energy: newAmount };
}

/** Voucher-pay path: validate the player has enough vouchers to cover the
 *  20 bRON price, deduct them, then grant. The deduction algorithm prefers
 *  smaller tiers first so high-tier vouchers stay for bigger purchases. */
export async function claimWithVouchers(address: string): Promise<{ ok: boolean; reason?: string; energy?: number; deducted?: Record<string, number> }> {
  const cur = await readOffer(address);
  if (cur.status === "consumed") return { ok: false, reason: "offer already consumed" };

  // Pre-flight: confirm wallet has at least 20 bRON face value in vouchers.
  const inv = await readShopInventory(address);
  const vchs = inv.vouchers ?? {};
  const total = (vchs.t1 ?? 0) * VOUCHER_VALUES_RON.t1
              + (vchs.t2 ?? 0) * VOUCHER_VALUES_RON.t2
              + (vchs.t3 ?? 0) * VOUCHER_VALUES_RON.t3
              + (vchs.t4 ?? 0) * VOUCHER_VALUES_RON.t4
              + (vchs.t5 ?? 0) * VOUCHER_VALUES_RON.t5;
  if (total < FIRST_OFFER_RON_PRICE) {
    return { ok: false, reason: `need ${FIRST_OFFER_RON_PRICE} bRON, have ${total}` };
  }

  // Greedy deduction: largest-tier-first to minimize voucher count consumed
  // (a single t3 covers the whole 20 bRON cleanly, no change needed).
  // Tracks the deducted amounts so we can return them for the success modal.
  const deductedOut = await mutateShopInventory<Record<string, number> | null>(address, current => {
    const v = current.vouchers ?? { t1: 0, t2: 0, t3: 0, t4: 0, t5: 0 };
    current.vouchers = v;
    let remaining = FIRST_OFFER_RON_PRICE;
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
    // Overshoot fallback: if remaining > 0 (e.g. only t3=20 vouchers left for
    // a remaining 5), spend the smallest tier ≥ remaining. Player effectively
    // overpays but the bundle is still cheap so it's a non-issue.
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

  // Grant + mark consumed.
  const grant = await grantOfferBundle(address, "voucher");
  if (!grant.ok) {
    // Race: someone else consumed between pre-flight and here. Roll back the
    // voucher deduction so the player isn't double-charged. (Unlikely with
    // the per-wallet lock, but defensive.)
    const refund = deductedOut;
    await mutateShopInventory(address, current => {
      const v = current.vouchers ?? { t1: 0, t2: 0, t3: 0, t4: 0, t5: 0 };
      current.vouchers = v;
      v.t1 = (v.t1 ?? 0) + (refund.t1 ?? 0);
      v.t2 = (v.t2 ?? 0) + (refund.t2 ?? 0);
      v.t3 = (v.t3 ?? 0) + (refund.t3 ?? 0);
      v.t4 = (v.t4 ?? 0) + (refund.t4 ?? 0);
      v.t5 = (v.t5 ?? 0) + (refund.t5 ?? 0);
      return { next: current, result: true };
    });
    return { ok: false, reason: grant.reason };
  }
  return { ok: true, energy: grant.energy, deducted: deductedOut };
}

/** Dev-only helper: clear the offer state so the modal will show again. */
export async function adminResetOffer(address: string): Promise<void> {
  await del(key(address));
}

// (Imports satisfied; readShopInventory + writeShopInventory exposed for
//  future extension, ENERGY_MAX referenced for the cap formula.)
void readShopInventory; void writeShopInventory; void ENERGY_MAX;
