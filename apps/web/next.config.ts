import type { NextConfig } from "next";

const IS_VERCEL_PRODUCTION = process.env["VERCEL_ENV"] === "production";
const GATEWAY_ORIGIN = readGatewayOrigin(process.env["NEXT_PUBLIC_GATEWAY_URL"]);
const PREVIEW_HOSTNAME = readPreviewHostname(process.env["NEXT_PUBLIC_PREVIEW_HOSTNAME"]);
const PREVIEW_HTTPS_ORIGIN = `https://*.${PREVIEW_HOSTNAME}`;
const PREVIEW_WSS_ORIGIN = `wss://*.${PREVIEW_HOSTNAME}`;
const CLERK_FRONTEND_HOSTNAME = readClerkFrontendHostname(
  process.env["NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY"],
);
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

function readGatewayOrigin(value: string | undefined): string {
  const configured = (value ?? "http://localhost:8787").trim();
  let parsed: URL;
  try {
    parsed = new URL(configured);
  } catch {
    throw new TypeError("NEXT_PUBLIC_GATEWAY_URL must be a valid URL");
  }
  if (configured !== parsed.origin) {
    throw new TypeError(
      "NEXT_PUBLIC_GATEWAY_URL must be an origin without credentials, path, query, or fragment",
    );
  }
  const isLoopback =
    parsed.hostname === "localhost" ||
    parsed.hostname === "127.0.0.1" ||
    parsed.hostname === "[::1]";
  if (parsed.protocol !== "https:" && !(isLoopback && parsed.protocol === "http:")) {
    throw new TypeError(
      "NEXT_PUBLIC_GATEWAY_URL must use HTTPS except for a loopback development origin",
    );
  }
  if (IS_VERCEL_PRODUCTION && parsed.origin !== "https://gateway.trycheatcode.com") {
    throw new TypeError(
      "Vercel Production requires https://gateway.trycheatcode.com as its gateway origin",
    );
  }
  return parsed.origin;
}

function readPreviewHostname(value: string | undefined): string {
  const hostname = (value ?? "trycheatcode.com").trim().toLowerCase().replace(/\.$/u, "");
  if (!isValidHostname(hostname)) {
    throw new TypeError("NEXT_PUBLIC_PREVIEW_HOSTNAME must be a valid hostname");
  }
  if (IS_VERCEL_PRODUCTION && hostname !== "trycheatcode.com") {
    throw new TypeError(
      "Vercel Production previews require the owned trycheatcode.com wildcard route",
    );
  }
  return hostname;
}

function readClerkFrontendHostname(value: string | undefined): string {
  const expectedEnvironment = IS_VERCEL_PRODUCTION ? "live" : "test";
  const prefix = `pk_${expectedEnvironment}_`;
  if (!value?.startsWith(prefix)) {
    throw new TypeError(
      `${IS_VERCEL_PRODUCTION ? "Vercel Production" : "Development and Vercel Preview"} requires a Clerk ${prefix} publishable key`,
    );
  }
  const encodedHostname = value.slice(prefix.length);
  if (!/^[A-Za-z0-9_-]+$/u.test(encodedHostname)) {
    throw new TypeError("Clerk publishable key payload must be base64url encoded");
  }
  const decoded = Buffer.from(encodedHostname, "base64url").toString("utf8");
  if (!decoded.endsWith("$") || decoded.slice(0, -1).includes("$")) {
    throw new TypeError("Clerk publishable key payload is malformed");
  }
  const hostname = decoded.slice(0, -1).toLowerCase();
  if (!isValidHostname(hostname)) {
    throw new TypeError("Clerk publishable key contains an invalid Frontend API hostname");
  }
  if (IS_VERCEL_PRODUCTION && hostname !== "clerk.trycheatcode.com") {
    throw new TypeError("Vercel Production requires the clerk.trycheatcode.com Clerk instance");
  }
  if (!IS_VERCEL_PRODUCTION && !hostname.endsWith(".clerk.accounts.dev")) {
    throw new TypeError("Development and Vercel Preview require a Clerk development instance");
  }
  return hostname;
}

function isValidHostname(hostname: string): boolean {
  const labels = hostname.split(".");
  return (
    hostname.length <= 253 &&
    labels.length >= 2 &&
    labels.every(
      (label) =>
        label.length >= 1 && label.length <= 63 && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/u.test(label),
    )
  );
}
