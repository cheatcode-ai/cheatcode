import type { DatabaseHandle } from "@cheatcode/db";
import type { CloudflareVersionMetadata, WorkerSecret } from "@cheatcode/env";
import type { AnalyticsBindings } from "@cheatcode/observability";
import type { ResourceDeletionServiceBinding } from "@cheatcode/types/internal";
import type { GatewayQuotaServiceBinding } from "@cheatcode/types/quota";
import type { Context, Hono } from "hono";
import type { IdempotencyStore } from "./durable-objects/idempotency";
import type { RateLimiter } from "./durable-objects/rate-limiter";
import type { IdempotencyBindings } from "./idempotency";

export interface GatewayEnv extends AnalyticsBindings, IdempotencyBindings {
  AGENT: Fetcher;
  CF_VERSION_METADATA?: CloudflareVersionMetadata;
  CHEATCODE_ENVIRONMENT: "development" | "production";
  CHEATCODE_RELEASE_SHA?: string;
  CLERK_AUTHORIZED_PARTIES?: string;
  CLERK_SECRET_KEY?: WorkerSecret;
  COMPOSIO_API_KEY?: WorkerSecret;
  COMPOSIO_AUTH_CONFIGS?: WorkerSecret;
  DATABASE_CONTEXT_SIGNING_SECRET_GATEWAY: WorkerSecret;
  ENTITLEMENTS_CACHE: KVNamespace;
  HYPERDRIVE: Hyperdrive;
  IDEMPOTENCY: DurableObjectNamespace<IdempotencyStore>;
  POLAR_ACCESS_TOKEN?: WorkerSecret;
  POLAR_PRODUCT_ID_PREMIUM?: string;
  POLAR_PRODUCT_ID_PRO?: string;
  POLAR_SERVER?: "production" | "sandbox";
  PREVIEW_PROXY?: Fetcher;
  QUOTA_TRACKER: GatewayQuotaServiceBinding;
  RATE_LIMITER: DurableObjectNamespace<RateLimiter>;
  RESOURCE_DELETION: ResourceDeletionServiceBinding;
  WEBHOOKS: Fetcher;
}

interface GatewayVariables {
  database: () => DatabaseHandle;
}

export type GatewayHonoEnv = { Bindings: GatewayEnv; Variables: GatewayVariables };
export type GatewayApp = Hono<GatewayHonoEnv>;
export type GatewayContext = Context<GatewayHonoEnv>;

export function requestDatabase(c: GatewayContext): DatabaseHandle {
  return c.get("database")();
}
