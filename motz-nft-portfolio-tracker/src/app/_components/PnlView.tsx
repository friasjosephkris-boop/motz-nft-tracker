"use client";

import { useState } from "react";
import { shortAddr } from "./shared";

// TODO: Real implementation requires a historical floor index. When that lands,
// add a route at `src/app/api/pnl-history/route.ts` that returns a time series
// of (timestamp, floor_ron, ron_usd) per collection, then aggregate against the
// wallet's transfer history to produce monthly/yearly PNL points.

export function PnlView({
  addresses,
  titleOverride,
  subtitleOverride,
}: {
  addresses: string[];
  /** Customise the header — e.g. "MoTZ PnL Chart" vs "Holder's PnL Chart". */
  titleOverride?: string;
  subtitleOverride?: string;
}) {
  const [mode, setMode] = useState<"monthly" | "yearly">("monthly");
  const tracked = addresses.map((a) => a.trim()).filter(Boolean);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h2 className="font-display text-xl font-semibold text-zinc-100">
            {titleOverride ?? "P&L over time"}
          </h2>
          <p className="text-xs text-zinc-500">
            {subtitleOverride ??
              "Reconstructed from on-chain history and historical floors."}
          </p>
        </div>
        <div className="inline-flex rounded-md border border-white/10 bg-black/40 p-1">
          {(["monthly", "yearly"] as const).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={
                "px-4 py-1.5 text-xs font-mono uppercase tracking-wider rounded transition-colors " +
                (mode === m
                  ? "bg-[color:var(--motz-red)] text-white"
                  : "text-zinc-400 hover:text-zinc-100")
              }
            >
              {m}
            </button>
          ))}
        </div>
      </div>

      <div className="glass-card p-8 flex flex-col items-center justify-center text-center gap-3 min-h-[320px]">
        <div className="eyebrow">Coming soon</div>
        <p className="text-sm text-zinc-300 max-w-md">
          Monthly and yearly P&amp;L reconstruction from chain history needs a
          historical floor index. Tracked separately.
        </p>
        {tracked.length > 0 && (
          <div className="text-xs text-zinc-500 mt-4">
            Will track:{" "}
            <span className="font-mono text-zinc-300">
              {tracked
                .map((a) => (a.startsWith("0x") ? shortAddr(a) : a))
                .join(", ")}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
