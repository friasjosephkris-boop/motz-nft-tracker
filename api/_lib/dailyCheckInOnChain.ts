// On-chain daily check-in integration.
//
// When a player claims their in-game daily bonus, the server (relayer) also
// calls the `checkIn(address user)` function on the Daily Check-In smart
// contract. The contract is delegated-call style — the relayer wallet pays
// gas and signs the tx; the player wallet just appears as the `user` arg.
//
// CONFIGURATION (Vercel env vars — set per-environment, leave unset to disable):
//   DAILY_CHECKIN_ENABLED       — "1" to enable. Anything else = silent no-op.
//   DAILY_CHECKIN_CONTRACT_ADDR — 0x… deployed Daily Check-In contract
//   DAILY_CHECKIN_RELAYER_PK    — 0x… private key of the wallet that pays gas
//   DAILY_CHECKIN_RPC_URL       — RPC endpoint. Defaults to Saigon testnet.
//   DAILY_CHECKIN_CHAIN_ID      — 2021 (Saigon) or 2020 (Ronin mainnet). Default 2021.
//
// FAILURE MODE: ops decision = reject the in-game claim if the tx fails. The
// caller (claimDaily) MUST treat a thrown error or { ok: false } here as
// "abort, do not credit energy, do not advance streak."
//
// IDEMPOTENCY: not enforced here. The CONTRACT itself rejects double-checkin
// in the same period (see the `checkIn` description: "must not have
// double-checked in the same period"). If the player already on-chain
// checked in (e.g. via another platform), the tx reverts and we propagate
// that as a claim failure.

import { createPublicClient, createWalletClient, http, defineChain, getAddress, type Address, type Hash } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const ENABLED = process.env.DAILY_CHECKIN_ENABLED === "1";
const CONTRACT_ADDR_RAW = process.env.DAILY_CHECKIN_CONTRACT_ADDR ?? "";
const RELAYER_PK_RAW = process.env.DAILY_CHECKIN_RELAYER_PK ?? "";
const CHAIN_ID = Number(process.env.DAILY_CHECKIN_CHAIN_ID ?? 2021);
// RPC URL must match the chain — otherwise viem signs for the "right" chain
// but queries the "wrong" one (sees 0 balance, no contract, etc.). Default
// it from CHAIN_ID so a forgetful operator can't half-configure (the trap
// that caused the 'gas required exceeds allowance (0)' bug on mainnet).
const DEFAULT_RPC_FOR_CHAIN: Record<number, string> = {
  2020: "https://api.roninchain.com/rpc",
  2021: "https://saigon-testnet.roninchain.com/rpc",
};
const RPC_URL = process.env.DAILY_CHECKIN_RPC_URL ?? DEFAULT_RPC_FOR_CHAIN[CHAIN_ID] ?? DEFAULT_RPC_FOR_CHAIN[2021];

const saigon = defineChain({
  id: 2021,
  name: "Saigon",
  nativeCurrency: { name: "RON", symbol: "RON", decimals: 18 },
  rpcUrls: { default: { http: ["https://saigon-testnet.roninchain.com/rpc"] } },
});

const roninMainnet = defineChain({
  id: 2020,
  name: "Ronin",
  nativeCurrency: { name: "RON", symbol: "RON", decimals: 18 },
  rpcUrls: { default: { http: ["https://api.roninchain.com/rpc"] } },
});

const chain = CHAIN_ID === 2020 ? roninMainnet : saigon;

// Match the ABI shown in the Ronin contract template screenshot:
//   function checkIn(address user) external
const dailyCheckInAbi = [{
  name: "checkIn",
  type: "function",
  stateMutability: "nonpayable",
  inputs: [{ name: "user", type: "address" }],
  outputs: [],
}] as const;

/** True when all required env vars are present. When false, callOnChain
 *  short-circuits to a successful no-op so the in-game claim still works
 *  in environments where on-chain isn't configured (e.g. local dev, or
 *  prod before the mainnet contract is deployed). */
export function isOnChainCheckInEnabled(): boolean {
  return ENABLED && CONTRACT_ADDR_RAW.length > 0 && RELAYER_PK_RAW.length > 0;
}

interface CheckInResult { ok: boolean; txHash?: Hash; reason?: string; }

