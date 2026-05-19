import { getJson, setJson, del, zaddGt, zaddLt, zrangeWithScores, zrevrank, zrevrange, incrWithExpire, hset, hmget, hgetAll, incrBy, incrByWithExpire, getNumber, isPrefixedEnvironment, scanAllPrefixed, scanAllByPattern, delManyRaw, withWalletLock } from "./redis.js";
import { bumpVouchersAcquired } from "./analytics.js";

// ---- Admin: leaderboard resets ----
export type AdminResetScope = "survival" | "bossraid" | "we" | "conquer";

export async function adminClearLeaderboard(scope: AdminResetScope): Promise<string[]> {
  const keys: string[] = [];
  if (scope === "survival") keys.push(LB_KEYS.survival);
  else if (scope === "bossraid") keys.push(LB_KEYS.boss_raid);
  else if (scope === "we") keys.push(WORLD_ENDER_LB_KEY);
  else if (scope === "conquer") keys.push(FIRST_CONQUER_KEY);
  for (const k of keys) await del(k).catch(() => undefined);
  return keys;
}

/** Bulk wipe — kept for emergencies but the UI now exposes per-board buttons. */
export async function adminClearAllLeaderboards(): Promise<string[]> {
  const all: AdminResetScope[] = ["survival", "bossraid", "we", "conquer"];
  const keys: string[] = [];
  for (const s of all) keys.push(...await adminClearLeaderboard(s));
  return keys;
}

/** DEV-ONLY: wipe every Redis key under the current KEY_PREFIX. Returns
 *  { ok, deleted, scanned }. Hard-refuses to run when no KEY_PREFIX is set
 *  (production), so this can never accidentally nuke live data. */
export async function adminWipeDevData(): Promise<{ ok: boolean; reason?: string; scanned: number; deleted: number }> {
  if (!isPrefixedEnvironment()) {
    return { ok: false, reason: "KEY_PREFIX not set — refusing to wipe an un-prefixed (likely production) keyspace.", scanned: 0, deleted: 0 };
  }
  const keys = await scanAllPrefixed();
  if (keys.length === 0) return { ok: true, scanned: 0, deleted: 0 };
  const deleted = await delManyRaw(keys);
  return { ok: true, scanned: keys.length, deleted };
}

/** Wipe EVERY known game-related key in Redis (production-safe in the sense
 *  that the API op is admin-gated). Targets each top-level prefix the game
 *  uses so we don't accidentally nuke unrelated keys if the Upstash instance
 *  is ever shared. Returns aggregate scanned/deleted counts. */
/** Monotonic counter incremented every time a prod wipe runs. The client
 *  reads this at session-check time, compares against its cached value, and
 *  if higher (i.e. a wipe happened since last visit) does localStorage.clear()
 *  + reload. This is the safety net that catches CDN-cached old clients and
 *  weird browser state that the per-key reconciliation might miss. */
export const WIPE_EPOCH_KEY = "wipe_epoch";

export async function readWipeEpoch(): Promise<number> {
  return await getNumber(WIPE_EPOCH_KEY);
}

export async function adminWipeAllData(): Promise<{ ok: boolean; scanned: number; deleted: number; patternHits: Record<string, number> }> {
  // Every top-level pattern the game writes to. Update when adding new keyspaces.
  const PATTERNS = [
    "progress:*",
    "energy:*",
    "lb:*",              // covers lb:survival:v1, lb:bossraid:v1, lb:world_ender_fastest:v1
    "achievement:*",     // covers achievement:first_conquer:v1 (was incorrectly listed as "first_conquer")
    "attempts:*",
    "retries:*",
    "shop:*",
    "paymenttx:*",
    "bronroll:*",
    "analytics:*",       // covers analytics:total_ron_revenue too — full nuke per ops decision
    "pendingClears:*",
    "season:*",
    "run:*",
    "starts:*",
    "replay:*",          // saved replay blobs (replay:scope:address)
    "tempkey:*",         // temporary MoTZ key (seasonal pass) expiry records
    "ign_set_at",
    "igns",              // IGN registry — full nuke per ops decision
    "maxfloor:*",        // was wrong as "max_floor:*" — actual key uses no underscore
    "xpcap:*",
    "challenges:*",
    "daily:*",
  ];
  const patternHits: Record<string, number> = {};
  let totalScanned = 0;
  let totalDeleted = 0;
  for (const pattern of PATTERNS) {
    const keys = await scanAllByPattern(pattern);
    patternHits[pattern] = keys.length;
    totalScanned += keys.length;
    if (keys.length === 0) continue;
    const deleted = await delManyRaw(keys);
    totalDeleted += deleted;
  }
  // Belt-and-suspenders: enumerate every wallet that ever appeared in an
  // analytics hash and DEL its per-wallet keys directly. Catches anything the
  // pattern scan misses (e.g. a future keyspace we forgot to add to PATTERNS,
  // or an Upstash SCAN quirk that skipped a shard). Since these are explicit
  // GETs by full key name, they bypass SCAN entirely and route through the
  // normal prefix-aware command pipeline.
  try {
    const walletSources = await Promise.all([
      hgetAll("analytics:minutes").catch(() => ({})),
      hgetAll("analytics:ron_spent").catch(() => ({})),
      hgetAll("analytics:vouchers_acquired").catch(() => ({})),
      hgetAll("analytics:vouchers_spent").catch(() => ({})),
      hgetAll("analytics:energy_used").catch(() => ({})),
      hgetAll("igns").catch(() => ({})),
    ]);
    const wallets = new Set<string>();
    for (const src of walletSources) for (const k of Object.keys(src)) wallets.add(k.toLowerCase());
    const PER_WALLET_PREFIXES = [
      "progress:", "xpcap:", "energy:", "maxfloor:", "shop:", "attempts:",
      "retries:", "starts:", "pendingClears:", "challenges:", "daily:", "season:",
      "tempkey:motz:", "replay:campaign:", "replay:survival:", "replay:boss_raid:",
    ];
    let directDeleted = 0;
    for (const wallet of wallets) {
      for (const prefix of PER_WALLET_PREFIXES) {
        const n = await del(`${prefix}${wallet}`).catch(() => 0);
        if (typeof n === "number") directDeleted += n;
      }
    }
    patternHits["__direct_per_wallet"] = directDeleted;
    totalDeleted += directDeleted;
  } catch {
    // Direct-delete is a safety net — don't fail the whole wipe if it errors.
  }
  // Bump the wipe epoch LAST, after deletes, so clients pulling concurrently
  // either see the old epoch (and stale data, which is fine — they'll catch
  // up next poll) or the new epoch (and reload into a clean state).
  await incrBy(WIPE_EPOCH_KEY, 1).catch(() => 0);
  return { ok: true, scanned: totalScanned, deleted: totalDeleted, patternHits };
}

