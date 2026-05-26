import { NextRequest, NextResponse } from "next/server";
import { MOTZ_FOUNDERS_COIN } from "@/lib/contracts";
import { userAcquisitionsFor } from "@/lib/marketplace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const address =
    req.nextUrl.searchParams.get("address") ??
    "0x7c5B15E5e361E7B91D2648256aC50BC561979F3c";
  const acqs = await userAcquisitionsFor(
    address,
    MOTZ_FOUNDERS_COIN.address,
    0,
    50,
  );
  return NextResponse.json({
    address,
    contract: MOTZ_FOUNDERS_COIN.address,
    count: acqs.size,
    items: Array.from(acqs.entries()).map(([k, v]) => ({ ...v, key: k })),
  });
}
