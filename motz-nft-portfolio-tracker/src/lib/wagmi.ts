"use client";

import { connectorsForWallets, getDefaultConfig } from "@rainbow-me/rainbowkit";
import {
  injectedWallet,
  metaMaskWallet,
  rabbyWallet,
  walletConnectWallet,
} from "@rainbow-me/rainbowkit/wallets";
import { createConfig, http } from "wagmi";
import { ronin } from "./chains";

const projectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID;

// Without a real WalletConnect projectId, the explorer service spams the page
// with retry errors. Fall back to injected-only connectors in that case.
export const wagmiConfig = projectId
  ? getDefaultConfig({
      appName: "MoTZ NFT Portfolio Tracker",
      projectId,
      chains: [ronin],
      transports: { [ronin.id]: http() },
      ssr: true,
    })
  : createConfig({
      chains: [ronin],
      transports: { [ronin.id]: http() },
      ssr: true,
      connectors: connectorsForWallets(
        [
          {
            groupName: "Installed",
            wallets: [injectedWallet, metaMaskWallet, rabbyWallet],
          },
        ],
        {
          appName: "MoTZ NFT Portfolio Tracker",
          // projectId is required by the type but unused without walletConnectWallet
          projectId: "noop",
        },
      ),
    });

// Silence unused-import warning if rainbowkit changes its tree-shaking.
void walletConnectWallet;
