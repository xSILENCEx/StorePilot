import type { NextConfig } from "next";
const config: NextConfig = {
  experimental: {
    optimizePackageImports: [
      "@mantine/core",
      "@mantine/hooks",
      "@mantine/notifications",
    ],
  },
};
export default config;
