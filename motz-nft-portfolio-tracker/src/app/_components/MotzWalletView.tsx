"use client";

import { MOTZ_WALLETS, MOTZ_TRANSFERRERS } from "@/lib/motz-wallets";

// Read-only display of the project's configured wallets. Visitors see what
// the MoTZ Dashboard is tracking; only edits to src/lib/motz-wallets.ts
// change them.
export function MotzWalletView() {
  return (
    <div className="space-y-8">
      <section className="glass-card p-6 space-y-3">
        <h2 className="font-display text-lg font-semibold text-zinc-100">
          MoTZ&apos;s Wallets
        </h2>
        <p className="text-xs text-zinc-500">
          The project&apos;s configured wallet set. Read-only — these power
          the MoTZ Dashboard and MoTZ PnL Chart snapshots.
        </p>

        <div className="rounded-md border border-white/10 bg-white/[0.02] p-4 space-y-2">
          <div className="font-mono text-[11px] uppercase tracking-wider text-[color:var(--motz-gold)]">
            Primary wallets ({MOTZ_WALLETS.length})
          </div>
          <ul className="space-y-1.5">
            {MOTZ_WALLETS.map((addr) => (
              <li
                key={addr}
                className="rounded-md bg-black/30 border border-white/10 px-3 py-2 font-mono text-xs text-zinc-200"
              >
                {addr}
              </li>
            ))}
          </ul>
        </div>

        <div className="rounded-md border border-white/10 bg-white/[0.02] p-4 space-y-2">
          <div className="font-mono text-[11px] uppercase tracking-wider text-[color:var(--motz-red)]">
            Transferrer wallets ({MOTZ_TRANSFERRERS.length})
          </div>
          <p className="text-[11px] text-zinc-500">
            Upstream wallets that historically minted or bought tokens before
            transferring them to a primary wallet. Adding the original
            minter/buyer here lets the snapshot show the real cost basis on
            transferred-in rows.
          </p>
          <ul className="space-y-1.5">
            {MOTZ_TRANSFERRERS.map((addr) => (
              <li
                key={addr}
                className="rounded-md bg-black/30 border border-white/10 px-3 py-2 font-mono text-xs text-zinc-200"
              >
                {addr}
              </li>
            ))}
          </ul>
        </div>
      </section>
    </div>
  );
}
