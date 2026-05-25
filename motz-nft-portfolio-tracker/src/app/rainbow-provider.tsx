"use client";

import { ReactNode } from "react";
import { RainbowKitProvider, darkTheme } from "@rainbow-me/rainbowkit";
import "@rainbow-me/rainbowkit/styles.css";

export function RainbowProviderWrapper({ children }: { children: ReactNode }) {
  return <RainbowKitProvider theme={darkTheme()}>{children}</RainbowKitProvider>;
}
