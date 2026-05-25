import { defineChain } from "viem";

export const ronin = defineChain({
  id: 2020,
  name: "Ronin",
  nativeCurrency: { name: "RON", symbol: "RON", decimals: 18 },
  rpcUrls: {
    default: { http: ["https://api.roninchain.com/rpc"] },
  },
  blockExplorers: {
    default: { name: "Ronin Explorer", url: "https://app.roninchain.com" },
  },
});
