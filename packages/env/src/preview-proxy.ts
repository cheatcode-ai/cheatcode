import { z } from "zod";
import { PRODUCTION_APP_HOSTNAME, PRODUCTION_APP_ORIGIN } from "./web-config";
import {
  AnalyticsBindingsSchema,
  PreviewHostnameSchema,
  requireProductionPreviewHostname,
  requireProductionReleaseSha,
  WorkerReleaseBindingsSchema,
  WorkerSecretSchema,
} from "./worker-shared";

export const PreviewProxyEnvSchema = z
  .strictObject({
    ...AnalyticsBindingsSchema,
    ...WorkerReleaseBindingsSchema,
    CHEATCODE_APP_ORIGIN: z.string().url().optional(),
    DAYTONA_API_KEY: WorkerSecretSchema,
    DAYTONA_API_URL: z.string().url(),
    DAYTONA_PREVIEW_HOST_SUFFIXES: z.string().min(1).max(1_024).optional(),
    PREVIEW_HOSTNAME: PreviewHostnameSchema.optional(),
    PREVIEW_TOKEN_SECRET: WorkerSecretSchema,
  })

  .transform((env, context) => {
    const appOrigin =
      env.CHEATCODE_APP_ORIGIN ??
      (env.CHEATCODE_ENVIRONMENT === "production" ? PRODUCTION_APP_ORIGIN : undefined);
    const previewHostname =
      env.PREVIEW_HOSTNAME ??
      (env.CHEATCODE_ENVIRONMENT === "production" ? PRODUCTION_APP_HOSTNAME : undefined);
    if (!appOrigin) {
      context.addIssue({
        code: "custom",
        message: "Preview application origin is required",
        path: ["CHEATCODE_APP_ORIGIN"],
      });
      return z.NEVER;
    }
    if (!previewHostname) {
      context.addIssue({
        code: "custom",
        message: "Preview hostname is required",
        path: ["PREVIEW_HOSTNAME"],
      });
      return z.NEVER;
    }
    return {
      ...env,
      CHEATCODE_APP_ORIGIN: appOrigin,
      PREVIEW_HOSTNAME: previewHostname,
    };
  })
  .superRefine(requireProductionReleaseSha)
  .superRefine((env, context) => {
    if (!isExactAppOrigin(env.CHEATCODE_APP_ORIGIN, env.CHEATCODE_ENVIRONMENT)) {
      context.addIssue({
        code: "custom",
        message: "Preview application origin must be an exact trusted HTTP(S) origin",
        path: ["CHEATCODE_APP_ORIGIN"],
      });
    }
    if (
      env.CHEATCODE_ENVIRONMENT === "production" &&
      env.CHEATCODE_APP_ORIGIN !== PRODUCTION_APP_ORIGIN
    ) {
      context.addIssue({
        code: "custom",
        message: "Production previews derive from the canonical application origin",
        path: ["CHEATCODE_APP_ORIGIN"],
      });
    }
    requireProductionPreviewHostname(
      {
        CHEATCODE_ENVIRONMENT: env.CHEATCODE_ENVIRONMENT,
        PREVIEW_HOSTNAME: env.PREVIEW_HOSTNAME,
      },
      context,
    );
  });

export type PreviewProxyEnv = z.output<typeof PreviewProxyEnvSchema>;

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
