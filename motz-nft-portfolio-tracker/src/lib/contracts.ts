/**
 * Chain identifier. Ronin collections go through the Sky Mavis pipeline;
 * "ethereum" collections go through the OpenSea pipeline. Most fields are
 * shared; chain-specific fields are noted.
 */
export type ChainId = "ronin" | "ethereum";

export type TrackedCollection = {
  address: `0x${string}`;
  /** Defaults to "ronin" for back-compat with the existing Ronin pipeline. */
  chain?: ChainId;
  name: string;
  symbol: string;
  slug: string;
  /** Public mint price in the chain's native currency (RON for ronin, ETH for ethereum). */
  mintPriceRon: number;
  /** Public mint date (ISO YYYY-MM-DD, UTC). */
  mintDate: string;
  /** Attribute key used as the rarity/tier filter on this collection. */
  traitName: string;
  /**
   * Optional override attribute. When a token has this attribute set, its
   * value takes precedence over `traitName` for rarity/floor lookups.
   * Example: Moki Genesis uses "Fur" as the bulk tier, but the 27 named
   * "1 of 1" tokens get their own per-name floor via this override.
   */
  overrideTraitName?: string;
  /** Optional display formatter for a raw trait value (e.g. "1" → "Tier 1"). */
  formatTrait?: (value: string) => string;
  /**
   * Optional staking contract addresses. When the user's acquired tokens are
   * currently held by any of these contracts on-chain, we count them as
   * "staked" in the portfolio (and keep the user's original cost basis).
   */
  stakingContracts?: `0x${string}`[];
};

export const MOTZ_FOUNDERS_COIN: TrackedCollection = {
  address: "0x712b0029a1763ef2aac240a39091bada6bdae4f8",
  name: "Mark of The Zeal Founders Coin",
  symbol: "MoTZ",
  slug: "motz-founders-coin",
  mintPriceRon: 35,
  mintDate: "2025-01-22",
  traitName: "Rarity",
};

export const CAMBRIA_CORES: TrackedCollection = {
  address: "0x17f93440990354a442369d56baeb20ab56e73ab1",
  name: "Cambria Cores",
  symbol: "CC",
  slug: "cambria-cores",
  mintPriceRon: 20,
  mintDate: "2024-12-20",
  traitName: "Tier",
  formatTrait: (v) => `Tier ${v}`,
  // Cambria has two staking contracts (discovered by sampling ownerOf across
  // the supply — together they hold ~9.5k of 10k Cambria).
  stakingContracts: [
    "0x036dce26656e7c4308da764176229f6d9ca7f157", // 19KB, ~8.4k tokens
    "0x85405d9078876e5f9f580a48f5774bea2c0047a6", // 16KB, ~1.05k tokens
  ],
};

export const FABLEBORNE_KINGDOM: TrackedCollection = {
  address: "0x727b7ff568e7173134eb02517c4a87eac390a77b",
  name: "Fableborne Kingdoms",
  symbol: "FK",
  slug: "fableborne-kingdoms",
  mintPriceRon: 50,
  // Redemption/airdrop phase concluded Feb 19, 2025 — use that as the
  // canonical mint date for cost-basis lookups.
  mintDate: "2025-02-19",
  traitName: "Rarity",
  // Discovered by sampling ownerOf across the supply: this contract holds
  // ~4.3k of 7.2k Fableborne (~59%).
  stakingContracts: ["0x569899aab0ff89c1711114ba9d7be0774bd23c71"],
};

export const MOKI_GENESIS: TrackedCollection = {
  address: "0x47b5a7c2e4f07772696bbf8c8c32fe2b9eabd550",
  name: "Moki Genesis",
  symbol: "MOKI",
  slug: "moki-genesis",
  // 55 RON public/lucksack mint price on July 9, 2024 (~$150 USD at the time).
  mintPriceRon: 55,
  mintDate: "2024-07-09",
  // Moki uses "Fur" as the broad rarity tier (14 variants: Spirit rarest
  // → Light Brown most common). The 27 named uniques carry a "1 of 1"
  // attribute — we surface that name as the rarity LABEL but explicitly
  // skip floor lookups for these tokens (there's only one of each, so
  // no comparable floor exists). PnL stays null by design.
  traitName: "Fur",
  overrideTraitName: "1 of 1",
};

export const CAMBRIA_ISLANDS: TrackedCollection = {
  address: "0xd479cc4b52a692b4dd82ead6ae082e161ac7c049",
  chain: "ethereum",
  name: "Cambria Islands",
  symbol: "CI",
  slug: "cambriaislands",
  // 0.1 ETH public mint price.
  mintPriceRon: 0.1,
  mintDate: "2025-10-23",
  // Rarity trait unknown until first metadata fetch. Update once known.
  traitName: "Rarity",
};

/** Ronin-only collections (Sky Mavis pipeline). */
export const TRACKED_COLLECTIONS: TrackedCollection[] = [
  MOTZ_FOUNDERS_COIN,
  CAMBRIA_CORES,
  FABLEBORNE_KINGDOM,
  MOKI_GENESIS,
];

/** Ethereum collections (OpenSea pipeline). Tracked separately so the
 * Ronin code paths don't accidentally pull these in. */
export const ETH_TRACKED_COLLECTIONS: TrackedCollection[] = [
  CAMBRIA_ISLANDS,
];

/** All tracked collections across all chains. */
export const ALL_TRACKED_COLLECTIONS: TrackedCollection[] = [
  ...TRACKED_COLLECTIONS,
  ...ETH_TRACKED_COLLECTIONS,
];

/** Helper: pick the correct collection list for a given chain. */
export function collectionsForChain(chain: ChainId): TrackedCollection[] {
  return chain === "ethereum" ? ETH_TRACKED_COLLECTIONS : TRACKED_COLLECTIONS;
}
