// Referral system — server-authoritative.
//
// Model:
//   referrer  = the player who shares their link
//   referee   = a NEW player who signs up via that link
//
// Attribution: a referee is bound to exactly one referrer, once, at first
// sign-up, and it's immutable thereafter. A wallet that has already played
// (cleared any campaign floor) can't be retro-attributed.
//
// Rewards (5 energy to BOTH referrer and referee, each fires at most once):
//   - Floor milestone: referee clears campaign Floor 20 / 40 / 60 / 80 / 100
//   - RON spend:       referee's lifetime real-RON spend first reaches 10
//
// Anti-abuse: every wallet must hold a gated NFT to play at all (real cost
// barrier), rewards are energy-only (no RON outflow), self-referral is
// blocked, and each reward is guarded by an atomic SETNX so it can't double-pay.
//
// Redis keys:
//   ref:owner:<CODE>          → wallet that owns the referral code
//   ref:by:<refereeWallet>    → referrer wallet (set once, immutable)
//   ref:referees:<referrer>   → hash: field = referee wallet,
//                                     value = JSON { joinedAt, energyEarned }
//   ref:paid:<referee>:<key>  → "1" marker (SETNX) — <key> ∈ f20|f40|…|ron10

import { createHash } from "crypto";
import { getJson, setJson, hgetAll, hset, setNxWithExpire, incrByWithExpire, getNumber, getDelNumber } from "./redis.js";
import { adminGrantEnergy } from "./energy.js";
import { getMaxFloorCleared, IGN_HASH_KEY } from "./runState.js";

const REF_TTL = 60 * 60 * 24 * 365 * 5; // 5 years — referral graph is long-lived

/** Campaign floors that pay a referral reward when the referee clears them. */
export const MILESTONE_FLOORS = [20, 40, 60, 80, 100];
/** Lifetime real-RON spend (by the referee) that triggers the RON reward. */
export const RON_MILESTONE = 10;
/** Energy granted to EACH side per reward event. */
export const REFERRAL_REWARD_ENERGY = 5;

// Crockford-ish charset — no 0/O/1/I/L so codes are unambiguous when typed
// or read aloud. 31 chars ^ 6 ≈ 887M combinations → collisions are negligible.
const CODE_CHARSET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
const CODE_LEN = 6;

/** Deterministic 6-char referral code for a wallet. Same wallet always
 *  derives the same code, so we never need to store the forward mapping. */
export function referralCodeFor(wallet: string, salt = ""): string {
  const h = createHash("sha256").update(wallet.toLowerCase() + salt).digest();
  let code = "";
  for (let i = 0; i < CODE_LEN; i++) {
    code += CODE_CHARSET[h[i] % CODE_CHARSET.length];
  }
  return code;
}

/** Return the wallet's referral code, registering the reverse lookup
 *  (ref:owner:<CODE> → wallet) the first time so capture can resolve it.
 *  Handles the astronomically unlikely collision by salting + retrying. */
export async function ensureReferralCode(wallet: string): Promise<string> {
  const w = wallet.toLowerCase();
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = referralCodeFor(w, attempt === 0 ? "" : `:${attempt}`);
    const ownerKey = `ref:owner:${code}`;
    const existing = await getJson<string>(ownerKey).catch(() => null);
    if (!existing) {
      await setJson(ownerKey, w, REF_TTL).catch(() => undefined);
      return code;
    }
    if (existing.toLowerCase() === w) return code; // already ours
    // collision with a different wallet — salt and try again
  }
  // Extremely unlikely fall-through: return the base code anyway (still
  // displayable; capture just might resolve to the colliding wallet).
  return referralCodeFor(w);
}

/** Resolve a referral code (case-insensitive) to its owner wallet, or null. */
export async function resolveReferralCode(code: string): Promise<string | null> {
  const clean = code.trim().toUpperCase();
  if (!/^[0-9A-Z]{4,12}$/.test(clean)) return null;
  const owner = await getJson<string>(`ref:owner:${clean}`).catch(() => null);
  return owner ? owner.toLowerCase() : null;
}

