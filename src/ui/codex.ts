// In-game Codex / glossary screen. Static reference for stats, universal
// actions, effect tags, and the three stat sources.

import { topBarHtml } from "./settings";

interface CodexTocEntry { id: string; icon: string; label: string; }
const CODEX_TOC: CodexTocEntry[] = [
  { id: "modes",     icon: "🎮", label: "Game Modes" },
  { id: "stats",     icon: "📊", label: "Stats" },
  { id: "sources",   icon: "🧬", label: "Stat Sources" },
  { id: "actions",   icon: "⚙",  label: "Universal Actions" },
  { id: "aoe",       icon: "🎯", label: "Single vs AOE" },
  { id: "shop",      icon: "🛒", label: "Shop & Inventory" },
  { id: "buffs-c",   icon: "⚡", label: "Campaign Buffs" },
  { id: "vouchers",  icon: "💰", label: "bRON Vouchers" },
  { id: "buffs",     icon: "⬆", label: "Buffs" },
  { id: "debuffs",   icon: "⬇", label: "Debuffs" },
];

export function renderCodex(root: HTMLElement, onBack: () => void): void {
  root.innerHTML = `
    <div class="screen-frame codex-screen">
      <div class="codex-sticky-header">
        ${topBarHtml("Codex", true)}
      </div>

      <div class="codex-body">

        <nav class="codex-toc" aria-label="Codex sections">
          <div class="codex-toc-title">Table of Contents</div>
          <div class="codex-toc-grid">
            ${CODEX_TOC.map(e => `
              <button class="codex-toc-item" data-codex-jump="${e.id}" type="button">
                <span class="codex-toc-icon">${e.icon}</span>
                <span class="codex-toc-label">${e.label}</span>
              </button>
            `).join("")}
          </div>
        </nav>

        <section class="codex-section" id="codex-modes">
          <h2 class="codex-h2">🎮 Game Modes</h2>
          <p class="codex-intro">Three ways to play — pick what you're trying to accomplish.</p>
          <div class="codex-list">
            <div class="codex-mode mode-floor">
              <div class="codex-mode-head">Normal Floor Run</div>
              <p>The main progression loop. Pick a single floor (1–50) and battle through it. <strong>Where you level up your units</strong> — XP rewards are awarded at full multiplier. Floor 1 unlocks Floor 2 only on a successful clear; the tower opens up sequentially. 1 energy per attempt; on a defeat the server refunds +1 energy back, up to 3 times per PH day.</p>
            </div>
            <div class="codex-mode mode-survival">
              <div class="codex-mode-head">Survival Mode</div>
              <p>Start from Floor 1 and keep going as far as you can — every cleared floor carries your party's HP/MP/cooldowns into the next, no rest. Run ends the moment your whole party falls. <em>Prove you are the strongest.</em> XP earned in survival is heavily reduced (1/50× the floor mode rate) — this is a leaderboard mode, not a leveling mode. <strong>Capped at 3 attempts per PH day</strong> (server-enforced, resets at 8 AM PH).</p>
            </div>
            <div class="codex-mode mode-bossraid">
              <div class="codex-mode-head">Boss Raid</div>
              <p>Fight every solo boss in the tower back-to-back: Stone Sentinel → Wraith Lord → Tower Lord → Iron Behemoth → Storm Lord → Demon General → Witch Queen → Dragon Lord → Tower God → World Ender. Bosses are scaled up (~2× stats, +25% ATB) and you pick a boon between fights (Heal / Boost / Weaken). XP = 1/10× floor mode. Top times go on the Boss Raid leaderboard. <strong>Capped at 3 attempts per PH day</strong> (server-enforced).</p>
            </div>
          </div>
        </section>

        <section class="codex-section" id="codex-stats">
          <h2 class="codex-h2">📊 Stats</h2>
          <p class="codex-intro">Each stat feeds multiple derived combat values.</p>
          <div class="codex-grid">
            ${statCard("STR", "Strength",
              `Drives physical attack power. Adds to <em>physAtk</em> ×3 and gives small bumps to HP and both defenses.`,
              ["+3 per point to physical attack", "+3 per point to max HP", "+1 per point to phys/mag defense"])}
            ${statCard("DEX", "Dexterity",
              `Accuracy + critical hits + armor penetration. Hits more often, lands more crits, and ignores part of the target's defense.`,
              ["+3 per point to accuracy", "+2 per point to crit chance", "+1% armor penetration per point (cap 40%)"])}
            ${statCard("AGI", "Agility",
              `Speed of the ATB gauge and evasion. High AGI = more turns and dodge incoming hits more often.`,
              ["Sets ATB speed (faster gauge fill)", "+1% evade per point", "+1 to physical attack"])}
            ${statCard("VIT", "Vitality",
              `Toughness. Mostly HP, with a smaller defensive contribution.`,
              ["+10 per point to max HP", "+1 per point to phys/mag defense"])}
            ${statCard("INT", "Intelligence",
              `Magic damage + mana pool. Casters live and die by INT.`,
              ["+3 per point to magical attack", "+10 per point to max MP", "+2 per point to magic defense"])}
            ${statCard("DEF", "Defense",
              `Pure defensive stat. Reduces incoming damage on both attack types.`,
              ["+3 per point to physical defense", "+2 per point to magical defense", "+5 per point to max HP"])}
          </div>
        </section>

        <section class="codex-section" id="codex-sources">
          <h2 class="codex-h2">🧬 Three Sources of Stats</h2>
          <div class="codex-list">
            <div class="codex-source unit">
              <div class="codex-source-head">Unit Base</div>
              <p>Innate stats from the character template (e.g., Hera's INT-heavy line). Grow with level.</p>
            </div>
            <div class="codex-source class">
              <div class="codex-source-head">Class Base</div>
              <p>Layer added when a class is assigned (available from Lv 1). Grows with level on top of the unit's base.</p>
            </div>
            <div class="codex-source custom">
              <div class="codex-source-head">Custom (Allocatable)</div>
              <p>Spendable points earned on level-up — 4 per level. You distribute them by hand on the Units screen and they stay locked once finalized.</p>
            </div>
          </div>
          <p class="codex-tip"><strong>Effective stat</strong> = Unit Base + Class Base + Custom. The hex chart on each unit card shows all three layers stacked.</p>
        </section>

        <section class="codex-section" id="codex-actions">
          <h2 class="codex-h2">⚙ Universal Actions</h2>
          <p class="codex-intro">Every unit always has these three on top of their kit.</p>
          <div class="codex-list">
            <div class="codex-action">
              <div class="codex-action-head">Idle</div>
              <p>Wait this action. No MP cost, no damage. Recovers <strong>2% max HP</strong> and <strong>3% max MP</strong>, and your ATB gauge keeps <strong>25% of full</strong> instead of resetting to 0 — so your next turn fires noticeably sooner. Useful for stalling a beat on a slow boss skill, topping off resources, letting a teammate act first, or syncing turns.</p>
            </div>
            <div class="codex-action">
              <div class="codex-action-head">Attack</div>
              <p>Basic strike. No MP, no cooldown. Always available — use it when every skill is on cooldown or you're saving MP. Damage type follows the unit's <code>basicAttackKind</code> (Hera/Nova/Calypso are magical).</p>
            </div>
            <div class="codex-action">
              <div class="codex-action-head">Guard</div>
              <p>Brace until your next action. <strong>Halves all incoming damage</strong> until you act again. No MP cost. Best used the turn before a known boss AOE.</p>
            </div>
          </div>
        </section>

        <section class="codex-section" id="codex-aoe">
          <h2 class="codex-h2">🎯 Single vs AOE</h2>
          <div class="codex-list">
            <div class="codex-pair">
              <div class="codex-pair-label">Single-target</div>
              <p>Full damage to one enemy. Best on bosses or to focus down high-priority targets first. Status effects apply only to the chosen target.</p>
            </div>
            <div class="codex-pair">
              <div class="codex-pair-label">AOE (all enemies)</div>
              <p>Hits every living enemy at <strong>75% damage</strong> per hit. With a five-mob floor that's roughly 3.75× the total damage of a single-target cast — but each AOE costs 50% more MP than its single-target counterpart, and the boss raid plus solo-boss floors get nothing extra from AOE.</p>
            </div>
          </div>
        </section>

        <section class="codex-section" id="codex-shop">
          <h2 class="codex-h2">🛒 Shop &amp; Inventory</h2>
          <p class="codex-intro">The <strong>Tower Exchange</strong> (Home → Shop) carries five item families. Every item can be purchased <strong>once per PH day</strong>; resets at 8 AM PH.</p>
          <div class="codex-list">
            <div class="codex-mode mode-floor">
              <div class="codex-mode-head">Energy Packs</div>
              <p>+5, +10, +20 energy refills. Purchases go to your <strong>Backpack</strong> (top-right home icon). Click <strong>Use</strong> in the Inventory to consume one and refill your energy.</p>
            </div>
            <div class="codex-mode mode-survival">
              <div class="codex-mode-head">Unit Utilities</div>
              <p>Stat Reset and Class Change entitlements (spent from the Units screen). Plus a <strong>Temporary MoTZ Key — 10-Day Seasonal Pass</strong> that unlocks Hera/Nova/Oge/Shego without holding the on-chain key. Stacks if you re-buy before it expires.</p>
            </div>
            <div class="codex-mode mode-bossraid">
              <div class="codex-mode-head">Campaign Buffs</div>
              <p>One-shot run boosts. Bought in packs of charges, then <strong>chosen ONE per floor</strong> from the Squad Select screen. Campaign-mode only — buffs are <em>disabled on Floor 50</em> (World Ender is fair-fight only) and don't appear in Survival/Boss Raid.</p>
            </div>
          </div>
        </section>

        <section class="codex-section" id="codex-buffs-c">
          <h2 class="codex-h2">⚡ Campaign Buffs</h2>
          <p class="codex-intro">Choose one before starting a campaign floor. Each charge is consumed on use.</p>
          <div class="codex-effects">
            ${effectRow("📯", "Battle Cry", "buff", "3 charges per buy. All player ATB gauges start full on the chosen floor — front-load damage on hard fights.")}
            ${effectRow("🔥", "Phoenix Embers", "buff", "2 charges per buy. The first ally to fall during the battle is auto-revived at 50% HP. One use per battle.")}
            ${effectRow("📖", "Scholar's Insight", "buff", "10 charges per buy. +25% XP for the CURRENT floor only — does not carry to other floors of a run.")}
            ${effectRow("⚡", "Quickdraw", "buff", "1 charge per buy. Player ATB gauges fill 25% faster for the entire run.")}
            ${effectRow("🗡", "Last Stand", "buff", "2 charges per buy. When only one of your units remains alive on the battlefield, that unit's damage is doubled.")}
          </div>
          <p class="codex-tip"><strong>Floor 50 (World Ender) disables all buffs.</strong> The capstone fight is intentionally a fair fight — slotted buffs are not consumed and have no effect there.</p>
        </section>

        <section class="codex-section" id="codex-vouchers">
          <h2 class="codex-h2">💰 bRON Vouchers</h2>
          <p class="codex-intro">A rare drop from enemy kills. Vouchers stack in your Inventory by tier; spend them in the Shop or redeem at end of season at 1 bRON = 1 RON. <em>(End-of-season redemption is not redeemable during the first playtest.)</em></p>
          <div class="codex-effects">
            ${effectRow("⚪", "Tier 1", "buff", "1 in 1,000 drop chance per kill — 5 bRON each.")}
            ${effectRow("🔵", "Tier 2", "buff", "1 in 5,000 drop chance per kill — 10 bRON each.")}
            ${effectRow("🟡", "Tier 3", "buff", "1 in 25,000 drop chance per kill — 20 bRON each.")}
            ${effectRow("🟠", "Tier 4", "buff", "1 in 125,000 drop chance per kill — 50 bRON each.")}
            ${effectRow("🌟", "Tier 5", "buff", "1 in 625,000 drop chance per kill — 200 bRON each.")}
          </div>
          <p class="codex-tip"><strong>Boss kills get 2× drop chance per tier</strong>, and the <strong>World Ender drops 4×</strong> — the cosmic-tier boss is the best per-kill chance to score a high-value voucher. Drop rolls happen entirely server-side; a money-bag popup appears over killed enemies as visual feedback.</p>
        </section>

        <section class="codex-section" id="codex-buffs">
          <h2 class="codex-h2">⬆ Buffs</h2>
          <div class="codex-effects">
            ${effectRow("⚔", "Atk Up", "buff", "+X% physical or magical attack for N actions.")}
            ${effectRow("⬆", "Stat Up", "buff", "+X% to a specific stat (STR/DEF/AGI/etc.) for N actions.")}
            ${effectRow("💚", "Heal", "buff", "Instant heal — restores HP at cast time, no duration.")}
            ${effectRow("💨", "Haste", "buff", "ATB gauge fills X% faster for N actions.")}
            ${effectRow("🛡", "Shield", "buff", "Reduce incoming damage by X% for N actions.")}
            ${effectRow("🎯", "Drawing Fire", "buff", "All damage to allies (including each AOE hit) is redirected to this unit.")}
            ${effectRow("🪞", "Damage Reflect", "buff", "Returns X% of damage taken to the attacker. Bosses take HALF the reflected damage. World Ender is fully immune.")}
          </div>
        </section>

        <section class="codex-section" id="codex-debuffs">
          <h2 class="codex-h2">⬇ Debuffs</h2>
          <div class="codex-effects">
            ${effectRow("🔥", "Burn", "debuff", "Take X damage at the start of each of your actions for N actions.")}
            ${effectRow("☠", "Poison", "debuff", "Same as Burn but with a different damage source flavor.")}
            ${effectRow("🩸", "Bleed", "debuff", "Lose 5% of max HP per action — scales with the target's HP, not the attacker's.")}
            ${effectRow("❄", "Freeze", "debuff", "ATB gauge fills 25% slower for N actions.")}
            ${effectRow("💫", "Stun", "debuff", "Skip your next action entirely.")}
            ${effectRow("🔇", "Silence", "debuff", "Can't use skills — only Idle, Attack, Guard.")}
            ${effectRow("🌫", "Blind", "debuff", "−X hit chance — likely to miss your attacks.")}
            ${effectRow("❓", "Confuse", "debuff", "Attacks land on a random combatant (could be your own ally).")}
            ${effectRow("💢", "Vulnerable", "debuff", "+X% damage taken for N actions.")}
          </div>
        </section>

      </div>
    </div>
  `;
  root.querySelector<HTMLButtonElement>("#back-btn")?.addEventListener("click", onBack);

  // TOC click handlers — smooth-scroll to the matching section. scroll-margin-top
  // on each section accounts for the sticky header so the heading lands clear of it.
  root.querySelectorAll<HTMLButtonElement>("[data-codex-jump]").forEach(btn => {
    btn.addEventListener("click", () => {
      const id = `codex-${btn.dataset.codexJump}`;
      const target = root.querySelector<HTMLElement>(`#${id}`);
      if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  });
}

function statCard(key: string, name: string, summary: string, bullets: string[]): string {
  return `
    <div class="codex-stat">
      <div class="codex-stat-head">
        <span class="codex-stat-key">${key}</span>
        <span class="codex-stat-name">${name}</span>
      </div>
      <p>${summary}</p>
      <ul>${bullets.map(b => `<li>${b}</li>`).join("")}</ul>
    </div>
  `;
}

function effectRow(icon: string, name: string, kind: "buff" | "debuff", desc: string): string {
  return `
    <div class="codex-effect codex-effect-${kind}">
      <span class="codex-effect-icon">${icon}</span>
      <span class="codex-effect-name">${name}</span>
      <span class="codex-effect-desc">${desc}</span>
    </div>
  `;
}
