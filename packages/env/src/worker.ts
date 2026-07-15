import { z } from "zod";

export type WorkerSecret = string | SecretsStoreSecret;

export interface CloudflareVersionMetadata {
  id: string;
  tag: string;
  timestamp: string;
}

interface AnalyticsDatasetBinding {
  writeDataPoint(point: { blobs?: string[]; doubles?: number[]; indexes?: string[] }): void;
}

function hasBindingMethods(value: unknown, methods: readonly string[]): value is object {
  if (value === null || (typeof value !== "object" && typeof value !== "function")) {
    return false;
  }
  try {
    return methods.every((method) => typeof Reflect.get(value, method) === "function");
  } catch {
    return false;
  }
}

function isSecretsStoreSecret(value: unknown): value is SecretsStoreSecret {
  return hasBindingMethods(value, ["get"]);
}

function isAnalyticsDatasetBinding(value: unknown): value is AnalyticsDatasetBinding {
  return hasBindingMethods(value, ["writeDataPoint"]);
}

function isFetcherBinding(value: unknown): value is Fetcher {
  return hasBindingMethods(value, ["fetch"]);
}

function isKvNamespaceBinding(value: unknown): value is KVNamespace {
  return hasBindingMethods(value, ["get", "put", "delete", "list"]);
}

function isDurableObjectNamespaceBinding(value: unknown): value is DurableObjectNamespace {
  return hasBindingMethods(value, [
    "newUniqueId",
    "idFromName",
    "idFromString",
    "get",
    "getByName",
    "jurisdiction",
  ]);
}

function isR2BucketBinding(value: unknown): value is R2Bucket {
  return hasBindingMethods(value, [
    "head",
    "get",
    "put",
    "delete",
    "list",
    "createMultipartUpload",
    "resumeMultipartUpload",
  ]);
}

function isWorkflowBinding(value: unknown): value is Workflow<unknown> {
  return hasBindingMethods(value, ["get", "create", "createBatch"]);
}

export const WorkerSecretSchema = z.union([
  z.string().min(1),
  z.custom<SecretsStoreSecret>(isSecretsStoreSecret),
]);

const OptionalWorkerSecretSchema = z.preprocess(
  (value) => (value === "" ? undefined : value),
  WorkerSecretSchema.optional(),
);

const AnalyticsDatasetBindingSchema = z.custom<AnalyticsDatasetBinding>(
  isAnalyticsDatasetBinding,
  "Expected a Cloudflare Analytics Engine dataset binding",
);
const DurableObjectNamespaceBindingSchema = z.custom<DurableObjectNamespace>(
  isDurableObjectNamespaceBinding,
  "Expected a Cloudflare Durable Object namespace binding",
);
const FetcherBindingSchema = z.custom<Fetcher>(
  isFetcherBinding,
  "Expected a Cloudflare service binding",
);
const KvNamespaceBindingSchema = z.custom<KVNamespace>(
  isKvNamespaceBinding,
  "Expected a Cloudflare KV namespace binding",
);
const R2BucketBindingSchema = z.custom<R2Bucket>(
  isR2BucketBinding,
  "Expected a Cloudflare R2 bucket binding",
);
const WorkflowBindingSchema = z.custom<Workflow<unknown>>(
  isWorkflowBinding,
  "Expected a Cloudflare Workflow binding",
);

export const PreviewHostnameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .refine(
    (hostname) => hostname === "localhost:8787" || isMultiLabelDnsHostname(hostname),
    "Preview hostname must be localhost:8787 or a multi-label DNS hostname",
  );

const HyperdriveSchema = z
  .object({
    connectionString: z.string().min(1),
  })
  .passthrough();

const AnalyticsBindingsSchema = {
  AGENT_METRICS: AnalyticsDatasetBindingSchema.optional(),
  ERROR_EVENTS: AnalyticsDatasetBindingSchema.optional(),
  PERFORMANCE_METRICS: AnalyticsDatasetBindingSchema.optional(),
  USER_EVENTS: AnalyticsDatasetBindingSchema.optional(),
} as const;

export const WorkerReleaseBindingsSchema = {
  CF_VERSION_METADATA: z
    .object({
      id: z.string().min(1),
      tag: z.string(),
      timestamp: z.string().min(1),
    })
    .passthrough()
    .optional(),
  CHEATCODE_ENVIRONMENT: z.enum(["development", "production"]),
  CHEATCODE_RELEASE_SHA: z
    .string()
    .regex(/^[0-9a-f]{40}$/u)
    .optional(),
} as const;

