// Client-side helper: sign the Gauntlet DailyCheckIn contract's `checkIn()`
// function from the player's connected Ronin Wallet. Player pays ~0.001 RON
// in gas. Returns the tx hash on success — server verifies via RPC before
// granting the in-game daily reward.
//
// The new contract uses `msg.sender` semantics (no relayer pattern), so the
// player wallet MUST be the one to sign. This is the cost of being eligible
// for Ronin Voyages rewards — Voyages tracks msg.sender, not a delegated arg.

import { getVerifiedAddress } from "./session";

const CONTRACT_ADDR: string = (import.meta.env.VITE_DAILY_CHECKIN_CONTRACT_ADDR ?? "").trim();

/** keccak256("checkIn()") first 4 bytes = function selector. The contract's
 *  ABI is checkIn() with no args, so the calldata is exactly the selector. */
const CHECKIN_SELECTOR = "0x183ff085";

const RONIN_CHAIN_ID_HEX = "0x7e4"; // 2020
const RONIN_CHAIN_ID_DEC = 2020;

export interface DailyCheckInSignResult {
  ok: boolean;
  txHash?: `0x${string}`;
  /** Human-readable error surfaced to the player on failure. */
  reason?: string;
  /** True when the player explicitly cancelled in their wallet popup. The UI
   *  treats this differently from a true failure (no error toast, just close). */
  cancelled?: boolean;
}

export function isDailyCheckInChainEnabled(): boolean {
  return /^0x[0-9a-fA-F]{40}$/.test(CONTRACT_ADDR);
}

export function getDailyCheckInContractAddr(): string {
  return CONTRACT_ADDR;
}

interface EthProvider {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
}

function getRoninProvider(): EthProvider | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { ronin?: EthProvider; ethereum?: EthProvider };
  // Prefer the explicit window.ronin injection. Falls back to window.ethereum
  // (Ronin Wallet also exposes itself there, alongside MetaMask if installed).
  return w.ronin ?? w.ethereum ?? null;
}

/** Confirm the connected wallet is on Ronin Mainnet (2020). Prompts a
 *  wallet_switchEthereumChain request if not — most players will already be
 *  on Ronin from the sign-in step, so this is a fast no-op for them. */
async function ensureRoninMainnet(provider: EthProvider): Promise<{ ok: true } | { ok: false; reason: string }> {
  try {
    const result = await provider.request({ method: "eth_chainId" });
    const chainId = typeof result === "string" ? result.toLowerCase() : "";
    if (chainId === RONIN_CHAIN_ID_HEX) return { ok: true };
    const asNum = parseInt(chainId, chainId.startsWith("0x") ? 16 : 10);
    if (asNum === RONIN_CHAIN_ID_DEC) return { ok: true };
  } catch { /* fall through to switch attempt */ }
  try {
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: RONIN_CHAIN_ID_HEX }],
    });
    return { ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "couldn't switch to Ronin";
    if (/reject|denied|cancel/i.test(msg)) {
      return { ok: false, reason: "please switch to Ronin Mainnet in your wallet" };
    }
    return { ok: false, reason: msg };
  }
}

/** Pop up Ronin Wallet to sign the `checkIn()` tx. Returns the tx hash if
 *  the player approves and the wallet submits. Does NOT wait for confirmation
 *  — the server polls for that based on the returned hash. */
export async function signDailyCheckIn(): Promise<DailyCheckInSignResult> {
  if (!isDailyCheckInChainEnabled()) {
    // Misconfiguration — VITE_DAILY_CHECKIN_CONTRACT_ADDR wasn't set at build.
    // Surfaced as a real error so ops notices it instead of silently skipping.
    return { ok: false, reason: "on-chain daily check-in is not configured on this build" };
  }
  const provider = getRoninProvider();
  if (!provider) {
    return { ok: false, reason: "no Ronin-compatible wallet detected in this browser" };
  }

  // Make sure an account is actually connected. This is normally a no-op
  // for signed-in players, but guards against edge cases where the wallet
  // dropped its connection after the session was issued.
  let account: string;
  try {
    const res = await provider.request({ method: "eth_requestAccounts" });
    const accs = Array.isArray(res) ? res as string[] : [];
    if (accs.length === 0 || !accs[0]) {
      return { ok: false, reason: "no account returned by wallet" };
    }
    account = accs[0];
  } catch (e) {
    const msg = e instanceof Error ? e.message : "wallet connect rejected";
    if (/reject|denied|cancel/i.test(msg)) {
      return { ok: false, cancelled: true, reason: "wallet connection cancelled" };
    }
    return { ok: false, reason: msg };
  }

  // Match-account guard: the signing wallet MUST be the same as the JWT-verified
  // login wallet. The server enforces this via the on-chain `from` check, but
  // a clear early failure beats an opaque server 4xx after the player has
  // already approved a tx that won't be credited.
  const sess = getVerifiedAddress();
  if (sess && account.toLowerCase() !== sess.toLowerCase()) {
    return {
      ok: false,
      reason: `the active wallet account doesn't match your logged-in wallet. Switch active account, or sign out and sign in again with this wallet.`,
    };
  }

  const chain = await ensureRoninMainnet(provider);
  if (!chain.ok) return { ok: false, reason: chain.reason };

  // Build and send the checkIn() tx. Value is 0 — this is a state-changing
  // function call, not a transfer. Gas limit is left for the wallet to
  // estimate so we don't ship a hardcoded number that goes stale if the
  // contract logic changes.
  try {
    const res = await provider.request({
      method: "eth_sendTransaction",
      params: [{
        from: account,
        to: CONTRACT_ADDR,
        data: CHECKIN_SELECTOR,
        value: "0x0",
      }],
    });
    if (typeof res !== "string" || !/^0x[a-fA-F0-9]{64}$/.test(res)) {
      return { ok: false, reason: "wallet returned no tx hash" };
    }
    return { ok: true, txHash: res as `0x${string}` };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "wallet send failed";
    if (/reject|denied|cancel/i.test(msg)) {
      return { ok: false, cancelled: true, reason: "daily check-in cancelled" };
    }
    // Surface the actual revert / gas / RPC reason instead of a generic
    // "failed" so the player knows what to fix (e.g. "insufficient funds for gas").
    return { ok: false, reason: msg };
  }
}
