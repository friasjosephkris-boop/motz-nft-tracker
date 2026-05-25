import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { MOTZ_WALLETS, MOTZ_TRANSFERRERS } from "@/lib/motz-wallets";
import type {
  ApiResponse,
  TaggedCollectionHoldings,
  TaggedHoldingRow,
} from "@/app/_components/shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Snapshot file lives in the gitignored data/ directory. Holds the most
// recent combined-portfolio render for the MoTZ project wallets — served
// as-is to any visitor of the MoTZ Dashboard / PnL tabs so they don't
// trigger expensive load chains on every page view.
const SNAPSHOT_PATH = path.join(
  process.cwd(),
  "data",
  "motz-snapshot.json",
);
const SNAPSHOT_TTL_MS = 24 * 60 * 60 * 1000;

export type MotzSnapshot = {
  generatedAt: number;
  walletAddresses: string[];
  resolvedAddresses: string[];
  collections: TaggedCollectionHoldings[];
  currentRonUsd: number | null;
  walletCount: number;
};

function readSnapshot(): MotzSnapshot | null {
  try {
    if (!fs.existsSync(SNAPSHOT_PATH)) return null;
    return JSON.parse(fs.readFileSync(SNAPSHOT_PATH, "utf8")) as MotzSnapshot;
  } catch {
    return null;
  }
}

function writeSnapshot(snap: MotzSnapshot): void {
  fs.mkdirSync(path.dirname(SNAPSHOT_PATH), { recursive: true });
  fs.writeFileSync(SNAPSHOT_PATH, JSON.stringify(snap));
}

// In-flight guard: if a refresh is already running, return its promise so
// concurrent requests don't trigger overlapping loads (which would just
// rate-limit themselves into oblivion).
let refreshInFlight: Promise<MotzSnapshot> | null = null;

async function refreshSnapshot(req: NextRequest): Promise<MotzSnapshot> {
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = (async () => {
    try {
      // Resolve absolute origin so we can call our own /api/holdings.
      // Next 16 puts the original host on req.nextUrl.
      const origin = req.nextUrl.origin;
      const transferrerParams = MOTZ_TRANSFERRERS.map(
        (t) => `&transferrer=${encodeURIComponent(t)}`,
      ).join("");
      const byContract = new Map<string, TaggedCollectionHoldings>();
      const resolved: string[] = [];
      let currentRonUsd: number | null = null;
      // Sequential — same reason as Load Combined: per-wallet shares a
      // server-side rate limiter, running in parallel just trips the breaker.
      for (const w of MOTZ_WALLETS) {
        const url =
          `${origin}/api/holdings?address=${encodeURIComponent(w)}` +
          transferrerParams;
        const r = await fetch(url, { cache: "no-store" });
        const j = (await r.json()) as ApiResponse | { error: string };
        if (!r.ok || "error" in j) {
          throw new Error(
            `Snapshot refresh failed for ${w}: ` +
              ("error" in j ? j.error : `HTTP ${r.status}`),
          );
        }
        const data = j as ApiResponse;
        resolved.push(data.address);
        if (data.currentRonUsd != null) currentRonUsd = data.currentRonUsd;
        for (const c of data.collections) {
          const existing = byContract.get(c.contract);
          const taggedRows: TaggedHoldingRow[] = c.rows.map((row) => ({
            ...row,
            walletTag: data.address,
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
      const snap: MotzSnapshot = {
        generatedAt: Date.now(),
        walletAddresses: [...MOTZ_WALLETS],
        resolvedAddresses: resolved,
        collections: [...byContract.values()],
        currentRonUsd,
        walletCount: resolved.length,
      };
      writeSnapshot(snap);
      return snap;
    } finally {
      refreshInFlight = null;
    }
  })();
  return refreshInFlight;
}

// GET — return cached snapshot. Caller can pass ?stale=ok to receive a
// stale snapshot even if it's beyond the TTL (useful when Sky Mavis is
// down and we'd rather show old data than nothing).
export async function GET(req: NextRequest) {
  const cached = readSnapshot();
  const stale =
    cached && Date.now() - cached.generatedAt > SNAPSHOT_TTL_MS;
  const allowStale = req.nextUrl.searchParams.get("stale") === "ok";
  if (cached && (!stale || allowStale)) {
    return NextResponse.json({ ...cached, stale: !!stale });
  }
  if (!cached) {
    try {
      const fresh = await refreshSnapshot(req);
      return NextResponse.json({ ...fresh, stale: false });
    } catch (err) {
      return NextResponse.json(
        { error: (err as Error).message },
        { status: 500 },
      );
    }
  }
  // Cached + stale + !allowStale → kick off refresh, return stale immediately.
  refreshSnapshot(req).catch((err) => {
    console.error("[motz-snapshot] background refresh failed:", err);
  });
  return NextResponse.json({ ...cached, stale: true });
}

// POST — force refresh now and return the fresh snapshot.
export async function POST(req: NextRequest) {
  try {
    const fresh = await refreshSnapshot(req);
    return NextResponse.json({ ...fresh, stale: false });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 },
    );
  }
}
