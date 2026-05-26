import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  // Pin the Turbopack workspace root to this project. Without this, Next.js
  // can pick the parent directory ("D:\Claude files") because of a stray
  // package-lock.json there, which breaks route discovery (every endpoint
  // turns into 404 on the next dev-server restart).
  turbopack: {
    root: path.resolve(__dirname),
  },
};

export default nextConfig;
