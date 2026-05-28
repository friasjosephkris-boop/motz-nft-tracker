import type { VercelRequest, VercelResponse } from "@vercel/node";
import { zrevrangeWithScores, hmget } from "../_lib/redis.js";
import { lbKeyFor, IGN_HASH_KEY, decodeScore, isLbMode, getFirstConquer, getWorldEnderTop, WorldEnderEntry, getHighestFloorTop, HighestFloorEntry } from "../_lib/runState.js";
import { readShopRevenue } from "../_lib/analytics.js";
import { isFrozen, readSnapshot, checkAndExecuteScheduledFreeze } from "../_lib/lbFreeze.js";

// Public endpoint — no auth needed to read top scores.
export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== "GET") { res.status(405).json({ error: "method" }); return; }

  const limitRaw = req.query.limit;
  let limit = 50;
  if (typeof limitRaw === "string") {
    const n = parseInt(limitRaw, 10);
    if (Number.isFinite(n) && n > 0 && n <= 200) limit = n;
  }

  const modeRaw = req.query.mode;
  const mode = isLbMode(modeRaw) ? modeRaw : "survival";

  // Optional: include cross-board achievements in a single round trip.
  const wantExtras = req.query.extras === "1";

  try {
    // ---- Lazy-trigger any scheduled auto-freeze ----
    // If an admin scheduled a freeze and the target time has passed but
    // nobody has fired it yet, fire it now (idempotent, locked). This
    // means the first LB read after the scheduled moment is what flips
    // the switch — no cron job required.
    await checkAndExecuteScheduledFreeze().catch(() => undefined);

    // ---- Frozen-snapshot mode (end-of-season freeze) ----
    // When the admin has locked the LB, every read returns the captured
    // snapshot instead of live data. Live writes still happen behind the
    // scenes (so unfreezing restores everything), but players see the
    // frozen board until the admin re-toggles it.
    if (await isFrozen().catch(() => false)) {
      const snap = await readSnapshot().catch(() => null);
      if (snap) {
        const entriesFromSnap = mode === "boss_raid" ? snap.bossRaid : snap.survival;
        const entries = entriesFromSnap.slice(0, limit);
        res.setHeader("Cache-Control", "public, max-age=10");
        res.status(200).json({
          entries,
          firstConquer: wantExtras ? snap.firstConquer : null,
          worldEnder: wantExtras ? snap.worldEnder : [],
          highestFloor: wantExtras ? snap.highestFloor : [],
          shopRevenue: wantExtras ? snap.shopRevenue : 0,
          frozen: true,
          frozenLabel: snap.label,
          frozenAt: snap.capturedAt,
        });
        return;
      }
      // Freeze flag was on but no snapshot existed — fall through to live
      // data rather than 500ing. Admin should re-capture.
    }

    const rows = await zrevrangeWithScores(lbKeyFor(mode), 0, limit - 1);
    const igns = rows.length > 0 ? await hmget(IGN_HASH_KEY, rows.map(r => r.member)) : [];
    const entries = rows.map((r, i) => {
      const { floor, ms } = decodeScore(r.score);
      return { rank: i + 1, address: r.member, ign: igns[i] ?? null, floor, ms };
    });

    let firstConquer: { address: string; ign: string | null; when: number; party?: unknown } | null = null;
    let worldEnder: WorldEnderEntry[] = [];
    let highestFloor: HighestFloorEntry[] = [];
    // Live prize pool for the Highest Floor board — total RON spent on the shop.
    let shopRevenue = 0;
    if (wantExtras) {
      const rec = await getFirstConquer().catch(() => null);
      if (rec) {
        const [ign] = await hmget(IGN_HASH_KEY, [rec.address.toLowerCase()]).catch(() => [null]);
        firstConquer = { address: rec.address, ign: ign ?? null, when: rec.when, party: rec.party };
      }
      // 5 — matches the leaderboard UI's SLOT_COUNT (5 rows rendered).
      worldEnder = await getWorldEnderTop(5).catch(() => []);
      highestFloor = await getHighestFloorTop(5).catch(() => []);
      shopRevenue = await readShopRevenue().catch(() => 0);
    }

    res.setHeader("Cache-Control", "public, max-age=10");
    res.status(200).json({ entries, firstConquer, worldEnder, highestFloor, shopRevenue });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : "server error" });
  }
}
