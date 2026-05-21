import type { VercelRequest, VercelResponse } from "@vercel/node";
import { verifySession } from "../_lib/jwt.js";
import {
  bumpXpCap, XP_CAP_PER_FLOOR, submitWorldEnderClear,
  bumpFloorRetry, readFloorRetries, FLOOR_RETRIES_PER_DAY,
  adminClearAllLeaderboards, adminClearLeaderboard, AdminResetScope,
  recordFloorModeClear, getMaxFloorCleared,
  saveReplayBlob, loadReplayBlob,
  adminWipeDevData, adminWipeAllData, adminForceResetWallet, enumerateAllWallets,
  readAttempts, bumpAttempts, attemptsCap,
  readShopInventory, writeShopInventory, mutateShopInventory,
  readBoughtToday, markBoughtToday, consumeBuff,
  SHOP_BUFF_IDS, ShopItemId, BUFF_GRANT_SIZE,
  grantTempMotzKey, readTempMotzKey,
  rollBronForKills,
  MAX_KILLS_PER_ROLL, MAX_BOSS_KILLS_PER_ROLL, MAX_WORLD_ENDER_KILLS_PER_ROLL,
  ENERGY_PACK_CAP_BUMP, SCHOLARS_INSIGHT_CAP_BUMP,
  VOUCHER_VALUES_RON,
} from "../_lib/runState.js";
import { validateAndSyncProgress, readServerProgress } from "../_lib/progressVault.js";
import { verifyShopPayment, consumeTxHash, ITEM_PRICES_WEI } from "../_lib/payment.js";
import { isSeasonHalted, setSeasonHalt, readSeasonHalt, SEASON_HALTED_RESPONSE } from "../_lib/season.js";
import { bumpRonSpent, bumpVouchersSpent, bumpVouchersAcquired, buildAnalyticsExport, buildAnalyticsExportBundle, rowsToCsv, bumpShopRevenue, readShopRevenue } from "../_lib/analytics.js";

const MAX_PARTY_SIZE = 3;
/** Reject replays whose battles report >MAX_PARTY_SIZE units or duplicates —
 *  blocks DevTools-manipulated submissions from landing on the leaderboard. */
function isReplayPartyValid(blob: unknown): boolean {
  if (!blob || typeof blob !== "object") return true;
  const battles = (blob as { battles?: unknown }).battles;
  if (!Array.isArray(battles)) return true;
  for (const battle of battles) {
    if (!battle || typeof battle !== "object") continue;
    const party = (battle as { party?: unknown }).party;
    if (!Array.isArray(party)) continue;
    if (party.length > MAX_PARTY_SIZE) return false;
    const ids = party
      .map(p => (p && typeof p === "object" ? (p as { templateId?: unknown }).templateId : null))
      .filter((x): x is string => typeof x === "string");
    if (new Set(ids).size !== ids.length) return false;
  }
  return true;
}
import { getAddress } from "viem";
import { getCurrentMultiplier } from "../_lib/daily.js";
import { isAdmin } from "../_lib/admin.js";
import { adminGrantEnergy, adminFillEnergy, ENERGY_MAX, consumePendingClear } from "../_lib/energy.js";
import { captureReferral, getReferralDashboard, fireFloorMilestone, fireRonMilestone, getReferralClaimable, claimReferralRewards } from "../_lib/referral.js";