// A live survival run. Stored at Redis key `run:{runId}` with a TTL.
export interface RunState {
  address: string;
  mode: LbMode;
  startedAt: number;       // ms epoch (server clock)
  currentFloor: number;    // count of bosses/floors cleared; 0 = none cleared yet
  lastFloorAt: number;     // ms epoch when currentFloor was cleared (or startedAt)
  status: "live" | "ended";
}

const RUN_TTL_SECONDS = 60 * 60 * 2; // 2 hours — must beat the JWT exp.
export type LbMode = "survival" | "boss_raid";
export const LB_KEYS: Record<LbMode, string> = {
  survival: "lb:survival:v1",
  boss_raid: "lb:bossraid:v1",
};
// Back-compat default key (existing references).
export const LB_KEY = LB_KEYS.survival;
export function lbKeyFor(mode: LbMode): string { return LB_KEYS[mode]; }
export function isLbMode(s: unknown): s is LbMode {
  return s === "survival" || s === "boss_raid";
}
export const IGN_HASH_KEY = "igns";
export const IGN_SET_AT_KEY = "ign_set_at";
const MAX_IGN_LEN = 24;
export const IGN_CHANGE_COOLDOWN_MS = Number(process.env.LB_IGN_COOLDOWN_MS ?? 7 * 24 * 60 * 60 * 1000);

export function sanitizeIgn(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  // Strip control chars, collapse whitespace, trim, cap length.
  const cleaned = raw.replace(/[\x00-\x1f\x7f]/g, "").replace(/\s+/g, " ").trim();
  if (!cleaned) return null;
  return cleaned.slice(0, MAX_IGN_LEN);
}

export type IgnUpdateResult =
  | { kind: "saved"; ign: string }
  | { kind: "unchanged"; ign: string }
  | { kind: "cooldown"; ign: string; nextAllowedAt: number };

// Idempotent IGN write with 7-day cooldown for changes (not for first-time set).
export async function setIgnIfAllowed(address: string, ign: string): Promise<IgnUpdateResult> {
  const addr = address.toLowerCase();
  const [existing, setAtRaw] = await hmget(IGN_HASH_KEY, [addr]).then(async ([cur]) => {
    const [t] = await hmget(IGN_SET_AT_KEY, [addr]);
    return [cur, t] as const;
  });

  if (existing && existing === ign) return { kind: "unchanged", ign };

  if (existing && existing !== ign) {
    const setAt = setAtRaw ? Number(setAtRaw) : 0;
    const elapsed = Date.now() - (Number.isFinite(setAt) ? setAt : 0);
    if (elapsed < IGN_CHANGE_COOLDOWN_MS) {
      return { kind: "cooldown", ign: existing, nextAllowedAt: setAt + IGN_CHANGE_COOLDOWN_MS };
    }
  }

  await hset(IGN_HASH_KEY, addr, ign);
  await hset(IGN_SET_AT_KEY, addr, String(Date.now()));
  return { kind: "saved", ign };
}

// Anti-cheat: minimum average ms per cleared floor enforced at /end.
// Real fast clears are allowed; pure spam (e.g. 50 floor pings in 1s) is rejected.
export const MIN_AVG_FLOOR_MS = Number(process.env.LB_MIN_AVG_FLOOR_MS ?? 2000);
// Cap submitted floor so a forged client can't claim absurd numbers.
export const MAX_FLOOR = Number(process.env.LB_MAX_FLOOR ?? 50);
// Per-wallet rate-limit on /run/start.
export const MAX_STARTS_PER_HOUR = Number(process.env.LB_MAX_STARTS_PER_HOUR ?? 30);

