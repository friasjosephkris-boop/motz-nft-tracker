"use client";

import { useState } from "react";
import Image from "next/image";
import type { HoldingRow, CollectionHoldings } from "../api/holdings/route";

/** Extension of HoldingRow that carries an optional wallet tag (for aggregated views). */
export type TaggedHoldingRow = HoldingRow & { walletTag?: string };

/** Collection bucket whose rows may carry walletTag chips. */
export type TaggedCollectionHoldings = Omit<CollectionHoldings, "rows"> & {
  rows: TaggedHoldingRow[];
};

export function fmtUsd(n: number | null | undefined) {
  if (n == null) return "—";
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" });
}
export function fmtRon(n: number | null | undefined) {
  if (n == null) return "—";
  return `${n.toLocaleString("en-US", { maximumFractionDigits: 4 })} RON`;
}
/**
 * Currency-aware formatter. Falls back to RON for legacy rows that
 * predate the per-row currencySymbol field.
 */
export function fmtCoin(
  n: number | null | undefined,
  symbol: string | undefined,
): string {
  if (n == null) return "—";
  return `${n.toLocaleString("en-US", { maximumFractionDigits: 4 })} ${symbol || "RON"}`;
}
export function fmtDate(unix: number | null | undefined) {
  if (!unix) return "—";
  return new Date(unix * 1000).toLocaleString();
}
export function sumRows(
  collections: TaggedCollectionHoldings[] | undefined,
  f: (r: TaggedHoldingRow) => number | null | undefined,
): number {
  return (
    collections?.reduce(
      (s, c) =>
        s +
        c.rows
          .filter((r) => !r.excludeFromTotals)
          .reduce((rs, r) => rs + (f(r) ?? 0), 0),
      0,
    ) ?? 0
  );
}

/** Shortens a 0x address to "0x7c5b…F3c" style chip text. */
export function shortAddr(addr: string): string {
  if (!addr.startsWith("0x") || addr.length < 10) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

export function Stat({
  label,
  value,
  accent,
  hint,
}: {
  label: string;
  value: string;
  accent?: "pos" | "neg" | "gold";
  hint?: string;
}) {
  const color =
    accent === "pos"
      ? "text-emerald-400"
      : accent === "neg"
        ? "text-red-400"
        : accent === "gold"
          ? "text-glow-gold"
          : "text-zinc-100";
  return (
    <div className="glass-card glass-card-hover px-5 py-4">
      <div className="eyebrow">{label}</div>
      <div className={`mt-1 font-display text-2xl font-semibold ${color}`}>
        {value}
      </div>
      {hint && (
        <div className="font-mono text-[11px] uppercase tracking-wider text-zinc-500 mt-0.5">
          {hint}
        </div>
      )}
    </div>
  );
}

function Chevron() {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-3.5 w-3.5"
      aria-hidden
    >
      <path d="M5 7l5 5 5-5" />
    </svg>
  );
}

type SortKey =
  | "tokenId"
  | "rarity"
  | "acquired"
  | "costRon"
  | "costUsd"
  | "floor"
  | "pnl";

// Shared null-safe numeric comparator. Nulls always sort to the bottom
// regardless of direction so they don't pollute the top of the list when
// sorting by columns like Cost / Floor / PnL where many rows can be null.
function numericCompare(
  a: number | null | undefined,
  b: number | null | undefined,
  dir: 1 | -1,
): number {
  const aN = typeof a === "number" && Number.isFinite(a) ? a : null;
  const bN = typeof b === "number" && Number.isFinite(b) ? b : null;
  if (aN == null && bN == null) return 0;
  if (aN == null) return 1;
  if (bN == null) return -1;
  return (aN - bN) * dir;
}

// Columns where "biggest first" is the conventional default. First click on
// these jumps to DESC so users immediately see the largest cost / floor /
// pnl rows. Subsequent clicks toggle.
const DESC_FIRST_COLUMNS: ReadonlySet<string> = new Set([
  "acquired",
  "costRon",
  "costUsd",
  "floor",
  "pnl",
]);
type SortDir = "asc" | "desc";

