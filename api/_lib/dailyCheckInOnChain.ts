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
const RPC_URL = process.env.DAILY_CHECKIN_RPC_URL ?? "https://saigon-testnet.roninchain.com/rpc";
const CHAIN_ID = Number(process.env.DAILY_CHECKIN_CHAIN_ID ?? 2021);

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
    const msg = e instanceof Error ? e.message : "unknown rpc error";
    // Trim viem's verbose error blob to one line so it fits cleanly in logs
    // and any error returned to the client.
    return { ok: false, reason: msg.split("\n")[0].slice(0, 200) };
  }
}