export interface CaptureResult { ok: boolean; reason?: string; }

/** Bind `referee` to the referrer behind `code`. Rejects if: the code is
 *  unknown, the referee is already referred, the referee has campaign
 *  progress (not a new wallet), or it's a self-referral. Idempotent-safe —
 *  a second call after a successful bind returns ok:false "already referred". */
export async function captureReferral(referee: string, code: string): Promise<CaptureResult> {
  const r = referee.toLowerCase();
  // Immutable once set.
  const existing = await getJson<string>(`ref:by:${r}`).catch(() => null);
  if (existing) return { ok: false, reason: "already referred" };
  // Only a genuinely new wallet (no campaign progress) can be attributed.
  const maxFloor = await getMaxFloorCleared(r).catch(() => 0);
  if (maxFloor > 0) return { ok: false, reason: "not a new wallet — referral links only work on first sign-up" };
  const referrer = await resolveReferralCode(code);
  if (!referrer) return { ok: false, reason: "referral code not found" };
  if (referrer === r) return { ok: false, reason: "you can't refer yourself" };
  // Bind + index for the referrer's dashboard.
  await setJson(`ref:by:${r}`, referrer, REF_TTL);
  await hset(
    `ref:referees:${referrer}`,
    r,
    JSON.stringify({ joinedAt: Date.now(), energyEarned: 0 }),
  );
  return { ok: true };
}

/** Add `amount` to the denormalized energyEarned for one referee row in the
 *  referrer's dashboard hash. Creates the row if it's somehow missing. */
async function bumpRefereeEnergyEarned(referrer: string, referee: string, amount: number): Promise<void> {
  const hashKey = `ref:referees:${referrer}`;
  const cur = await hgetAll(hashKey).catch(() => ({}));
  let entry: { joinedAt: number; energyEarned: number } = { joinedAt: Date.now(), energyEarned: 0 };
  const raw = cur[referee];
  if (raw) { try { entry = JSON.parse(raw); } catch { /* keep default */ } }
  entry.energyEarned = (entry.energyEarned ?? 0) + amount;
  await hset(hashKey, referee, JSON.stringify(entry)).catch(() => undefined);
}

/** Accrue the 5+5 reward for a named milestone, guarded by an atomic SETNX so
 *  it accrues at most once. `rewardKey` ∈ {f20,f40,…,ron10}. No-op if the
 *  referee has no referrer or the reward already fired.
 *
 *  The energy is added to each side's CLAIMABLE balance — it is NOT granted
 *  directly. The player collects it from the referral screen, prompted by a
 *  notification bubble on the home-screen tile. No interrupting popup. */
async function grantReferralReward(referee: string, referrer: string, rewardKey: string): Promise<void> {
  const claimed = await setNxWithExpire(`ref:paid:${referee}:${rewardKey}`, "1", REF_TTL);
  if (!claimed) return; // already accrued — atomic guard
  await Promise.all([
    incrByWithExpire(`ref:claimable:${referee}`, REFERRAL_REWARD_ENERGY, REF_TTL).catch(() => 0),
    incrByWithExpire(`ref:claimable:${referrer}`, REFERRAL_REWARD_ENERGY, REF_TTL).catch(() => 0),
  ]);
  await bumpRefereeEnergyEarned(referrer, referee, REFERRAL_REWARD_ENERGY);
}

/** A wallet's currently-unclaimed referral energy. */
export async function getReferralClaimable(wallet: string): Promise<number> {
  return await getNumber(`ref:claimable:${wallet.toLowerCase()}`).catch(() => 0);
}

/** Collect all of a wallet's unclaimed referral energy. Atomic via GETDEL —
 *  two concurrent claims can't both collect; the loser gets 0. Returns the
 *  amount claimed and the wallet's new energy balance. */