interface WorkerReleaseIdentity {
  CHEATCODE_ENVIRONMENT: "development" | "production";
  CHEATCODE_RELEASE_SHA?: string | undefined;
}

function requireProductionReleaseSha(
  bindings: WorkerReleaseIdentity,
  context: z.RefinementCtx,
): void {
  if (bindings.CHEATCODE_ENVIRONMENT === "production" && !bindings.CHEATCODE_RELEASE_SHA) {
    context.addIssue({
      code: "custom",
      message: "Production Workers require an immutable release SHA.",
      path: ["CHEATCODE_RELEASE_SHA"],
    });
  }
}

export const GatewayWorkerEnvSchema = z
  .object({
    ...AnalyticsBindingsSchema,
    ...WorkerReleaseBindingsSchema,
    AGENT: FetcherBindingSchema,
    CHEATCODE_RELEASE_GATE: z.enum(["open", "closed"]).optional(),
    CLERK_AUTHORIZED_PARTIES: z.string().trim().min(1).max(2_048).optional(),
    CLERK_JWT_KEY: OptionalWorkerSecretSchema,
    CLERK_SECRET_KEY: OptionalWorkerSecretSchema,
    COMPOSIO_API_KEY: OptionalWorkerSecretSchema,
    COMPOSIO_AUTH_CONFIGS: OptionalWorkerSecretSchema,
    ENTITLEMENTS_CACHE: KvNamespaceBindingSchema,
    HYPERDRIVE: HyperdriveSchema,
    IDEMPOTENCY: DurableObjectNamespaceBindingSchema,
    INTERNAL_MAINTENANCE_SECRET: OptionalWorkerSecretSchema,
    POLAR_ACCESS_TOKEN: OptionalWorkerSecretSchema,
    // Polar product ids per paid tier — non-secret config bound as plain wrangler vars
    // (not secrets). Optional so a tier without a Polar product simply 503s on checkout.
    POLAR_PRODUCT_ID_PRO: z.string().min(1).optional(),
    POLAR_PRODUCT_ID_PREMIUM: z.string().min(1).optional(),
    POLAR_PRODUCT_ID_ULTRA: z.string().min(1).optional(),
    POLAR_PRODUCT_ID_MAX: z.string().min(1).optional(),
    POLAR_SERVER: z.enum(["production", "sandbox"]).optional(),
    QUOTA_TRACKER: DurableObjectNamespaceBindingSchema,
    RATE_LIMITER: DurableObjectNamespaceBindingSchema,
  })
  .strict()
  .superRefine(requireProductionReleaseSha);

export const AgentWorkerEnvSchema = z
  .object({
    ...AnalyticsBindingsSchema,
    ...WorkerReleaseBindingsSchema,
    AGENT_RUN: DurableObjectNamespaceBindingSchema,
    // Secret-store-bound and resolved request-scoped in the ProjectSandbox DO.
    DAYTONA_API_KEY: WorkerSecretSchema,
    DAYTONA_API_URL: z.string().url(),
    DAYTONA_TARGET: z.string().min(1).default("us"),
    DAYTONA_SANDBOX_SNAPSHOT: z.string().min(1),
    DAYTONA_ORG_ID: z.string().min(1).optional(),
    DAYTONA_PREVIEW_HOST_SUFFIXES: z.string().min(1).max(1_024).optional(),
    // Shared HMAC secret for the preview-proxy access-token contract.
    PREVIEW_TOKEN_SECRET: WorkerSecretSchema,
    COMPOSIO_API_KEY: OptionalWorkerSecretSchema,
    // Platform-provided DeepSeek key for the free tier (Secrets-Store-bound, resolved
    // request-scoped in the AgentRun DO via resolveWorkerSecret()).
    DEEPSEEK_PLATFORM_API_KEY: OptionalWorkerSecretSchema,
    HYPERDRIVE: HyperdriveSchema,
    INTERNAL_MAINTENANCE_SECRET: OptionalWorkerSecretSchema,
    OUTPUT_DOWNLOAD_BASE_URL: z.string().url().optional(),
    OUTPUT_DOWNLOAD_SIGNING_SECRET: WorkerSecretSchema,
    PREVIEW_HOSTNAME: PreviewHostnameSchema,
    PROJECT_SANDBOX: DurableObjectNamespaceBindingSchema,
    QUOTA_TRACKER: DurableObjectNamespaceBindingSchema,
    R2_AUDIT: R2BucketBindingSchema,
    R2_OUTPUTS: R2BucketBindingSchema,
    R2_OUTPUTS_BUCKET_NAME: z.string().min(1).optional(),
    SANDBOX_STATE: KvNamespaceBindingSchema.optional(),
  })
  .strict()
  .superRefine(requireProductionReleaseSha)
  .superRefine(requireProductionPreviewHostname);

