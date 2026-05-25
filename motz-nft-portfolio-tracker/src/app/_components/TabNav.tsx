"use client";

export type TabId =
  | "motz-dashboard"
  | "motz-pnl"
  | "motz-wallet"
  | "holder-dashboard"
  | "holder-pnl"
  | "holder-wallet";

// Two visual groups (MoTZ = project owner's read-only snapshot, Holder =
// anyone's input view). A subtle divider separates them so the grouping is
// visible without extra chrome.
const TABS: { id: TabId; label: string; group: "motz" | "holder" }[] = [
  { id: "motz-dashboard", label: "MoTZ Dashboard", group: "motz" },
  { id: "motz-pnl", label: "MoTZ PnL Chart", group: "motz" },
  { id: "motz-wallet", label: "MoTZ's Wallet", group: "motz" },
  { id: "holder-dashboard", label: "Holder's Dashboard", group: "holder" },
  { id: "holder-pnl", label: "Holder's PnL Chart", group: "holder" },
  { id: "holder-wallet", label: "Holder's Wallet", group: "holder" },
];

export function TabNav({
  active,
  onChange,
}: {
  active: TabId;
  onChange: (id: TabId) => void;
}) {
  return (
    <nav className="flex flex-wrap items-center gap-6 border-b border-white/5 px-8">
      {TABS.map((t, i) => {
        const isActive = t.id === active;
        // Insert a vertical separator between MoTZ and Holder groups.
        const showDivider = i > 0 && TABS[i - 1].group !== t.group;
        return (
          <div key={t.id} className="flex items-center gap-6">
            {showDivider && (
              <span
                className="h-5 w-px bg-white/10"
                aria-hidden
              />
            )}
            <button
              type="button"
              onClick={() => onChange(t.id)}
              className={
                "relative py-3 text-sm font-medium font-display transition-colors " +
                (isActive
                  ? "text-zinc-100"
                  : "text-zinc-400 hover:text-zinc-100")
              }
            >
              {t.label}
              {isActive && (
                <span
                  className="absolute inset-x-0 -bottom-px h-0.5 rounded-full bg-[color:var(--motz-red)]"
                  aria-hidden
                />
              )}
            </button>
          </div>
        );
      })}
    </nav>
  );
}
