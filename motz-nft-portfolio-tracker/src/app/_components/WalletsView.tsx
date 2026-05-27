"use client";

import { useEffect, useState } from "react";
import { useAccount, useConnect, useDisconnect } from "wagmi";
import type { LoadedPortfolio } from "../page";
import {
  ApiResponse,
  LoadingOverlay,
  TaggedCollectionHoldings,
  TaggedHoldingRow,
  retryFetch,
  shortAddr,
} from "./shared";

type WalletStatus =
  | { state: "idle" }
  | { state: "loading"; attempt: number }
  | { state: "ok"; resolved: string }
  | { state: "error"; message: string };

export function WalletsView({
  addresses,
  setAddresses,
  transferrers,
  setTransferrers,
  onLoaded,
  holderMode = false,
  title = "Connect wallets",
  subtitle = "Paste Ronin addresses (0x…) or RNS. Blanks are skipped. Add as many as you need.",
}: {
  addresses: string[];
  setAddresses: (v: string[]) => void;
  transferrers: string[];
  setTransferrers: (v: string[]) => void;
  /** Called when combined load finishes — payload is rendered on the Dashboard tab. */
  onLoaded: (payload: LoadedPortfolio) => void;
  /**
   * Holder mode passes ?holderMode=true to /api/holdings so non-mint/non-sale
   * tokens stay classified as "transfer" with $0 cost (no mint-price proxy).
   * The Holder's Wallet tab uses this — visitors viewing their own portfolios
   * shouldn't get a fake positive cost basis for transferred-in airdrops.
   */
  holderMode?: boolean;
  /** Override the section header for re-skinned variants of this view. */
  title?: string;
  subtitle?: string;
}) {
  const [statuses, setStatuses] = useState<WalletStatus[]>(
    addresses.map(() => ({ state: "idle" })),
  );
  const [loading, setLoading] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);

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

  function updateInput(i: number, value: string) {
    const next = [...addresses];
    next[i] = value;
    setAddresses(next);
  }
  function addWalletRow() {
    setAddresses([...addresses, ""]);
  }
  function removeWalletRow(i: number) {
    if (addresses.length <= 1) return;
    setAddresses(addresses.filter((_, j) => j !== i));
    setStatuses((prev) => prev.filter((_, j) => j !== i));
  }
  function updateTransferrer(i: number, value: string) {
    const next = [...transferrers];
    next[i] = value;
    setTransferrers(next);
  }
  function addTransferrerRow() {
    setTransferrers([...transferrers, ""]);
  }
  function removeTransferrerRow(i: number) {
    if (transferrers.length <= 1) {
      setTransferrers([""]);
      return;
    }
    setTransferrers(transferrers.filter((_, j) => j !== i));
  }

  const cleaned = addresses.map((a) => a.trim()).filter(Boolean);
  // Holder mode never uses transferrers — they're a project-owner feature.
  // Even if state somehow contains values, ignore them so the API call
  // doesn't accidentally pull in MoTZ-side transferrer scans.
  const cleanedTransferrers = holderMode
    ? []
    : transferrers.map((a) => a.trim()).filter(Boolean);

  async function loadAll() {
    // Case-insensitive dedupe on input.
    const seenInput = new Set<string>();
    const unique: { idx: number; input: string }[] = [];
    addresses.forEach((raw, idx) => {
      const v = raw.trim();
      if (!v) return;
      const key = v.toLowerCase();
      if (seenInput.has(key)) return;
      seenInput.add(key);
      unique.push({ idx, input: v });
    });
    if (unique.length === 0) {
      setError("Enter at least one address.");
      return;
    }
    setError(null);
    setLoading(true);

    const initStatuses: WalletStatus[] = addresses.map(() => ({
      state: "idle",
    }));
    setStatuses(initStatuses);

    // Process wallets SEQUENTIALLY (not Promise.all) so they don't all
    // hammer Sky Mavis at once. Each /api/holdings request hits a shared
    // server-side rate limiter + breaker; running 4 wallets × 6 transferrers
    // in parallel instantly burned through the breaker threshold and every
    // wallet failed. Sequential is slower but actually completes.
    const transferrerParams = cleanedTransferrers
      .map((t) => `&transferrer=${encodeURIComponent(t)}`)
      .join("");
    const holderParam = holderMode ? "&holderMode=true" : "";
    const results: Array<{
      idx: number;
      input: string;
      data: ApiResponse | null;
      error: string | null;
    }> = [];
    for (const { idx, input } of unique) {
      try {
        const j = await retryFetch<ApiResponse>(
          `/api/holdings?address=${encodeURIComponent(input)}${transferrerParams}${holderParam}`,
          3,
          5000,
          (attempt) => {
            setStatuses((prev) => {
              const next = [...prev];
              next[idx] = { state: "loading", attempt };
              return next;
            });
          },
        );
        setStatuses((prev) => {
          const next = [...prev];
          next[idx] = { state: "ok", resolved: j.address };
          return next;
        });
        results.push({ idx, input, data: j as ApiResponse, error: null });
      } catch (e) {
        setStatuses((prev) => {
          const next = [...prev];
          next[idx] = { state: "error", message: (e as Error).message };
          return next;
        });
        results.push({
          idx,
          input,
          data: null,
          error: (e as Error).message,
        });
      }
    }

    // Surface per-wallet failures at the top of the form. Builds a single
    // visible banner so the user sees the real error (e.g. "Sky Mavis API
    // quota exhausted") instead of just a tiny red "X failed" pill.
    const failures = results.filter((r) => !r.data && r.error);
    if (failures.length > 0) {
      const lines = failures.map(
        (f) => `${f.input}: ${f.error}`,
      );
      setError(
        failures.length === 1
          ? `Failed to load ${lines[0]}`
          : `Failed to load ${failures.length} wallet(s):\n${lines.join("\n")}`,
      );
    }

    // Dedupe on resolved address (case-insensitive).
    const seenResolved = new Set<string>();
    const accepted = results.filter((r) => {
      if (!r.data) return false;
      const key = r.data.address.toLowerCase();
      if (seenResolved.has(key)) return false;
      seenResolved.add(key);
      return true;
    });

    // If NOTHING loaded successfully, stay on the Wallets tab so the user
    // can read the error and retry — don't auto-switch to an empty Dashboard.
    if (accepted.length === 0) {
      setLoading(false);
      return;
    }

    // Merge collections across wallets, tagging each row.
    const byContract = new Map<string, TaggedCollectionHoldings>();
    for (const r of accepted) {
      const tag = r.data!.address;
      for (const c of r.data!.collections) {
        const existing = byContract.get(c.contract);
        const taggedRows: TaggedHoldingRow[] = c.rows.map((row) => ({
          ...row,
          walletTag: tag,
        }));
        if (existing) {
          existing.rows.push(...taggedRows);
        } else {
          byContract.set(c.contract, {
            contract: c.contract,
            name: c.name,
            symbol: c.symbol,
            slug: c.slug,
            rows: taggedRows,
          });
        }
      }
    }
    const collections = [...byContract.values()];
    const sourceAddrs = accepted.map((r) => r.data!.address);
    onLoaded({
      collections,
      label:
        sourceAddrs.length === 1
          ? shortAddr(sourceAddrs[0])
          : `${sourceAddrs.length} wallets combined`,
      walletCount: sourceAddrs.length,
      addresses: sourceAddrs,
    });
    setLoading(false);
  }

  return (
    <div className="space-y-8">
      <section className="glass-card p-6 space-y-3">
        <h2 className="font-display text-lg font-semibold text-zinc-100">
          {title}
        </h2>
        <p className="text-xs text-zinc-500">{subtitle}</p>

        {/* Connect-wallet helper, holder mode only. Lets visitors connect
            their Ronin/Rabby/MetaMask wallet to auto-fill the address input
            and skip typing. Manual paste-an-address still works below. */}
        {holderMode && (
          <ConnectWalletHelper
            onUseAddress={(addr) => {
              const next = [...addresses];
              // Replace the first empty slot, or the first slot if all filled.
              const slot = next.findIndex((v) => !v.trim());
              const idx = slot >= 0 ? slot : 0;
              next[idx] = addr;
              setAddresses(next);
            }}
          />
        )}

        {/* Transferrer UI is only meaningful for the project-owner view —
            it lets you specify upstream wallets that minted/bought tokens
            before transferring them to you, so the load can recover the
            real cost basis. Holders viewing their own wallet shouldn't have
            this option: their non-mint/non-sale NFTs stay as transfers
            with $0 cost regardless. */}
        {!holderMode && (
          <div className="rounded-md border border-white/10 bg-white/[0.02] p-3 space-y-2">
            <div className="flex items-baseline justify-between gap-2">
              <label className="font-mono text-[11px] uppercase tracking-wider text-[color:var(--winner-gold)]">
                Transferrer wallets (optional)
              </label>
              <span className="text-[11px] text-zinc-500">
                Upgrades transferred-in rows to the transferrer&apos;s mint/sale cost basis
              </span>
            </div>
            {transferrers.map((v, i) => (
              <div key={i} className="flex items-center gap-2">
                <input
                  value={v}
                  onChange={(e) => updateTransferrer(i, e.target.value)}
                  placeholder="0x… or RNS"
                  disabled={loading}
                  className="flex-1 rounded-md bg-black/40 border border-white/10 px-3 py-2 font-mono text-sm placeholder:text-zinc-600 focus:outline-none focus:border-[color:var(--winner-gold)] focus:ring-1 focus:ring-[color:var(--winner-gold)]/40"
                />
                <button
                  onClick={() => removeTransferrerRow(i)}
                  disabled={loading || (transferrers.length === 1 && !v)}
                  title="Remove this transferrer"
                  className="h-9 w-9 rounded-md border border-white/10 bg-white/5 text-zinc-400 hover:border-[color:var(--motz-red)]/40 hover:text-zinc-100 disabled:opacity-30 disabled:cursor-not-allowed"
                  aria-label="Remove transferrer"
                >
                  −
                </button>
              </div>
            ))}
            <button
              onClick={addTransferrerRow}
              disabled={loading}
              className="font-mono text-[11px] uppercase tracking-wider text-[color:var(--winner-gold)] hover:text-zinc-100 disabled:opacity-40"
            >
              + Add another transferrer
            </button>
          </div>
        )}

        <div className="flex flex-col gap-2">
          {/* Holder mode = single wallet only (visitors looking up their
              own portfolio don't need multi-wallet combine). Project
              owner view shows all input rows + the + Add button below. */}
          {(holderMode ? addresses.slice(0, 1) : addresses).map((v, i) => (
            <div key={i} className="flex items-center gap-3">
              <span className="eyebrow w-20 shrink-0">
                {holderMode ? "Wallet" : `Wallet ${i + 1}`}
              </span>
              <input
                value={v}
                onChange={(e) => updateInput(i, e.target.value)}
                placeholder="0x… or RNS"
                disabled={loading}
                className="flex-1 rounded-md bg-black/40 border border-white/10 px-3 py-2 font-mono text-sm placeholder:text-zinc-600 focus:outline-none focus:border-[color:var(--motz-red)] focus:ring-1 focus:ring-[color:var(--motz-red)]/40"
              />
              {!holderMode && (
                <button
                  onClick={() => removeWalletRow(i)}
                  disabled={loading || addresses.length <= 1}
                  title="Remove this wallet"
                  className="h-9 w-9 rounded-md border border-white/10 bg-white/5 text-zinc-400 hover:border-[color:var(--motz-red)]/40 hover:text-zinc-100 disabled:opacity-30 disabled:cursor-not-allowed"
                  aria-label="Remove wallet"
                >
                  −
                </button>
              )}
              <StatusPill status={statuses[i] ?? { state: "idle" }} />
            </div>
          ))}
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={loadAll}
            disabled={loading}
            className="btn-primary"
          >
            {loading
              ? "Loading…"
              : holderMode || cleaned.length === 1
                ? "Load wallet"
                : "Load combined"}
          </button>
          {!holderMode && (
            <button
              onClick={addWalletRow}
              disabled={loading}
              className="font-mono text-[11px] uppercase tracking-wider text-[color:var(--motz-red)] hover:text-zinc-100 disabled:opacity-40"
            >
              + Add another wallet
            </button>
          )}
        </div>
        {error && (
          <div className="rounded-md border border-red-900/60 bg-red-950/40 px-4 py-3 text-sm text-red-300 whitespace-pre-wrap break-words">
            {error}
          </div>
        )}
      </section>

      {loading && (
        <LoadingOverlay
          elapsed={elapsed}
          walletCount={cleaned.length || 1}
          walletProgress={{
            done: statuses.filter((s) => s.state === "ok").length,
            total: cleaned.length || 1,
          }}
        />
      )}
    </div>
  );
}

