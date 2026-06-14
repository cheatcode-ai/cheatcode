import type { WorkerSecret } from "@cheatcode/env";
import type { AnalyticsBindings } from "@cheatcode/observability";
import { z } from "zod";

/**
 * A Secrets Store binding exposes `.get()`; a plain `.dev.vars` value is a string.
 * Mirrors `WorkerSecretSchema` in `packages/env/src/worker.ts` (not exported from
 * that package's barrel, so it is re-declared locally rather than imported).
 */
const SecretsStoreSecretSchema = z.custom<SecretsStoreSecret>(
  (value) => typeof value === "object" && value !== null && "get" in value,
);

const WorkerSecretSchema = z.union([z.string().min(1), SecretsStoreSecretSchema]);

/**
 * Trust-boundary schema for the preview-proxy worker env. Validates only the
 * three values the proxy depends on; Analytics Engine bindings are optional and
 * null-checked at emit time, so they are intentionally not required here.
 */
export const PreviewProxyEnvSchema = z.object({
  DAYTONA_API_KEY: WorkerSecretSchema,
  DAYTONA_API_URL: z.string().url(),
  PREVIEW_TOKEN_SECRET: WorkerSecretSchema,
});

export interface PreviewProxyEnv extends AnalyticsBindings {
  DAYTONA_API_KEY: WorkerSecret;
  DAYTONA_API_URL: string;
  PREVIEW_TOKEN_SECRET: WorkerSecret;
}
