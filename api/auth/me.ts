import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getAddress } from "viem";
import { verifySession } from "../_lib/jwt.js";
import { holdsAnyGatedNft, holdsMotzKey } from "../_lib/ronin.js";
import { isDevBypassWallet } from "../_lib/devBypass.js";
import { hasActiveTempMotzKey, readWipeEpoch } from "../_lib/runState.js";

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith("Bearer ")) {
    res.status(401).json({ error: "no token" });
    return;
  }
  const token = auth.slice("Bearer ".length);
  try {
    const payload = await verifySession(token);
    const address = getAddress(payload.address);
    const bypass = isDevBypassWallet(address);
    // Re-check that the wallet STILL holds the gated NFT. Issued sessions are
    // valid for 24h, so without this a player who transfers/sells their NFT
    // after signing in could keep playing until expiry. Re-validating on every
    // session check (called by the client periodically) revokes access almost
    // immediately. Dev-bypass wallets skip this on dev environments only.
    if (!bypass) {
      const stillHolds = await holdsAnyGatedNft(address).catch(() => false);
      if (!stillHolds) {
        res.status(403).json({ error: "wallet no longer holds required NFT" });
        return;
      }
    }
    // Re-check key holding too so the locked-unit overlay updates if the key
    // is sold/transferred mid-session. Also honor any active temporary MoTZ
    // Key (seasonal pass bought from the shop) — its expiry is persisted
    // server-side, so the client can't fake it from devtools.
    const [onChainKey, tempKey, wipeEpoch] = await Promise.all([
      bypass ? Promise.resolve(true) : holdsMotzKey(address).catch(() => false),
      bypass ? Promise.resolve(false) : hasActiveTempMotzKey(address).catch(() => false),
      readWipeEpoch().catch(() => 0),
    ]);
    const motzKey = onChainKey || tempKey;
    // wipeEpoch lets the client detect a server wipe and force a localStorage
    // clear + reload. Sent on every session check (5-min poll) so even sleeping
    // tabs converge within minutes of a wipe.
    res.status(200).json({ address: payload.address, perks: { motzKey }, wipeEpoch });
  } catch {
    res.status(401).json({ error: "invalid session" });
  }
}
