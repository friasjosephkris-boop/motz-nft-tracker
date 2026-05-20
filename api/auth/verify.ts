import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getAddress, verifyMessage } from "viem";
import { verifyChallenge, signSession } from "../_lib/jwt.js";
import { holdsAnyGatedNft, NftCheckUnavailableError } from "../_lib/ronin.js";
import { buildSignMessage } from "../_lib/signMessage.js";
import { isDevBypassWallet } from "../_lib/devBypass.js";

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== "POST") {
    res.status(405).json({ error: "method not allowed" });
    return;
  }
  const { address, signature, token } = (req.body ?? {}) as {
    address?: string; signature?: string; token?: string;
  };
  if (typeof address !== "string" || typeof signature !== "string" || typeof token !== "string") {
    res.status(400).json({ error: "address, signature, token required" });
    return;
  }

  let normalized: ReturnType<typeof getAddress>;
  try { normalized = getAddress(address); }
  catch { res.status(400).json({ error: "invalid address" }); return; }

  let challenge;
  try { challenge = await verifyChallenge(token); }
  catch { res.status(400).json({ error: "invalid or expired challenge" }); return; }

  if (challenge.address !== normalized) {
    res.status(400).json({ error: "address mismatch" });
    return;
  }

  const message = buildSignMessage({
    address: normalized,
    nonce: challenge.nonce,
    ts: challenge.ts,
    domain: challenge.domain,
  });

  const ok = await verifyMessage({ address: normalized, message, signature: signature as `0x${string}` });
  if (!ok) {
    res.status(401).json({ error: "bad signature" });
    return;
  }

  // Dev tester wallets bypass the NFT-gate check on dev environments only.
  if (!isDevBypassWallet(normalized)) {
    let holds: boolean;
    try {
      holds = await holdsAnyGatedNft(normalized);
    } catch (e) {
      // RPC outage / rate-limit — DON'T tell the player they lack the NFT
      // (they may well hold it). Return a distinct retryable 503 so the
      // wallet gate shows "try again" instead of a false "no NFT" denial.
      if (e instanceof NftCheckUnavailableError) {
        res.status(503).json({ error: "Couldn't verify NFT ownership right now — the Ronin network is busy. Please try connecting again in a moment." });
        return;
      }
      throw e;
    }
    if (!holds) {
      res.status(403).json({ error: "wallet does not hold required NFT" });
      return;
    }
  }

  const session = await signSession(normalized);
  res.status(200).json({ session, address: normalized });
}