export const WebhooksWorkerEnvSchema = z
  .object({
    ...AnalyticsBindingsSchema,
    ...WorkerReleaseBindingsSchema,
    AGENT: FetcherBindingSchema,
    CLERK_WEBHOOK_SIGNING_SECRET: OptionalWorkerSecretSchema,
    CLOUDFLARE_ACCOUNT_ID: z.string().min(1).optional(),
    CLOUDFLARE_ANALYTICS_API_TOKEN: OptionalWorkerSecretSchema,
    COMPOSIO_API_KEY: OptionalWorkerSecretSchema,
    COMPOSIO_WEBHOOK_SECRET: OptionalWorkerSecretSchema,
    DAYTONA_WEBHOOK_SIGNING_SECRET: WorkerSecretSchema,
    ENTITLEMENTS_CACHE: KvNamespaceBindingSchema,
    GATEWAY: FetcherBindingSchema,
    SANDBOX_STATE: KvNamespaceBindingSchema.optional(),
    HYPERDRIVE: HyperdriveSchema,
    INTERNAL_ALERT_WEBHOOK_SECRET: OptionalWorkerSecretSchema,
    INTERNAL_ALERT_WEBHOOK_URL: z.string().url().optional(),
    INTERNAL_MAINTENANCE_SECRET: OptionalWorkerSecretSchema,
    OPS_WORKFLOW: WorkflowBindingSchema,
    POLAR_ACCESS_TOKEN: OptionalWorkerSecretSchema,
    POLAR_PRODUCT_ID_PRO: z.string().min(1).optional(),
    POLAR_PRODUCT_ID_PREMIUM: z.string().min(1).optional(),
    POLAR_PRODUCT_ID_ULTRA: z.string().min(1).optional(),
    POLAR_PRODUCT_ID_MAX: z.string().min(1).optional(),
    POLAR_SERVER: z.enum(["production", "sandbox"]).optional(),
    POLAR_WEBHOOK_SECRET: OptionalWorkerSecretSchema,
    R2_OUTPUTS: R2BucketBindingSchema,
    R2_OUTPUTS_BUCKET_NAME: z.string().min(1).optional(),
    R2_UPLOADS: R2BucketBindingSchema,
    WEBHOOK_IDEMPOTENCY: DurableObjectNamespaceBindingSchema,
    WEBHOOK_WORKFLOW: WorkflowBindingSchema,
  })
  .strict()
  .superRefine(requireProductionReleaseSha);

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

function requireProductionPreviewHostname(
  bindings: { CHEATCODE_ENVIRONMENT: "development" | "production"; PREVIEW_HOSTNAME: string },
  context: z.RefinementCtx,
): void {
  if (bindings.CHEATCODE_ENVIRONMENT !== "production") {
    return;
  }
  if (bindings.PREVIEW_HOSTNAME.includes(":")) {
    context.addIssue({
      code: "custom",
      message: "Production preview hostname must be a DNS hostname without a port",
      path: ["PREVIEW_HOSTNAME"],
    });
  }
  if (bindings.PREVIEW_HOSTNAME !== "trycheatcode.com") {
    context.addIssue({
      code: "custom",
      message: "Production previews require the owned trycheatcode.com wildcard route",
      path: ["PREVIEW_HOSTNAME"],
    });
  }
}

function isMultiLabelDnsHostname(hostname: string): boolean {
  if (hostname.length > 253 || !hostname.includes(".")) {
    return false;
  }
  return hostname
    .split(".")
    .every(
      (label) =>
        label.length >= 1 && label.length <= 63 && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/u.test(label),
    );
}
