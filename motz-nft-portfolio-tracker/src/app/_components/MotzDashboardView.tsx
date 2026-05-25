"use client";

import { useEffect, useState } from "react";
import {
  CollectionSection,
  LoadingOverlay,
  Stat,
  TaggedCollectionHoldings,
  fmtUsd,
  shortAddr,
  sumRows,
} from "./shared";

type SnapshotResponse = {
  generatedAt: number;
  walletAddresses: string[];
  resolvedAddresses: string[];
  collections: TaggedCollectionHoldings[];
  currentRonUsd: number | null;
  walletCount: number;
  stale: boolean;
  error?: string;
};

function fmtRelativeTime(ms: number): string {
  const sec = Math.floor((Date.now() - ms) / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const d = Math.floor(hr / 24);
  return `${d}d ago`;
}

export function MotzDashboardView() {
  const [snap, setSnap] = useState<SnapshotResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (!loading) {
      setElapsed(0);
      return;
    }
    const start = Date.now();
    const id = setInterval(() => {
      setElapsed(Math.floor((Date.now() - start) / 1000));
    }, 250);
    return () => clearInterval(id);
  }, [loading]);

  async function fetchSnap(force: boolean) {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(
        force ? "/api/motz-snapshot" : "/api/motz-snapshot?stale=ok",
        force ? { method: "POST" } : { cache: "no-store" },
      );
      const j = (await r.json()) as SnapshotResponse;
      if (!r.ok || j.error) {
        throw new Error(j.error ?? `HTTP ${r.status}`);
      }
      setSnap(j);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchSnap(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const collections = snap?.collections ?? [];
  const totalCount = collections.reduce((s, c) => s + c.rows.length, 0);
  const totalCostUsd = sumRows(collections, (r) => r.costUsd);
  const totalFloorUsd = sumRows(collections, (r) => r.floorUsd);
  const totalFloorRon = sumRows(collections, (r) => r.floorRon);
  const totalCostRon = sumRows(collections, (r) => r.costRon);
  const totalPnlUsd = totalFloorUsd - totalCostUsd;
  const totalPnlRon = totalFloorRon - totalCostRon;

  return (
    <div className="space-y-8">
      <section className="glass-card p-6 space-y-3">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h2 className="font-display text-lg font-semibold text-zinc-100">
              MoTZ Dashboard
            </h2>
            <p className="text-xs text-zinc-500">
              Project portfolio snapshot. Auto-refreshes every 24 hours.
              {snap && (
                <>
                  {" "}Last update:{" "}
                  <span className="font-mono text-zinc-300">
                    {fmtRelativeTime(snap.generatedAt)}
                  </span>
                  {snap.stale && (
                    <span className="ml-2 rounded-md border border-amber-700/40 bg-amber-950/40 px-2 py-0.5 text-[10px] font-mono uppercase text-amber-300">
                      stale
                    </span>
                  )}
                </>
              )}
            </p>
          </div>
          <button
            onClick={() => fetchSnap(true)}
            disabled={loading}
            className="btn-primary"
          >
            {loading ? "Refreshing…" : "Refresh"}
          </button>
        </div>
      </section>

      {loading && <LoadingOverlay elapsed={elapsed} />}

      {error && (
        <div className="rounded-md border border-red-900/60 bg-red-950/40 px-4 py-3 text-sm text-red-300 whitespace-pre-wrap break-words">
          {error}
        </div>
      )}

      {snap && (
        <>
          <div className="flex flex-wrap items-baseline justify-between gap-2 text-xs text-zinc-400">
            <div>
              {snap.walletCount === 1 ? (
                <>
                  Showing{" "}
                  <span className="font-mono text-zinc-200">
                    {shortAddr(snap.resolvedAddresses[0])}
                  </span>
                </>
              ) : (
                <>
                  Showing{" "}
                  <span className="font-mono text-zinc-200">
                    {snap.walletCount} wallets combined
                  </span>{" "}
                  —{" "}
                  <span className="font-mono text-zinc-500">
                    {snap.resolvedAddresses.map(shortAddr).join(" · ")}
                  </span>
                </>
              )}
            </div>
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
              No tracked NFTs in the snapshot yet. Hit Refresh to generate one.
            </div>
          )}
        </>
      )}
    </div>
  );
}
