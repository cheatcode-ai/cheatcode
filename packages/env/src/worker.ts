import { z } from "zod";

export type WorkerSecret = string | SecretsStoreSecret;

interface AnalyticsDatasetBinding {
  writeDataPoint(point: { blobs?: string[]; doubles?: number[]; indexes?: string[] }): void;
}

function isSecretsStoreSecret(value: unknown): value is SecretsStoreSecret {
  return typeof value === "object" && value !== null && "get" in value;
}

export const WorkerSecretSchema = z.union([
  z.string().min(1),
  z.custom<SecretsStoreSecret>(isSecretsStoreSecret),
]);

const OptionalWorkerSecretSchema = z.preprocess(
  (value) => (value === "" ? undefined : value),
  WorkerSecretSchema.optional(),
);

export const HyperdriveSchema = z
  .object({
    connectionString: z.string().min(1),
  })
  .passthrough();

const AnalyticsBindingsSchema = {
  AGENT_METRICS: z.custom<AnalyticsDatasetBinding>().optional(),
  COST_EVENTS: z.custom<AnalyticsDatasetBinding>().optional(),
  ERROR_EVENTS: z.custom<AnalyticsDatasetBinding>().optional(),
  PERFORMANCE_METRICS: z.custom<AnalyticsDatasetBinding>().optional(),
  USER_EVENTS: z.custom<AnalyticsDatasetBinding>().optional(),
} as const;

export const GatewayWorkerEnvSchema = z
  .object({
    ...AnalyticsBindingsSchema,
    AGENT: z.custom<Fetcher>(),
    CLERK_JWT_KEY: OptionalWorkerSecretSchema,
    CLERK_SECRET_KEY: OptionalWorkerSecretSchema,
    COMPOSIO_API_KEY: OptionalWorkerSecretSchema,
    COMPOSIO_AUTH_CONFIGS: OptionalWorkerSecretSchema,
    DATABASE_URL: z.string().url().optional(),
    ENTITLEMENTS_CACHE: z.custom<KVNamespace>(),
    HYPERDRIVE: HyperdriveSchema,
    IDEMPOTENCY: z.custom<DurableObjectNamespace>().optional(),
    INTERNAL_MAINTENANCE_SECRET: OptionalWorkerSecretSchema,
    POLAR_ACCESS_TOKEN: OptionalWorkerSecretSchema,
    QUOTA_TRACKER: z.custom<DurableObjectNamespace>(),
    RATE_LIMITER: z.custom<DurableObjectNamespace>(),
  })
  .strict();

export const AgentWorkerEnvSchema = z
  .object({
    ...AnalyticsBindingsSchema,
    AGENT_RUN: z.custom<DurableObjectNamespace>(),
    BL_API_KEY: z.string().min(1),
    BL_REGION: z.string().min(1),
    BL_WORKSPACE: z.string().min(1),
    BLAXEL_SANDBOX_IMAGE: z.string().min(1),
    BLAXEL_SANDBOX_MEMORY_MB: z.string().regex(/^\d+$/).optional(),
    COMPOSIO_API_KEY: OptionalWorkerSecretSchema,
    HYPERDRIVE: HyperdriveSchema,
    INTERNAL_MAINTENANCE_SECRET: OptionalWorkerSecretSchema,
    OUTPUT_DOWNLOAD_BASE_URL: z.string().url().optional(),
    OUTPUT_DOWNLOAD_SIGNING_SECRET: z.string().min(32),
    PREVIEW_HOSTNAME: z.string().trim().min(1).max(255).optional(),
    PROJECT_SANDBOX: z.custom<DurableObjectNamespace>(),
    QUOTA_TRACKER: z.custom<DurableObjectNamespace>().optional(),
    R2_AUDIT: z.custom<R2Bucket>(),
    R2_OUTPUTS: z.custom<R2Bucket>(),
    R2_OUTPUTS_BUCKET_NAME: z.string().min(1).optional(),
  })
  .strict();

export const WebhooksWorkerEnvSchema = z
  .object({
    ...AnalyticsBindingsSchema,
    AGENT: z.custom<Fetcher>().optional(),
    BL_API_KEY: OptionalWorkerSecretSchema,
    BL_REGION: OptionalWorkerSecretSchema,
    BL_WORKSPACE: OptionalWorkerSecretSchema,
    CLERK_SECRET_KEY: OptionalWorkerSecretSchema,
    CLERK_WEBHOOK_SECRET: OptionalWorkerSecretSchema,
    CLERK_WEBHOOK_SIGNING_SECRET: OptionalWorkerSecretSchema,
    CLOUDFLARE_ACCOUNT_ID: z.string().min(1).optional(),
    CLOUDFLARE_ANALYTICS_API_TOKEN: OptionalWorkerSecretSchema,
    COMPOSIO_API_KEY: OptionalWorkerSecretSchema,
    COMPOSIO_WEBHOOK_SECRET: OptionalWorkerSecretSchema,
    ENTITLEMENTS_CACHE: z.custom<KVNamespace>(),
    GATEWAY: z.custom<Fetcher>().optional(),
    HYPERDRIVE: HyperdriveSchema,
    INTERNAL_ALERT_WEBHOOK_SECRET: OptionalWorkerSecretSchema,
    INTERNAL_ALERT_WEBHOOK_URL: z.string().url().optional(),
    INTERNAL_MAINTENANCE_SECRET: OptionalWorkerSecretSchema,
    OPS_WORKFLOW: z.custom<unknown>(),
    POLAR_ACCESS_TOKEN: OptionalWorkerSecretSchema,
    POLAR_WEBHOOK_SECRET: OptionalWorkerSecretSchema,
    R2_OUTPUTS: z.custom<R2Bucket>(),
    R2_SNAPSHOTS: z.custom<R2Bucket>(),
    R2_UPLOADS: z.custom<R2Bucket>(),
    WEBHOOK_IDEMPOTENCY: z.custom<DurableObjectNamespace>(),
    WEBHOOK_WORKFLOW: z.custom<unknown>(),
  })
  .strict();

export type GatewayWorkerEnv = z.infer<typeof GatewayWorkerEnvSchema>;
export type AgentWorkerEnv = z.infer<typeof AgentWorkerEnvSchema>;
export type WebhooksWorkerEnv = z.infer<typeof WebhooksWorkerEnvSchema>;

export function parseGatewayWorkerEnv(env: unknown): GatewayWorkerEnv {
  return GatewayWorkerEnvSchema.parse(env);
}

export function parseAgentWorkerEnv(env: unknown): AgentWorkerEnv {
  return AgentWorkerEnvSchema.parse(env);
}

export function parseWebhooksWorkerEnv(env: unknown): WebhooksWorkerEnv {
  return WebhooksWorkerEnvSchema.parse(env);
}

export async function resolveWorkerSecret(
  secret: WorkerSecret | undefined,
): Promise<string | undefined> {
  if (!secret) {
    return undefined;
  }
  if (typeof secret === "string") {
    return secret;
  }
  return secret.get();
}
