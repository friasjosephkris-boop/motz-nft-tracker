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

  // Drill-down state: when a tile is clicked, restrict the entire view to
  // that one collection (filtered totals + only its tile + auto-expanded
  // section). Setting back to null returns to the all-collections view.
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);

  // Owner filter: when set, restrict every row across every collection to
  // only those tagged with this wallet address. Works orthogonally with
  // the collection drill-down — user can filter to one owner AND one
  // collection simultaneously.
  const [ownerFilter, setOwnerFilter] = useState<string>("all");

  const rawCollections = snap?.collections ?? [];

  // Build owner dropdown options from the snapshot's resolved addresses.
  // Maps resolved (0x…) back to its original RNS / hex input from
  // walletAddresses[i] for a friendly label.
  const ownerOptions: { value: string; label: string }[] = [];
  if (snap) {
    for (let i = 0; i < snap.resolvedAddresses.length; i++) {
      const resolved = snap.resolvedAddresses[i];
      const input = snap.walletAddresses[i] ?? "";
      ownerOptions.push({
        value: resolved.toLowerCase(),
        label: input || shortAddr(resolved),
      });
    }
  }

  // Apply owner filter — strip rows where walletTag doesn't match.
  // Collections that end up empty after the filter are dropped from the
  // display entirely so we don't show zero-token tiles + sections.
  const ownerFilteredCollections =
    ownerFilter === "all"
      ? rawCollections
      : rawCollections
          .map((c) => ({
            ...c,
            rows: c.rows.filter(
              (r) => (r.walletTag ?? "").toLowerCase() === ownerFilter,
            ),
          }))
          .filter((c) => c.rows.length > 0);

  const allCollections = ownerFilteredCollections;
  const collections = selectedSlug
    ? allCollections.filter((c) => c.slug === selectedSlug)
    : allCollections;
  const selectedCollection = selectedSlug
    ? allCollections.find((c) => c.slug === selectedSlug)
    : null;

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
                {/* Owner filter — narrows the entire dashboard (stats,
                    tiles, sections) to a single project wallet. */}
                {ownerOptions.length > 1 && (
                  <div className="flex items-center gap-2">
                    <label className="font-mono text-[11px] uppercase tracking-wider text-zinc-500">
                      Owner
                    </label>
                    <select
                      value={ownerFilter}
                      onChange={(e) => setOwnerFilter(e.target.value)}
                      className="rounded-md bg-black/40 border border-white/10 px-2 py-1 font-mono text-xs text-zinc-200 focus:outline-none focus:border-[color:var(--motz-red)] focus:ring-1 focus:ring-[color:var(--motz-red)]/40"
                    >
                      <option value="all">MoTZ wallet</option>
                      {ownerOptions.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                    {ownerFilter !== "all" && (
                      <button
                        onClick={() => setOwnerFilter("all")}
                        className="font-mono text-[11px] uppercase tracking-wider text-zinc-500 hover:text-[color:var(--motz-red)]"
                      >
                        Clear
                      </button>
                    )}
                  </div>
                )}
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

          {/* Drill-down "back" link, visible only when filtered to one
              collection. Clicking returns to the all-collections view. */}
          {selectedSlug && selectedCollection && (
            <div>
              <button
                onClick={() => setSelectedSlug(null)}
                className="font-mono text-[11px] uppercase tracking-wider text-zinc-400 hover:text-[color:var(--motz-red)] transition-colors"
              >
                ← All collections
              </button>
            </div>
          )}

          {/* Per-collection summary tiles with background imagery. Each
              tile is a button — click to filter the whole dashboard to
              that collection only. When filtered, only the selected tile
              renders (full-width). */}
          {(selectedSlug
            ? collections
            : allCollections
          ).length > 0 && (
            <section
              className={
                selectedSlug
                  ? "grid grid-cols-1 gap-4"
                  : "grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4"
              }
            >
              {(selectedSlug ? collections : allCollections).map((c) => {
                const count = c.rows.length;
                const cost = c.rows.reduce(
                  (s, r) => s + (r.costUsd ?? 0),
                  0,
                );
                const floor = c.rows.reduce(
                  (s, r) => s + (r.floorUsd ?? 0),
                  0,
                );
                const pnl = floor - cost;
                return (
                  <CollectionTile
                    key={c.contract}
                    name={c.name}
                    slug={c.slug}
                    count={count}
                    costUsd={cost}
                    floorUsd={floor}
                    pnlUsd={pnl}
                    onClick={() => setSelectedSlug(c.slug)}
                    isActive={selectedSlug === c.slug}
                  />
                );
              })}
            </section>
          )}

          {/* Per-collection sections are intentionally hidden on the
              all-collections overview — the dashboard there should feel
              like a "summary" view (totals + tiles only). The section
              with its full token table only appears when the user
              clicks a tile to drill into one collection. */}
          {selectedSlug &&
            collections.map((c) => (
              <CollectionSection key={c.contract} c={c} defaultExpanded />
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

// Maps collection slugs to their background images under /public/motz/collections.
// Keep this in sync with src/lib/contracts.ts slugs.
const COLLECTION_IMAGES: Record<string, string> = {
  "motz-founders-coin": "/motz/collections/founders-coin.jpg",
  "cambria-cores": "/motz/collections/cambria.png",
  "fableborne-kingdoms": "/motz/collections/fableborne.jpg",
  // Keep the old slug mapped too in case the cached snapshot still uses it.
  "fableborne-kingdom": "/motz/collections/fableborne.jpg",
  // Drop an image at public/motz/collections/moki.png to give this tile
  // a branded background. Until then the tile renders with the dark
  // gradient only — still readable, just less visually distinct.
  "moki-genesis": "/motz/collections/moki.png",
};

function CollectionTile({
  name,
  slug,
  count,
  costUsd,
  floorUsd,
  pnlUsd,
  onClick,
  isActive = false,
}: {
  name: string;
  slug: string;
  count: number;
  costUsd: number;
  floorUsd: number;
  pnlUsd: number;
  onClick?: () => void;
  isActive?: boolean;
}) {
  const bg = COLLECTION_IMAGES[slug];
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        "relative overflow-hidden rounded-lg border min-h-[180px] group w-full text-left transition-all " +
        "cursor-pointer focus:outline-none focus:ring-2 focus:ring-[color:var(--motz-red)]/60 " +
        (isActive
          ? "border-[color:var(--motz-red)] bg-black/60 ring-2 ring-[color:var(--motz-red)]/40"
          : "border-white/10 bg-black/40 hover:border-[color:var(--motz-red)]/40")
      }
    >
      {/* Background image with strong dark gradient overlay so the stats
          remain legible on top of any imagery. */}
      {bg && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={bg}
          alt=""
          className="absolute inset-0 h-full w-full object-cover opacity-30 transition-opacity duration-300 group-hover:opacity-50"
          aria-hidden
        />
      )}
      <div
        className="absolute inset-0 bg-gradient-to-br from-black/40 via-black/60 to-black/80"
        aria-hidden
      />

      <div className="relative h-full p-4 flex flex-col justify-between gap-3">
        <h3 className="font-display text-lg font-semibold text-zinc-100 leading-tight">
          {name}
        </h3>
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <div className="font-mono text-[10px] uppercase tracking-wider text-zinc-400">
              NFTs
            </div>
            <div className="font-display text-xl font-bold text-zinc-100">
              {count}
            </div>
          </div>
          <div>
            <div className="font-mono text-[10px] uppercase tracking-wider text-zinc-400">
              Cost (USD)
            </div>
            <div className="font-display text-xl font-bold text-zinc-100">
              {fmtUsd(costUsd)}
            </div>
          </div>
          <div>
            <div className="font-mono text-[10px] uppercase tracking-wider text-zinc-400">
              Floor (USD)
            </div>
            <div className="font-display text-xl font-bold text-[color:var(--motz-gold)]">
              {fmtUsd(floorUsd)}
            </div>
          </div>
          <div>
            <div className="font-mono text-[10px] uppercase tracking-wider text-zinc-400">
              P&amp;L (USD)
            </div>
            <div
              className={
                "font-display text-xl font-bold " +
                (pnlUsd >= 0 ? "text-emerald-400" : "text-red-400")
              }
            >
              {pnlUsd >= 0 ? "+" : ""}
              {fmtUsd(pnlUsd)}
            </div>
          </div>
        </div>
      </div>
    </button>
  );
}
