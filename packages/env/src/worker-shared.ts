import { z } from "zod";
import { PRODUCTION_APP_HOSTNAME } from "./web-config";

export type WorkerSecret = string | SecretsStoreSecret;
export const DEFAULT_DAYTONA_TARGET = "us";

export interface CloudflareVersionMetadata {
  id: string;
  tag: string;
  timestamp: string;
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

function isAnalyticsDatasetBinding(value: unknown): boolean {
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

export const OptionalWorkerSecretSchema = z.preprocess(
  (value) => (value === "" ? undefined : value),
  WorkerSecretSchema.optional(),
);

const AnalyticsDatasetBindingSchema = z.custom<{
  writeDataPoint(point: { blobs?: string[]; doubles?: number[]; indexes?: string[] }): void;
}>(isAnalyticsDatasetBinding, "Expected a Cloudflare Analytics Engine dataset binding");
export const DurableObjectNamespaceBindingSchema = z.custom<DurableObjectNamespace>(
  isDurableObjectNamespaceBinding,
  "Expected a Cloudflare Durable Object namespace binding",
);
export const FetcherBindingSchema = z.custom<Fetcher>(
  isFetcherBinding,
  "Expected a Cloudflare service binding",
);
export const KvNamespaceBindingSchema = z.custom<KVNamespace>(
  isKvNamespaceBinding,
  "Expected a Cloudflare KV namespace binding",
);
export const R2BucketBindingSchema = z.custom<R2Bucket>(
  isR2BucketBinding,
  "Expected a Cloudflare R2 bucket binding",
);
export const WorkflowBindingSchema = z.custom<Workflow<unknown>>(
  isWorkflowBinding,
  "Expected a Cloudflare Workflow binding",
);

export const PreviewHostnameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .refine(
    (hostname) =>
      hostname === "localhost" ||
      hostname === "localhost:8787" ||
      isMultiLabelDnsHostname(hostname),
    "Preview hostname must be localhost, localhost:8787, or a multi-label DNS hostname",
  );

export const HyperdriveSchema = z.looseObject({
  connectionString: z.string().min(1),
});

export const AnalyticsBindingsSchema = {
  AGENT_METRICS: AnalyticsDatasetBindingSchema.optional(),
  ERROR_EVENTS: AnalyticsDatasetBindingSchema.optional(),
  PERFORMANCE_METRICS: AnalyticsDatasetBindingSchema.optional(),
  USER_EVENTS: AnalyticsDatasetBindingSchema.optional(),
} as const;

export const WorkerReleaseBindingsSchema = {
  CF_VERSION_METADATA: z
    .looseObject({
      id: z.string().min(1),
      tag: z.string(),
      timestamp: z.string().min(1),
    })

    .optional(),
  CHEATCODE_ENVIRONMENT: z.enum(["development", "production"]),
  CHEATCODE_RELEASE_SHA: z
    .string()
    .regex(/^[0-9a-f]{40}$/u)
    .optional(),
} as const;

export interface WorkerReleaseIdentity {
  CHEATCODE_ENVIRONMENT: "development" | "production";
  CHEATCODE_RELEASE_SHA?: string | undefined;
}

export function requireProductionReleaseSha(
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

export function requireProductionDaytonaOrg(
  bindings: WorkerReleaseIdentity & { DAYTONA_ORG_ID?: string | undefined },
  context: z.RefinementCtx,
): void {
  if (bindings.CHEATCODE_ENVIRONMENT === "production" && !bindings.DAYTONA_ORG_ID) {
    context.addIssue({
      code: "custom",
      message: "Production sandbox Workers require the pinned Daytona organization ID.",
      path: ["DAYTONA_ORG_ID"],
    });
  }
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

export function requireProductionPreviewHostname(
  bindings: {
    CHEATCODE_ENVIRONMENT: "development" | "production";
    PREVIEW_HOSTNAME?: string | undefined;
  },
  context: z.RefinementCtx,
): void {
  if (bindings.CHEATCODE_ENVIRONMENT !== "production") {
    return;
  }
  const previewHostname = bindings.PREVIEW_HOSTNAME ?? PRODUCTION_APP_HOSTNAME;
  if (previewHostname.includes(":")) {
    context.addIssue({
      code: "custom",
      message: "Production preview hostname must be a DNS hostname without a port",
      path: ["PREVIEW_HOSTNAME"],
    });
  }
  if (previewHostname !== PRODUCTION_APP_HOSTNAME) {
    context.addIssue({
      code: "custom",
      message: "Production previews require the owned trycheatcode.com wildcard route",
      path: ["PREVIEW_HOSTNAME"],
    });
  }
}

export function previewHostnameForWorker(
  environment: "development" | "production",
  configured: string | undefined,
): string {
  const hostname = PreviewHostnameSchema.parse(
    configured ?? (environment === "production" ? PRODUCTION_APP_HOSTNAME : undefined),
  );
  if (environment === "production" && hostname !== PRODUCTION_APP_HOSTNAME) {
    throw new Error("Production preview hostname must derive from the canonical app origin");
  }
  return hostname;
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