/** Call `checkIn(player)` from the relayer wallet. Waits for the receipt so
 *  the caller can confirm success before granting the in-game reward.
 *
 *  If on-chain integration is not configured (env vars missing or disabled),
 *  returns { ok: true } immediately — the caller treats this as a pass-through
 *  so unconfigured environments keep working.
 *
 *  Throws nothing; returns { ok: false, reason } on any failure (RPC down,
 *  insufficient gas, tx revert, timeout). Caller decides whether to fail
 *  the claim (current policy: yes, fail it). */
export async function callOnChainCheckIn(player: Address): Promise<CheckInResult> {
  if (!isOnChainCheckInEnabled()) {
    return { ok: true, reason: "on-chain integration not configured (no-op)" };
  }
  let contractAddr: Address;
  try {
    contractAddr = getAddress(CONTRACT_ADDR_RAW);
  } catch {
    return { ok: false, reason: "DAILY_CHECKIN_CONTRACT_ADDR is not a valid 0x address" };
  }
  let relayerPk: `0x${string}`;
  if (/^0x[0-9a-fA-F]{64}$/.test(RELAYER_PK_RAW)) {
    relayerPk = RELAYER_PK_RAW as `0x${string}`;
  } else if (/^[0-9a-fA-F]{64}$/.test(RELAYER_PK_RAW)) {
    relayerPk = (`0x${RELAYER_PK_RAW}`) as `0x${string}`;
  } else {
    return { ok: false, reason: "DAILY_CHECKIN_RELAYER_PK is not a 32-byte hex string" };
  }

  try {
    const account = privateKeyToAccount(relayerPk);
    const transport = http(RPC_URL);
    const wallet = createWalletClient({ account, chain, transport });
    const pub = createPublicClient({ chain, transport });

    // Simulate first so a guaranteed-revert (e.g. double-checkin in the same
    // period) errors out BEFORE we burn gas. The contract description
    // explicitly lists "double-checked in the same period" as a revert
    // condition, so the simulation catches the common case cleanly.
    await pub.simulateContract({
      address: contractAddr,
      abi: dailyCheckInAbi,
      functionName: "checkIn",
      args: [player],
      account,
    });

    const hash = await wallet.writeContract({
      address: contractAddr,
      abi: dailyCheckInAbi,
      functionName: "checkIn",
      args: [player],
    });

    // 30s is enough for Ronin blocks (~3s) without hanging the daily endpoint
    // indefinitely if the RPC goes dark mid-tx.
    const receipt = await pub.waitForTransactionReceipt({ hash, timeout: 30_000 });
    if (receipt.status !== "success") {
      return { ok: false, txHash: hash, reason: `tx reverted (status=${receipt.status})` };
    }
    return { ok: true, txHash: hash };
  } catch (e) {
    // Pull the actual revert reason out of viem's verbose error blob. viem
    // exposes it on .shortMessage / .metaMessages / .details — fall back to
    // walking the message text if those aren't present. The earlier
    // single-line truncation hid the real reason (e.g. "not owner") because
    // viem puts the headline on line 1 and the actual reason on line 2+.
    const err = e as { shortMessage?: string; details?: string; metaMessages?: unknown; message?: string };
    const candidates: string[] = [];
    if (typeof err.shortMessage === "string") candidates.push(err.shortMessage);
    if (typeof err.details === "string") candidates.push(err.details);
    if (Array.isArray(err.metaMessages)) {
      for (const m of err.metaMessages) {
        if (typeof m === "string") candidates.push(m);
      }
    }
    // Look for an explicit revert reason inside the full message body.
    const rawMsg = typeof err.message === "string" ? err.message : "";
    const reasonMatch = rawMsg.match(/reverted with the following reason:\s*\n?\s*([^\n]+)/i);
    if (reasonMatch && reasonMatch[1]) candidates.push(reasonMatch[1].trim());
    // Strip surrounding quotes / Solidity-style wrappers and dedupe.
    const cleaned = candidates
      .map(s => s.replace(/^["']|["']$/g, "").trim())
      .filter(s => s.length > 0);
    const reason = cleaned.length > 0
      ? Array.from(new Set(cleaned)).join(" | ").slice(0, 400)
      : (rawMsg.split("\n").filter(l => l.trim().length > 0).slice(0, 3).join(" | ").slice(0, 400) || "unknown rpc error");
    return { ok: false, reason };
  }
}
