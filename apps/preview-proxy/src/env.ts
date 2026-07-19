import {
  type CloudflareVersionMetadata,
  PreviewHostnameSchema,
  WorkerReleaseBindingsSchema,
  type WorkerSecret,
  WorkerSecretSchema,
} from "@cheatcode/env";
import type { AnalyticsBindings } from "@cheatcode/observability";
import { z } from "zod";

/**
 * Trust-boundary schema for the preview-proxy worker env. Validates only the
 * three values the proxy depends on; Analytics Engine bindings are optional and
 * null-checked at emit time, so they are intentionally not required here.
 */
export const PreviewProxyEnvSchema = z
  .object({
    ...WorkerReleaseBindingsSchema,
    CHEATCODE_APP_ORIGIN: z.string().url(),
    DAYTONA_API_KEY: WorkerSecretSchema,
    DAYTONA_API_URL: z.string().url(),
    DAYTONA_PREVIEW_HOST_SUFFIXES: z.string().min(1).max(1_024).optional(),
    PREVIEW_HOSTNAME: PreviewHostnameSchema,
    PREVIEW_TOKEN_SECRET: WorkerSecretSchema,
  })
  .superRefine((env, context) => {
    if (env.CHEATCODE_ENVIRONMENT === "production" && !env.CHEATCODE_RELEASE_SHA) {
      context.addIssue({
        code: "custom",
        message: "Production Workers require an immutable release SHA.",
        path: ["CHEATCODE_RELEASE_SHA"],
      });
    }
    if (
      env.CHEATCODE_ENVIRONMENT === "production" &&
      env.CHEATCODE_APP_ORIGIN !== "https://trycheatcode.com"
    ) {
      context.addIssue({
        code: "custom",
        message: "Production previews require the canonical Vercel application origin",
        path: ["CHEATCODE_APP_ORIGIN"],
      });
    }
    if (!isExactAppOrigin(env.CHEATCODE_APP_ORIGIN, env.CHEATCODE_ENVIRONMENT)) {
      context.addIssue({
        code: "custom",
        message: "Preview application origin must be an exact trusted HTTP(S) origin",
        path: ["CHEATCODE_APP_ORIGIN"],
      });
    }
    if (env.CHEATCODE_ENVIRONMENT === "production" && env.PREVIEW_HOSTNAME.includes(":")) {
      context.addIssue({
        code: "custom",
        message: "Production preview hostname must be a DNS hostname without a port",
        path: ["PREVIEW_HOSTNAME"],
      });
    }
    if (env.CHEATCODE_ENVIRONMENT === "production" && env.PREVIEW_HOSTNAME !== "trycheatcode.com") {
      context.addIssue({
        code: "custom",
        message: "Production previews require the owned trycheatcode.com wildcard route",
        path: ["PREVIEW_HOSTNAME"],
      });
    }
  });

export interface PreviewProxyEnv extends AnalyticsBindings {
  CF_VERSION_METADATA?: CloudflareVersionMetadata;
  CHEATCODE_APP_ORIGIN: string;
  CHEATCODE_ENVIRONMENT: "development" | "production";
  CHEATCODE_RELEASE_SHA?: string;
  DAYTONA_API_KEY: WorkerSecret;
  DAYTONA_API_URL: string;
  DAYTONA_PREVIEW_HOST_SUFFIXES?: string;
  PREVIEW_HOSTNAME: string;
  PREVIEW_TOKEN_SECRET: WorkerSecret;
}

function isExactAppOrigin(value: string, environment: "development" | "production"): boolean {
  try {
    const url = new URL(value);
    if (
      url.origin !== value ||
      url.pathname !== "/" ||
      url.search ||
      url.hash ||
      url.username ||
      url.password
    ) {
      return false;
    }
    if (environment === "production") {
      return url.protocol === "https:";
    }
    return (
      url.protocol === "http:" && (url.hostname === "localhost" || url.hostname === "127.0.0.1")
    );
  } catch {
    return false;
  }
}
