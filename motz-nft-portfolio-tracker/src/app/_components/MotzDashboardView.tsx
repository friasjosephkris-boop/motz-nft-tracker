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
  failures?: { input: string; error: string }[];
  partials?: { input: string; tokens: number; warnings: string[] }[];
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

      {((snap?.failures && snap.failures.length > 0) ||
        (snap?.partials && snap.partials.length > 0)) && (
        <div className="rounded-md border border-amber-900/60 bg-amber-950/30 px-4 py-3 text-sm text-amber-200 whitespace-pre-wrap break-words space-y-3">
          {snap?.failures && snap.failures.length > 0 && (
            <div>
              <div className="font-mono text-[11px] uppercase tracking-wider text-amber-300 mb-1">
                Failed — {snap.failures.length} of {snap.walletAddresses.length} wallets did not load
              </div>
              {snap.failures.map((f) => (
                <div key={f.input} className="text-xs">
                  <span className="font-mono text-amber-100">{f.input}</span>:{" "}
                  {f.error}
                </div>
              ))}
            </div>
          )}
          {snap?.partials && snap.partials.length > 0 && (
            <div>
              <div className="font-mono text-[11px] uppercase tracking-wider text-amber-300 mb-1">
                Partial — {snap.partials.length} wallet(s) loaded with internal rate-limits
              </div>
              {snap.partials.map((p) => (
                <details key={p.input} className="text-xs">
                  <summary className="cursor-pointer hover:text-amber-50">
                    <span className="font-mono text-amber-100">{p.input}</span>
                    {" — "}
                    <span className="font-mono">{p.tokens}</span> tokens loaded,{" "}
                    <span className="font-mono">{p.warnings.length}</span>{" "}
                    internal warning(s)
                  </summary>
                  <ul className="ml-4 mt-1 list-disc list-inside text-amber-300/80 space-y-0.5">
                    {p.warnings.slice(0, 8).map((w, i) => (
                      <li key={i} className="break-words">
                        {w}
                      </li>
                    ))}
                    {p.warnings.length > 8 && (
                      <li className="italic">
                        …{p.warnings.length - 8} more
                      </li>
                    )}
                  </ul>
                </details>
              ))}
            </div>
          )}
        </div>
      )}

      {snap && (
        <>
          {(() => {
            // Only count wallets that contributed at least one token —
            // a "resolved" wallet with zero tokens means its load failed
            // silently and shouldn't inflate the wallet count.
            const tokensByWallet = new Map<string, number>();
            for (const c of collections) {
              for (const r of c.rows) {
                if (!r.walletTag) continue;
                tokensByWallet.set(
                  r.walletTag,
                  (tokensByWallet.get(r.walletTag) ?? 0) + 1,
                );
              }
            }
            const contributors = Array.from(tokensByWallet.keys());
            return (
              <div className="flex flex-wrap items-baseline justify-between gap-2 text-xs text-zinc-400">
                <div>
                  {contributors.length === 0 ? (
                    <span className="font-mono text-zinc-200">
                      No wallets contributed tokens
                    </span>
                  ) : contributors.length === 1 ? (
                    <>
                      Showing{" "}
                      <span className="font-mono text-zinc-200">
                        {shortAddr(contributors[0])}
                      </span>
                    </>
                  ) : (
                    <>
                      Showing{" "}
                      <span className="font-mono text-zinc-200">
                        {contributors.length} wallet
                        {contributors.length > 1 ? "s" : ""} combined
                      </span>{" "}
                      —{" "}
                      <span className="font-mono text-zinc-500">
                        {contributors.map(shortAddr).join(" · ")}
                      </span>
                    </>
                  )}
                </div>
              </div>
            );
          })()}

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
