import { createPublicClient, http, defineChain, getAddress, type Address, type PublicClient } from "viem";

export const ronin = defineChain({
  id: 2020,
  name: "Ronin",
  nativeCurrency: { name: "RON", symbol: "RON", decimals: 18 },
  rpcUrls: { default: { http: ["https://api.roninchain.com/rpc"] } },
});

/** RPC endpoints used for NFT-ownership reads, in priority order.
 *
 *  Why multiple endpoints: NFT ownership is the play gate, and a single
 *  endpoint failing OPEN to a clean `0` is catastrophic — it locks a genuine
 *  holder out with a false "wallet does not hold required NFT". This happens
 *  in practice when the public Ronin RPC rate-limits Vercel's shared
 *  serverless egress IPs, or when RONIN_RPC_URL is misconfigured (e.g. points
 *  at testnet). Querying several INDEPENDENT endpoints and trusting any
 *  positive balance defends against any one of them being wrong. */
const RPC_URLS: string[] = Array.from(new Set([
  process.env.RONIN_RPC_URL ?? "https://api.roninchain.com/rpc",
  "https://api.roninchain.com/rpc",
  "https://ronin.drpc.org",
].filter((u): u is string => typeof u === "string" && u.length > 0)));

const clients: PublicClient[] = RPC_URLS.map(url =>
  createPublicClient({ chain: ronin, transport: http(url) }),
);

/** Primary client — kept as a named export for non-gate callers (payments). */
export const client: PublicClient = clients[0];

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
async function balanceOfWithRetry(
  rpc: PublicClient, contract: Address, owner: Address,
): Promise<bigint | null> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const bal = await rpc.readContract({
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
 *  Queries every gated contract across every configured RPC endpoint, then:
 *    - Any read on any endpoint returned balance > 0  → return true  (holder).
 *      A single positive is proof — we never need consensus to CONFIRM.
 *    - At least one endpoint successfully read EVERY contract as 0 → return
 *      false (verified non-holder).
 *    - Otherwise (no positives, and no endpoint completed a full clean
 *      sweep) → throw NftCheckUnavailableError (retryable, not a denial).
 *
 *  This makes a single rate-limited or misconfigured endpoint unable to
 *  cause a false "no NFT" denial: as long as one healthy endpoint can read
 *  the chain, a real holder is recognised. */
export async function holdsAnyGatedNft(owner: Address): Promise<boolean> {
  const perEndpoint = await Promise.all(
    clients.map(rpc => Promise.all(
      GATED_NFT_CONTRACTS.map(addr => balanceOfWithRetry(rpc, addr, owner)),
    )),
  );
  let sawCleanZeroSweep = false;
  for (const results of perEndpoint) {
    // Confirmed holder — bail out the moment any endpoint sees a balance.
    if (results.some(r => r !== null && r > 0n)) return true;
    // This endpoint read every gated contract and all were genuinely 0.
    if (results.every(r => r !== null)) sawCleanZeroSweep = true;
  }
  if (sawCleanZeroSweep) return false;
  // No positives anywhere, and no endpoint managed a complete read — we
  // cannot definitively say "no". Surface as retryable instead of denying.
  throw new NftCheckUnavailableError();
}

/** True if the wallet holds a MoTZ Vault Key. Queries every configured RPC
 *  endpoint and trusts any positive balance, for the same resilience reason
 *  as holdsAnyGatedNft. Returns false only if no endpoint saw a key (callers
 *  treat this as a soft check and additionally honour temp keys). */
export async function holdsMotzKey(owner: Address): Promise<boolean> {
  const results = await Promise.all(
    clients.map(rpc => balanceOfWithRetry(rpc, MOTZ_KEY_CONTRACT, owner)),
  );
  return results.some(r => r !== null && r > 0n);
}
