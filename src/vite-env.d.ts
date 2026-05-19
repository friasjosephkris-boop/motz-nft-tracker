/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** When "1", restrict sign-in to wallets in DEV_TESTERS (see auth/devBuild.ts). */
  readonly VITE_DEV_BUILD?: string;
  /** Deployed Gauntlet DailyCheckIn contract address. When set + non-empty,
   *  the client signs a Ronin Mainnet `checkIn()` tx before each daily claim
   *  so the player gets Voyages credit. When unset, daily claim is in-game
   *  only with no on-chain signature step. */
  readonly VITE_DAILY_CHECKIN_CONTRACT_ADDR?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