export function CollectionSection({
  c,
  defaultExpanded = false,
}: {
  c: TaggedCollectionHoldings;
  /** Caller can force the section open on mount (e.g. drill-down view). */
  defaultExpanded?: boolean;
}) {
  // Collapsed by default so the dashboard opens to a quick summary view.
  // User clicks the chevron to expand any collection they want to drill into.
  // defaultExpanded lets the parent override this — used when filtering to a
  // single collection where it makes sense to show the table immediately.
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [sortKey, setSortKey] = useState<SortKey>("tokenId");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [rarityFilter, setRarityFilter] = useState<string>("all");
  const [acquiredFilter, setAcquiredFilter] = useState<string>("all");

  // All rows in a section share a single native currency (a collection
  // lives on one chain). Derive it from the first row's currencySymbol;
  // defaults to RON for back-compat with snapshots predating the field.
  const sectionCurrency = c.rows[0]?.currencySymbol ?? "RON";

  // Build the set of distinct rarities and acquired-via values present in
  // this collection for the dropdown options.
  const distinctRarities = Array.from(
    new Set(
      c.rows
        .map((r) => r.rarityLabel ?? r.rarity ?? null)
        .filter((v): v is string => !!v),
    ),
  ).sort();
  const distinctAcquired = Array.from(
    new Set(
      c.rows
        .map((r) => r.acquiredVia)
        .filter((v): v is "sale" | "mint" | "transfer" => v != null),
    ),
  );

  // Dedupe rows by (walletTag, tokenId). Merge-protection in the snapshot
  // pipeline can occasionally re-attribute a token to the same wallet across
  // runs and leave a duplicate row. Duplicates produce colliding React keys,
  // which prevents <tbody> from reordering when the sort changes — that's
  // why a column header click could "do nothing" on a collection with dupes.
  let view = c.rows;
  const seen = new Set<string>();
  const deduped: typeof c.rows = [];
  for (const r of c.rows) {
    const k = `${r.walletTag ?? ""}-${r.tokenId}`;
    if (seen.has(k)) continue;
    seen.add(k);
    deduped.push(r);
  }
  view = deduped;
  if (rarityFilter !== "all") {
    view = view.filter(
      (r) => (r.rarityLabel ?? r.rarity) === rarityFilter,
    );
  }
  if (acquiredFilter !== "all") {
    view = view.filter((r) => r.acquiredVia === acquiredFilter);
  }
  view = [...view].sort((a, b) => {
    const dir = sortDir === "asc" ? 1 : -1;
    switch (sortKey) {
      case "tokenId":
        return (Number(a.tokenId) - Number(b.tokenId)) * dir;
      case "rarity": {
        const ar = a.rarityLabel ?? a.rarity ?? "";
        const br = b.rarityLabel ?? b.rarity ?? "";
        return ar.localeCompare(br) * dir;
      }
      case "acquired": {
        const at = a.acquiredAt ?? 0;
        const bt = b.acquiredAt ?? 0;
        return (at - bt) * dir;
      }
      case "costRon":
        return numericCompare(a.costRon, b.costRon, dir);
      case "costUsd":
        return numericCompare(a.costUsd, b.costUsd, dir);
      case "floor":
        return numericCompare(a.floorUsd, b.floorUsd, dir);
      case "pnl":
        return numericCompare(a.pnlUsd, b.pnlUsd, dir);
    }
  });

  if (deduped.length === 0) return null;
  // Total count uses the deduped row set so the section header reflects the
  // count the user actually sees in the table.
  const totalRowCount = deduped.length;
  // Header totals follow whatever's currently visible: when filters are
  // active, COST/PNL reflect the filtered subset (matches the "Showing N
  // of M" text below). When unfiltered, view === c.rows so totals are the
  // full collection.
  //
  // Rows with excludeFromTotals=true (Moki 1-of-1s like soda / Gruyere)
  // are skipped entirely — they have no comparable floor by design, so
  // including their cost without a real floor would attribute a phantom
  // loss of -cost to them on every refresh.
  const tableRows = view.filter((r) => !r.excludeFromTotals);
  const costUsd = tableRows.reduce((s, r) => s + (r.costUsd ?? 0), 0);
  const floorUsd = tableRows.reduce((s, r) => s + (r.floorUsd ?? 0), 0);
  const pnl = floorUsd - costUsd;
  const isFiltered = view.length !== totalRowCount;

  // Helper: when user clicks a sortable header, toggle direction if it's
  // already the active sort, otherwise switch to that sort with asc.
  function clickSort(k: SortKey) {
    if (sortKey === k) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(k);
      setSortDir(DESC_FIRST_COLUMNS.has(k) ? "desc" : "asc");
    }
  }
  function sortIndicator(k: SortKey) {
    if (sortKey !== k) return null;
    return (
      <span className="ml-1 text-[color:var(--motz-red)]">
        {sortDir === "asc" ? "▲" : "▼"}
      </span>
    );
  }

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          aria-label={expanded ? "Collapse section" : "Expand section"}
          className="flex items-center gap-2 group focus:outline-none"
        >
          <span
            className={
              "inline-flex h-6 w-6 items-center justify-center rounded-md border border-white/10 bg-white/5 text-zinc-400 transition-all group-hover:border-[color:var(--motz-red)]/40 group-hover:text-zinc-100 " +
              (expanded ? "" : "-rotate-90")
            }
          >
            <Chevron />
          </span>
          <h2 className="font-display text-xl font-semibold text-zinc-100">
            {c.name}{" "}
            <span className="text-sm font-normal text-zinc-500">
              {isFiltered ? (
                <>
                  ({view.length}{" "}
                  <span className="text-zinc-600">of {totalRowCount}</span>)
                </>
              ) : (
                `(${totalRowCount})`
              )}
            </span>
          </h2>
        </button>
        <div className="font-mono text-xs uppercase tracking-wider text-zinc-500">
          Cost <span className="text-zinc-100">{fmtUsd(costUsd)}</span> · PnL{" "}
          <span className={pnl >= 0 ? "text-emerald-400" : "text-red-400"}>
            {pnl >= 0 ? "+" : ""}
            {fmtUsd(pnl)}
          </span>
        </div>
      </div>
      {expanded && (
        <>
          {/* Filter bar */}
          <div className="flex flex-wrap items-center gap-3 px-1">
            {distinctRarities.length > 0 && (
              <FilterDropdown
                label="Rarity"
                value={rarityFilter}
                onChange={setRarityFilter}
                options={[
                  { value: "all", label: "All rarities" },
                  ...distinctRarities.map((r) => ({ value: r, label: r })),
                ]}
              />
            )}
            {distinctAcquired.length > 0 && (
              <FilterDropdown
                label="Acquired"
                value={acquiredFilter}
                onChange={setAcquiredFilter}
                options={[
                  { value: "all", label: "All" },
                  ...distinctAcquired.map((v) => ({
                    value: v,
                    label:
                      v === "mint"
                        ? "Minted"
                        : v === "sale"
                          ? "Bought"
                          : v === "transfer"
                            ? "Transferred"
                            : v,
                  })),
                ]}
              />
            )}
            {(rarityFilter !== "all" || acquiredFilter !== "all") && (
              <button
                onClick={() => {
                  setRarityFilter("all");
                  setAcquiredFilter("all");
                }}
                className="font-mono text-[11px] uppercase tracking-wider text-zinc-500 hover:text-[color:var(--motz-red)]"
              >
                Clear filters
              </button>
            )}
            {view.length !== totalRowCount && (
              <span className="font-mono text-[11px] text-zinc-500 ml-auto">
                Showing {view.length} of {totalRowCount}
              </span>
            )}
          </div>

          <div className="glass-card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-white/5 text-xs uppercase tracking-wider text-zinc-400 font-mono">
                  <tr>
                    <SortableHeader
                      onClick={() => clickSort("tokenId")}
                      align="left"
                    >
                      Token{sortIndicator("tokenId")}
                    </SortableHeader>
                    <SortableHeader
                      onClick={() => clickSort("rarity")}
                      align="left"
                    >
                      Rarity{sortIndicator("rarity")}
                    </SortableHeader>
                    <SortableHeader
                      onClick={() => clickSort("acquired")}
                      align="left"
                    >
                      Acquired{sortIndicator("acquired")}
                    </SortableHeader>
                    <SortableHeader
                      onClick={() => clickSort("costRon")}
                      align="right"
                    >
                      Cost ({sectionCurrency}){sortIndicator("costRon")}
                    </SortableHeader>
                    <SortableHeader
                      onClick={() => clickSort("costUsd")}
                      align="right"
                    >
                      Cost (USD){sortIndicator("costUsd")}
                    </SortableHeader>
                    <SortableHeader
                      onClick={() => clickSort("floor")}
                      align="right"
                    >
                      Floor{sortIndicator("floor")}
                    </SortableHeader>
                    <SortableHeader
                      onClick={() => clickSort("pnl")}
                      align="right"
                    >
                      P&L{sortIndicator("pnl")}
                    </SortableHeader>
                  </tr>
                </thead>
                <tbody>
                  {view.map((r) => (
                    <Row
                      key={`${r.walletTag ?? ""}-${r.tokenId}`}
                      r={r}
                    />
                  ))}
                  {view.length === 0 && (
                    <tr>
                      <td
                        colSpan={7}
                        className="px-4 py-8 text-center text-sm text-zinc-500"
                      >
                        No tokens match the current filters.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </section>
  );
}

function SortableHeader({
  children,
  onClick,
  align,
}: {
  children: React.ReactNode;
  onClick: () => void;
  align: "left" | "right";
}) {
  return (
    <th
      className={
        "px-4 py-3 font-medium cursor-pointer select-none transition-colors hover:text-zinc-100 " +
        (align === "right" ? "text-right" : "text-left")
      }
      onClick={onClick}
    >
      {children}
    </th>
  );
}

function FilterDropdown({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <label className="flex items-center gap-2">
      <span className="font-mono text-[11px] uppercase tracking-wider text-zinc-500">
        {label}
      </span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-md bg-black/40 border border-white/10 px-2 py-1 font-mono text-xs text-zinc-200 focus:outline-none focus:border-[color:var(--motz-red)] focus:ring-1 focus:ring-[color:var(--motz-red)]/40"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export function Row({ r }: { r: TaggedHoldingRow }) {
  return (
    <tr className="border-t border-white/5 hover:bg-white/[0.03] transition-colors">
      <td className="px-4 py-3">
        <div className="flex items-center gap-3">
          {r.image && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={r.image}
              alt=""
              className="h-10 w-10 rounded-md object-cover bg-zinc-800 ring-1 ring-white/10"
            />
          )}
          <div>
            <div className="font-medium text-zinc-100 flex items-center gap-2">
              {r.name || `#${r.tokenId}`}
              {r.walletTag && (
                <span className="chip chip-blue font-mono text-[10px]">
                  {shortAddr(r.walletTag)}
                </span>
              )}
            </div>
            <div className="text-xs text-zinc-500 font-mono">#{r.tokenId}</div>
          </div>
        </div>
      </td>
      <td className="px-4 py-3">
        {r.rarityLabel || r.rarity ? (
          <span className="chip chip-purple">{r.rarityLabel ?? r.rarity}</span>
        ) : (
          <span className="text-zinc-600">—</span>
        )}
      </td>
      <td className="px-4 py-3 text-zinc-300">
        {r.acquiredVia === "mint" ? (
          <span className="chip chip-gold">Minted</span>
        ) : r.acquiredVia === "transfer" ? (
          <>
            <span className="chip chip-blue">Transferred</span>
            {r.acquiredTxHash && (
              <a
                href={`https://app.roninchain.com/tx/${r.acquiredTxHash}`}
                target="_blank"
                rel="noopener noreferrer"
                className="block text-[11px] font-mono text-zinc-500 hover:text-zinc-300 mt-1"
              >
                {r.acquiredTxHash.slice(0, 10)}…
              </a>
            )}
          </>
        ) : (
          <>
            <span className="chip chip-purple">Bought</span>
            <div className="text-sm mt-1">{fmtDate(r.acquiredAt)}</div>
            {r.acquiredTxHash && (
              <a
                href={`https://app.roninchain.com/tx/${r.acquiredTxHash}`}
                target="_blank"
                rel="noopener noreferrer"
                className="block text-[11px] font-mono text-zinc-500 hover:text-zinc-300"
              >
                {r.acquiredTxHash.slice(0, 10)}…
              </a>
            )}
          </>
        )}
      </td>
      <td className="px-4 py-3 text-right font-mono">
        <div className="text-zinc-100">{fmtCoin(r.costRon, r.currencySymbol)}</div>
        {r.acquiredVia === "mint" && (
          <div className="text-[10px] uppercase tracking-wider text-[color:var(--winner-gold)]/80">
            mint price
          </div>
        )}
      </td>
      <td className="px-4 py-3 text-right font-mono">
        <div className="text-zinc-100">{fmtUsd(r.costUsd)}</div>
        {r.ronUsdAtPurchase != null && (
          <div className="text-[10px] text-zinc-500">
            @ ${r.ronUsdAtPurchase.toFixed(4)}/{r.currencySymbol ?? "RON"}
          </div>
        )}
      </td>
      <td className="px-4 py-3 text-right font-mono">
        <div className="text-zinc-100">{fmtUsd(r.floorUsd)}</div>
        {r.floorRon != null && (
          <div className="text-[11px] text-zinc-500">
            {fmtCoin(r.floorRon, r.currencySymbol)}
          </div>
        )}
      </td>
      <td
        className={
          "px-4 py-3 text-right font-mono font-semibold " +
          (r.pnlUsd == null
            ? "text-zinc-500"
            : r.pnlUsd >= 0
              ? "text-emerald-400"
              : "text-red-400")
        }
      >
        {fmtUsd(r.pnlUsd)}
      </td>
    </tr>
  );
}

export function LoadingOverlay({
  elapsed,
  walletCount = 1,
  walletProgress,
}: {
  elapsed: number;
  /** Number of wallets being loaded (Connected Wallets view). */
  walletCount?: number;
  /** Optional "n of N done" indicator for combined loads. */
  walletProgress?: { done: number; total: number };
}) {
  // Sky Mavis rate-limits per-account so parallel wallets don't fully overlap —
  // the tail is the slowest wallet plus some queue contention. Buckets below
  // reflect measured durations: small ~10–30s, mid ~30–90s, big 200+ NFTs up to
  // ~3 min, 300+ on a cold cache up to ~5 min.
  const isCombined = walletCount > 1;
  const step =
    elapsed < 2
      ? isCombined
        ? `Resolving ${walletCount} addresses…`
        : "Resolving address and fetching holdings…"
      : elapsed < 8
        ? "Looking up sales and floor prices…"
        : elapsed < 30
          ? "Scanning marketplace activity for acquisitions…"
          : elapsed < 90
            ? "Reconstructing cost basis and staking deposits — hang tight…"
            : elapsed < 180
              ? "Large wallet — still scanning. Sky Mavis is rate-limiting some queries…"
              : "Big wallet, working through every page. Won't return partial data — promise.";

  // ETA scales with wallet count; one slow wallet drags the whole combined load.
  const eta = isCombined
    ? elapsed < 30
      ? `ETA ~${Math.max(30, 25 * walletCount)}–${60 * walletCount}s for ${walletCount} wallets`
      : elapsed < 90
        ? `ETA up to ~${Math.ceil((90 * walletCount) / 60)} min for ${walletCount} wallets`
        : elapsed < 180
          ? "Still going — large combined wallet set"
          : "Final stretch — slow wallets bring up the tail"
    : elapsed < 8
      ? "ETA ~10–30s for small wallets"
      : elapsed < 30
        ? "ETA ~30–60s"
        : elapsed < 90
          ? "ETA up to ~2 min for mid-size wallets"
          : elapsed < 180
            ? "ETA up to ~3 min for 200+ NFTs"
            : "300+ NFTs can take ~5 min on a cold cache";

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 backdrop-blur-md">
      <div className="glass-card flex w-full max-w-sm flex-col items-center gap-4 px-8 py-10 text-center">
        <div className="relative">
          <Image
            src="/motz/mascot/ego.png"
            alt="Ego mascot"
            width={88}
            height={88}
            className="ego-float drop-shadow-[0_0_30px_rgba(255,42,85,0.5)]"
          />
          <div className="absolute inset-0 -z-10 rounded-full bg-[color:var(--motz-red)] opacity-20 blur-2xl" />
        </div>
        <div className="space-y-1">
          <div className="font-display font-mono text-3xl font-bold tabular-nums text-zinc-100">
            {elapsed}s
          </div>
          <div className="text-sm text-zinc-300">{step}</div>
          <div className="text-xs text-zinc-500">{eta}</div>
          {walletProgress && walletProgress.total > 1 && (
            <div className="mt-2 font-mono text-[11px] uppercase tracking-wider text-[color:var(--winner-gold)]">
              {walletProgress.done} / {walletProgress.total} wallets loaded
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export type ApiResponse = {
  address: string;
  resolvedFrom?: string | null;
  currentRonUsd: number | null;
  collections: CollectionHoldings[];
  /** Non-fatal failures encountered during the load (rate-limited
   * enrichment calls, etc.). Empty when everything succeeded. */
  warnings?: string[];
};

/** Retries a fetch up to `attempts` times with a fixed delay. onAttempt fires before each try (1-indexed). */
export async function retryFetch<T>(
  url: string,
  attempts = 3,
  delayMs = 5000,
  onAttempt?: (attempt: number) => void,
): Promise<T> {
  let lastErr: unknown;
  for (let i = 1; i <= attempts; i++) {
    onAttempt?.(i);
    try {
      const r = await fetch(url);
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
      return j as T;
    } catch (e) {
      lastErr = e;
      if (i < attempts) {
        await new Promise((res) => setTimeout(res, delayMs));
      }
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("Request failed");
}
