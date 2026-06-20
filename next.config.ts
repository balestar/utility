import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // Stealth: use a generic route prefix so URLs don't scream "metasploit"
  // assetPrefix is intentionally not set — we rely on Caddy for obfuscation
  headers: async () => [
    {
      source: "/(.*)",
      headers: [
        {
          key: "X-Frame-Options",
          value: "DENY",
        },
        {
          key: "X-Content-Type-Options",
          value: "nosniff",
        },
        {
          key: "Referrer-Policy",
          value: "no-referrer-when-downgrade",
        },
      ],
    },
  ],
};

export default nextConfig;
