"use client";

import { useEffect, useState } from "react";
import { useAccount } from "wagmi";
import type { LoadedPortfolio } from "../page";
import {
  ApiResponse,
  CollectionSection,
  LoadingOverlay,
  Stat,
  TaggedCollectionHoldings,
  fmtUsd,
  shortAddr,
  sumRows,
} from "./shared";

export function DashboardView({
  loaded,
  setLoaded,
  holderMode = false,
}: {
  loaded: LoadedPortfolio | null;
  setLoaded: (v: LoadedPortfolio | null) => void;
  /** Pass-through to /api/holdings so manual single-wallet loads on this
   * tab respect holder semantics (unknowns → $0 transfer, no mint-price
   * fallback). The "loaded" payload from the Wallets tab also already
   * reflects holderMode if it was set there. */
  holderMode?: boolean;
}) {
  const { address, isConnected } = useAccount();
  const [manualAddress, setManualAddress] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const target = isConnected ? address : manualAddress;
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (!loading) {
      setElapsed(0);
      return;
    }
    const start = Date.now();
    setElapsed(0);
    const id = setInterval(() => {
      setElapsed(Math.floor((Date.now() - start) / 1000));
    }, 250);
    return () => clearInterval(id);
  }, [loading]);

  async function load(addr: string) {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(
        `/api/holdings?address=${addr}${holderMode ? "&holderMode=true" : ""}`,
      );
      const j: ApiResponse = await r.json();
      if (!r.ok)
        throw new Error((j as unknown as { error: string }).error ?? `HTTP ${r.status}`);
      setLoaded({
        collections: j.collections as TaggedCollectionHoldings[],
        label: shortAddr(j.address),
        walletCount: 1,
        addresses: [j.address],
      });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (isConnected && address) load(address);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isConnected, address]);

  const collections = loaded?.collections ?? [];
  const totalCount = collections.reduce((s, c) => s + c.rows.length, 0);
  const totalCostUsd = sumRows(collections, (r) => r.costUsd);
  const totalFloorUsd = sumRows(collections, (r) => r.floorUsd);
  const totalFloorRon = sumRows(collections, (r) => r.floorRon);
  const totalCostRon = sumRows(collections, (r) => r.costRon);
  const totalPnlUsd = totalFloorUsd - totalCostUsd;
  const totalPnlRon = totalFloorRon - totalCostRon;

  return (
    <div className="space-y-8">
      {!isConnected && (
        <section className="glass-card p-6 space-y-3">
          <h2 className="font-display text-lg font-semibold text-zinc-100">
            Drop a Ronin address or RNS
          </h2>
          <div className="flex gap-2">
            <input
              value={manualAddress}
              onChange={(e) => setManualAddress(e.target.value.trim())}
              onKeyDown={(e) => {
                if (e.key === "Enter" && manualAddress && !loading) {
                  load(manualAddress);
                }
              }}
              placeholder="0x… or RNS"
              className="flex-1 rounded-md bg-black/40 border border-white/10 px-3 py-2 font-mono text-sm placeholder:text-zinc-600 focus:outline-none focus:border-[color:var(--motz-red)] focus:ring-1 focus:ring-[color:var(--motz-red)]/40"
            />
            <button
              onClick={() => target && load(target)}
              disabled={!manualAddress || loading}
              className="btn-primary"
            >
              {loading ? "Loading…" : "Load"}
            </button>
          </div>
        </section>
      )}

      {loading && <LoadingOverlay elapsed={elapsed} />}

      {error && (
        <div className="rounded-md border border-red-900/60 bg-red-950/40 px-4 py-3 text-sm text-red-300">
          {error}
        </div>
      )}

      {loaded && (
        <>
          {/* Source banner: single address or multi-wallet roll-up. */}
          <div className="flex flex-wrap items-baseline justify-between gap-2 text-xs text-zinc-400">
            <div>
              Showing{" "}
              <span className="font-mono text-zinc-200">{loaded.label}</span>
              {loaded.walletCount > 1 && (
                <>
                  {" "}—{" "}
                  <span className="font-mono text-zinc-500">
                    {loaded.addresses.map(shortAddr).join(" · ")}
                  </span>
                </>
              )}
            </div>
            <button
              onClick={() => setLoaded(null)}
              className="font-mono text-[11px] uppercase tracking-wider text-zinc-500 hover:text-zinc-200"
            >
              Clear
            </button>
          </div>

          <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <Stat label="NFTs held" value={String(totalCount)} />
            <Stat label="Cost basis (USD)" value={fmtUsd(totalCostUsd)} />
            <Stat
              label="Floor value"
              value={fmtUsd(totalFloorUsd)}
              hint={`${totalFloorRon.toLocaleString("en-US", { maximumFractionDigits: 2 })} RON`}
              accent="gold"
            />
            <Stat
              label="P&L (USD)"
              value={fmtUsd(totalPnlUsd)}
              hint={`${totalPnlRon >= 0 ? "+" : ""}${totalPnlRon.toLocaleString("en-US", { maximumFractionDigits: 2 })} RON`}
              accent={totalPnlUsd >= 0 ? "pos" : "neg"}
            />
          </section>

          {collections.map((c) => (
            <CollectionSection key={c.contract} c={c} />
          ))}

          {totalCount === 0 && (
            <div className="glass-card p-10 text-center text-zinc-400">
              No tracked NFTs held by this address. Yet.
            </div>
          )}
        </>
      )}
    </div>
  );
}
