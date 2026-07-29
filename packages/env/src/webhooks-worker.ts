import { z } from "zod";
import {
  AnalyticsBindingsSchema,
  DurableObjectNamespaceBindingSchema,
  FetcherBindingSchema,
  HyperdriveSchema,
  KvNamespaceBindingSchema,
  OptionalWorkerSecretSchema,
  R2BucketBindingSchema,
  requireProductionReleaseSha,
  WorkerReleaseBindingsSchema,
  WorkerSecretSchema,
  WorkflowBindingSchema,
} from "./worker-shared";

export const WebhooksWorkerEnvSchema = z
  .object({
    ...AnalyticsBindingsSchema,
    ...WorkerReleaseBindingsSchema,
    AGENT_LIFECYCLE: FetcherBindingSchema,
    CLERK_WEBHOOK_SIGNING_SECRET: OptionalWorkerSecretSchema,
    COMPOSIO_API_KEY: OptionalWorkerSecretSchema,
    COMPOSIO_WEBHOOK_SECRET: OptionalWorkerSecretSchema,
    DAILY_MAINTENANCE_WORKFLOW: WorkflowBindingSchema,
    DATABASE_CONTEXT_SIGNING_SECRET_WEBHOOKS: WorkerSecretSchema,
    DAYTONA_WEBHOOK_SIGNING_SECRET: WorkerSecretSchema,
    ENTITLEMENTS_CACHE: KvNamespaceBindingSchema,
    HYPERDRIVE: HyperdriveSchema,
    POLAR_ACCESS_TOKEN: OptionalWorkerSecretSchema,
    POLAR_PRODUCT_ID_PREMIUM: z.string().min(1).optional(),
    POLAR_PRODUCT_ID_PRO: z.string().min(1).optional(),
    POLAR_SERVER: z.enum(["production", "sandbox"]).optional(),
    POLAR_WEBHOOK_SECRET: OptionalWorkerSecretSchema,
    QUOTA_TRACKER: DurableObjectNamespaceBindingSchema,
    R2_OUTPUTS: R2BucketBindingSchema,
    RESOURCE_DELETION_WORKFLOW: WorkflowBindingSchema,
    SANDBOX_STATE: KvNamespaceBindingSchema.optional(),
    USER_DELETION_WORKFLOW: WorkflowBindingSchema,
    WEBHOOK_IDEMPOTENCY: DurableObjectNamespaceBindingSchema,
    WEBHOOK_WORKFLOW: WorkflowBindingSchema,
  })
  .strict()
  .superRefine(requireProductionReleaseSha);
