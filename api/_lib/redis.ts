// Thin Upstash Redis REST client. Uses fetch — no SDK dep.
// Env vars (set in Vercel project settings):
//   UPSTASH_REDIS_REST_URL
//   UPSTASH_REDIS_REST_TOKEN
//   KEY_PREFIX                  — optional. Prepended to every key (e.g. "dev:")
//                                 so dev + prod can share one Upstash database
//                                 without colliding. Production: leave unset.

const URL = process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
const KEY_PREFIX = process.env.KEY_PREFIX ?? "";

function ensureConfigured(): void {
  if (!URL || !TOKEN) throw new Error("Upstash Redis not configured (UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN)");
}

/** Apply the KEY_PREFIX to args[1] (every Redis command in this file places
 *  the target key in slot 1: SET key …, ZADD key …, GET key, etc.). When
 *  KEY_PREFIX is empty, args pass through unchanged (production behavior). */
function withPrefix(args: (string | number)[]): (string | number)[] {
  if (!KEY_PREFIX || args.length < 2 || typeof args[1] !== "string") return args;
  const next = args.slice();
  next[1] = `${KEY_PREFIX}${args[1]}`;
  return next;
}

async function call(args: (string | number)[]): Promise<unknown> {
  ensureConfigured();
  const r = await fetch(URL!, {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(withPrefix(args)),
  });
  if (!r.ok) throw new Error(`upstash ${r.status}: ${await r.text()}`);
  const data = await r.json() as { result?: unknown; error?: string };
  if (data.error) throw new Error(`upstash: ${data.error}`);
  return data.result;
}

export async function setJson<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
  await call(["SET", key, JSON.stringify(value), "EX", ttlSeconds]);
}

export async function getJson<T>(key: string): Promise<T | null> {
  const r = await call(["GET", key]);
  if (typeof r !== "string") return null;
  try { return JSON.parse(r) as T; } catch { return null; }
}

export async function del(key: string): Promise<void> {
  await call(["DEL", key]);
}

export async function zaddGt(key: string, score: number, member: string): Promise<number> {
  // GT: only update if new score is greater than existing.
  // CH returns the count of changed members: 1 if better, 0 otherwise.
  const r = await call(["ZADD", key, "GT", "CH", score, member]);
  return typeof r === "number" ? r : 0;
}

export async function zaddLt(key: string, score: number, member: string): Promise<number> {
  // LT: only update if new score is less than existing (used for "fastest" boards).
  // CH returns the count of changed elements: 1 if the score got better, 0 otherwise.
  const r = await call(["ZADD", key, "LT", "CH", score, member]);
  return typeof r === "number" ? r : 0;
}

export async function zrangeWithScores(key: string, start: number, stop: number): Promise<ZEntry[]> {
  const r = await call(["ZRANGE", key, start, stop, "WITHSCORES"]);
  if (!Array.isArray(r)) return [];
  const out: ZEntry[] = [];
  for (let i = 0; i < r.length; i += 2) {
    out.push({ member: String(r[i]), score: Number(r[i + 1]) });
  }
  return out;
}

export interface ZEntry { member: string; score: number; }

export async function zrevrangeWithScores(key: string, start: number, stop: number): Promise<ZEntry[]> {
  const r = await call(["ZREVRANGE", key, start, stop, "WITHSCORES"]);
  if (!Array.isArray(r)) return [];
  const out: ZEntry[] = [];
  for (let i = 0; i < r.length; i += 2) {
    out.push({ member: String(r[i]), score: Number(r[i + 1]) });
  }
  return out;
}

export async function zrevrange(key: string, start: number, stop: number): Promise<string[]> {
  const r = await call(["ZREVRANGE", key, start, stop]);
  return Array.isArray(r) ? r.map(String) : [];
}

/** 0-indexed rank from the high end (best score = 0). Null if member missing. */
export async function zrevrank(key: string, member: string): Promise<number | null> {
  const r = await call(["ZREVRANK", key, member]);
  return typeof r === "number" ? r : null;
}

