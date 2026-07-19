import type { CloudflareVersionMetadata, WorkerSecret } from "@cheatcode/env";
import type { AnalyticsBindings } from "@cheatcode/observability";
import type { Context, Hono } from "hono";
import type { IdempotencyStore } from "./durable-objects/idempotency";
import type { QuotaTracker } from "./durable-objects/quota-tracker";
import type { RateLimiter } from "./durable-objects/rate-limiter";
import type { IdempotencyBindings } from "./idempotency";

export interface GatewayEnv extends AnalyticsBindings, IdempotencyBindings {
  AGENT: Fetcher;
  CF_VERSION_METADATA?: CloudflareVersionMetadata;
  CHEATCODE_ENVIRONMENT: "development" | "production";
  CHEATCODE_RELEASE_GATE: "open" | "closed";
  CHEATCODE_RELEASE_SHA?: string;
  CLERK_AUTHORIZED_PARTIES?: string;
  CLERK_JWT_KEY?: WorkerSecret;
  CLERK_SECRET_KEY?: WorkerSecret;
  COMPOSIO_API_KEY?: WorkerSecret;
  COMPOSIO_AUTH_CONFIGS?: WorkerSecret;
  DATABASE_CONTEXT_SIGNING_SECRET_GATEWAY: WorkerSecret;
  ENTITLEMENTS_CACHE: KVNamespace;
  GATEWAY_TO_WEBHOOKS_RESOURCE_DELETION_SECRET: WorkerSecret;
  HYPERDRIVE: Hyperdrive;
  IDEMPOTENCY: DurableObjectNamespace<IdempotencyStore>;
  POLAR_ACCESS_TOKEN?: WorkerSecret;
  POLAR_PRODUCT_ID_MAX?: string;
  POLAR_PRODUCT_ID_PREMIUM?: string;
  POLAR_PRODUCT_ID_PRO?: string;
  POLAR_PRODUCT_ID_ULTRA?: string;
  POLAR_SERVER?: "production" | "sandbox";
  PREVIEW_PROXY?: Fetcher;
  QUOTA_TRACKER: DurableObjectNamespace<QuotaTracker>;
  RATE_LIMITER: DurableObjectNamespace<RateLimiter>;
  RELEASE_DATABASE_READINESS_SECRET: WorkerSecret;
  WEBHOOKS: Fetcher;
}

export type GatewayApp = Hono<{ Bindings: GatewayEnv }>;
export type GatewayContext = Context<{ Bindings: GatewayEnv }>;