export function runKey(runId: string): string { return `run:${runId}`; }
export function startsKey(address: string): string { return `starts:${address.toLowerCase()}`; }

export async function getRun(runId: string): Promise<RunState | null> {
  return getJson<RunState>(runKey(runId));
}

export async function saveRun(runId: string, state: RunState): Promise<void> {
  await setJson(runKey(runId), state, RUN_TTL_SECONDS);
}

export async function deleteRun(runId: string): Promise<void> {
  await del(runKey(runId));
}

export async function bumpStartCounter(address: string): Promise<number> {
  return incrWithExpire(startsKey(address), 60 * 60);
}

// Leaderboard score encoding: higher floor first, then lower ms first.
// score = floor * MS_BUCKET + (MS_BUCKET - 1 - clamp(ms))
// This keeps each floor's scores inside its own bucket [floor*B, (floor+1)*B)
// so decoding is unambiguous regardless of ms.
const MS_BUCKET = 1e10; // 1e10 ms = ~115 days, safely larger than any real run.
export function encodeScore(floor: number, ms: number): number {
  const clampedMs = Math.max(0, Math.min(MS_BUCKET - 1, Math.floor(ms)));
  return floor * MS_BUCKET + (MS_BUCKET - 1 - clampedMs);
}
export function decodeScore(score: number): { floor: number; ms: number } {
  const floor = Math.floor(score / MS_BUCKET);
  const rest = score - floor * MS_BUCKET;
  const ms = MS_BUCKET - 1 - rest;
  return { floor, ms };
}

export async function submitToLeaderboard(address: string, floor: number, ms: number, mode: LbMode = "survival"): Promise<{ improved: boolean }> {
  const changed = await zaddGt(lbKeyFor(mode), encodeScore(floor, ms), address.toLowerCase());
  return { improved: changed > 0 };
}

// ---- "First to Conquer the Tower" — first wallet to clear floors 1..50 sequentially in floor mode ----
// Tracking: maxFloorCleared:{addr} stores the highest contiguous floor cleared.
// We only bump it when the new clear is exactly maxCleared + 1, so claiming
// floor 50 without clearing the prior ones doesn't count. The achievement
// itself is a single record persisted via SETNX so only the first wallet to
// reach 50 wins.
export const FIRST_CONQUER_KEY = "achievement:first_conquer:v1";
export const TOWER_FINAL_FLOOR = 50;
export const SURVIVAL_FINAL_FLOOR = 50;  // legacy export, unused

export interface FirstConquerPartyMember {
  templateId: string;
  classId?: string;
  level: number;
  customStats: Record<string, number>;
  equippedSkills: string[];
}

export interface FirstConquerRecord {
  address: string;
  /** Wallclock when the achievement was awarded (no run-time tracked). */
  when: number;
  /** Party that was on the floor-50 clear that earned the trophy. Optional for back-compat with v1 records. */
  party?: FirstConquerPartyMember[];
}

function maxFloorKey(address: string): string { return `maxfloor:${address.toLowerCase()}`; }

export async function getMaxFloorCleared(address: string): Promise<number> {
  return await getNumber(maxFloorKey(address));
}

/** Returns true if THIS clear advanced the max-cleared counter and minted the
 *  conqueror record. Only call from the floor-mode "clear" event after the
 *  client has reported a successful stageId clear. */
export async function recordFloorModeClear(address: string, stageId: number, party?: FirstConquerPartyMember[]): Promise<{ newMax: number; awardedConqueror: boolean }> {
  const cur = await getMaxFloorCleared(address);
  let newMax = cur;
  // Sequential rule: only bump if this is the next floor in line. Prevents
  // someone clearing floor 5 from being credited as having cleared 1-4.
  if (stageId === cur + 1) {
    newMax = stageId;
    await setJson(maxFloorKey(address), newMax, 60 * 60 * 24 * 365 * 5);
  }
  let awardedConqueror = false;
  if (newMax >= TOWER_FINAL_FLOOR) {
    awardedConqueror = await setNxJson(FIRST_CONQUER_KEY, {
      address: address.toLowerCase(),
      when: Date.now(),
      ...(party ? { party } : {}),
    } as FirstConquerRecord);
  }
  return { newMax, awardedConqueror };
}

export async function getFirstConquer(): Promise<FirstConquerRecord | null> {
  return await getJson<FirstConquerRecord>(FIRST_CONQUER_KEY);
}

// SETNX with JSON value. Returns true if newly set.
async function setNxJson<T>(key: string, value: T): Promise<boolean> {
  const { setNxWithExpire } = await import("./redis.js");
  // No expiry for permanent achievements: pass a very long TTL.
  return await setNxWithExpire(key, JSON.stringify(value), 60 * 60 * 24 * 365 * 10);
}

// ---- Floor-mode free retries — capped per wallet per PH day ----
export const FLOOR_RETRIES_PER_DAY = 3;
const PH_OFFSET_MS = 8 * 60 * 60 * 1000;
const RESET_HOUR = 8;

