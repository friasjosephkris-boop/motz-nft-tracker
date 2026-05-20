import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getAddress } from "viem";
import { verifySession } from "../_lib/jwt.js";
import { holdsAnyGatedNft, holdsMotzKey, NftCheckUnavailableError } from "../_lib/ronin.js";
import { isDevBypassWallet } from "../_lib/devBypass.js";
import { hasActiveTempMotzKey, readWipeEpoch, readForceResetAt } from "../_lib/runState.js";

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
      // Re-validation is lenient on RPC failures: a transient Ronin RPC blip
      // must NOT revoke an active session. Only a *definitive* non-holder
      // result (all contract reads succeeded, all zero) revokes access.
      // NftCheckUnavailableError → keep the session; the next poll re-checks.
      let stillHolds = true;
      try {
        stillHolds = await holdsAnyGatedNft(address);
      } catch (e) {
        if (e instanceof NftCheckUnavailableError) {
          stillHolds = true; // RPC outage — don't kick the player out
        } else {
          stillHolds = false; // unexpected error — fail closed
        }
      }
      if (!stillHolds) {
        res.status(403).json({ error: "wallet no longer holds required NFT" });
        return;
      }
    }
    // Re-check key holding too so the locked-unit overlay updates if the key
    // is sold/transferred mid-session. Also honor any active temporary MoTZ
    // Key (seasonal pass bought from the shop) — its expiry is persisted
    // server-side, so the client can't fake it from devtools.
    const [onChainKey, tempKey, wipeEpoch, forceResetAt] = await Promise.all([
      bypass ? Promise.resolve(true) : holdsMotzKey(address).catch(() => false),
      bypass ? Promise.resolve(false) : hasActiveTempMotzKey(address).catch(() => false),
      readWipeEpoch().catch(() => 0),
      readForceResetAt(address).catch(() => 0),
    ]);
    const motzKey = onChainKey || tempKey;
    // wipeEpoch:    global counter, bumped on full prod wipes
    // forceResetAt: per-wallet timestamp, bumped by targeted admin reset
    // Either advancing past the client's cached value triggers a local nuke
    // + reload on the next session-check poll (5-min cadence).
    res.status(200).json({ address: payload.address, perks: { motzKey }, wipeEpoch, forceResetAt });
  } catch {
    res.status(401).json({ error: "invalid session" });
  }
}