export async function incrWithExpire(key: string, ttlSeconds: number): Promise<number> {
  const n = await call(["INCR", key]) as number;
  if (n === 1) await call(["EXPIRE", key, ttlSeconds]);
  return n;
}

export async function incrBy(key: string, amount: number): Promise<number> {
  return await call(["INCRBY", key, Math.floor(amount)]) as number;
}

/** Increment a counter by `amount` and ensure a TTL is set. We refresh the
 *  TTL each call — the caller is expected to pass the same boundary-derived
 *  TTL throughout the day, so this is idempotent for daily-rolling counters. */
export async function incrByWithExpire(key: string, amount: number, ttlSeconds: number): Promise<number> {
  const n = await call(["INCRBY", key, Math.floor(amount)]) as number;
  await call(["EXPIRE", key, ttlSeconds]);
  return n;
}

export async function getNumber(key: string): Promise<number> {
  const r = await call(["GET", key]);
  if (typeof r !== "string") return 0;
  const n = Number(r);
  return Number.isFinite(n) ? n : 0;
}

/** Sets the key only if it does not exist. Returns true if the lock was acquired. */
export async function setNxWithExpire(key: string, value: string, ttlSeconds: number): Promise<boolean> {
  // Upstash REST translates SET key value NX EX seconds — returns "OK" on success, null otherwise.
  const r = await call(["SET", key, value, "NX", "EX", ttlSeconds]);
  return r === "OK";
}

export async function hset(key: string, field: string, value: string): Promise<void> {
  await call(["HSET", key, field, value]);
}

/** Atomically increments a numeric hash field. Used by lifetime analytics
 *  counters (minutes played, RON spent, vouchers acquired) — one hash per
 *  metric, one field per wallet. */
export async function hincrBy(key: string, field: string, amount: number): Promise<number> {
  return await call(["HINCRBY", key, field, Math.floor(amount)]) as number;
}

/** Read every field from a hash. Returns a record { field: value }. Used by
 *  the analytics export to enumerate every wallet at once. Returns {} on miss. */
export async function hgetAll(key: string): Promise<Record<string, string>> {
  const r = await call(["HGETALL", key]);
  if (!r) return {};
  // Upstash returns alternating [k, v, k, v, ...]
  if (Array.isArray(r)) {
    const out: Record<string, string> = {};
    for (let i = 0; i + 1 < r.length; i += 2) {
      const k = String(r[i]);
      const v = String(r[i + 1]);
      out[k] = v;
    }
    return out;
  }
  // Some Upstash configs return an object map directly.
  if (typeof r === "object") return r as Record<string, string>;
  return {};
}

/** Acquire a short-lived lock for a critical section. Retries up to `retries`
 *  times with `retryMs` backoff. Returns a release fn (idempotent) or null if
 *  the lock could not be acquired. Caller MUST call release in a finally block.
 *  Use for read-modify-write paths where multiple ops contend for the same
 *  per-wallet state (e.g. inventory, energy). */
export async function withWalletLock<T>(
  lockKey: string,
  fn: () => Promise<T>,
  opts: { ttlSeconds?: number; retries?: number; retryMs?: number } = {},
): Promise<T | null> {
  const ttl = opts.ttlSeconds ?? 5;
  const retries = opts.retries ?? 10;
  const retryMs = opts.retryMs ?? 60;
  for (let i = 0; i < retries; i++) {
    const got = await setNxWithExpire(lockKey, "1", ttl);
    if (got) {
      try {
        return await fn();
      } finally {
        await del(lockKey).catch(() => undefined);
      }
    }
    await new Promise<void>(r => setTimeout(r, retryMs));
  }
  return null;
}

export async function hmget(key: string, fields: string[]): Promise<(string | null)[]> {
  if (fields.length === 0) return [];
  const r = await call(["HMGET", key, ...fields]);
  if (!Array.isArray(r)) return fields.map(() => null);
  return r.map(v => (typeof v === "string" ? v : null));
}

