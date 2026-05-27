import "server-only";

/**
 * Manual cost-basis overrides for tokens acquired via off-chain channels
 * (P2P trades, OTC deals, gifts with agreed-upon valuation, etc.).
 *
 * When a token is held by a tracked MoTZ wallet but on-chain sale history
 * doesn't reflect the true price (e.g. a private trade), add an entry here.
 * The snapshot route applies these overrides AFTER the standard cost-basis
 * pipeline has run, so they always win.
 *
 * Shape: contract address (lowercase) → tokenId (string) → override.
 *
 * Override fields:
 *   - cost:    native-coin amount you paid (RON for Ronin, ETH for Ethereum)
 *   - via:     "sale" (Bought chip) | "transfer" | "mint" — usually "sale"
 *              for P2P purchases
 *   - acquiredAtIso (optional): ISO date string. Used for the historical
 *              USD/coin lookup. If omitted, defaults to "now".
 *   - note (optional): free-form context for future maintainers. Not
 *              displayed in the UI; just helps you remember WHY.
 *
 * Edit this file, commit it, and the next snapshot refresh will pick up
 * the changes. No re-fetch from OpenSea needed.
 */

export type ManualCostOverride = {
  cost: number;
  via?: "sale" | "transfer" | "mint";
  acquiredAtIso?: string;
  note?: string;
};

export const MANUAL_COST_OVERRIDES: Record<
  string,
  Record<string, ManualCostOverride>
> = {
  // Example (uncomment and adapt):
  //
  // // Cambria Islands (Ethereum). All keys lowercase contract addresses.
  // "0xd479cc4b52a692b4dd82ead6ae082e161ac7c049": {
  //   // P2P trade with frienly#1234 on Discord — paid 1.2 ETH off-chain.
  //   "5499": {
  //     cost: 1.2,
  //     via: "sale",
  //     acquiredAtIso: "2026-01-15",
  //     note: "Discord P2P trade — frienly#1234",
  //   },
  // },
};

/**
 * Lookup helper. Returns the override entry for a given (contract, tokenId)
 * or null. Both args are lowercased for matching.
 */
export function lookupManualCost(
  contract: string,
  tokenId: string,
): ManualCostOverride | null {
  const c = contract.toLowerCase();
  const byContract = MANUAL_COST_OVERRIDES[c];
  if (!byContract) return null;
  return byContract[String(tokenId)] ?? null;
}
