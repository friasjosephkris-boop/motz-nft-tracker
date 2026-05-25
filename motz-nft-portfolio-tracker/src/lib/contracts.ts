export type TrackedCollection = {
  address: `0x${string}`;
  name: string;
  symbol: string;
  slug: string;
  /** Public mint price in RON. */
  mintPriceRon: number;
  /** Public mint date (ISO YYYY-MM-DD, UTC). */
  mintDate: string;
  /** Attribute key used as the rarity/tier filter on this collection. */
  traitName: string;
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
  name: "Fableborne Kingdom",
  symbol: "FK",
  slug: "fableborne-kingdom",
  mintPriceRon: 50,
  // Redemption/airdrop phase concluded Feb 19, 2025 — use that as the
  // canonical mint date for cost-basis lookups.
  mintDate: "2025-02-19",
  traitName: "Rarity",
  // Discovered by sampling ownerOf across the supply: this contract holds
  // ~4.3k of 7.2k Fableborne (~59%).
  stakingContracts: ["0x569899aab0ff89c1711114ba9d7be0774bd23c71"],
};

export const TRACKED_COLLECTIONS: TrackedCollection[] = [
  MOTZ_FOUNDERS_COIN,
  CAMBRIA_CORES,
  FABLEBORNE_KINGDOM,
];