function phDayBoundary(now = Date.now()): number {
  const phNow = new Date(now + PH_OFFSET_MS);
  const phY = phNow.getUTCFullYear();
  const phM = phNow.getUTCMonth();
  const phD = phNow.getUTCDate();
  const phH = phNow.getUTCHours();
  const dayOffset = phH < RESET_HOUR ? -1 : 0;
  return Date.UTC(phY, phM, phD + dayOffset, RESET_HOUR) - PH_OFFSET_MS;
}

function retriesKey(address: string): string {
  return `retries:floor:${address.toLowerCase()}:${phDayBoundary()}`;
}

/** Atomic increment with TTL set to the next PH boundary. Returns the new count. */
export async function bumpFloorRetry(address: string): Promise<number> {
  const remainingMs = phDayBoundary() + 24 * 60 * 60 * 1000 - Date.now();
  const ttl = Math.max(60, Math.floor(remainingMs / 1000));
  return await incrWithExpire(retriesKey(address), ttl);
}

/** Read current count without incrementing. */
export async function readFloorRetries(address: string): Promise<number> {
  return await getNumber(retriesKey(address));
}

// ---- Daily attempt caps for Survival / Boss Raid (3/day, server-enforced) ----
// Same PH-day TTL pattern as floor retries — devtools can't bypass.
export const SURVIVAL_ATTEMPTS_PER_DAY = 3;
export const BOSSRAID_ATTEMPTS_PER_DAY = 3;

function attemptsKey(mode: "survival" | "boss_raid", address: string): string {
  return `attempts:${mode}:${address.toLowerCase()}:${phDayBoundary()}`;
}

export async function readAttempts(mode: "survival" | "boss_raid", address: string): Promise<number> {
  return await getNumber(attemptsKey(mode, address));
}

/** Atomic increment with PH-day TTL. Returns the new count after bumping. */
export async function bumpAttempts(mode: "survival" | "boss_raid", address: string): Promise<number> {
  const remainingMs = phDayBoundary() + 24 * 60 * 60 * 1000 - Date.now();
  const ttl = Math.max(60, Math.floor(remainingMs / 1000));
  return await incrWithExpire(attemptsKey(mode, address), ttl);
}

export function attemptsCap(mode: "survival" | "boss_raid"): number {
  return mode === "survival" ? SURVIVAL_ATTEMPTS_PER_DAY : BOSSRAID_ATTEMPTS_PER_DAY;
}

// ---- Shop inventory & daily-buy tracker ----
// All shop items are 1/day max — same Redis daily-counter shape, but keyed per item.
// Owned consumables (unconsumed buffs etc.) live in a JSON blob per wallet so we
// can read/write the full inventory atomically. Cosmetics / titles will use the
// same blob with a separate "owned" array.

export type ShopItemId =
  | "energy_5" | "energy_10" | "energy_20"
  | "unit_stat_reset" | "unit_class_change" | "unit_temp_motz_key"
  | "buff_battle_cry" | "buff_phoenix_embers" | "buff_scholars_insight"
  | "buff_quickdraw" | "buff_last_stand";

export const SHOP_BUFF_IDS: ShopItemId[] = [
  "buff_battle_cry", "buff_phoenix_embers", "buff_scholars_insight",
  "buff_quickdraw", "buff_last_stand",
];

/** Per-buff grant size (how many charges a single purchase adds to inventory).
 *  Defaults to 1; bumped for buffs the design intends as multi-use packs. */
export const BUFF_GRANT_SIZE: Partial<Record<ShopItemId, number>> = {
  buff_battle_cry: 3,
  buff_phoenix_embers: 2,
  buff_scholars_insight: 10,
  buff_last_stand: 2,
};

// ---- Temporary MoTZ Key (seasonal pass purchased via shop) ----
// Stored as a JSON blob with an expiresAt timestamp. auth/me OR's this into
// perks.motzKey so locked units unlock without holding the on-chain key.
export const TEMP_KEY_DURATION_MS = 10 * 24 * 60 * 60 * 1000; // 10 days
interface TempMotzKey { expiresAt: number; }
function tempKeyKey(address: string): string { return `tempkey:motz:${address.toLowerCase()}`; }

export async function readTempMotzKey(address: string): Promise<TempMotzKey | null> {
  return await getJson<TempMotzKey>(tempKeyKey(address));
}
export async function grantTempMotzKey(address: string): Promise<{ expiresAt: number }> {
  // Stack the new pass on top of any existing time remaining so back-to-back
  // purchases extend rather than reset.
  const cur = await readTempMotzKey(address);
  const base = cur && cur.expiresAt > Date.now() ? cur.expiresAt : Date.now();
  const expiresAt = base + TEMP_KEY_DURATION_MS;
  const ttlSec = Math.max(60, Math.floor((expiresAt - Date.now()) / 1000));
  await setJson(tempKeyKey(address), { expiresAt }, ttlSec);
  return { expiresAt };
}
export async function hasActiveTempMotzKey(address: string): Promise<boolean> {
  const cur = await readTempMotzKey(address);
  return !!cur && cur.expiresAt > Date.now();
}

