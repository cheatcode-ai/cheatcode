import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";

type NextPublicEnv = {
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY?: string;
  NEXT_PUBLIC_GATEWAY_URL?: string;
  NEXT_PUBLIC_PREVIEW_HOSTNAME?: string;
  NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA?: string;
};

const isVercelProduction = process.env["VERCEL_ENV"] === "production";
const isVercelDeployment = isVercelProduction || process.env["VERCEL_ENV"] === "preview";
const vercelEnvironmentSchema = z.enum(["development", "preview", "production"]).optional();
const vercelHostnameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(
    /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+vercel\.app$/u,
    "Vercel VERCEL_URL must be a Vercel hostname without a scheme or path",
  );
const vercelUrlSchema = isVercelDeployment ? vercelHostnameSchema : vercelHostnameSchema.optional();
const PRODUCTION_GATEWAY_ORIGIN = "https://gateway.trycheatcode.com";
const PRODUCTION_PREVIEW_HOSTNAME = "trycheatcode.com";
const clerkPublishableKeySchema = clerkKeySchema("pk");
const clerkSecretKeySchema = clerkKeySchema("sk");
const gatewayUrlSchema = gatewayOriginSchema().default("http://localhost:8787");
const releaseShaSchema = isVercelProduction
  ? z.string().regex(/^[0-9a-f]{40}$/u)
  : z.union([z.string().regex(/^[0-9a-f]{40}$/u), z.literal("development")]).default("development");

export const env = createEnv({
  server: {
    CLERK_SECRET_KEY: clerkSecretKeySchema,
    VERCEL_ENV: vercelEnvironmentSchema,
    VERCEL_URL: vercelUrlSchema,
  },
  client: {
    NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: clerkPublishableKeySchema,
    NEXT_PUBLIC_GATEWAY_URL: gatewayUrlSchema,
    NEXT_PUBLIC_PREVIEW_HOSTNAME: z
      .string()
      .trim()
      .toLowerCase()
      .refine(isMultiLabelHostname, "Preview hostname must be a multi-label DNS hostname")
      .refine(
        (hostname) => !isVercelProduction || hostname === PRODUCTION_PREVIEW_HOSTNAME,
        `Vercel Production requires ${PRODUCTION_PREVIEW_HOSTNAME}`,
      )
      .default(PRODUCTION_PREVIEW_HOSTNAME),
    NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA: releaseShaSchema,
  },
  experimental__runtimeEnv: {
    NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: (process.env as NextPublicEnv)
      .NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
    NEXT_PUBLIC_GATEWAY_URL: (process.env as NextPublicEnv).NEXT_PUBLIC_GATEWAY_URL,
    NEXT_PUBLIC_PREVIEW_HOSTNAME: (process.env as NextPublicEnv).NEXT_PUBLIC_PREVIEW_HOSTNAME,
    NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA: (process.env as NextPublicEnv)
      .NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA,
  },
  emptyStringAsUndefined: true,
});

function clerkKeySchema(kind: "pk" | "sk") {
  const environment = isVercelProduction ? "live" : "test";
  return z
    .string()
    .trim()
    .startsWith(
      `${kind}_${environment}_`,
      `${isVercelProduction ? "Production" : "Development and preview"} deployments require Clerk ${kind}_${environment}_ keys`,
    );
}

function gatewayOriginSchema() {
  return z
    .string()
    .trim()
    .url()
    .superRefine((value, context) => {
      const parsed = new URL(value);
      if (value !== parsed.origin) {
        context.addIssue({
          code: "custom",
          message: "Gateway URL must be an origin without credentials, path, query, or fragment",
        });
      }
      const isLoopback =
        parsed.hostname === "localhost" ||
        parsed.hostname === "127.0.0.1" ||
        parsed.hostname === "[::1]";
      if (parsed.protocol !== "https:" && !(isLoopback && parsed.protocol === "http:")) {
        context.addIssue({
          code: "custom",
          message: "Gateway URL must use HTTPS except for a loopback development origin",
        });
      }
      if (isVercelProduction && value !== PRODUCTION_GATEWAY_ORIGIN) {
        context.addIssue({
          code: "custom",
          message: `Vercel Production requires ${PRODUCTION_GATEWAY_ORIGIN}`,
        });
      }
    });
}

function isMultiLabelHostname(hostname: string): boolean {
  if (hostname.length > 253 || !hostname.includes(".")) {
    return false;
  }
  const labels = hostname.split(".");
  return labels.every(
    (label) =>
      label.length >= 1 && label.length <= 63 && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/u.test(label),
  );
}
