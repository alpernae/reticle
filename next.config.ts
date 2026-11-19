import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // Set by the 2026-11-19 security upgrade (16.4.3 → 16.4.6).
    agentUpgrade: 'security',
  },
  // Docker builds set NEXT_OUTPUT=standalone for a small self-contained server;
  // local `npm run build && npm start` keeps the normal output.
  output: process.env.NEXT_OUTPUT === 'standalone' ? 'standalone' : undefined,
  cacheComponents: true,
  async redirects() {
    return [{ source: '/studio', destination: '/workflows', permanent: false }]; // renamed: Agent runs → Workflows
  },
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
