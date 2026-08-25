import { z } from "zod";
import {
  AnalyticsBindingsSchema,
  HyperdriveSchema,
  R2BucketBindingSchema,
  requireProductionReleaseSha,
  WorkerReleaseBindingsSchema,
  WorkerSecretSchema,
} from "./worker-shared";

export const ArtifactWorkerEnvSchema = z
  .strictObject({
    ...AnalyticsBindingsSchema,
    ...WorkerReleaseBindingsSchema,
    DATABASE_CONTEXT_SIGNING_SECRET_AGENT: WorkerSecretSchema,
    HYPERDRIVE: HyperdriveSchema,
    OUTPUT_DOWNLOAD_BASE_URL: z.string().url().optional(),
    OUTPUT_DOWNLOAD_SIGNING_SECRET: WorkerSecretSchema,
    R2_OUTPUTS: R2BucketBindingSchema,
  })
  .superRefine(requireProductionReleaseSha);
