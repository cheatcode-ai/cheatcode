import { z } from "zod";
import { PRODUCTION_APP_ORIGIN } from "./web-config";
import {
  AnalyticsBindingsSchema,
  DurableObjectNamespaceBindingSchema,
  FetcherBindingSchema,
  HyperdriveSchema,
  KvNamespaceBindingSchema,
  OptionalWorkerSecretSchema,
  requireProductionReleaseSha,
  WorkerReleaseBindingsSchema,
  WorkerSecretSchema,
} from "./worker-shared";

export const GatewayWorkerEnvSchema = z
  .object({
    ...AnalyticsBindingsSchema,
    ...WorkerReleaseBindingsSchema,
    AGENT: FetcherBindingSchema,
    CLERK_AUTHORIZED_PARTIES: z.string().trim().min(1).max(2_048).optional(),
    CLERK_SECRET_KEY: OptionalWorkerSecretSchema,
    COMPOSIO_API_KEY: OptionalWorkerSecretSchema,
    COMPOSIO_AUTH_CONFIGS: OptionalWorkerSecretSchema,
    DATABASE_CONTEXT_SIGNING_SECRET_GATEWAY: WorkerSecretSchema,
    ENTITLEMENTS_CACHE: KvNamespaceBindingSchema,
    HYPERDRIVE: HyperdriveSchema,
    IDEMPOTENCY: DurableObjectNamespaceBindingSchema,
    POLAR_ACCESS_TOKEN: OptionalWorkerSecretSchema,
    POLAR_PRODUCT_ID_PRO: z.string().min(1).optional(),
    POLAR_PRODUCT_ID_PREMIUM: z.string().min(1).optional(),
    POLAR_SERVER: z.enum(["production", "sandbox"]).optional(),
    PREVIEW_PROXY: FetcherBindingSchema.optional(),
    QUOTA_TRACKER: DurableObjectNamespaceBindingSchema,
    RATE_LIMITER: DurableObjectNamespaceBindingSchema,
    RESOURCE_DELETION: FetcherBindingSchema,
    WEBHOOKS: FetcherBindingSchema,
  })
  .strict()
  .superRefine(requireProductionReleaseSha)
  .superRefine((env, context) => {
    if (
      env.CHEATCODE_ENVIRONMENT === "production" &&
      env.CLERK_AUTHORIZED_PARTIES !== undefined &&
      env.CLERK_AUTHORIZED_PARTIES !== PRODUCTION_APP_ORIGIN
    ) {
      context.addIssue({
        code: "custom",
        message: "Production Clerk authorized parties derive from the canonical app origin",
        path: ["CLERK_AUTHORIZED_PARTIES"],
      });
    }
  });