// ---- RON vouchers ----
// Dropped via rollBronForKills and stored in the wallet's shop inventory as
// per-tier voucher counts (inventory.vouchers.{t1..t5}). There is no separate
// running "balance" — players redeem the tier vouchers at end of season for
// their RON value. The previous balance ledger was removed because we want
// the player to see what they actually own, not an aggregated total.

// ---- Server-authoritative RON drop roller ----
// All drop randomness lives on the server. The client reports kill events
// (enemyTemplateId + isBoss flag); the server validates count caps, rolls
// using Node crypto, and returns the per-tier breakdown alongside the new
// balance. This makes the system devtools-proof: there's nothing on the
// client to tamper with except the kill counts, and those are capped well
// below what would produce meaningful expected gain.

/** Hard caps per single bron_roll call. A normal floor has 3-30 enemies and
 *  at most one boss; these are intentionally generous so legit play never
 *  trips them, but tight enough that a tampered client can't fake huge runs.
 *  Survival/boss-raid can clear MANY floors → bump the mob cap to cover that. */
export const MAX_KILLS_PER_ROLL = 50;
export const MAX_BOSS_KILLS_PER_ROLL = 13;     // survival has 13 boss floors max
export const MAX_WORLD_ENDER_KILLS_PER_ROLL = 1; // there's exactly one

/** Daily ceiling on cumulative kills credited to bron rolls. Without this the
 *  per-call cap is meaningless — a script could call bron_roll N times per
 *  PH-day. Even with max 3 boss-raid attempts (3×13=39 bosses), 3 survival
 *  runs (~3×50=150 mobs), and 50 campaign floors (~50×30=1500 mobs + ~10 bosses
 *  + 1 WE), a legit player tops out around 1700 mobs / 50 bosses / 1 WE per
 *  day. We give 2× headroom so streaks of fast clears don't trip it. */
export const MAX_KILLS_PER_DAY = 3500;
export const MAX_BOSS_KILLS_PER_DAY = 100;
export const MAX_WORLD_ENDER_KILLS_PER_DAY = 4;
function bronRollDailyKey(address: string, scope: "mob" | "boss" | "we"): string {
  return `bronroll:${scope}:${address.toLowerCase()}:${phDayBoundary()}`;
}
async function readBronRollUsed(address: string): Promise<{ mob: number; boss: number; we: number }> {
  const [m, b, w] = await Promise.all([
    getNumber(bronRollDailyKey(address, "mob")),
    getNumber(bronRollDailyKey(address, "boss")),
    getNumber(bronRollDailyKey(address, "we")),
  ]);
  return { mob: m, boss: b, we: w };
}
async function addBronRollUsed(address: string, mob: number, boss: number, we: number): Promise<void> {
  const remainingMs = phDayBoundary() + 24 * 60 * 60 * 1000 - Date.now();
  const ttl = Math.max(60, Math.floor(remainingMs / 1000));
  const ops: Promise<number>[] = [];
  if (mob > 0)  ops.push(incrByWithExpire(bronRollDailyKey(address, "mob"),  mob,  ttl));
  if (boss > 0) ops.push(incrByWithExpire(bronRollDailyKey(address, "boss"), boss, ttl));
  if (we > 0)   ops.push(incrByWithExpire(bronRollDailyKey(address, "we"),   we,   ttl));
  await Promise.all(ops);
}

/** Drop tiers — chance / amount paired. Rarest first so we break on first hit. */
const BRON_DROP_TABLE: { tier: "t1" | "t2" | "t3" | "t4" | "t5"; chance: number; amount: number }[] = [
  { tier: "t5", chance: 0.0000016, amount: 200 },
  { tier: "t4", chance: 0.000008,  amount: 50 },
  { tier: "t3", chance: 0.00004,   amount: 20 },
  { tier: "t2", chance: 0.0002,    amount: 10 },
  { tier: "t1", chance: 0.001,     amount: 5 },
];

/** Drop-chance multipliers per kill tier. Bosses double; World Ender quadruples.
 *  Even with the 4× cap on World Ender, T5 remains 0.00064% — rare reward. */
export const BOSS_DROP_MULTIPLIER = 2.0;
export const WORLD_ENDER_DROP_MULTIPLIER = 4.0;

/** Face value of each voucher tier in RON (whole units). Source of truth for
 *  the voucher-pay path in the shop. Server uses this to validate that the
 *  submitted vouchers cover the item's RON price — devtool-tampered client
 *  values are ignored, only these constants are trusted. */
export const VOUCHER_VALUES_RON: Record<"t1" | "t2" | "t3" | "t4" | "t5", number> = {
  t1: 5, t2: 10, t3: 20, t4: 50, t5: 200,
};

export interface BronRollResult {
  drops: { t1: number; t2: number; t3: number; t4: number; t5: number; total: number };
  killsCounted: number;
  bossKillsCounted: number;
  worldEnderKillsCounted: number;
}

