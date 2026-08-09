import { z } from "zod";
import {
  AnalyticsBindingsSchema,
  DEFAULT_DAYTONA_TARGET,
  DurableObjectNamespaceBindingSchema,
  HyperdriveSchema,
  KvNamespaceBindingSchema,
  OptionalWorkerSecretSchema,
  PreviewHostnameSchema,
  R2BucketBindingSchema,
  requireProductionDaytonaOrg,
  requireProductionPreviewHostname,
  requireProductionReleaseSha,
  WorkerReleaseBindingsSchema,
  WorkerSecretSchema,
  WorkflowBindingSchema,
} from "./worker-shared";

export const AgentWorkerEnvSchema = z
  .strictObject({
    ...AnalyticsBindingsSchema,
    ...WorkerReleaseBindingsSchema,
    AGENT_RUN: DurableObjectNamespaceBindingSchema,
    AGENT_RUN_WORKFLOW: WorkflowBindingSchema,
    COMPOSIO_API_KEY: OptionalWorkerSecretSchema,
    DATABASE_CONTEXT_SIGNING_SECRET_AGENT: WorkerSecretSchema,
    DAYTONA_API_KEY: WorkerSecretSchema,
    DAYTONA_API_URL: z.string().url(),
    DAYTONA_ORG_ID: z.string().uuid().optional(),
    DAYTONA_PREVIEW_HOST_SUFFIXES: z.string().min(1).max(1_024).optional(),
    DAYTONA_SANDBOX_SNAPSHOT: z.string().min(1),
    DAYTONA_TARGET: z.string().min(1).default(DEFAULT_DAYTONA_TARGET),
    DAYTONA_WORKSPACE_VOLUME: z.string().min(1).max(100),
    DEEPSEEK_PLATFORM_API_KEY: OptionalWorkerSecretSchema,
    HYPERDRIVE: HyperdriveSchema,
    MORPH_API_KEY: WorkerSecretSchema,
    OUTPUT_DOWNLOAD_BASE_URL: z.string().url().optional(),
    OUTPUT_DOWNLOAD_SIGNING_SECRET: WorkerSecretSchema,
    PREVIEW_HOSTNAME: PreviewHostnameSchema.optional(),
    PREVIEW_TOKEN_SECRET: WorkerSecretSchema,
    PROJECT_SANDBOX: DurableObjectNamespaceBindingSchema,
    QUOTA_TRACKER: DurableObjectNamespaceBindingSchema,
    R2_AUDIT: R2BucketBindingSchema,
    R2_OUTPUTS: R2BucketBindingSchema,
    SANDBOX_STATE: KvNamespaceBindingSchema.optional(),
  })

  .superRefine(requireProductionReleaseSha)
  .superRefine(requireProductionDaytonaOrg)
  .superRefine(requireProductionPreviewHostname);
