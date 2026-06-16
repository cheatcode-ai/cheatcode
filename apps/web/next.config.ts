import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const nextConfig = {
  cacheComponents: true,
  images: {
    unoptimized: true,
    qualities: [75],
    minimumCacheTTL: 14_400,
  },
} satisfies NextConfig;

const withNextIntl = createNextIntlPlugin("./src/lib/intl/request.ts");

export default withNextIntl(nextConfig);
