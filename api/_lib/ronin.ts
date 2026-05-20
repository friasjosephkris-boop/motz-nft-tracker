import { createPublicClient, http, defineChain, getAddress, type Address } from "viem";

export const ronin = defineChain({
  id: 2020,
  name: "Ronin",
  nativeCurrency: { name: "RON", symbol: "RON", decimals: 18 },
  rpcUrls: { default: { http: ["https://api.roninchain.com/rpc"] } },
});

export const client = createPublicClient({
  chain: ronin,
  transport: http(process.env.RONIN_RPC_URL ?? "https://api.roninchain.com/rpc"),
});

const erc721Abi = [{
  name: "balanceOf",
  type: "function",
  stateMutability: "view",
  inputs: [{ name: "owner", type: "address" }],
  outputs: [{ type: "uint256" }],
}] as const;

/** MoTZ Vault Key contract — required to use Hera, Nova, and Oge. */
export const MOTZ_KEY_CONTRACT: Address = getAddress("0x45ed5ee2f9e175f59fbb28f61678afe78c3d70f8");

export const GATED_NFT_CONTRACTS: Address[] = [
  getAddress("0x712b0029a1763ef2aac240a39091bada6bdae4f8"),
  MOTZ_KEY_CONTRACT,
];

/** Thrown when every gated-NFT balance read failed (RPC down / rate-limited)
 *  so the caller can distinguish "verified non-holder" from "couldn't verify".
 *  Critically, this is NOT the same as `false` — a transient Ronin RPC blip
 *  must never be reported to the player as "you don't hold the NFT". */
export class NftCheckUnavailableError extends Error {
  constructor(message = "NFT verification temporarily unavailable") {
    super(message);
    this.name = "NftCheckUnavailableError";
  }
}

const sleep = (ms: number): Promise<void> => new Promise(r => setTimeout(r, ms));

/** Read balanceOf with up to 3 attempts + linear backoff. Returns the balance
 *  on success, or null if every attempt errored (so the caller can tell a
 *  genuine 0 apart from an RPC failure). The public Ronin RPC rate-limits
 *  Vercel's shared serverless egress IPs under load — a single .catch(0n)
 *  there silently locks legit NFT holders out, which is the bug this fixes. */
async function balanceOfWithRetry(contract: Address, owner: Address): Promise<bigint | null> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const bal = await client.readContract({
        address: contract, abi: erc721Abi, functionName: "balanceOf", args: [owner],
      });
      return bal as bigint;
    } catch {
      if (attempt < 2) await sleep(300 * (attempt + 1));
    }
  }
  return null;
}

/** True if the wallet holds at least one gated NFT.
 *
 *  Three-state logic so a transient RPC failure can't masquerade as "no NFT":
 *    - Any contract read succeeded with balance > 0  → return true  (holder)
 *    - Any contract read is indeterminate (all retries errored) AND no
 *      contract confirmed a holding → throw NftCheckUnavailableError
 *      (an unread contract might hold the NFT — we cannot say "no")
 *    - Every contract read succeeded and all returned 0 → return false
 *      (verified non-holder)
 */
export async function holdsAnyGatedNft(owner: Address): Promise<boolean> {
  const results = await Promise.all(
    GATED_NFT_CONTRACTS.map(addr => balanceOfWithRetry(addr, owner)),
  );
  // Confirmed holder — at least one read succeeded with a positive balance.
  if (results.some(r => r !== null && r > 0n)) return true;
  // Any indeterminate read means we can't definitively say "no" — the
  // contract we failed to read might be the one holding the NFT. Surface
  // as retryable instead of a false denial.
  if (results.some(r => r === null)) throw new NftCheckUnavailableError();
  // Every read succeeded and all balances were 0 — genuine non-holder.
  return false;
}

export async function holdsMotzKey(owner: Address): Promise<boolean> {
  try {
    const bal = await client.readContract({
      address: MOTZ_KEY_CONTRACT,
      abi: erc721Abi,
      functionName: "balanceOf",
      args: [owner],
    });
    return bal > 0n;
  } catch {
    return false;
  }
}
