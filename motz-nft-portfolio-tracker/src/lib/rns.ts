import "server-only";
import { concat, keccak256, stringToHex } from "viem";

// Ronin Name Service Public Resolver (mainnet).
// Discovered by probing candidate contracts with addr(bytes32) for a known .ron name.
const RNS_RESOLVER = "0xadb077d236d9e81fb24b96ae9cb8089ab9942d48";

const RPC_URL =
  process.env.RONIN_RPC_URL ||
  (process.env.SKY_MAVIS_API_KEY
    ? "https://api-gateway.skymavis.com/rpc"
    : "https://api.roninchain.com/rpc");

function headers() {
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (process.env.SKY_MAVIS_API_KEY) h["X-API-Key"] = process.env.SKY_MAVIS_API_KEY;
  return h;
}

/** ENS-style namehash. e.g. "markofthezeal.ron" → 0xdc9f… */
export function rnsNamehash(name: string): `0x${string}` {
  let node: `0x${string}` = `0x${"0".repeat(64)}`;
  if (!name) return node;
  const labels = name.toLowerCase().split(".").reverse();
  for (const label of labels) {
    if (!label) continue;
    node = keccak256(concat([node, keccak256(stringToHex(label))]));
  }
  return node;
}

const cache = new Map<string, string | null>();

/**
 * Resolve a .ron name to its Ronin address via the RNS Public Resolver's
 * addr(bytes32) function. Returns null on resolution failure or zero address.
 */
export async function resolveRnsName(name: string): Promise<string | null> {
  const key = name.toLowerCase();
  if (cache.has(key)) return cache.get(key)!;

  const node = rnsNamehash(name);
  // addr(bytes32) selector = 0x3b3b57de
  const data = `0x3b3b57de${node.slice(2)}`;
  try {
    const res = await fetch(RPC_URL, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "eth_call",
        params: [{ to: RNS_RESOLVER, data }, "latest"],
      }),
      cache: "no-store",
    });
    const json = (await res.json()) as { result?: string; error?: { message: string } };
    if (json.error || !json.result || json.result === "0x") return null;
    // result is left-padded address: 0x000…0<20-byte address>
    const addr = "0x" + json.result.slice(-40);
    if (/^0x0+$/i.test(addr)) {
      cache.set(key, null);
      return null;
    }
    cache.set(key, addr);
    return addr;
  } catch (err) {
    console.warn(`[rns] resolve ${name} failed:`, (err as Error).message);
    return null;
  }
}

/** True if the input looks like an RNS name rather than a 0x address. */
export function looksLikeRnsName(input: string): boolean {
  return /\.ron$/i.test(input.trim());
}
