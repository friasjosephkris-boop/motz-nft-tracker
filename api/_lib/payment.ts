// RON payment verification for the shop. Players send RON to the treasury
// wallet, then post the tx hash to /api/run/floor-cleared shop_buy. The server
// verifies the receipt on-chain BEFORE granting the item.
//
// Anti-cheat checks:
//   - txHash hasn't been used in any prior purchase (Redis nonce set)
//   - Receipt status is success
//   - Receipt `to` matches the canonical treasury wallet
//   - Receipt `from` matches the authenticated session wallet
//   - Receipt `value` is at LEAST the item's price in wei
//   - Receipt has settled on-chain (any non-pending status counts;
//     we additionally verify the block has at least N confirmations)
//
// Devtools-proof: nothing on the client can fake a tx hash that, when
// re-fetched from Ronin RPC, matches all five checks. The worst a tampered
// client can do is submit a real tx hash that fails one of the checks,
// which is rejected.

import { client as roninClient } from "./ronin.js";
import { TREASURY_WALLET } from "./treasury.js";
import { getJson, setJson } from "./redis.js";
import { getAddress } from "viem";
import type { ShopItemId } from "./runState.js";

/** Per-item price in wei (1 RON = 10^18 wei). Source of truth on the server. */
export const ITEM_PRICES_WEI: Record<ShopItemId, bigint> = {
  energy_5:  5n  * 10n ** 18n,
  energy_10: 10n * 10n ** 18n,
  energy_20: 20n * 10n ** 18n,
  energy_first_offer: 20n * 10n ** 18n,    // one-time first-offer bundle: 35 energy for 20 RON
  energy_floor200_offer: 25n * 10n ** 18n, // one-time floor-200 bundle: 50 energy for 25 RON
  floor20_offer_bundle: 20n * 10n ** 18n,  // one-time floor-20 bundle: all campaign buffs for 20 RON
  unit_stat_reset:    10n * 10n ** 18n,
  unit_class_change:  10n * 10n ** 18n,
  unit_temp_motz_key: 40n * 10n ** 18n,
  buff_battle_cry:        10n * 10n ** 18n,
  buff_phoenix_embers:    10n * 10n ** 18n,
  buff_scholars_insight:  10n * 10n ** 18n,
  buff_quickdraw:         10n * 10n ** 18n,
  buff_last_stand:        10n * 10n ** 18n,
};

/** Minimum block confirmations before we trust a tx. Ronin has ~3s blocks;
 *  3 confirmations ≈ 9 seconds finality — safe vs. reorgs without making
 *  the player wait forever for a Buy click to resolve. */
const REQUIRED_CONFIRMATIONS = 3n;

/** Used-tx-hash store: prevents replaying the same payment for multiple
 *  item grants. Keyed per-hash with a 1-year TTL (way longer than needed,
 *  but harmless and gives us a nice audit log). */
const USED_TX_TTL_SECONDS = 60 * 60 * 24 * 365;
function usedTxKey(txHash: string): string {
  return `paymenttx:${txHash.toLowerCase()}`;
}

interface UsedTxRecord {
  buyer: string;
  itemId: string;
  amountWei: string;
  consumedAt: number;
}

export async function isTxHashUsed(txHash: string): Promise<boolean> {
  const rec = await getJson<UsedTxRecord>(usedTxKey(txHash));
  return rec !== null;
}

async function markTxHashUsed(txHash: string, rec: UsedTxRecord): Promise<void> {
  await setJson(usedTxKey(txHash), rec, USED_TX_TTL_SECONDS);
}

export type VerifyResult =
  | { ok: true; valueWei: bigint }
  | { ok: false; reason: string; pending?: boolean };

/** Pulls the receipt from Ronin RPC and validates every constraint. Does NOT
 *  mark the hash as used — caller does that after granting the item to keep
 *  validation and item grant atomic (a failed grant lets the player retry). */