/** Server-side roll: takes the claimed kill counts by tier (mob/boss/world_ender),
 *  applies caps, rolls each kill independently with Node's crypto RNG using the
 *  tier's drop multiplier, deposits the resulting vouchers into the wallet's
 *  shop inventory, and returns the per-tier breakdown. There is no running
 *  RON "balance" anymore — each tier voucher is its own inventory item. */
export async function rollBronForKills(
  address: string,
  kills: number,
  bossKills: number,
  worldEnderKills: number,
): Promise<BronRollResult> {
  // Per-call cap first (per-floor / per-run sanity bound).
  let safeMob  = Math.max(0, Math.min(MAX_KILLS_PER_ROLL, Math.floor(kills)));
  let safeBoss = Math.max(0, Math.min(MAX_BOSS_KILLS_PER_ROLL, Math.floor(bossKills)));
  let safeWE   = Math.max(0, Math.min(MAX_WORLD_ENDER_KILLS_PER_ROLL, Math.floor(worldEnderKills)));
  // Per-day cap second (anti-scripted-spam). We TRIM the over-cap portion
  // rather than reject — that way a player who hits the cap mid-day still
  // gets credit for the partial roll and the rest is silently ignored.
  const used = await readBronRollUsed(address);
  safeMob  = Math.max(0, Math.min(safeMob,  MAX_KILLS_PER_DAY        - used.mob));
  safeBoss = Math.max(0, Math.min(safeBoss, MAX_BOSS_KILLS_PER_DAY   - used.boss));
  safeWE   = Math.max(0, Math.min(safeWE,   MAX_WORLD_ENDER_KILLS_PER_DAY - used.we));
  const drops = { t1: 0, t2: 0, t3: 0, t4: 0, t5: 0, total: 0 };

  function rollOnce(mul: number): void {
    for (const t of BRON_DROP_TABLE) {
      const chance = Math.min(1, t.chance * mul);
      if (cryptoRandomFloat() < chance) {
        drops[t.tier] += 1;
        drops.total += t.amount;
        return;
      }
    }
  }

  for (let i = 0; i < safeMob; i++)  rollOnce(1.0);
  for (let i = 0; i < safeBoss; i++) rollOnce(BOSS_DROP_MULTIPLIER);
  for (let i = 0; i < safeWE; i++)   rollOnce(WORLD_ENDER_DROP_MULTIPLIER);

  // Atomically record the kills consumed against the daily budget BEFORE
  // depositing vouchers, so a concurrent call sees the updated cap usage.
  await addBronRollUsed(address, safeMob, safeBoss, safeWE);

  // Deposit vouchers into the wallet's shop inventory (atomic via lock).
  if (drops.t1 + drops.t2 + drops.t3 + drops.t4 + drops.t5 > 0) {
    await mutateShopInventory(address, inv => {
      inv.vouchers = inv.vouchers ?? {};
      inv.vouchers.t1 = (inv.vouchers.t1 ?? 0) + drops.t1;
      inv.vouchers.t2 = (inv.vouchers.t2 ?? 0) + drops.t2;
      inv.vouchers.t3 = (inv.vouchers.t3 ?? 0) + drops.t3;
      inv.vouchers.t4 = (inv.vouchers.t4 ?? 0) + drops.t4;
      inv.vouchers.t5 = (inv.vouchers.t5 ?? 0) + drops.t5;
      return { next: inv, result: true };
    });
    // Analytics: lifetime RON value of vouchers acquired. `drops.total` is
    // already the summed RON value (BRON_DROP_TABLE amounts).
    void bumpVouchersAcquired(address, drops.total);
  }

  return {
    drops,
    killsCounted: safeMob,
    bossKillsCounted: safeBoss,
    worldEnderKillsCounted: safeWE,
  };
}

/** Cryptographically random float in [0, 1). Server-side equivalent of
 *  Math.random() with much higher entropy — no RNG state to predict. */
function cryptoRandomFloat(): number {
  // Use Node crypto if available; fall back to Math.random in unexpected envs.
  // 53-bit float construction so chances down to ~1e-16 are reachable.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const c: typeof import("crypto") | null = (() => {
    try { return require("crypto") as typeof import("crypto"); } catch { return null; }
  })();
  if (!c) return Math.random();
  const buf = c.randomBytes(7);
  // Pack 53 bits across two halves: 21 bits + 32 bits, divided by 2^53.
  const hi = buf.readUIntBE(0, 3) & 0x1fffff;
  const lo = buf.readUInt32BE(3);
  return (hi * 0x100000000 + lo) / 0x20000000000000;
}

interface ShopInventory {
  /** Map of buff id → count owned (un-consumed). Buffs are 1/day buy, so the
   *  daily-bought key prevents re-purchase, while count tracks unused stock. */
  buffs: Partial<Record<ShopItemId, number>>;
  /** Per-tier RON voucher stash. Server is the only writer (via rollBronForKills).
   *  Held until end-of-season redemption. Missing → all zero. */
  vouchers?: { t1?: number; t2?: number; t3?: number; t4?: number; t5?: number };
}

