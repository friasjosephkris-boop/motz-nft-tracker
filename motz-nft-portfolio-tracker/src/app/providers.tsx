"use client";

import { ReactNode, useState } from "react";
import { WagmiProvider } from "wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import dynamic from "next/dynamic";

import { wagmiConfig } from "@/lib/wagmi";

const hasWalletConnectProject = !!process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID;

// Dynamically import RainbowKit only when a projectId is configured.
// RainbowKit's bundle has side-effects that spam the console (WalletConnect
// modal explorer) when no projectId is present.
const RainbowProviderWrapper = dynamic(
  () =>
    import("@/app/rainbow-provider").then((m) => m.RainbowProviderWrapper),
  { ssr: false },
);

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());

  const tree = hasWalletConnectProject ? (
    <RainbowProviderWrapper>{children}</RainbowProviderWrapper>
  ) : (
    children
  );

  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>{tree}</QueryClientProvider>
    </WagmiProvider>
  );
}