export async function verifyShopPayment(
  txHash: string,
  expectedFrom: string,
  itemId: ShopItemId,
): Promise<VerifyResult> {
  // Shape check on the hash first — short-circuit obvious junk before RPC.
  if (typeof txHash !== "string" || !/^0x[a-fA-F0-9]{64}$/.test(txHash)) {
    return { ok: false, reason: "bad tx hash format" };
  }
  // Replay guard.
  if (await isTxHashUsed(txHash)) {
    return { ok: false, reason: "tx already used for a prior purchase" };
  }

  // Use viem's waitForTransactionReceipt so we transparently poll for the
  // receipt — broadcasting wallets return a tx hash before nodes index it,
  // and our RPC node can lag a few seconds behind the chain head. We give
  // it ~8 seconds with confirmation depth = REQUIRED_CONFIRMATIONS. If the
  // receipt still isn't visible after that window, we tell the caller to
  // retry by setting `pending: true`. Vercel's serverless function timeout
  // (10s on Hobby) is the upper bound here — keep the wait conservative.
  let receipt: Awaited<ReturnType<typeof roninClient.waitForTransactionReceipt>>;
  let tx: Awaited<ReturnType<typeof roninClient.getTransaction>>;
  try {
    receipt = await roninClient.waitForTransactionReceipt({
      hash: txHash as `0x${string}`,
      confirmations: Number(REQUIRED_CONFIRMATIONS),
      timeout: 8_000,
      pollingInterval: 1_500,
    });
    tx = await roninClient.getTransaction({ hash: txHash as `0x${string}` });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown";
    // viem throws TransactionReceiptNotFoundError / WaitForTransactionReceiptTimeoutError
    // when the tx hasn't been indexed yet. Surface that as a retryable
    // "pending" so the client polls again rather than treating it as failure.
    if (/TransactionReceiptNotFound|WaitForTransactionReceiptTimeout|TransactionNotFound|timed?\s*out|could not be found|may not be processed|to be confirmed/i.test(msg)) {
      return {
        ok: false,
        pending: true,
        reason: "transaction not yet confirmed on-chain — still waiting for the network",
      };
    }
    return { ok: false, reason: `rpc error: ${msg}` };
  }
  if (!receipt) return { ok: false, pending: true, reason: "tx not found on-chain yet" };
  if (receipt.status !== "success") return { ok: false, reason: `tx reverted (status: ${receipt.status})` };
  if (!tx) return { ok: false, reason: "tx body not retrievable" };

  // `to` must be the treasury wallet.
  const to = receipt.to ? getAddress(receipt.to) : null;
  if (to !== TREASURY_WALLET) {
    return { ok: false, reason: `tx sent to ${to ?? "<null>"}, not the treasury ${TREASURY_WALLET}` };
  }

  // `from` must be the authenticated session wallet.
  let expected: string;
  try {
    expected = getAddress(expectedFrom);
  } catch {
    return { ok: false, reason: "bad expectedFrom address" };
  }
  const from = receipt.from ? getAddress(receipt.from) : null;
  if (from !== expected) {
    return { ok: false, reason: `tx sent from ${from ?? "<null>"}, not the session wallet ${expected}` };
  }

  // `value` must be at least the item's price. We allow over-payment (player
  // tips, decimal rounding above price) but never under-payment.
  const expectedWei = ITEM_PRICES_WEI[itemId];
  if (expectedWei === undefined) {
    return { ok: false, reason: `unknown item id ${itemId} (no price set)` };
  }
  if (tx.value < expectedWei) {
    return { ok: false, reason: `paid ${tx.value} wei, need ${expectedWei} wei` };
  }

  return { ok: true, valueWei: tx.value };
}

/** Mark the tx as consumed. Call AFTER the item has been successfully granted
 *  so a server-side grant failure doesn't burn the player's payment.
 *  Idempotent via setJson's overwrite — re-marking the same hash is harmless. */
export async function consumeTxHash(
  txHash: string,
  buyer: string,
  itemId: string,
  amountWei: bigint,
): Promise<void> {
  await markTxHashUsed(txHash, {
    buyer: buyer.toLowerCase(),
    itemId,
    amountWei: amountWei.toString(),
    consumedAt: Date.now(),
  });
}

/** Helper for the client / UI to display the price in human RON units. */
export function priceWeiToRonString(wei: bigint): string {
  // Divide by 10^18 with 4 decimal precision, trim trailing zeros.
  const whole = wei / 10n ** 18n;
  const frac = wei % 10n ** 18n;
  if (frac === 0n) return whole.toString();
  const fracStr = (frac + 10n ** 18n).toString().slice(1).replace(/0+$/, "");
  return `${whole}.${fracStr}`;
}