export async function claimReferralRewards(wallet: string): Promise<{ claimed: number; energy: number }> {
  const w = wallet.toLowerCase();
  const amount = await getDelNumber(`ref:claimable:${w}`);
  if (amount <= 0) return { claimed: 0, energy: 0 };
  const energy = await adminGrantEnergy(w, amount).catch(() => 0);
  return { claimed: amount, energy };
}

/** Called after a referee clears a campaign floor. Pays the referral reward
 *  if `stageId` is a milestone floor and hasn't already paid for this referee. */
export async function fireFloorMilestone(referee: string, stageId: number): Promise<void> {
  if (!MILESTONE_FLOORS.includes(stageId)) return;
  const r = referee.toLowerCase();
  const referrer = await getJson<string>(`ref:by:${r}`).catch(() => null);
  if (!referrer) return; // not a referred player — nothing to do
  await grantReferralReward(r, referrer.toLowerCase(), `f${stageId}`);
}

/** Read a wallet's lifetime real-RON spend from the analytics hash. */
async function cumulativeRonSpent(wallet: string): Promise<number> {
  const map = await hgetAll("analytics:ron_spent").catch(() => ({}));
  const w = wallet.toLowerCase();
  // Be case-tolerant — analytics writers should lowercase, but don't miss a
  // reward over a casing mismatch.
  for (const [k, v] of Object.entries(map)) {
    if (k.toLowerCase() === w) return Number(v) || 0;
  }
  return 0;
}

/** Called after a referee makes a real-RON purchase. Pays the one-time RON
 *  reward once their lifetime RON spend first reaches RON_MILESTONE. */
export async function fireRonMilestone(referee: string): Promise<void> {
  const r = referee.toLowerCase();
  const referrer = await getJson<string>(`ref:by:${r}`).catch(() => null);
  if (!referrer) return;
  const spent = await cumulativeRonSpent(r);
  if (spent < RON_MILESTONE) return;
  await grantReferralReward(r, referrer.toLowerCase(), "ron10");
}

export interface ReferralRefereeRow {
  address: string;
  ign: string | null;
  joinedAt: number;
  energyEarned: number;
}
export interface ReferralDashboard {
  code: string;
  referees: ReferralRefereeRow[];
  totalEnergyEarned: number;
  /** Unclaimed referral energy waiting on the referral screen. */
  claimable: number;
  referredBy: string | null;
  referredByIgn: string | null;
}

/** Build the referral dashboard payload for a wallet. */
export async function getReferralDashboard(wallet: string): Promise<ReferralDashboard> {
  const w = wallet.toLowerCase();
  const [code, refereesHash, igns, myReferrer, claimable] = await Promise.all([
    ensureReferralCode(w),
    hgetAll(`ref:referees:${w}`).catch(() => ({})),
    hgetAll(IGN_HASH_KEY).catch(() => ({}) as Record<string, string>),
    getJson<string>(`ref:by:${w}`).catch(() => null),
    getReferralClaimable(w),
  ]);
  // Case-insensitive IGN lookup helper.
  const ignFor = (addr: string): string | null => {
    const lc = addr.toLowerCase();
    for (const [k, v] of Object.entries(igns)) {
      if (k.toLowerCase() === lc) return v || null;
    }
    return null;
  };
  const referees: ReferralRefereeRow[] = Object.entries(refereesHash).map(([addr, raw]) => {
    let joinedAt = 0, energyEarned = 0;
    try {
      const p = JSON.parse(raw) as { joinedAt?: number; energyEarned?: number };
      joinedAt = p.joinedAt ?? 0;
      energyEarned = p.energyEarned ?? 0;
    } catch { /* leave zeros */ }
    return { address: addr, ign: ignFor(addr), joinedAt, energyEarned };
  }).sort((a, b) => b.joinedAt - a.joinedAt);
  const totalEnergyEarned = referees.reduce((s, row) => s + row.energyEarned, 0);
  return {
    code,
    referees,
    totalEnergyEarned,
    claimable,
    referredBy: myReferrer ? myReferrer.toLowerCase() : null,
    referredByIgn: myReferrer ? ignFor(myReferrer) : null,
  };
}