function shopBoughtKey(itemId: ShopItemId, address: string): string {
  return `shop:bought:${itemId}:${address.toLowerCase()}:${phDayBoundary()}`;
}
function shopInventoryKey(address: string): string {
  return `shop:inv:${address.toLowerCase()}`;
}
function shopInventoryLockKey(address: string): string {
  return `shop:inv:lock:${address.toLowerCase()}`;
}
const SHOP_INV_TTL = 60 * 60 * 24 * 365; // 1 year — inventory persists indefinitely

/** Per-wallet atomic mutation of shop inventory. All voucher / buff writes
 *  MUST go through this — bare readShopInventory + writeShopInventory pairs
 *  race against concurrent shop_buy_voucher / rollBronForKills / consumeBuff
 *  calls and can lose updates ("last write wins" overwrites the other's
 *  deduction, effectively duplicating items or eating vouchers).
 *
 *  The mutator function returns the next inventory + an optional result
 *  payload; the helper returns the result. Returns null if the lock could
 *  not be acquired within the retry budget (extreme contention). */
export async function mutateShopInventory<T>(
  address: string,
  mutator: (inv: ShopInventory) => { next: ShopInventory; result: T } | Promise<{ next: ShopInventory; result: T }>,
): Promise<T | null> {
  const r = await withWalletLock(shopInventoryLockKey(address), async () => {
    const inv = await readShopInventory(address);
    const { next, result } = await mutator(inv);
    await writeShopInventory(address, next);
    return result;
  }, { ttlSeconds: 5, retries: 12, retryMs: 60 });
  return r ?? null;
}

export async function readShopInventory(address: string): Promise<ShopInventory> {
  const raw = await getJson<ShopInventory>(shopInventoryKey(address));
  if (raw && typeof raw === "object" && raw.buffs && typeof raw.buffs === "object") {
    const vouchers = raw.vouchers && typeof raw.vouchers === "object" ? raw.vouchers : {};
    return { buffs: raw.buffs, vouchers };
  }
  return { buffs: {}, vouchers: {} };
}
export async function writeShopInventory(address: string, inv: ShopInventory): Promise<void> {
  await setJson(shopInventoryKey(address), inv, SHOP_INV_TTL);
}

/** True if this wallet has already bought `itemId` since the last PH-day boundary. */
export async function readBoughtToday(itemId: ShopItemId, address: string): Promise<boolean> {
  const n = await getNumber(shopBoughtKey(itemId, address));
  return n > 0;
}
/** Atomically marks `itemId` as bought today. Returns the post-bump count
 *  (>1 means a duplicate buy raced and should be rejected by the caller). */
export async function markBoughtToday(itemId: ShopItemId, address: string): Promise<number> {
  const remainingMs = phDayBoundary() + 24 * 60 * 60 * 1000 - Date.now();
  const ttl = Math.max(60, Math.floor(remainingMs / 1000));
  return await incrWithExpire(shopBoughtKey(itemId, address), ttl);
}

/** Consume one of an owned buff. Returns true if the consume happened. */
export async function consumeBuff(address: string, itemId: ShopItemId): Promise<boolean> {
  const result = await mutateShopInventory<boolean>(address, inv => {
    const cur = inv.buffs[itemId] ?? 0;
    if (cur <= 0) return { next: inv, result: false };
    inv.buffs[itemId] = cur - 1;
    return { next: inv, result: true };
  });
  return result === true;
}

// ---- "Fastest to Kill World Ender" — floor-50 single-battle clears ----
// Tracked separately from the survival/boss-raid leaderboards because this
// is specifically about the standalone Floor 50 fight in normal floor mode.
export const WORLD_ENDER_LB_KEY = "lb:world_ender_fastest:v1";
// Minimum acceptable clear time (server side anti-cheat). Lowered to 2s after
// World End! (50% AOE instant-kill) + reflect builds made sub-10s clears
// legitimately possible — anything well under 2s is almost certainly tampered.
// At the same time the boss's "instant_kill" skill can itself one-shot players,
// so fights ARE genuinely fast when the rolls go right.
export const MIN_WORLD_ENDER_MS = 2_000;
export const MAX_WORLD_ENDER_MS = 30 * 60 * 1000; // 30 min, sanity cap.

export async function submitWorldEnderClear(address: string, ms: number): Promise<{ ok: boolean; improved: boolean }> {
  if (ms < MIN_WORLD_ENDER_MS || ms > MAX_WORLD_ENDER_MS) return { ok: false, improved: false };
  // LT: only persist if this is a faster time than the wallet's current best.
  const changed = await zaddLt(WORLD_ENDER_LB_KEY, ms, address.toLowerCase());
  return { ok: true, improved: changed > 0 };
}

export interface WorldEnderEntry { rank: number; address: string; ign: string | null; ms: number; }

export async function getWorldEnderTop(limit = 3): Promise<WorldEnderEntry[]> {
  const rows = await zrangeWithScores(WORLD_ENDER_LB_KEY, 0, limit - 1);
  if (rows.length === 0) return [];
  const igns = await hmget(IGN_HASH_KEY, rows.map(r => r.member));
  return rows.map((r, i) => ({ rank: i + 1, address: r.member, ign: igns[i] ?? null, ms: r.score }));
}

