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
  CHEATCODE_ENVIRONMENT: "development" | "production";
  CHEATCODE_RELEASE_SHA?: string;
  DAYTONA_API_KEY: WorkerSecret;
  DAYTONA_API_URL: string;
  DAYTONA_PREVIEW_HOST_SUFFIXES?: string;
  PREVIEW_HOSTNAME: string;
  PREVIEW_TOKEN_SECRET: WorkerSecret;
}
