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
      (s, c) => s + c.rows.reduce((rs, r) => rs + (f(r) ?? 0), 0),
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

export function CollectionSection({ c }: { c: TaggedCollectionHoldings }) {
  const [expanded, setExpanded] = useState(true);
  if (c.rows.length === 0) return null;
  const costUsd = c.rows.reduce((s, r) => s + (r.costUsd ?? 0), 0);
  const floorUsd = c.rows.reduce((s, r) => s + (r.floorUsd ?? 0), 0);
  const pnl = floorUsd - costUsd;
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
              ({c.rows.length})
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
        <div className="glass-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-white/5 text-xs uppercase tracking-wider text-zinc-400 font-mono">
                <tr>
                  <th className="text-left px-4 py-3 font-medium">Token</th>
                  <th className="text-left px-4 py-3 font-medium">Rarity</th>
                  <th className="text-left px-4 py-3 font-medium">Acquired</th>
                  <th className="text-right px-4 py-3 font-medium">
                    Cost (RON)
                  </th>
                  <th className="text-right px-4 py-3 font-medium">
                    Cost (USD)
                  </th>
                  <th className="text-right px-4 py-3 font-medium">Floor</th>
                  <th className="text-right px-4 py-3 font-medium">P&L</th>
                </tr>
              </thead>
              <tbody>
                {c.rows.map((r) => (
                  <Row key={`${r.walletTag ?? ""}-${r.tokenId}`} r={r} />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
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
            <div className="text-sm">{fmtDate(r.acquiredAt)}</div>
            {r.acquiredTxHash && (
              <a
                href={`https://app.roninchain.com/tx/${r.acquiredTxHash}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[11px] font-mono text-zinc-500 hover:text-zinc-300"
              >
                {r.acquiredTxHash.slice(0, 10)}…
              </a>
            )}
          </>
        )}
      </td>
      <td className="px-4 py-3 text-right font-mono">
        <div className="text-zinc-100">{fmtRon(r.costRon)}</div>
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
            @ ${r.ronUsdAtPurchase.toFixed(4)}/RON
          </div>
        )}
      </td>
      <td className="px-4 py-3 text-right font-mono">
        <div className="text-zinc-100">{fmtUsd(r.floorUsd)}</div>
        {r.floorRon != null && (
          <div className="text-[11px] text-zinc-500">{fmtRon(r.floorRon)}</div>
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
