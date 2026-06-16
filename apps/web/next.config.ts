import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const nextConfig = {
  cacheComponents: true,
  images: {
    unoptimized: true,
    qualities: [75],
    minimumCacheTTL: 14_400,
  },
  // `standalone` is required by the OpenNext/Cloudflare build but conflicts with
  // Vercel's managed output, so emit it everywhere EXCEPT Vercel builds.
  ...(process.env["VERCEL"] ? {} : { output: "standalone" as const }),
} satisfies NextConfig;

const withNextIntl = createNextIntlPlugin("./src/lib/intl/request.ts");

export default withNextIntl(nextConfig);

// Local-dev only: wire OpenNext's Cloudflare binding shim for `next dev`. Loaded
// via dynamic import behind a dev guard so production builds (incl. Vercel, which
// has no @opennextjs/cloudflare and no CF runtime) never resolve it.
if (process.env["NODE_ENV"] === "development") {
  void import("@opennextjs/cloudflare")
    .then((m) => m.initOpenNextCloudflareForDev())
    .catch(() => undefined);
}