// Floor-mode battle event endpoint. Handles three operations to stay under
// the Vercel Hobby 12-function cap:
//   op: "clear"     (default) — successful clear; bump XP ceiling (+ optional World Ender time)
//   op: "retry_status"        — read the wallet's remaining defeat-refund count for today
//   op: "defeat_refund"       — atomically consume one refund slot AND grant +1 energy; 429 if cap reached
//
// Body: { stageId: number, op?: string, ms?: number }
export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  // ---- ANALYTICS EXPORT (unauthenticated GET, key-gated) ----
  // Piggybacks on this endpoint to stay under the Vercel 12-function cap.
  // GET /api/run/floor-cleared?op=analytics_export&key=ANALYTICS_KEY&format=csv|json
  // Used by the Google Apps Script daily sync at 08:00 PH. The key is stored
  // as `ANALYTICS_KEY` in Vercel env and pasted into the Apps Script.
  if (req.method === "GET" && (req.query?.op === "analytics_export")) {
    const expectedKey = process.env.ANALYTICS_KEY;
    const submittedKey = typeof req.query.key === "string" ? req.query.key : "";
    if (!expectedKey || submittedKey !== expectedKey) {
      res.status(403).json({ error: "bad analytics key" }); return;
    }
    try {
      const bundle = await buildAnalyticsExportBundle();
      const format = req.query.format === "json" ? "json" : "csv";
      if (format === "json") {
        res.status(200).json({ ok: true, ...bundle });
        return;
      }
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Cache-Control", "no-store");
      // CSV: emit a header summary line, then the per-wallet rows.
      const summary = `# Total RON Earned by Shop,${bundle.totalShopRevenue}\r\n# Generated At,${new Date(bundle.generatedAt).toISOString()}\r\n`;
      res.status(200).send(summary + rowsToCsv(bundle.rows));
      return;
    } catch (e) {
      res.status(500).json({ error: e instanceof Error ? e.message : "server error" });
      return;
    }
  }

  if (req.method !== "POST") { res.status(405).json({ error: "method" }); return; }
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith("Bearer ")) { res.status(401).json({ error: "no token" }); return; }

  const body = (req.body ?? {}) as { stageId?: unknown; ms?: unknown; op?: unknown };
  const op = typeof body.op === "string" ? body.op : "clear";

  let address: string;
  try {
    const session = await verifySession(auth.slice("Bearer ".length));
    address = session.address;
  } catch {
    res.status(401).json({ error: "invalid session" }); return;
  }

  // Admin ops don't need a stageId — handled before the stage validation.
  if (op === "admin_reset_leaderboards") {
    if (!isAdmin(address)) { res.status(403).json({ error: "admin only" }); return; }
    try {
      const keys = await adminClearAllLeaderboards();
      res.status(200).json({ ok: true, cleared: keys });
    } catch (e) {
      res.status(500).json({ error: e instanceof Error ? e.message : "server error" });
    }
    return;
  }
  if (op === "admin_reset_lb") {
    if (!isAdmin(address)) { res.status(403).json({ error: "admin only" }); return; }
    const scope = (req.body as { scope?: unknown }).scope;
    if (scope !== "survival" && scope !== "bossraid" && scope !== "we" && scope !== "conquer" && scope !== "floorclimb") {
      res.status(400).json({ error: "bad scope" }); return;
    }
    try {
      const keys = await adminClearLeaderboard(scope as AdminResetScope);
      res.status(200).json({ ok: true, cleared: keys });
    } catch (e) {
      res.status(500).json({ error: e instanceof Error ? e.message : "server error" });
    }
    return;
  }
  if (op === "admin_wipe_all_data") {
    // Production wipe — admin-only AND requires a magic confirmation token
    // in the body to prevent accidental fires from devtools / replay. Wipes
    // every known game-related key prefix in Redis. The client UI guards
    // this with 3 confirmation modals before sending.
    if (!isAdmin(address)) { res.status(403).json({ error: "admin only" }); return; }
    const confirm = typeof (req.body as { confirm?: unknown }).confirm === "string"
      ? (req.body as { confirm: string }).confirm : "";
    if (confirm !== "WIPE EVERYTHING NOW") {
      res.status(400).json({ error: "missing or wrong confirm token" }); return;
    }
    try {
      const r = await adminWipeAllData();
      res.status(200).json({ ok: true, scanned: r.scanned, deleted: r.deleted, patternHits: r.patternHits });
    } catch (e) {
      res.status(500).json({ error: e instanceof Error ? e.message : "server error" });
    }
    return;
  }
  if (op === "admin_force_reset_except") {
    // Reset every wallet that has any data EXCEPT the allowlist. Use when
    // most players need a re-sync but a handful of legit fresh-start players
    // should be preserved. Allowlist must be non-empty as a safety check —
    // an empty allowlist would be equivalent to a global wipe and should go
    // through admin_wipe_all_data with its 3-confirmation gauntlet instead.
    if (!isAdmin(address)) { res.status(403).json({ error: "admin only" }); return; }
    const keepRaw = (req.body as { keep?: unknown }).keep;
    if (!Array.isArray(keepRaw) || keepRaw.length === 0) {
      res.status(400).json({ error: "keep must be a non-empty array of wallet addresses" }); return;
    }
    const keep = new Set<string>();
    for (const k of keepRaw) {
      if (typeof k === "string" && /^0x[0-9a-fA-F]{40}$/.test(k.trim())) {
        keep.add(k.trim().toLowerCase());
      }
    }
    if (keep.size === 0) {
      res.status(400).json({ error: "keep contains no valid 0x-prefixed 40-hex addresses" }); return;
    }
    try {
      const allWallets = await enumerateAllWallets();
      const targets = allWallets.filter(w => !keep.has(w));
      const results: { wallet: string; ok: boolean; deleted: number; error?: string }[] = [];
      for (const w of targets) {
        try {
          const r = await adminForceResetWallet(w);
          const deletedCount = Object.values(r.deleted).reduce((a, b) => a + b, 0);
          results.push({ wallet: w, ok: true, deleted: deletedCount });
        } catch (e) {
          results.push({ wallet: w, ok: false, deleted: 0, error: e instanceof Error ? e.message : "failed" });
        }
      }
      res.status(200).json({
        ok: true,
        totalWallets: allWallets.length,
        kept: Array.from(keep),
        resetCount: results.filter(r => r.ok).length,
        failCount: results.filter(r => !r.ok).length,
        results,
      });
    } catch (e) {
      res.status(500).json({ error: e instanceof Error ? e.message : "server error" });
    }
    return;
  }
  if (op === "admin_force_reset_wallet") {
    // Targeted per-wallet reset. Use when a global wipe isn't viable (other
    // players already mid-run on the fresh data). Clears the named wallet's
    // server-side keys AND stamps a force-reset timestamp; their next
    // /api/auth/me poll triggers a localStorage clear + reload.
    if (!isAdmin(address)) { res.status(403).json({ error: "admin only" }); return; }
    const target = typeof (req.body as { wallet?: unknown }).wallet === "string"
      ? (req.body as { wallet: string }).wallet.trim() : "";
    if (!/^0x[0-9a-fA-F]{40}$/.test(target)) {
      res.status(400).json({ error: "wallet must be a 0x-prefixed 40-hex address" }); return;
    }
    try {
      const r = await adminForceResetWallet(target);
      res.status(200).json(r);
    } catch (e) {
      res.status(500).json({ error: e instanceof Error ? e.message : "server error" });
    }
    return;
  }
  if (op === "admin_wipe_dev") {
    if (!isAdmin(address)) { res.status(403).json({ error: "admin only" }); return; }
    try {
      const r = await adminWipeDevData();
      if (!r.ok) { res.status(400).json({ error: r.reason ?? "wipe refused" }); return; }
      res.status(200).json({ ok: true, scanned: r.scanned, deleted: r.deleted });
    } catch (e) {
      res.status(500).json({ error: e instanceof Error ? e.message : "server error" });
    }
    return;
  }
  // ---- Season kill switch ----
  // Admin presses Halt → no wallet can start a run (campaign, survival, raid).
  // The flag lives in Redis (api/_lib/season.ts) and is checked by every
  // run-start gate: /api/run/start, POST /api/energy, and the
  // attempts_claim op below. Public read via season_status — clients use
  // this to gray out Start buttons and show an "off-season" banner.
  if (op === "admin_season_halt" || op === "admin_season_resume") {
    if (!isAdmin(address)) { res.status(403).json({ error: "admin only" }); return; }
    try {
      const rec = await setSeasonHalt(op === "admin_season_halt", address);
      res.status(200).json({ ok: true, halted: rec.halted, setAt: rec.setAt, setBy: rec.setBy });
    } catch (e) {
      res.status(500).json({ error: e instanceof Error ? e.message : "server error" });
    }
    return;
  }
  if (op === "season_status") {
    try {
      const rec = await readSeasonHalt();
      res.status(200).json({
        ok: true,
        halted: !!(rec && rec.halted),
        setAt: rec?.setAt ?? null,
      });
    } catch (e) {
      res.status(500).json({ error: e instanceof Error ? e.message : "server error" });
    }
    return;
  }

  if (op === "admin_bump_xp_cap") {
    // Admin op: raise the wallet's server-side XP ceiling by `delta`. Used by
    // the dev-build "+ Level" button so the next progress_sync push doesn't
    // get rejected as a cheating attempt (the new level's totalXp would
    // otherwise exceed the cap that legit play hadn't earned yet).
    if (!isAdmin(address)) { res.status(403).json({ error: "admin only" }); return; }
    const delta = typeof (req.body as { delta?: unknown }).delta === "number"
      ? Math.max(0, Math.min(100000, Math.floor((req.body as { delta: number }).delta))) : 0;
    if (delta === 0) { res.status(400).json({ error: "delta must be a positive number ≤100000" }); return; }
    try {
      const newCap = await bumpXpCap(address, delta);
      res.status(200).json({ ok: true, newCap });
    } catch (e) {
      res.status(500).json({ error: e instanceof Error ? e.message : "server error" });
    }
    return;
  }
  if (op === "admin_grant_vouchers") {
    // Hard gate: only the admin wallet (server-side allowlist in api/_lib/admin.ts)
    // can fire this. `address` comes from the JWT-verified session, so the body
    // can't spoof it. Grants are ALWAYS to the caller's own wallet — no `target`
    // parameter — so there's no way for any other wallet to receive vouchers
    // through this path, even via an admin call.
    if (!isAdmin(address)) { res.status(403).json({ error: "admin only" }); return; }
    try {
      const body = req.body as { t1?: unknown; t2?: unknown; t3?: unknown; t4?: unknown; t5?: unknown };
      const num = (v: unknown, def: number): number => {
        if (typeof v !== "number" || !Number.isFinite(v)) return def;
        return Math.max(0, Math.min(999, Math.floor(v)));
      };
      const grant = {
        t1: num(body.t1, 1), t2: num(body.t2, 1), t3: num(body.t3, 1),
        t4: num(body.t4, 1), t5: num(body.t5, 1),
      };
      const inv = await readShopInventory(address);
      inv.vouchers = inv.vouchers ?? {};
      inv.vouchers.t1 = (inv.vouchers.t1 ?? 0) + grant.t1;
      inv.vouchers.t2 = (inv.vouchers.t2 ?? 0) + grant.t2;
      inv.vouchers.t3 = (inv.vouchers.t3 ?? 0) + grant.t3;
      inv.vouchers.t4 = (inv.vouchers.t4 ?? 0) + grant.t4;
      inv.vouchers.t5 = (inv.vouchers.t5 ?? 0) + grant.t5;
      await writeShopInventory(address, inv);
      // Analytics: admin-granted vouchers count toward the wallet's lifetime
      // voucher acquisition (so the spreadsheet reflects total RON value
      // entering the inventory, regardless of source).
      const acquiredRon =
        grant.t1 * VOUCHER_VALUES_RON.t1 +
        grant.t2 * VOUCHER_VALUES_RON.t2 +
        grant.t3 * VOUCHER_VALUES_RON.t3 +
        grant.t4 * VOUCHER_VALUES_RON.t4 +
        grant.t5 * VOUCHER_VALUES_RON.t5;
      void bumpVouchersAcquired(address, acquiredRon);
      res.status(200).json({ ok: true, vouchers: inv.vouchers });
    } catch (e) {
      res.status(500).json({ error: e instanceof Error ? e.message : "server error" });
    }
    return;
  }
  if (op === "admin_grant_energy" || op === "admin_fill_energy") {
    if (!isAdmin(address)) { res.status(403).json({ error: "admin only" }); return; }
    try {
      let amount: number;
      if (op === "admin_fill_energy") {
        amount = await adminFillEnergy(address);
      } else {
        const delta = typeof (req.body as { delta?: unknown }).delta === "number"
          ? Math.floor((req.body as { delta: number }).delta)
          : 5;
        if (Math.abs(delta) > 999) { res.status(400).json({ error: "delta too large" }); return; }
        amount = await adminGrantEnergy(address, delta);
      }
      res.status(200).json({ ok: true, amount, max: ENERGY_MAX });
    } catch (e) {
      res.status(500).json({ error: e instanceof Error ? e.message : "server error" });
    }
    return;
  }

  // Replay fetch — public-ish, allows anyone to view another wallet's replay.
  // ---- Progress vault ops (devtool-proof XP / stat audit) ----
  // progress_get  → return the server-canonical per-unit progress map.
  // progress_sync → accept the client's claimed progress, validate, persist if
  //                 legitimate, return the new canonical. Rejected claims get
  //                 the existing canonical back so the client can overwrite
  //                 localStorage and unwind any tampering.
  if (op === "progress_get") {
    try {
      // Also return the canonical maxFloor so the client can reconcile its
      // localStorage stage-unlock cache. Without this, a post-wipe player
      // still sees every campaign stage unlocked because the unlock state
      // lives in localStorage and the wipe only nukes the server side.
      const [blob, maxFloor] = await Promise.all([
        readServerProgress(address),
        getMaxFloorCleared(address).catch(() => 0),
      ]);
      res.status(200).json({ ok: true, canonical: blob, maxFloor });
      return;
    } catch (e) {
      res.status(500).json({ error: e instanceof Error ? e.message : "server error" });
      return;
    }
  }
  if (op === "progress_sync") {
    const claimedRaw = (req.body as { claimed?: unknown }).claimed;
    if (!claimedRaw || typeof claimedRaw !== "object" || Array.isArray(claimedRaw)) {
      res.status(400).json({ error: "claimed must be an object" }); return;
    }
    try {
      const result = await validateAndSyncProgress(address, claimedRaw as Record<string, unknown>);
      // 200 in both ok and rejected cases — the client uses the returned
      // canonical to overwrite localStorage either way. We surface `accepted`
      // so the UI can show a "your save was reverted" notice on rejection.
      res.status(200).json({
        ok: result.ok,
        canonical: result.canonical,
        reason: result.reason,
      });
      return;
    } catch (e) {
      res.status(500).json({ error: e instanceof Error ? e.message : "server error" });
      return;
    }
  }

  // ---- Referral system ----
  // referral_status  → dashboard payload (own code, referees, totals, who
  //                    referred you).
  // referral_capture → bind the caller to a referrer behind a code. Server
  //                    rejects self-referral / already-referred / non-new
  //                    wallets, so the client can fire it freely on sign-in.
  if (op === "referral_status") {
    try {
      const dash = await getReferralDashboard(address);
      res.status(200).json({ ok: true, ...dash });
    } catch (e) {
      res.status(500).json({ error: e instanceof Error ? e.message : "server error" });
    }
    return;
  }
  if (op === "referral_capture") {
    const codeRaw = (req.body as { code?: unknown }).code;
    if (typeof codeRaw !== "string" || codeRaw.trim().length === 0) {
      res.status(400).json({ ok: false, reason: "code required" }); return;
    }
    try {
      const result = await captureReferral(address, codeRaw);
      // 200 in both ok and rejected cases — the client uses `ok` to decide
      // whether to clear its pending code, and a rejection isn't an error.
      res.status(200).json(result);
    } catch (e) {
      res.status(500).json({ error: e instanceof Error ? e.message : "server error" });
    }
    return;
  }
  if (op === "referral_claimable") {
    // Lightweight read for the home-screen notification bubble — just the
    // unclaimed energy count, no dashboard build.
    try {
      const claimable = await getReferralClaimable(address);
      res.status(200).json({ ok: true, claimable });
    } catch (e) {
      res.status(500).json({ error: e instanceof Error ? e.message : "server error" });
    }
    return;
  }
  if (op === "referral_claim") {
    // Collect all unclaimed referral energy. Atomic server-side (GETDEL), so
    // a double-tapped Claim button can't double-grant.
    try {
      const result = await claimReferralRewards(address);
      res.status(200).json({ ok: true, ...result });
    } catch (e) {
      res.status(500).json({ error: e instanceof Error ? e.message : "server error" });
    }
    return;
  }

  if (op === "get_replay") {
    const scope = typeof (req.body as { scope?: unknown }).scope === "string" ? (req.body as { scope: string }).scope : "";
    const targetRaw = typeof (req.body as { address?: unknown }).address === "string" ? (req.body as { address: string }).address : "";
    if (!scope || !targetRaw) { res.status(400).json({ error: "scope and address required" }); return; }
    if (!/^[a-zA-Z0-9_:-]{1,32}$/.test(scope)) { res.status(400).json({ error: "bad scope" }); return; }
    let target: string;
    try { target = getAddress(targetRaw); }
    catch { res.status(400).json({ error: "bad address" }); return; }
    try {
      const blob = await loadReplayBlob(scope, target);
      res.status(200).json({ ok: true, blob });
    } catch (e) {
      res.status(500).json({ error: e instanceof Error ? e.message : "server error" });
    }
    return;
  }

  // ---- RON voucher drops ----
  // bron_roll: client reports per-battle kill counts; server rolls drops with
  //            crypto RNG and deposits per-tier vouchers into the wallet's
  //            shop inventory. There is no longer a running RON "balance" —
  //            each tier voucher is its own inventory item, redeemed at end
  //            of season. Multipliers: mob 1×, boss 2×, world_ender 4×.
  if (op === "bron_roll") {
    const killsRaw = (req.body as { kills?: unknown }).kills;
    const bossRaw = (req.body as { bossKills?: unknown }).bossKills;
    const weRaw = (req.body as { worldEnderKills?: unknown }).worldEnderKills;
    if (typeof killsRaw !== "number" || !Number.isFinite(killsRaw) || killsRaw < 0) {
      res.status(400).json({ error: "kills must be a non-negative number" }); return;
    }
    if (typeof bossRaw !== "number" || !Number.isFinite(bossRaw) || bossRaw < 0) {
      res.status(400).json({ error: "bossKills must be a non-negative number" }); return;
    }
    // worldEnderKills optional for back-compat — defaults to 0 if not sent.
    const weKills = typeof weRaw === "number" && Number.isFinite(weRaw) && weRaw >= 0 ? weRaw : 0;
    try {
      const result = await rollBronForKills(address, killsRaw, bossRaw, weKills);
      res.status(200).json({
        ok: true,
        drops: result.drops,
        killsCounted: result.killsCounted,
        bossKillsCounted: result.bossKillsCounted,
        worldEnderKillsCounted: result.worldEnderKillsCounted,
        caps: {
          kills: MAX_KILLS_PER_ROLL,
          bossKills: MAX_BOSS_KILLS_PER_ROLL,
          worldEnderKills: MAX_WORLD_ENDER_KILLS_PER_ROLL,
        },
      });
      return;
    } catch (e) {
      res.status(500).json({ error: e instanceof Error ? e.message : "server error" });
      return;
    }
  }

  // ---- Daily attempt cap ops (Survival / Boss Raid) ----
  // No stageId needed — these gate run starts before the squad screen.
  if (op === "attempts_status" || op === "attempts_claim") {
    const modeRaw = (req.body as { mode?: unknown }).mode;
    if (modeRaw !== "survival" && modeRaw !== "boss_raid") {
      res.status(400).json({ error: "mode must be survival|boss_raid" }); return;
    }
    const mode = modeRaw;
    try {
      if (op === "attempts_status") {
        const used = await readAttempts(mode, address);
        const cap = attemptsCap(mode);
        res.status(200).json({ ok: true, used, remaining: Math.max(0, cap - used), max: cap });
        return;
      }
      // Season-halt gate — block the actual claim, but allow status reads
      // above so the UI can still render the cap counter while paused.
      if (await isSeasonHalted()) {
        res.status(SEASON_HALTED_RESPONSE.status).json(SEASON_HALTED_RESPONSE.body);
        return;
      }
      // attempts_claim — atomic bump-then-check. We use the post-increment
      // value so concurrent claims can't race past the cap.
      const before = await readAttempts(mode, address);
      const cap = attemptsCap(mode);
      if (before >= cap) {
        res.status(429).json({ ok: false, used: before, remaining: 0, max: cap });
        return;
      }
      const newUsed = await bumpAttempts(mode, address);
      if (newUsed > cap) {
        res.status(429).json({ ok: false, used: newUsed, remaining: 0, max: cap });
        return;
      }
      res.status(200).json({ ok: true, used: newUsed, remaining: cap - newUsed, max: cap });
      return;
    } catch (e) {
      res.status(500).json({ error: e instanceof Error ? e.message : "server error" });
      return;
    }
  }

  // ---- Shop ops ----
  // shop_status — read current inventory + which items have been bought today.
  // shop_buy    — atomic: check daily-bought flag, mark, grant the item.
  // shop_consume — consume one of an owned buff (called by run-start flow).
  if (op === "shop_status") {
    try {
      const inv = await readShopInventory(address);
      const allItems: ShopItemId[] = [
        "energy_5", "energy_10", "energy_20",
        "unit_stat_reset", "unit_class_change", "unit_temp_motz_key",
        ...SHOP_BUFF_IDS,
      ];
      const bought: Partial<Record<ShopItemId, boolean>> = {};
      await Promise.all(allItems.map(async id => {
        bought[id] = await readBoughtToday(id, address);
      }));
      // Surface the temp MoTZ Key state so the inventory UI can render an
      // active-pass card with the remaining time.
      const tempKey = await readTempMotzKey(address);
      const tempMotzKey = tempKey && tempKey.expiresAt > Date.now()
        ? { active: true, expiresAt: tempKey.expiresAt }
        : { active: false };
      // Stringified per-item prices in wei — clients need these to build the
      // wallet tx. We send strings because JSON can't represent bigint, and
      // because clients shouldn't be doing math on the raw wei values anyway
      // (just passing them to viem's `value` field).
      const pricesWei: Record<string, string> = {};
      const pricesRon: Record<string, number> = {};
      for (const id of allItems) {
        const v = ITEM_PRICES_WEI[id];
        if (v !== undefined) {
          pricesWei[id] = v.toString();
          pricesRon[id] = Number(v / 10n ** 18n);
        }
      }
      const totalShopRevenue = await readShopRevenue().catch(() => 0);
      res.status(200).json({
        ok: true, inventory: inv, boughtToday: bought, tempMotzKey,
        pricesWei, pricesRon,
        voucherValuesRon: VOUCHER_VALUES_RON,
        totalShopRevenue,
      });
      return;
    } catch (e) {
      res.status(500).json({ error: e instanceof Error ? e.message : "server error" });
      return;
    }
  }

  // Both shop-buy paths gate on the season halt too — when the admin ends the
  // season, the shop closes alongside run starts. shop_status / shop_consume /
  // inventory_use_energy remain open so players can still SEE what they own
  // and use already-purchased items.
  // ---- One-time first-energy-bundle offer (35 energy for 20 RON / 20 bRON) ----
  // Status check, RON-claim, voucher-claim, dismiss. Status is also auto-marked
  // "shown" on first read so a reload doesn't refire the modal until the player
  // explicitly picks an action.
  if (op === "first_offer_status") {
    try {
      const { markOfferShown, FIRST_OFFER_ENERGY_GRANT, FIRST_OFFER_RON_PRICE } = await import("../_lib/firstEnergyOffer.js");
      const state = await markOfferShown(address);
      res.status(200).json({ ok: true, status: state.status, energy: FIRST_OFFER_ENERGY_GRANT, priceRon: FIRST_OFFER_RON_PRICE });
      return;
    } catch (e) {
      res.status(500).json({ error: e instanceof Error ? e.message : "server error" });
      return;
    }
  }
  if (op === "first_offer_dismiss") {
    try {
      const { dismissOffer } = await import("../_lib/firstEnergyOffer.js");
      const state = await dismissOffer(address);
      res.status(200).json({ ok: true, status: state.status });
      return;
    } catch (e) {
      res.status(500).json({ error: e instanceof Error ? e.message : "server error" });
      return;
    }
  }
  if (op === "first_offer_claim_ron") {
    // RON claim path: same payment-verify infrastructure as the regular shop,
    // synthetic itemId "energy_first_offer" looks up the 20 RON price.
    const txHash = typeof (req.body as { txHash?: unknown }).txHash === "string"
      ? (req.body as { txHash: string }).txHash : "";
    if (!txHash) { res.status(400).json({ error: "txHash required" }); return; }
    try {
      const { readOffer, grantOfferBundle } = await import("../_lib/firstEnergyOffer.js");
      const cur = await readOffer(address);
      if (cur.status === "consumed") {
        res.status(409).json({ ok: false, reason: "offer already consumed" }); return;
      }
      const pay = await verifyShopPayment(txHash, address, "energy_first_offer");
      if (!pay.ok) {
        res.status(pay.pending ? 202 : 400).json({ ok: false, pending: pay.pending, reason: pay.reason });
        return;
      }
      const grant = await grantOfferBundle(address, "ron");
      if (!grant.ok) {
        res.status(409).json({ ok: false, reason: grant.reason });
        return;
      }
      await consumeTxHash(txHash, address, "energy_first_offer", pay.valueWei);
      // Analytics: count this purchase toward the wallet's lifetime RON-spent
      // AND the global shop revenue (real RON flows to the treasury via the
      // same verified tx, so it's revenue just like any other shop_buy).
      const ronPrice = Number((ITEM_PRICES_WEI["energy_first_offer"] ?? 0n) / 10n ** 18n);
      await bumpRonSpent(address, ronPrice).catch(() => undefined);
      void bumpShopRevenue(ronPrice);
      // Referral RON-spend reward — this offer purchase counts toward the
      // referee's 10-RON milestone.
      await fireRonMilestone(address).catch(() => undefined);
      res.status(200).json({ ok: true, energy: grant.energy });
      return;
    } catch (e) {
      res.status(500).json({ error: e instanceof Error ? e.message : "server error" });
      return;
    }
  }
  if (op === "admin_test_onchain_checkin") {
    // Admin-only smoke test: reads the Gauntlet DailyCheckIn contract to
    // check whether `target` has an on-chain check-in for today AND their
    // current streak. Read-only — does NOT fire a write (impossible now that
    // the contract uses msg.sender semantics; the server can't sign for the
    // player). Useful for verifying contract reachability + the player's
    // on-chain claim status without waiting for UTC reset.
    if (!isAdmin(address)) { res.status(403).json({ error: "admin only" }); return; }
    const target = typeof (req.body as { wallet?: unknown }).wallet === "string"
      ? (req.body as { wallet: string }).wallet.trim() : "";
    if (!/^0x[0-9a-fA-F]{40}$/.test(target)) {
      res.status(400).json({ error: "wallet must be a 0x-prefixed 40-hex address" }); return;
    }
    try {
      const { callOnChainCheckIn, isOnChainCheckInEnabled } = await import("../_lib/dailyCheckInOnChain.js");
      if (!isOnChainCheckInEnabled()) {
        res.status(200).json({ ok: false, enabled: false, reason: "DAILY_CHECKIN_* env vars not configured on this environment" });
        return;
      }
      const { getAddress } = await import("viem");
      const r = await callOnChainCheckIn(getAddress(target));
      res.status(200).json({
        ok: r.ok,
        enabled: true,
        hasCheckedInToday: r.hasCheckedInToday ?? false,
        currentStreak: r.currentStreak ?? 0,
        reason: r.reason,
      });
      return;
    } catch (e) {
      res.status(500).json({ error: e instanceof Error ? e.message : "server error" });
      return;
    }
  }
  if (op === "admin_grant_energy_to") {
    // Variant of admin_grant_energy that targets a SPECIFIC wallet rather
    // than the admin's own. Use for comp grants (player paid for a bundle
    // but got the wrong reward, manually add the energy they should have
    // received). Same delta sanity cap (±999) to prevent finger-fumbles.
    if (!isAdmin(address)) { res.status(403).json({ error: "admin only" }); return; }
    const target = typeof (req.body as { wallet?: unknown }).wallet === "string"
      ? (req.body as { wallet: string }).wallet.trim().toLowerCase() : "";
    if (!/^0x[0-9a-fA-F]{40}$/.test(target)) {
      res.status(400).json({ error: "wallet must be a 0x-prefixed 40-hex address" }); return;
    }
    const delta = typeof (req.body as { delta?: unknown }).delta === "number"
      ? Math.floor((req.body as { delta: number }).delta) : 0;
    if (delta === 0) { res.status(400).json({ error: "delta required (non-zero integer)" }); return; }
    if (Math.abs(delta) > 999) { res.status(400).json({ error: "delta too large (|delta| > 999)" }); return; }
    try {
      const amount = await adminGrantEnergy(target, delta);
      res.status(200).json({ ok: true, wallet: target, amount, max: ENERGY_MAX, delta });
      return;
    } catch (e) {
      res.status(500).json({ error: e instanceof Error ? e.message : "server error" });
      return;
    }
  }
  if (op === "admin_consume_one_time_offers") {
    // Admin op: mark a target wallet's one-time-offer state as "consumed" so
    // the modal won't reappear. Used to close out offers after a comp grant
    // (e.g. gioblo paid for energy but got the buff bundle — admin grants
    // the energy manually + closes the offer so it doesn't haunt him).
    // Body: { wallet, offers: ["first_energy"|"floor20"|"both"] }
    if (!isAdmin(address)) { res.status(403).json({ error: "admin only" }); return; }
    const target = typeof (req.body as { wallet?: unknown }).wallet === "string"
      ? (req.body as { wallet: string }).wallet.trim().toLowerCase() : "";
    if (!/^0x[0-9a-fA-F]{40}$/.test(target)) {
      res.status(400).json({ error: "wallet must be a 0x-prefixed 40-hex address" }); return;
    }
    const offers = (req.body as { offers?: unknown }).offers;
    const wantFirst = Array.isArray(offers) ? offers.includes("first_energy") || offers.includes("both") : false;
    const wantFloor20 = Array.isArray(offers) ? offers.includes("floor20") || offers.includes("both") : false;
    if (!wantFirst && !wantFloor20) {
      res.status(400).json({ error: "offers must include 'first_energy', 'floor20', or 'both'" }); return;
    }
    try {
      const closed: string[] = [];
      if (wantFirst) {
        const { dismissOffer } = await import("../_lib/firstEnergyOffer.js");
        await dismissOffer(target);
        closed.push("first_energy");
      }
      if (wantFloor20) {
        const { dismissFloor20Offer } = await import("../_lib/floor20Offer.js");
        await dismissFloor20Offer(target);
        closed.push("floor20");
      }
      res.status(200).json({ ok: true, wallet: target, closed });
      return;
    } catch (e) {
      res.status(500).json({ error: e instanceof Error ? e.message : "server error" });
      return;
    }
  }
  if (op === "first_offer_claim_voucher") {
    try {
      const { claimWithVouchers, FIRST_OFFER_RON_PRICE } = await import("../_lib/firstEnergyOffer.js");
      const r = await claimWithVouchers(address);
      if (!r.ok) { res.status(400).json({ ok: false, reason: r.reason }); return; }
      // Analytics: lifetime voucher-spent (no shop-revenue bump — vouchers
      // don't move new RON to the treasury, only consume an existing in-game
      // balance that was earned earlier).
      void bumpVouchersSpent(address, FIRST_OFFER_RON_PRICE);
      res.status(200).json({ ok: true, energy: r.energy, deducted: r.deducted });
      return;
    } catch (e) {
      res.status(500).json({ error: e instanceof Error ? e.message : "server error" });
      return;
    }
  }
  // ---- One-time floor-20 clear offer (all campaign buffs for 20 RON / 20 bRON) ----
  if (op === "floor20_offer_status") {
    try {
      const { markFloor20OfferShown, FLOOR20_OFFER_RON_PRICE } = await import("../_lib/floor20Offer.js");
      const state = await markFloor20OfferShown(address);
      res.status(200).json({ ok: true, status: state.status, priceRon: FLOOR20_OFFER_RON_PRICE });
      return;
    } catch (e) {
      res.status(500).json({ error: e instanceof Error ? e.message : "server error" });
      return;
    }
  }
  if (op === "floor20_offer_dismiss") {
    try {
      const { dismissFloor20Offer } = await import("../_lib/floor20Offer.js");
      const state = await dismissFloor20Offer(address);
      res.status(200).json({ ok: true, status: state.status });
      return;
    } catch (e) {
      res.status(500).json({ error: e instanceof Error ? e.message : "server error" });
      return;
    }
  }
  if (op === "floor20_offer_claim_ron") {
    const txHash = typeof (req.body as { txHash?: unknown }).txHash === "string"
      ? (req.body as { txHash: string }).txHash : "";
    if (!txHash) { res.status(400).json({ error: "txHash required" }); return; }
    try {
      const { readFloor20Offer, grantFloor20Bundle } = await import("../_lib/floor20Offer.js");
      const cur = await readFloor20Offer(address);
      if (cur.status === "consumed") { res.status(409).json({ ok: false, reason: "offer already consumed" }); return; }
      if (cur.status === "pending") { res.status(403).json({ ok: false, reason: "clear floor 30 first" }); return; }
      const pay = await verifyShopPayment(txHash, address, "floor20_offer_bundle");
      if (!pay.ok) {
        res.status(pay.pending ? 202 : 400).json({ ok: false, pending: pay.pending, reason: pay.reason });
        return;
      }
      const grant = await grantFloor20Bundle(address, "ron");
      if (!grant.ok) { res.status(409).json({ ok: false, reason: grant.reason }); return; }
      await consumeTxHash(txHash, address, "floor20_offer_bundle", pay.valueWei);
      // Analytics: same as the first-energy-offer path — real RON flows to
      // treasury, so per-wallet RON-spent + global shop revenue both bump.
      const ronPrice = Number((ITEM_PRICES_WEI["floor20_offer_bundle"] ?? 0n) / 10n ** 18n);
      await bumpRonSpent(address, ronPrice).catch(() => undefined);
      void bumpShopRevenue(ronPrice);
      // Referral RON-spend reward — this offer purchase counts toward the
      // referee's 10-RON milestone.
      await fireRonMilestone(address).catch(() => undefined);
      res.status(200).json({ ok: true, grants: grant.grants });
      return;
    } catch (e) {
      res.status(500).json({ error: e instanceof Error ? e.message : "server error" });
      return;
    }
  }
  if (op === "floor20_offer_claim_voucher") {
    try {
      const { claimFloor20WithVouchers, FLOOR20_OFFER_RON_PRICE } = await import("../_lib/floor20Offer.js");
      const r = await claimFloor20WithVouchers(address);
      if (!r.ok) { res.status(400).json({ ok: false, reason: r.reason }); return; }
      // Analytics: lifetime voucher-spent only (no shop-revenue bump on
      // voucher payments — same rationale as the first-energy-offer path).
      void bumpVouchersSpent(address, FLOOR20_OFFER_RON_PRICE);
      res.status(200).json({ ok: true, grants: r.grants, deducted: r.deducted });
      return;
    } catch (e) {
      res.status(500).json({ error: e instanceof Error ? e.message : "server error" });
      return;
    }
  }
  // ---- One-time floor-200 energy offer (50 energy for 25 RON / 25 bRON) ----
  if (op === "floor200_offer_status") {
    try {
      const { markFloor200OfferShown, FLOOR200_OFFER_ENERGY_GRANT, FLOOR200_OFFER_RON_PRICE } = await import("../_lib/floor200Offer.js");
      const state = await markFloor200OfferShown(address);
      res.status(200).json({ ok: true, status: state.status, energy: FLOOR200_OFFER_ENERGY_GRANT, priceRon: FLOOR200_OFFER_RON_PRICE });
      return;
    } catch (e) {
      res.status(500).json({ error: e instanceof Error ? e.message : "server error" });
      return;
    }
  }
  if (op === "floor200_offer_dismiss") {
    try {
      const { dismissFloor200Offer } = await import("../_lib/floor200Offer.js");
      const state = await dismissFloor200Offer(address);
      res.status(200).json({ ok: true, status: state.status });
      return;
    } catch (e) {
      res.status(500).json({ error: e instanceof Error ? e.message : "server error" });
      return;
    }
  }
  if (op === "floor200_offer_claim_ron") {
    const txHash = typeof (req.body as { txHash?: unknown }).txHash === "string"
      ? (req.body as { txHash: string }).txHash : "";
    if (!txHash) { res.status(400).json({ error: "txHash required" }); return; }
    try {
      const { readFloor200Offer, grantFloor200Bundle } = await import("../_lib/floor200Offer.js");
      const cur = await readFloor200Offer(address);
      if (cur.status === "consumed") { res.status(409).json({ ok: false, reason: "offer already consumed" }); return; }
      if (cur.status === "pending") { res.status(403).json({ ok: false, reason: "clear floor 200 first" }); return; }
      const pay = await verifyShopPayment(txHash, address, "energy_floor200_offer");
      if (!pay.ok) {
        res.status(pay.pending ? 202 : 400).json({ ok: false, pending: pay.pending, reason: pay.reason });
        return;
      }
      const grant = await grantFloor200Bundle(address, "ron");
      if (!grant.ok) { res.status(409).json({ ok: false, reason: grant.reason }); return; }
      await consumeTxHash(txHash, address, "energy_floor200_offer", pay.valueWei);
      // Analytics: real RON to treasury — count toward lifetime RON-spent +
      // global shop revenue, same as the other RON-paid offers.
      const ronPrice = Number((ITEM_PRICES_WEI["energy_floor200_offer"] ?? 0n) / 10n ** 18n);
      await bumpRonSpent(address, ronPrice).catch(() => undefined);
      void bumpShopRevenue(ronPrice);
      // Referral RON-spend reward — this purchase counts toward the 10-RON milestone.
      await fireRonMilestone(address).catch(() => undefined);
      res.status(200).json({ ok: true, energy: grant.energy });
      return;
    } catch (e) {
      res.status(500).json({ error: e instanceof Error ? e.message : "server error" });
      return;
    }
  }
  if (op === "floor200_offer_claim_voucher") {
    try {
      const { claimFloor200WithVouchers, FLOOR200_OFFER_RON_PRICE } = await import("../_lib/floor200Offer.js");
      const r = await claimFloor200WithVouchers(address);
      if (!r.ok) { res.status(400).json({ ok: false, reason: r.reason }); return; }
      // Analytics: lifetime voucher-spent only (vouchers don't move new RON).
      void bumpVouchersSpent(address, FLOOR200_OFFER_RON_PRICE);
      res.status(200).json({ ok: true, energy: r.energy, deducted: r.deducted });
      return;
    } catch (e) {
      res.status(500).json({ error: e instanceof Error ? e.message : "server error" });
      return;
    }
  }
  if (op === "shop_buy" || op === "shop_buy_voucher") {
    if (await isSeasonHalted()) {
      res.status(SEASON_HALTED_RESPONSE.status).json(SEASON_HALTED_RESPONSE.body);
      return;
    }
  }

  if (op === "shop_buy") {
    const itemRaw = (req.body as { item?: unknown }).item;
    if (typeof itemRaw !== "string") { res.status(400).json({ error: "item required" }); return; }
    const itemId = itemRaw as ShopItemId;
    // Whitelist guard — only accept known item ids.
    const known: ShopItemId[] = [
      "energy_5", "energy_10", "energy_20",
      "unit_stat_reset", "unit_class_change",
      ...SHOP_BUFF_IDS,
    ];
    known.push("unit_temp_motz_key");
    if (!known.includes(itemId)) { res.status(400).json({ error: "unknown item" }); return; }
    // ---- REQUIRE A PAID TX ----
    // Every purchase must carry a Ronin tx hash that paid the item's RON price
    // to the treasury wallet from the authenticated session wallet. The server
    // pulls the receipt and validates before granting. Nothing on the client
    // can fake a working tx hash.
    const txHashRaw = (req.body as { txHash?: unknown }).txHash;
    if (typeof txHashRaw !== "string") {
      res.status(400).json({ error: "txHash required (paid Ronin tx)" }); return;
    }
    const txHash = txHashRaw;
    try {
      // ---- DAILY 1-PER-ITEM CAP (server-authoritative, devtool-proof) ----
      // Every shop item is hard-capped to ONE purchase per wallet per PH day.
      // The cap lives in Redis (shop:bought:<itemId>:<wallet>:<phDay>) with a
      // TTL that expires at the next 08:00 PH boundary. Nothing the client
      // can do — localStorage edits, request retries, manual API calls —
      // bypasses this; the server is the sole arbiter.
      //
      // The check is atomic: incrWithExpire returns the post-bump count, so
      // even two simultaneous requests both see count > 1 on the loser side
      // and bail out (without granting the item). Worst case is the counter
      // sits at 2 for the rest of the day, which is harmless because we only
      // care that it's > 0.
      const already = await readBoughtToday(itemId, address);
      if (already) { res.status(429).json({ ok: false, reason: "already bought today" }); return; }
      // ---- VERIFY THE RON PAYMENT BEFORE BUMPING DAILY-CAP ----
      // Bumping the cap before payment verification would lock the player out
      // for the day if their tx is bad. Verify first, then bump.
      const pay = await verifyShopPayment(txHash, address, itemId);
      if (!pay.ok) {
        // Pending = tx broadcast but RPC node hasn't indexed the receipt yet.
        // Surface as 202 Accepted so the client polls again rather than
        // treating it as a hard failure. The daily-cap key has NOT been
        // bumped yet, so the player can retry freely.
        if (pay.pending) {
          res.status(202).json({ ok: false, pending: true, reason: pay.reason });
          return;
        }
        res.status(402).json({ ok: false, reason: pay.reason });
        return;
      }
      const after = await markBoughtToday(itemId, address);
      if (after > 1) {
        // Race: another claim raced past us with the SAME wallet.
        // (Could happen if a player double-submits the buy — unlikely in
        //  practice, but harmless: their first request granted the item.)
        res.status(429).json({ ok: false, reason: "already bought today" });
        return;
      }
      // Grant the item — inventory mutation goes through the per-wallet
      // lock so concurrent shop_buy / shop_buy_voucher / bron_roll /
      // consumeBuff don't race against each other. Temp MoTZ Key writes a
      // separate Redis key so it's granted outside the lock.
      const paidAmount = pay.valueWei;
      if (itemId === "unit_temp_motz_key") {
        const r = await grantTempMotzKey(address);
        await consumeTxHash(txHash, address, itemId, paidAmount);
        res.status(200).json({ ok: true, grant: { type: "temp_motz_key", expiresAt: r.expiresAt } });
        return;
      }
      const grant = await mutateShopInventory<{ type: string; itemId: ShopItemId; owned: number; qty?: number } | null>(address, inv => {
        if (itemId === "energy_5" || itemId === "energy_10" || itemId === "energy_20") {
          inv.buffs[itemId] = (inv.buffs[itemId] ?? 0) + 1;
          return { next: inv, result: { type: "energy_pack", itemId, owned: inv.buffs[itemId] as number } };
        }
        if (itemId === "unit_stat_reset" || itemId === "unit_class_change") {
          inv.buffs[itemId] = (inv.buffs[itemId] ?? 0) + 1;
          return { next: inv, result: { type: "entitlement", itemId, owned: inv.buffs[itemId] as number } };
        }
        if (SHOP_BUFF_IDS.includes(itemId)) {
          const grantQty = BUFF_GRANT_SIZE[itemId] ?? 1;
          inv.buffs[itemId] = (inv.buffs[itemId] ?? 0) + grantQty;
          return { next: inv, result: { type: "buff", itemId, owned: inv.buffs[itemId] as number, qty: grantQty } };
        }
        return { next: inv, result: null };
      });
      if (!grant) {
        res.status(503).json({ ok: false, reason: "shop inventory locked — please retry" });
        return;
      }
      await consumeTxHash(txHash, address, itemId, paidAmount);
      // Analytics: lifetime RON spent on shop (per-wallet) AND global shop
      // revenue (this is the ONLY revenue bump — voucher purchases below
      // don't move new RON to the treasury). We use the item's listed RON
      // price rather than the paid wei in case the player over-paid.
      const ronPriceForRevenue = Number((ITEM_PRICES_WEI[itemId] ?? 0n) / 10n ** 18n);
      // Awaited (not void) so the referral RON-milestone check below reads a
      // cumulative total that already includes THIS purchase.
      await bumpRonSpent(address, ronPriceForRevenue).catch(() => undefined);
      void bumpShopRevenue(ronPriceForRevenue);
      // Referral RON-spend reward: this purchase may push the referee's
      // lifetime RON spend over the 10-RON milestone. One-time + no-op for
      // non-referred wallets.
      await fireRonMilestone(address).catch(() => undefined);
      res.status(200).json({ ok: true, grant });
      return;
    } catch (e) {
      res.status(500).json({ error: e instanceof Error ? e.message : "server error" });
      return;
    }
  }

  // shop_buy_voucher — pay for a shop item using RON vouchers from inventory
  // instead of an on-chain RON tx. No wallet signature needed; the server is
  // the sole authority for both inventory and grant. Devtool-proof because:
  //   - vouchers can only have arrived via server-rolled drops (rollBronForKills)
  //     or the admin grant op — there is no client-writable path to inventory
  //   - the server re-reads the wallet's inventory before deducting, so a
  //     localStorage-tampered "vouchers" claim can't overdraw what's actually
  //     stored in Redis
  //   - voucher face values come from the server-side VOUCHER_VALUES_RON
  //     constant; the client can't claim a t1 is worth 1000 RON
  //   - daily 1-per-item cap is enforced the same way as the RON-paid path
  //   - inventory deduction and item grant are written in a single Redis
  //     update, so a partial failure can't leave the wallet missing vouchers
  //     without the item (or vice versa)
  if (op === "shop_buy_voucher") {
    const itemRaw = (req.body as { item?: unknown }).item;
    if (typeof itemRaw !== "string") { res.status(400).json({ error: "item required" }); return; }
    const itemId = itemRaw as ShopItemId;
    const known: ShopItemId[] = [
      "energy_5", "energy_10", "energy_20",
      "unit_stat_reset", "unit_class_change", "unit_temp_motz_key",
      ...SHOP_BUFF_IDS,
    ];
    if (!known.includes(itemId)) { res.status(400).json({ error: "unknown item" }); return; }

    // Parse the submitted voucher spend. Each tier must be a non-negative
    // integer; we clamp obviously bogus sizes to short-circuit attacks early.
    const vRaw = (req.body as { vouchers?: unknown }).vouchers;
    if (!vRaw || typeof vRaw !== "object") {
      res.status(400).json({ error: "vouchers required: { t1, t2, t3, t4, t5 }" }); return;
    }
    const parseSpend = (v: unknown): number => {
      if (typeof v !== "number" || !Number.isFinite(v)) return 0;
      const n = Math.floor(v);
      if (n < 0 || n > 9999) return -1;
      return n;
    };
    const spend = {
      t1: parseSpend((vRaw as Record<string, unknown>).t1),
      t2: parseSpend((vRaw as Record<string, unknown>).t2),
      t3: parseSpend((vRaw as Record<string, unknown>).t3),
      t4: parseSpend((vRaw as Record<string, unknown>).t4),
      t5: parseSpend((vRaw as Record<string, unknown>).t5),
    };
    if (spend.t1 < 0 || spend.t2 < 0 || spend.t3 < 0 || spend.t4 < 0 || spend.t5 < 0) {
      res.status(400).json({ error: "voucher counts must be non-negative integers" }); return;
    }
    const totalSpendRon =
      spend.t1 * VOUCHER_VALUES_RON.t1 +
      spend.t2 * VOUCHER_VALUES_RON.t2 +
      spend.t3 * VOUCHER_VALUES_RON.t3 +
      spend.t4 * VOUCHER_VALUES_RON.t4 +
      spend.t5 * VOUCHER_VALUES_RON.t5;
    if (totalSpendRon <= 0) {
      res.status(400).json({ error: "must spend at least one voucher" }); return;
    }

    // Resolve the item's RON price from the wei table — single source of truth.
    const priceWei = ITEM_PRICES_WEI[itemId];
    if (priceWei === undefined) {
      res.status(400).json({ error: "no price set for item" }); return;
    }
    const priceRon = Number(priceWei / 10n ** 18n);

    if (totalSpendRon < priceRon) {
      res.status(402).json({
        ok: false,
        reason: `submitted vouchers worth ${totalSpendRon} RON, need ${priceRon} RON`,
      });
      return;
    }

    try {
      // Daily cap gate FIRST — fails fast without burning vouchers.
      const already = await readBoughtToday(itemId, address);
      if (already) { res.status(429).json({ ok: false, reason: "already bought today" }); return; }

      // Bump daily-cap counter atomically (separate Redis key, separate
      // atomicity primitive than the inventory lock). If a race pushes us over,
      // bail before touching inventory.
      const after = await markBoughtToday(itemId, address);
      if (after > 1) {
        res.status(429).json({ ok: false, reason: "already bought today" });
        return;
      }

      // ---- ATOMIC INVENTORY MUTATION ----
      // Voucher ownership re-check, deduction, change-credit, and item grant
      // all happen inside a per-wallet Redis lock so concurrent shop_buy
      // / shop_buy_voucher / bron_roll / consumeBuff can't race against each
      // other and corrupt the inventory state.
      type VoucherTier = "t1" | "t2" | "t3" | "t4" | "t5";
      type VoucherMap = Record<VoucherTier, number>;
      type LockResult =
        | { ok: true; grantPayload: Record<string, unknown>; change: VoucherMap; vouchers: VoucherMap }
        | { ok: false; status: number; reason: string };
      const locked: LockResult | null = await mutateShopInventory<LockResult>(address, async inv => {
        inv.vouchers = inv.vouchers ?? {};
        const owned: VoucherMap = {
          t1: inv.vouchers.t1 ?? 0,
          t2: inv.vouchers.t2 ?? 0,
          t3: inv.vouchers.t3 ?? 0,
          t4: inv.vouchers.t4 ?? 0,
          t5: inv.vouchers.t5 ?? 0,
        };
        if (spend.t1 > owned.t1 || spend.t2 > owned.t2 || spend.t3 > owned.t3 ||
            spend.t4 > owned.t4 || spend.t5 > owned.t5) {
          return { next: inv, result: { ok: false, status: 402, reason: "you don't own enough vouchers for this spend" } };
        }
        // Deduct.
        inv.vouchers.t1 = owned.t1 - spend.t1;
        inv.vouchers.t2 = owned.t2 - spend.t2;
        inv.vouchers.t3 = owned.t3 - spend.t3;
        inv.vouchers.t4 = owned.t4 - spend.t4;
        inv.vouchers.t5 = owned.t5 - spend.t5;
        // Compute change (greedy largest-first, server-trusted constants).
        const changeRon = totalSpendRon - priceRon;
        const changeOut: VoucherMap = { t1: 0, t2: 0, t3: 0, t4: 0, t5: 0 };
        if (changeRon > 0) {
          let rem = changeRon;
          for (const t of ["t5", "t4", "t3", "t2", "t1"] as const) {
            const v = VOUCHER_VALUES_RON[t];
            const take = Math.floor(rem / v);
            if (take > 0) { changeOut[t] = take; rem -= take * v; }
          }
          inv.vouchers.t1 += changeOut.t1;
          inv.vouchers.t2 += changeOut.t2;
          inv.vouchers.t3 += changeOut.t3;
          inv.vouchers.t4 += changeOut.t4;
          inv.vouchers.t5 += changeOut.t5;
        }
        // Apply grant inside the same inventory blob.
        let grantPayload: Record<string, unknown> = { itemId };
        if (itemId === "energy_5" || itemId === "energy_10" || itemId === "energy_20") {
          inv.buffs[itemId] = (inv.buffs[itemId] ?? 0) + 1;
          grantPayload = { type: "energy_pack", itemId, owned: inv.buffs[itemId] };
        } else if (itemId === "unit_stat_reset" || itemId === "unit_class_change") {
          inv.buffs[itemId] = (inv.buffs[itemId] ?? 0) + 1;
          grantPayload = { type: "entitlement", itemId, owned: inv.buffs[itemId] };
        } else if (SHOP_BUFF_IDS.includes(itemId)) {
          const grantQty = BUFF_GRANT_SIZE[itemId] ?? 1;
          inv.buffs[itemId] = (inv.buffs[itemId] ?? 0) + grantQty;
          grantPayload = { type: "buff", itemId, owned: inv.buffs[itemId], qty: grantQty };
        }
        // unit_temp_motz_key is granted via grantTempMotzKey OUTSIDE the lock
        // (different Redis key, no inventory dependency).
        const vouchersFinal: VoucherMap = {
          t1: inv.vouchers.t1, t2: inv.vouchers.t2, t3: inv.vouchers.t3, t4: inv.vouchers.t4, t5: inv.vouchers.t5,
        };
        return { next: inv, result: { ok: true, grantPayload, change: changeOut, vouchers: vouchersFinal } };
      });
      if (!locked) {
        res.status(503).json({ ok: false, reason: "shop inventory locked — please retry" });
        return;
      }
      if (!locked.ok) {
        res.status(locked.status).json({ ok: false, reason: locked.reason });
        return;
      }
      // Temp MoTZ Key grant happens OUTSIDE the inventory lock (writes a
      // separate Redis key). Vouchers have already been burned atomically.
      if (itemId === "unit_temp_motz_key") {
        const r = await grantTempMotzKey(address);
        locked.grantPayload = { type: "temp_motz_key", expiresAt: r.expiresAt };
      }
      // Analytics: lifetime RON value of vouchers spent on shop (separate
      // counter from on-chain RON-spent so the sheet can show both lines).
      // Records the item's RON price (NOT the over-pay total — change is
      // refunded and doesn't count as a spend).
      void bumpVouchersSpent(address, priceRon);
      res.status(200).json({
        ok: true,
        grant: locked.grantPayload,
        spent: spend,
        spentRon: totalSpendRon,
        priceRon,
        change: locked.change,
        changeRon: totalSpendRon - priceRon,
        vouchers: locked.vouchers,
      });
      return;
    } catch (e) {
      res.status(500).json({ error: e instanceof Error ? e.message : "server error" });
      return;
    }
  }

  if (op === "shop_consume") {
    const itemRaw = (req.body as { item?: unknown }).item;
    if (typeof itemRaw !== "string") { res.status(400).json({ error: "item required" }); return; }
    const itemId = itemRaw as ShopItemId;
    try {
      const ok = await consumeBuff(address, itemId);
      if (!ok) { res.status(400).json({ ok: false, reason: "none owned" }); return; }
      // Scholar's Insight gives up to +25% XP on its floor — preemptively bump
      // the cheat-check ceiling so a player who slots Scholar's never trips
      // the lifetime-XP audit on a high-XP clear (best case: floor 50 with
      // full party + daily streak active).
      if (itemId === "buff_scholars_insight") {
        await bumpXpCap(address, SCHOLARS_INSIGHT_CAP_BUMP).catch(() => 0);
      }
      const inv = await readShopInventory(address);
      res.status(200).json({ ok: true, inventory: inv });
      return;
    } catch (e) {
      res.status(500).json({ error: e instanceof Error ? e.message : "server error" });
      return;
    }
  }

  // Atomic "use an energy pack from inventory" — decrement count + grant energy.
  // Same anti-cheat surface: localStorage can't fake the grant; server is the
  // sole authority for both inventory and energy.
  if (op === "inventory_use_energy") {
    const itemRaw = (req.body as { item?: unknown }).item;
    if (itemRaw !== "energy_5" && itemRaw !== "energy_10" && itemRaw !== "energy_20") {
      res.status(400).json({ error: "item must be energy_5|energy_10|energy_20" }); return;
    }
    const itemId = itemRaw as "energy_5" | "energy_10" | "energy_20";
    try {
      const consumed = await consumeBuff(address, itemId);
      if (!consumed) { res.status(400).json({ ok: false, reason: "none owned" }); return; }
      const grantAmount = itemId === "energy_5" ? 5 : itemId === "energy_10" ? 10 : 20;
      const newAmount = await adminGrantEnergy(address, grantAmount);
      // Energy pack lets the player run more floors than the daily refill
      // budget allows. Pre-bump the cheat-check ceiling by packSize × per-floor
      // cap so the audit doesn't trip during the in-flight gap between using
      // the pack and earning the XP. The per-clear bump still runs later;
      // these two bumps stack intentionally for headroom.
      await bumpXpCap(address, ENERGY_PACK_CAP_BUMP[itemId]).catch(() => 0);
      const inv = await readShopInventory(address);
      res.status(200).json({ ok: true, amount: newAmount, max: ENERGY_MAX, granted: grantAmount, inventory: inv });
      return;
    } catch (e) {
      res.status(500).json({ error: e instanceof Error ? e.message : "server error" });
      return;
    }
  }

  const stageId = typeof body.stageId === "number" ? body.stageId : null;
  // Campaign is 500 floors (1-50 base + 51-500 post-game). This cap was 50
  // pre-post-game and never got bumped — clears of floor 51+ were rejected
  // 400, so the server max-floor counter stayed stuck at 50 and the next
  // pullCanonicalProgress clobbered the client's local unlock state back
  // down. Keep this in sync with STAGE_DEFS.length / POST_GAME_LAST_FLOOR.
  const CAMPAIGN_LAST_FLOOR = 500;
  if (stageId === null || stageId < 1 || stageId > CAMPAIGN_LAST_FLOOR) {
    res.status(400).json({ error: "stageId out of range" }); return;
  }
  const ms = typeof body.ms === "number" && Number.isFinite(body.ms) ? Math.floor(body.ms) : null;
  const replay = (req.body as { replay?: unknown }).replay && typeof (req.body as { replay?: unknown }).replay === "object"
    ? (req.body as { replay: object }).replay
    : null;

  try {
    if (op === "retry_status") {
      const used = await readFloorRetries(address);
      const remaining = Math.max(0, FLOOR_RETRIES_PER_DAY - used);
      res.status(200).json({ ok: true, used, remaining, max: FLOOR_RETRIES_PER_DAY });
      return;
    }

    if (op === "defeat_refund") {
      // Atomic: check the per-wallet daily counter, bump it, then grant +1 energy.
      // Counter shares the same Redis key the old "retry" feature used (PH-day TTL)
      // so the cap can't be hacked from devtools — every claim hits the server.
      const beforeUsed = await readFloorRetries(address);
      if (beforeUsed >= FLOOR_RETRIES_PER_DAY) {
        res.status(429).json({ ok: false, used: beforeUsed, remaining: 0, max: FLOOR_RETRIES_PER_DAY });
        return;
      }
      const newUsed = await bumpFloorRetry(address);
      // Race: another concurrent claim could push us over the cap. The extra
      // increment still expires at the next PH boundary, so we just hard-deny.
      if (newUsed > FLOOR_RETRIES_PER_DAY) {
        res.status(429).json({ ok: false, used: newUsed, remaining: 0, max: FLOOR_RETRIES_PER_DAY });
        return;
      }
      // Now grant the energy. If this fails, we've already burnt a slot — accept
      // that small loss vs. the alternative of granting energy without bumping.
      const energy = await adminGrantEnergy(address, 1);
      res.status(200).json({
        ok: true,
        used: newUsed,
        remaining: FLOOR_RETRIES_PER_DAY - newUsed,
        max: FLOOR_RETRIES_PER_DAY,
        energy,
      });
      return;
    }

    // Default: clear event
    // Season-halt gate — a halted season blocks XP cap bumps + LB submissions
    // alongside run starts, so a player can't accumulate during off-season.
    if (await isSeasonHalted()) {
      res.status(SEASON_HALTED_RESPONSE.status).json(SEASON_HALTED_RESPONSE.body);
      return;
    }
    // ---- ENERGY-SPEND WITNESS (devtool-proof gate) ----
    // Every legit campaign clear is preceded by a real /api/energy POST that
    // debited the wallet's energy pool. We minted a "pending clear" credit
    // there; consumePendingClear atomically consumes one here. A scripted
    // client that POSTs `op:"clear"` 50 times without spending energy will
    // get 402 on the first attempt — there's no path to mint cap bumps,
    // floor progression, or the Conqueror trophy without burning energy.
    const witnessed = await consumePendingClear(address);
    if (!witnessed) {
      res.status(402).json({
        ok: false,
        reason: "no energy-spend witness — clear must be preceded by an /api/energy POST that debits the energy pool",
      });
      return;
    }
    const dailyMul = await getCurrentMultiplier(address).catch(() => 1.0);
    // Post-game floors (51-500) award meaningfully more XP since enemies are
    // higher level — the XP-cap allowance scales proportionally so the
    // anti-cheat threshold doesn't trip on legitimate post-game grinding.
    // Scale factor = enemyLevelOverride / 30 (base party level), clamped so
    // the cap bump still grows monotonically.
    let postGameScale = 1;
    if (stageId >= 51 && stageId <= 500) {
      const enemyLevel = 30 + Math.round(((stageId - 51) / (500 - 51)) * (70 - 30));
      postGameScale = Math.max(1, enemyLevel / 30);
    }
    const cap = await bumpXpCap(address, XP_CAP_PER_FLOOR.floor * dailyMul * postGameScale);

    let worldEnderSubmitted = false;
    let worldEnderImproved = false;
    if (stageId === 50 && ms !== null) {
      const we = await submitWorldEnderClear(address, ms).catch(() => ({ ok: false, improved: false }));
      worldEnderSubmitted = we.ok;
      worldEnderImproved = we.improved;
    }
    // Save replay blob alongside the LB entry only when this clear actually
    // improved the wallet's PB — otherwise we'd churn Upstash for nothing.
    // Also rejects replays whose recorded party violates the size cap.
    if (stageId === 50 && replay && worldEnderImproved && isReplayPartyValid(replay)) {
      await saveReplayBlob("we", address, replay).catch(() => undefined);
    }

    // Track sequential floor-mode progress + first-to-conquer trophy.
    // The replay (if present) carries the party at floor-50 finish — we lift
    // it into the conqueror record so the leaderboard can show stats / class /
    // loadout for the first wallet to top out.
    type PartyMemberMin = { templateId: string; classId?: string; level: number; customStats: Record<string, number>; equippedSkills: string[] };
    let conquerParty: PartyMemberMin[] | undefined;
    if (stageId === 50 && replay && isReplayPartyValid(replay) && Array.isArray((replay as { battles?: unknown }).battles)) {
      const battles = (replay as { battles: { party?: PartyMemberMin[] }[] }).battles;
      const last = battles[battles.length - 1];
      if (last && Array.isArray(last.party)) {
        // Truncate to MAX_PARTY_SIZE as a defense in depth — isReplayPartyValid
        // already rejects oversize parties, but this guarantees the conqueror
        // record can never store > MAX_PARTY_SIZE entries.
        conquerParty = last.party.slice(0, MAX_PARTY_SIZE).map(p => ({
          templateId: String(p.templateId),
          classId: p.classId,
          level: Number(p.level) || 1,
          customStats: p.customStats ?? {},
          equippedSkills: Array.isArray(p.equippedSkills) ? p.equippedSkills : [],
        }));
      }
    }
    const conquer = await recordFloorModeClear(address, stageId, conquerParty).catch(() => ({ newMax: 0, awardedConqueror: false }));

    // Referral floor-milestone reward: if this clearing wallet was referred
    // and just cleared Floor 20/40/60/80/100, grant 5 energy to both the
    // referee and their referrer. Idempotent + no-op for non-referred
    // wallets, so it's safe to await unconditionally on every clear.
    await fireFloorMilestone(address, stageId).catch(() => undefined);

    res.status(200).json({
      ok: true,
      cap,
      worldEnderSubmitted,
      maxFloorCleared: conquer.newMax,
      awardedConqueror: conquer.awardedConqueror,
    });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : "server error" });
  }
}
