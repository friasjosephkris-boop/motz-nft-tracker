"use client";

import { useEffect, useState } from "react";
import { useAccount, useConnect, useDisconnect } from "wagmi";
import dynamic from "next/dynamic";
import Image from "next/image";
import { TabNav, type TabId } from "./_components/TabNav";
import { DashboardView } from "./_components/DashboardView";
import { WalletsView } from "./_components/WalletsView";
import { PnlView } from "./_components/PnlView";
import { MotzDashboardView } from "./_components/MotzDashboardView";
import { MotzWalletView } from "./_components/MotzWalletView";
import type { TaggedCollectionHoldings } from "./_components/shared";

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

// Holder-side form persists to localStorage so visitors don't lose input
// across tab switches / reloads. The MoTZ-side data is server-cached and
// has no input fields, so nothing to persist there.
const HOLDER_WALLETS_LS_KEY = "motz:holder:walletAddresses";
const HOLDER_TRANSFERRERS_LS_KEY = "motz:holder:transferrers";

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

export default function Home() {
  const [tab, setTab] = useState<TabId>("motz-dashboard");

  // Holder-side state (visitor input + loaded portfolio).
  const [holderWalletAddresses, setHolderWalletAddresses] = useState<string[]>([
    "",
  ]);
  const [holderTransferrers, setHolderTransferrers] = useState<string[]>([""]);
  const [holderLoaded, setHolderLoaded] = useState<LoadedPortfolio | null>(
    null,
  );

  // Hydrate holder form state from localStorage on mount.
  useEffect(() => {
    setHolderWalletAddresses(readStringArray(HOLDER_WALLETS_LS_KEY, [""]));
    setHolderTransferrers(readStringArray(HOLDER_TRANSFERRERS_LS_KEY, [""]));
  }, []);
  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(
      HOLDER_WALLETS_LS_KEY,
      JSON.stringify(holderWalletAddresses),
    );
  }, [holderWalletAddresses]);
  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(
      HOLDER_TRANSFERRERS_LS_KEY,
      JSON.stringify(holderTransferrers),
    );
  }, [holderTransferrers]);

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

      {/* All 6 views render concurrently but only one is visible at a time
          (CSS toggle). Keeps loaded state / fetched snapshots resident
          across tab switches without re-mounting. */}
      <main className="relative flex-1 px-8 py-8 max-w-[1200px] w-full mx-auto">
        {/* MoTZ side — read-only project snapshot. */}
        <div className={tab === "motz-dashboard" ? "" : "hidden"}>
          <MotzDashboardView />
        </div>
        <div className={tab === "motz-pnl" ? "" : "hidden"}>
          <PnlView
            addresses={[]}
            titleOverride="MoTZ PnL Chart"
            subtitleOverride="Project P&L over time. Auto-refreshes with the MoTZ Dashboard snapshot."
          />
        </div>
        <div className={tab === "motz-wallet" ? "" : "hidden"}>
          <MotzWalletView />
        </div>

        {/* Holder side — visitor's own input. */}
        <div className={tab === "holder-dashboard" ? "" : "hidden"}>
          <DashboardView
            loaded={holderLoaded}
            setLoaded={setHolderLoaded}
            holderMode
          />
        </div>
        <div className={tab === "holder-pnl" ? "" : "hidden"}>
          <PnlView
            addresses={holderWalletAddresses}
            titleOverride="Holder's PnL Chart"
            subtitleOverride="Your P&L over time, reconstructed from on-chain history."
          />
        </div>
        <div className={tab === "holder-wallet" ? "" : "hidden"}>
          <WalletsView
            addresses={holderWalletAddresses}
            setAddresses={setHolderWalletAddresses}
            transferrers={holderTransferrers}
            setTransferrers={setHolderTransferrers}
            onLoaded={(payload) => {
              setHolderLoaded(payload);
              setTab("holder-dashboard");
            }}
            holderMode
            title="Holder's Wallets"
            subtitle="Paste your Ronin address(es) or RNS. Anything you didn't mint or buy stays as a transfer with $0 cost."
          />
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
