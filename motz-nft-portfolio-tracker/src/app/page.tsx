"use client";

import { useEffect, useState } from "react";
import { useAccount, useConnect, useDisconnect } from "wagmi";
import dynamic from "next/dynamic";
import Image from "next/image";
import { TabNav, type TabId } from "./_components/TabNav";
import { DashboardView } from "./_components/DashboardView";
import { WalletsView } from "./_components/WalletsView";
import { PnlView } from "./_components/PnlView";
import type { TaggedCollectionHoldings } from "./_components/shared";

// Initial wallet/transferrer values used on first load when no
// localStorage entry exists. Once the user edits, their changes persist
// to localStorage and override these.
const DEFAULT_WALLETS = [
  "markofthezeal.ron",
  "masterofcoin.ron",
  "0x27f4cea185af16f6cf784359e203e0125bea4ffb",
  "motzvault.ron",
  "",
];
const DEFAULT_TRANSFERRERS = [
  "markofthezeal.ron",
  "masterofcoin.ron",
  "0x27f4cea185af16f6cf784359e203e0125bea4ffb",
  "motzvault.ron",
  "0xb7ea94f09f680eb246d3cfcf47d9b4b8acdf23be",
  "0xf885cc3880dfac0d4a7abb4a9d4cf772ad6bbcf7",
];
const WALLETS_LS_KEY = "motz:walletAddresses";
const TRANSFERRERS_LS_KEY = "motz:transferrers";

function readStringArray(key: string, fallback: string[]): string[] {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.every((s) => typeof s === "string")) {
      return parsed;
    }
  } catch {
    /* ignore corrupted entry */
  }
  return fallback;
}

export type LoadedPortfolio = {
  collections: TaggedCollectionHoldings[];
  /** Source label: address shortcode for single, "N wallets combined" for multi. */
  label: string;
  /** Number of source wallets. 1 = single, >1 = combined view. */
  walletCount: number;
  /** Wallet addresses that contributed. */
  addresses: string[];
};

const RainbowConnectButton = dynamic(
  () => import("@rainbow-me/rainbowkit").then((m) => m.ConnectButton),
  { ssr: false, loading: () => null },
);

const hasWalletConnectProject =
  !!process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID;

export default function Home() {
  const [tab, setTab] = useState<TabId>("dashboard");
  // Lifted so loaded data + inputs persist across tab switches. Both lists
  // grow dynamically via "+ Add" buttons (no hard cap). The defaults
  // pre-populate the form on first visit; localStorage takes over once the
  // user edits anything.
  const [walletAddresses, setWalletAddresses] = useState<string[]>(
    DEFAULT_WALLETS,
  );
  const [transferrers, setTransferrers] = useState<string[]>(
    DEFAULT_TRANSFERRERS,
  );

  // Hydrate from localStorage on mount (skipped during SSR so the initial
  // server render uses the defaults and there's no hydration mismatch).
  useEffect(() => {
    setWalletAddresses(readStringArray(WALLETS_LS_KEY, DEFAULT_WALLETS));
    setTransferrers(readStringArray(TRANSFERRERS_LS_KEY, DEFAULT_TRANSFERRERS));
  }, []);

  // Persist changes back to localStorage.
  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(
      WALLETS_LS_KEY,
      JSON.stringify(walletAddresses),
    );
  }, [walletAddresses]);
  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(
      TRANSFERRERS_LS_KEY,
      JSON.stringify(transferrers),
    );
  }, [transferrers]);
  // The single source of truth for what the Dashboard renders. Either tab
  // can write here: Dashboard from its own single-address load, Wallets from
  // its combined load (after which we auto-switch to Dashboard).
  const [loaded, setLoaded] = useState<LoadedPortfolio | null>(null);

  return (
    <div className="relative z-10 flex flex-1 flex-col">
      <header className="flex items-center justify-between border-b border-white/5 px-8 py-4">
        <div className="flex items-center gap-4">
          <Image
            src="/motz/logos/motz-wordmark-horizontal.png"
            alt="MoTZ"
            width={120}
            height={42}
            className="h-10 w-auto"
            priority
          />
          <div>
            <h1 className="font-display text-2xl font-bold leading-tight">
              <span className="text-gradient">NFT Portfolio Tracker</span>
            </h1>
          </div>
        </div>
        {hasWalletConnectProject ? <RainbowConnectButton /> : <SimpleConnect />}
      </header>

      <TabNav active={tab} onChange={setTab} />

      {/* Render all three views always — toggle via CSS so loaded data
          persists across tab switches. */}
      <main className="relative flex-1 px-8 py-8 max-w-[1200px] w-full mx-auto">
        <div className={tab === "dashboard" ? "" : "hidden"}>
          <DashboardView loaded={loaded} setLoaded={setLoaded} />
        </div>
        <div className={tab === "wallets" ? "" : "hidden"}>
          <WalletsView
            addresses={walletAddresses}
            setAddresses={setWalletAddresses}
            transferrers={transferrers}
            setTransferrers={setTransferrers}
            onLoaded={(payload) => {
              setLoaded(payload);
              setTab("dashboard");
            }}
          />
        </div>
        <div className={tab === "pnl" ? "" : "hidden"}>
          <PnlView addresses={walletAddresses} />
        </div>
      </main>

      <footer className="relative z-10 mt-10 border-t border-white/5 px-8 py-6 text-center text-xs text-zinc-500">
        <span className="eyebrow">Powered by MoTZ</span>
      </footer>
    </div>
  );
}

function SimpleConnect() {
  const { address, isConnected } = useAccount();
  const { connectors, connect, isPending } = useConnect();
  const { disconnect } = useDisconnect();
  if (isConnected) {
    return (
      <button
        onClick={() => disconnect()}
        className="chip font-mono text-xs hover:bg-white/10 transition-colors cursor-pointer"
      >
        {address?.slice(0, 6)}…{address?.slice(-4)} · Disconnect
      </button>
    );
  }
  const injected =
    connectors.find((c) => c.type === "injected") ?? connectors[0];
  return (
    <button
      onClick={() => injected && connect({ connector: injected })}
      disabled={!injected || isPending}
      className="btn-primary"
    >
      {isPending ? "Connecting…" : "Connect Wallet"}
    </button>
  );
}