function StatusPill({ status }: { status: WalletStatus }) {
  if (status.state === "idle") {
    return <span className="font-mono text-[11px] text-zinc-600">—</span>;
  }
  if (status.state === "loading") {
    return (
      <span className="font-mono text-[11px] text-zinc-300">
        ↻ {status.attempt > 1 ? `retrying (attempt ${status.attempt}/3)` : "loading"}
      </span>
    );
  }
  if (status.state === "ok") {
    return (
      <span className="font-mono text-[11px] text-emerald-400">✓ loaded</span>
    );
  }
  return (
    <span
      className="font-mono text-[11px] text-red-400"
      title={status.message}
    >
      ✗ failed
    </span>
  );
}

/**
 * Compact connect-wallet helper for the Holder's Wallet view.
 *
 * - Not connected: shows a list of installed wallet connectors (Ronin
 *   Wallet / Rabby / MetaMask / any injected) for one-click connect.
 * - Connected: shows the address + a primary "Use this wallet" button
 *   that pre-fills the form's first wallet input. User then clicks
 *   "Load wallet" to fetch their portfolio.
 *
 * Disconnect link lets them switch wallets without leaving the page.
 */
function ConnectWalletHelper({
  onUseAddress,
}: {
  onUseAddress: (address: string) => void;
}) {
  const { address, isConnected, connector } = useAccount();
  const { connectors, connect, isPending, error } = useConnect();
  const { disconnect } = useDisconnect();

  // Surface ONE connect button — the user's currently-injected browser
  // wallet (Ronin Wallet, Rabby, MetaMask, etc.). RainbowKit/wagmi
  // duplicates injected connectors across multiple ids ("injected",
  // "io.rabby", "metaMaskSDK") which cluttered the UI; we pick the most
  // specific available and show only that.
  const orderedConnectors = (() => {
    const named = connectors.find(
      (c) => c.id === "io.rabby" || c.id === "rabbyWallet",
    );
    if (named) return [named];
    const metaMask = connectors.find((c) => c.id === "metaMaskSDK");
    if (metaMask) return [metaMask];
    const injected = connectors.find((c) => c.type === "injected");
    if (injected) return [injected];
    return connectors.slice(0, 1);
  })();

  return (
    <div className="rounded-md border border-white/10 bg-white/[0.02] p-3 space-y-2">
      <div className="flex items-baseline justify-between gap-2">
        <label className="font-mono text-[11px] uppercase tracking-wider text-[color:var(--motz-red)]">
          Connect wallet
        </label>
        <span className="text-[11px] text-zinc-500">
          Ronin Wallet · Rabby · MetaMask · any Ronin-compatible wallet
        </span>
      </div>
      {isConnected && address ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="chip chip-blue font-mono text-xs">
            {connector?.name ? `${connector.name} · ` : ""}
            {shortAddr(address)}
          </span>
          <button
            type="button"
            onClick={() => onUseAddress(address)}
            className="btn-primary"
          >
            Use this wallet
          </button>
          <button
            type="button"
            onClick={() => disconnect()}
            className="font-mono text-[11px] uppercase tracking-wider text-zinc-500 hover:text-zinc-200"
          >
            Disconnect
          </button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          {orderedConnectors.length === 0 ? (
            <span className="text-xs text-zinc-500">
              No browser wallet detected. Install{" "}
              <a
                href="https://wallet.roninchain.com/"
                target="_blank"
                rel="noopener noreferrer"
                className="text-[color:var(--motz-red)] hover:underline"
              >
                Ronin Wallet
              </a>{" "}
              or paste an address manually below.
            </span>
          ) : (
            orderedConnectors.map((c) => {
              // Prefer the connector's brand name. The generic "injected"
              // connector reports name="Injected" which isn't useful; in
              // that case just say "Connect Wallet".
              const label =
                c.name && c.name.toLowerCase() !== "injected"
                  ? `Connect ${c.name}`
                  : "Connect Wallet";
              return (
                <button
                  key={c.uid}
                  type="button"
                  disabled={isPending}
                  onClick={() => connect({ connector: c })}
                  className="btn-primary disabled:opacity-50"
                >
                  {isPending ? "Connecting…" : label}
                </button>
              );
            })
          )}
        </div>
      )}
      {error && (
        <div className="text-xs text-red-400">
          {error.message?.slice(0, 200)}
        </div>
      )}
    </div>
  );
}
