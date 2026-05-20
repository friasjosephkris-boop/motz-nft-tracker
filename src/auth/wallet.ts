import { requestRoninWalletConnector } from "@sky-mavis/tanto-connect";

const RONIN_CHAIN_ID = 2020;

export interface ConnectedWallet {
  address: string;
  signMessage: (message: string) => Promise<string>;
}

export async function connectRoninWallet(): Promise<ConnectedWallet> {
  const connector = await requestRoninWalletConnector();
  const result = await connector.connect(RONIN_CHAIN_ID);
  const address = result.account;
  if (!address) throw new Error("no account returned from wallet");

  const provider = await connector.getProvider();

  return {
    address,
    signMessage: async (message: string) => {
      const sig = await provider.request({
        method: "personal_sign",
        params: [message, address],
      });
      if (typeof sig !== "string") throw new Error("signature not returned");
      return sig;
    },
  };
}

export async function performAuthFlow(): Promise<{ token: string; address: string }> {
  const wallet = await connectRoninWallet();

  const challengeRes = await fetch("/api/auth/challenge", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ address: wallet.address }),
  });
  if (!challengeRes.ok) throw new Error(`challenge failed: ${challengeRes.status}`);
  const { message, token: challengeToken } = await challengeRes.json();

  const signature = await wallet.signMessage(message);

  const verifyRes = await fetch("/api/auth/verify", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ address: wallet.address, signature, token: challengeToken }),
  });
  if (verifyRes.status === 403) {
    const data = await verifyRes.json().catch(() => ({}));
    throw new Error(data?.error ?? "wallet does not hold required NFT");
  }
  if (verifyRes.status === 503) {
    // Retryable NFT-verification outage — surface the server's friendly
    // message verbatim ("Ronin network is busy, try again") instead of a
    // bare status code. The player likely DOES hold the NFT.
    const data = await verifyRes.json().catch(() => ({}));
    throw new Error(data?.error ?? "NFT verification temporarily unavailable — please try again in a moment");
  }
  if (!verifyRes.ok) throw new Error(`verify failed: ${verifyRes.status}`);
  const { session, address } = await verifyRes.json();
  return { token: session, address };
}