// ---- Replay storage ----
const REPLAY_TTL_SECONDS = 60 * 60 * 24 * 365;  // 1 year — replays for a permanent leaderboard
export function replayKey(scope: string, address: string): string {
  return `replay:${scope}:${address.toLowerCase()}`;
}
export async function saveReplayBlob(scope: string, address: string, blob: unknown): Promise<void> {
  await setJson(replayKey(scope, address), blob, REPLAY_TTL_SECONDS);
}
export async function loadReplayBlob<T = unknown>(scope: string, address: string): Promise<T | null> {
  return await getJson<T>(replayKey(scope, address));
}
export async function deleteReplayBlob(scope: string, address: string): Promise<void> {
  await del(replayKey(scope, address));
}

/** Number of replays we keep per leaderboard. Anything outside the top N gets pruned. */
export const REPLAY_TOP_N = 3;

/** Replay-storage scope name for an LbMode (matches the client's scope strings). */
export function replayScopeFor(mode: LbMode): string {
  return mode === "survival" ? "lb_survival" : "lb_bossraid";
}

/**
 * Save the replay for `address` if their CURRENT leaderboard rank is inside the
 * top N, then delete every replay for ranks outside the top N. Call this after
 * `submitToLeaderboard` so the rank reflects the just-submitted score.
 *
 * Idempotent: safe to call even when nothing changed (it'll just re-prune any
 * stale replays beyond the cutoff).
 */
export async function syncTopReplays(
  mode: LbMode,
  address: string,
  replay: unknown | null,
): Promise<void> {
  const lbKey = lbKeyFor(mode);
  const scope = replayScopeFor(mode);
  const addr = address.toLowerCase();

  // 1. Save the new replay only if this address is currently in the top N.
  if (replay) {
    const rank = await zrevrank(lbKey, addr);  // 0-indexed; 0 = best
    if (rank !== null && rank < REPLAY_TOP_N) {
      await saveReplayBlob(scope, addr, replay).catch(() => undefined);
    }
  }

  // 2. Drop replays for everyone outside the top N (e.g., the entry we just
  //    pushed off the bottom of the keep window).
  const outside = await zrevrange(lbKey, REPLAY_TOP_N, -1).catch(() => [] as string[]);
  for (const m of outside) {
    await deleteReplayBlob(scope, m).catch(() => undefined);
  }
}

// ---- Cheat-check audit: lifetime XP ceiling ----
// Server tracks the maximum total XP this wallet could have earned across
// every run it has ever completed. The client's claimed total XP (computed
// from local unit progress) must not exceed this value.
//
// Per-floor ceiling values are intentionally generous so legit play never
// trips the gate. Sources of extra XP that must fit under the cap:
//   - Daily streak multiplier: up to 1.1×
//   - Scholar's Insight buff:  +25% on the consumed floor
//   - MVP bonus:               +20% to one unit per run
//   - Realistic max floor XP:  ~4000 on floor 50 with full party
//   → 4000 × 1.1 × 1.25 = 5500. The 10000 cap below leaves ~1.8× headroom.
//
// Cap bumps happen at three points:
//   1. On every floor cleared (runFloor / reportFloorCleared)
//   2. When an energy pack is consumed (proactive — lets a player burn the
//      bought energy across many floors without an in-flight cheater alarm)
//   3. When Scholar's Insight is consumed (covers the +25% slack on top of
//      the per-floor cap)
export const XP_CAP_PER_FLOOR: Record<LbMode | "floor", number> = {
  floor: 10000,    // raised 8000 → 10000 to absorb Scholar's + MVP + daily stacks
  survival: 200,
  boss_raid: 1500,
};
// Slack added to cap on the cheat-check read path. Raised 1000 → 3000 to
// cover Scholar's Insight bonuses still in flight at the moment the audit
// runs, and to forgive in-flight survival/boss-raid floors mid-stream.
export const XP_CAP_SLACK = 3000;

// ---- Shop-related cap bumps ----
// Energy packs let the player run more floors than the daily energy budget;
// each pack adds a proactive cap allowance equal to "packSize × per-floor
// cap" so the cheat check doesn't fire between energy use and floor clears.
// (The per-clear bump still runs as normal — these allowances are stacked
// generously by design.)
export const ENERGY_PACK_CAP_BUMP: Record<"energy_5" | "energy_10" | "energy_20", number> = {
  energy_5: 5 * 10000,
  energy_10: 10 * 10000,
  energy_20: 20 * 10000,
};
// Scholar's Insight delivers up to +25% XP on the floor it's consumed on.
// Bump cap by that exact delta on consume so the cheat check never trips
// even if the buff is used on the highest-XP floor (floor 50).
export const SCHOLARS_INSIGHT_CAP_BUMP = Math.floor(10000 * 0.25);

export function xpCapKey(address: string): string { return `xpcap:${address.toLowerCase()}`; }

export async function bumpXpCap(address: string, amount: number): Promise<number> {
  if (amount <= 0) return 0;
  return await incrBy(xpCapKey(address), Math.floor(amount));
}

export async function getXpCap(address: string): Promise<number> {
  return await getNumber(xpCapKey(address));
}
