import type { NextConfig } from "next";
const config: NextConfig = {
  allowedDevOrigins: process.env.BETTER_AUTH_URL
    ? [new URL(process.env.BETTER_AUTH_URL).hostname]
    : [],
  experimental: {
    optimizePackageImports: [
      "@mantine/core",
      "@mantine/hooks",
      "@mantine/notifications",
    ],
  },
};
export default config;
