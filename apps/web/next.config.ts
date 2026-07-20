import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { parseWebBuildEnvironment, WEB_APPLICATION_ENV_KEYS } from "@cheatcode/env/web-config";
import type { NextConfig } from "next";

const REPOSITORY_ROOT = fileURLToPath(new URL("../..", import.meta.url));
const { loadEnvConfig } = createRequire(import.meta.url)("@next/env") as typeof import("@next/env");
// Next preloads env relative to apps/web; reload from the monorepo root so the
// single laptop env works, then prevent Worker-only secrets reaching Next.
const loadedRootEnvironment = loadEnvConfig(
  REPOSITORY_ROOT,
  process.env.NODE_ENV !== "production",
  undefined,
  true,
);
for (const key of Object.keys(loadedRootEnvironment.parsedEnv ?? {})) {
  if (!WEB_APPLICATION_ENV_KEYS.has(key)) {
    delete process.env[key];
  }
}

const vercelGitCommitSha = process.env["VERCEL_GIT_COMMIT_SHA"];
if (
  process.env["NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA"] === undefined &&
  vercelGitCommitSha !== undefined
) {
  process.env["NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA"] = vercelGitCommitSha;
}

const WEB_BUILD_ENVIRONMENT = parseWebBuildEnvironment({
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: process.env["NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY"],
  NEXT_PUBLIC_GATEWAY_URL: process.env["NEXT_PUBLIC_GATEWAY_URL"],
  NEXT_PUBLIC_PREVIEW_HOSTNAME: process.env["NEXT_PUBLIC_PREVIEW_HOSTNAME"],
  NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA: process.env["NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA"],
  VERCEL_ENV: process.env["VERCEL_ENV"],
  VERCEL_TARGET_ENV: process.env["VERCEL_TARGET_ENV"],
});
const GATEWAY_ORIGIN = WEB_BUILD_ENVIRONMENT.gatewayOrigin;
const PREVIEW_HOSTNAME = WEB_BUILD_ENVIRONMENT.previewHostname;
const PREVIEW_HTTPS_ORIGIN = `https://*.${PREVIEW_HOSTNAME}`;
const PREVIEW_WSS_ORIGIN = `wss://*.${PREVIEW_HOSTNAME}`;
const CLERK_FRONTEND_HOSTNAME = WEB_BUILD_ENVIRONMENT.clerkFrontendHostname;
const CLERK_FRONTEND_ORIGIN = `https://${CLERK_FRONTEND_HOSTNAME}`;
const CLERK_WEBSOCKET_ORIGIN = `wss://${CLERK_FRONTEND_HOSTNAME}`;

const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  `script-src 'self' 'unsafe-inline' ${CLERK_FRONTEND_ORIGIN} https://challenges.cloudflare.com`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://img.clerk.com",
  "font-src 'self' data:",
  "media-src 'self' data: blob:",
  `connect-src 'self' ${GATEWAY_ORIGIN} ${PREVIEW_HTTPS_ORIGIN} ${PREVIEW_WSS_ORIGIN} ${CLERK_FRONTEND_ORIGIN} ${CLERK_WEBSOCKET_ORIGIN}`,
  `frame-src 'self' ${PREVIEW_HTTPS_ORIGIN} https://challenges.cloudflare.com`,
  "worker-src 'self' blob:",
  "form-action 'self'",
  "upgrade-insecure-requests",
].join("; ");

const nextConfig = {
  allowedDevOrigins: ["127.0.0.1", "localhost"],
  cacheComponents: true,
  devIndicators: false,
  async headers() {
    if (process.env.NODE_ENV !== "production") {
      return [];
    }
    return [
      {
        headers: [
          { key: "Content-Security-Policy", value: CONTENT_SECURITY_POLICY },
          { key: "Cross-Origin-Opener-Policy", value: "same-origin-allow-popups" },
          { key: "Origin-Agent-Cluster", value: "?1" },
          { key: "Permissions-Policy", value: "camera=(), geolocation=(), microphone=()" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
        ],
        source: "/:path*",
      },
    ];
  },
  images: {
    qualities: [75],
    minimumCacheTTL: 14_400,
    remotePatterns: [{ hostname: "logos.composio.dev", protocol: "https" }],
  },
} satisfies NextConfig;

export default nextConfig;