/** True when the runtime is configured with a non-empty KEY_PREFIX — used as
 *  the "are we on a non-prod environment?" check for destructive admin ops. */
export function isPrefixedEnvironment(): boolean {
  return KEY_PREFIX.length > 0;
}

/** SCAN the entire keyspace (under KEY_PREFIX, since the prefix is added to
 *  the MATCH pattern) and return every matching key. Used for the dev wipe
 *  operation. NOTE: bypasses withPrefix() because SCAN's key-of-interest is
 *  in MATCH, not at args[1] (which is the cursor). */
/** SCAN every key matching `pattern`. Pages through SCAN cursors with a
 *  safety cap of 1000 iterations × 500 = 500k keys. Used by destructive
 *  admin ops to enumerate the keyspace before deleting. */
export async function scanAllByPattern(pattern: string): Promise<string[]> {
  // SCAN matches against the FULL stored key, which includes KEY_PREFIX. The
  // caller passes a logical pattern ("progress:*"); we prepend the prefix so
  // matches work whether or not a prefix is configured. Without this, a wipe
  // on any prefixed deployment scans zero keys and silently does nothing —
  // which is exactly how stale XP survived the last prod wipe.
  const fullPattern = KEY_PREFIX ? `${KEY_PREFIX}${pattern}` : pattern;
  const all: string[] = [];
  let cursor = "0";
  for (let i = 0; i < 1000; i++) {
    const args = ["SCAN", cursor, "MATCH", fullPattern, "COUNT", "500"];
    const r = await fetch(URL!, {
      method: "POST",
      headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify(args),
    });
    if (!r.ok) throw new Error(`upstash SCAN ${r.status}: ${await r.text()}`);
    const data = await r.json() as { result?: [string, string[]]; error?: string };
    if (data.error) throw new Error(`upstash SCAN: ${data.error}`);
    if (!data.result || !Array.isArray(data.result)) break;
    const [nextCursor, batch] = data.result;
    for (const k of batch) all.push(k);
    cursor = String(nextCursor);
    if (cursor === "0") break;
  }
  return all;
}

export async function scanAllPrefixed(): Promise<string[]> {
  if (!KEY_PREFIX) return [];
  const pattern = `${KEY_PREFIX}*`;
  const all: string[] = [];
  let cursor = "0";
  // Safety cap: 1000 SCAN iterations × ~500 keys = 500k keys before we bail.
  for (let i = 0; i < 1000; i++) {
    // Build the SCAN args manually so the cursor isn't double-prefixed.
    const args = ["SCAN", cursor, "MATCH", pattern, "COUNT", "500"];
    const r = await fetch(URL!, {
      method: "POST",
      headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify(args),
    });
    if (!r.ok) throw new Error(`upstash SCAN ${r.status}: ${await r.text()}`);
    const data = await r.json() as { result?: [string, string[]]; error?: string };
    if (data.error) throw new Error(`upstash SCAN: ${data.error}`);
    if (!data.result || !Array.isArray(data.result)) break;
    const [nextCursor, batch] = data.result;
    for (const k of batch) all.push(k);
    cursor = String(nextCursor);
    if (cursor === "0") break;
  }
  return all;
}

/** Bulk delete N keys, batched 200-at-a-time so we don't blow past Upstash's
 *  per-request limit. Pass keys that already include the prefix (e.g. from
 *  scanAllPrefixed). Returns the number actually deleted. */
export async function delManyRaw(keys: string[]): Promise<number> {
  if (keys.length === 0) return 0;
  let deleted = 0;
  for (let i = 0; i < keys.length; i += 200) {
    const batch = keys.slice(i, i + 200);
    const r = await fetch(URL!, {
      method: "POST",
      headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify(["DEL", ...batch]),
    });
    if (!r.ok) throw new Error(`upstash DEL ${r.status}: ${await r.text()}`);
    const data = await r.json() as { result?: number; error?: string };
    if (data.error) throw new Error(`upstash DEL: ${data.error}`);
    deleted += typeof data.result === "number" ? data.result : 0;
  }
  return deleted;
}
