import type { NextConfig } from "next";

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

const nextConfig: NextConfig = {
  // The dashboard is per-user and request-time; we use the classic dynamic
  // rendering model rather than Cache Components.
  cacheComponents: false,
  experimental: {
    // The persisted dev cache (.next/dev/cache/turbopack) got corrupted by interrupted dev servers and then made
    // Turbopack send endless "restart" updates, reloading every open page. A cold start is only a few seconds.
    turbopackFileSystemCacheForDev: false,
  },
  // PGlite ships WASM + data files and pg uses native-ish optional deps; keep them out of the bundle.
  serverExternalPackages: ["@electric-sql/pglite", "pg"],
  poweredByHeader: false,
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "cdn.dexscreener.com" },
      { protocol: "https", hostname: "dd.dexscreener.com" },
      { protocol: "https", hostname: "assets.geckoterminal.com" },
    ],
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
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
