import {
  type EntitlementCache,
  EntitlementCacheSchema,
  entitlementCacheFromValues,
  tierLimits,
} from "@cheatcode/billing";
import { countActiveProjects, type Database, findEntitlementByUserId } from "@cheatcode/db";
import { APIError, createLogger } from "@cheatcode/observability";
import {
  type LimitsSnapshot,
  LimitsSnapshotSchema,
  type Provider,
  type UserId,
} from "@cheatcode/types";
import type { QuotaTracker } from "./durable-objects/quota-tracker";
import { QuotaSnapshotResultSchema } from "./durable-objects/quota-tracker-contract";

export interface LimitBindings {
  ENTITLEMENTS_CACHE: KVNamespace;
  QUOTA_TRACKER: DurableObjectNamespace<QuotaTracker>;
}

const ENTITLEMENT_CACHE_TTL_SECONDS = 300;
const QUOTA_FEATURES = {
  composioCalls: "composio_calls",
  deployments: "deployments",
  sandboxHours: "sandbox_hours",
} as const;

export async function buildLimitsSnapshot(
  env: LimitBindings,
  db: Database,
  userId: UserId,
): Promise<LimitsSnapshot> {
  const entitlement = await resolveEntitlement(env, db, userId);
  const projectCount = await countActiveProjects(db, userId);
  const periodEnd = entitlement.currentPeriodEnd ?? defaultPeriodEnd();
  await syncQuotaLimits(env, userId, entitlement);
  const quotaSnapshot = await readQuotaSnapshot(env, userId, periodEnd);
  return LimitsSnapshotSchema.parse({
    rate_limits: {
      "runs.create": {
        limit: 30,
        remaining: 30,
        reset_at: Math.ceil(Date.now() / 1000) + 60,
      },
    },
    quotas: {
      active_projects: {
        limit: entitlement.maxProjects,
        period_end: periodEnd,
        used: projectCount,
      },
      composio_calls: quotaResponse(
        quotaSnapshot[QUOTA_FEATURES.composioCalls],
        entitlement.quotaComposioCalls,
        periodEnd,
      ),
      deployments: quotaResponse(
        quotaSnapshot[QUOTA_FEATURES.deployments],
        entitlement.quotaDeployments,
        periodEnd,
      ),
      sandbox_hours: quotaResponse(
        quotaSnapshot[QUOTA_FEATURES.sandboxHours],
        entitlement.quotaSandboxHours,
        periodEnd,
      ),
    },
  });
}

export async function enforceActiveProjectLimit(
  env: LimitBindings,
  db: Database,
  userId: UserId,
): Promise<void> {
  const entitlement = await resolveEntitlement(env, db, userId);
  const projectCount = await countActiveProjects(db, userId);
  if (projectCount < entitlement.maxProjects) {
    return;
  }
  throw new APIError(403, "permission_plan_required", "Active project limit reached", {
    details: {
      limit: entitlement.maxProjects,
      tier: entitlement.tier,
      used: projectCount,
    },
    hint: "Upgrade your plan or archive an existing project before creating another one.",
    retriable: false,
  });
}

export async function enforceByokProviderSlotLimit(
  env: LimitBindings,
  db: Database,
  userId: UserId,
  provider: Provider,
  existingKeys: readonly { disabledAt?: null | string; provider: Provider }[],
): Promise<void> {
  const activeKeys = existingKeys.filter(
    (key) => key.disabledAt === null || key.disabledAt === undefined,
  );
  if (activeKeys.some((key) => key.provider === provider)) {
    return;
  }
  const entitlement = await resolveEntitlement(env, db, userId);
  const limit = tierLimits(entitlement.tier).byokProviderSlots;
  if (limit === null || activeKeys.length < limit) {
    return;
  }
  throw new APIError(403, "permission_plan_required", "BYOK provider slot limit reached", {
    details: {
      limit,
      tier: entitlement.tier,
      used: activeKeys.length,
    },
    hint: "Upgrade your plan or remove an existing provider key before adding another one.",
    retriable: false,
  });
}

export async function resolveEntitlement(
  env: LimitBindings,
  db: Database,
  userId: UserId,
): Promise<EntitlementCache> {
  const cached = await readCachedEntitlement(env.ENTITLEMENTS_CACHE, userId);
  if (cached) {
    return cached;
  }
  const row = await findEntitlementByUserId(db, userId);
  const entitlement = entitlementCacheFromValues(row ?? { tier: "free" });
  await writeEntitlementCache(env.ENTITLEMENTS_CACHE, userId, entitlement);
  return entitlement;
}

export async function writeEntitlementCache(
  cache: KVNamespace,
  userId: UserId,
  entitlement: EntitlementCache,
): Promise<void> {
  await cache.put(entitlementCacheKey(userId), JSON.stringify(entitlement), {
    expirationTtl: ENTITLEMENT_CACHE_TTL_SECONDS,
  });
}

function quotaResponse(
  quota: { limit: number; used: number } | undefined,
  fallbackLimit: number,
  periodEnd: string,
) {
  return {
    limit: quota?.limit ?? fallbackLimit,
    period_end: periodEnd,
    used: quota?.used ?? 0,
  };
}

export async function syncQuotaLimits(
  env: LimitBindings,
  userId: UserId,
  entitlement: EntitlementCache,
): Promise<void> {
  const stub = quotaStub(env, userId);
  await Promise.all([
    setQuotaLimit(stub, QUOTA_FEATURES.sandboxHours, entitlement.quotaSandboxHours, "entitlement"),
    setQuotaLimit(
      stub,
      QUOTA_FEATURES.composioCalls,
      entitlement.quotaComposioCalls,
      "entitlement",
    ),
    setQuotaLimit(stub, QUOTA_FEATURES.deployments, entitlement.quotaDeployments, "entitlement"),
  ]);
}

async function setQuotaLimit(
  stub: DurableObjectStub<QuotaTracker>,
  feature: string,
  limit: number,
  source: string,
): Promise<void> {
  const response = await stub.fetch("https://quota.internal/set-limit", {
    body: JSON.stringify({ feature, limit, source }),
    method: "POST",
  });
  if (!response.ok) {
    throw new APIError(503, "unavailable_maintenance", "Quota tracker is unavailable", {
      hint: "Retry the request. If it persists, check the QuotaTracker Durable Object logs.",
      retriable: true,
    });
  }
}

async function readQuotaSnapshot(
  env: LimitBindings,
  userId: UserId,
  periodEnd: string,
): Promise<Record<string, { limit: number; used: number }>> {
  const response = await quotaStub(env, userId).fetch("https://quota.internal/snapshot", {
    body: JSON.stringify({ periodEnd }),
    method: "POST",
  });
  if (!response.ok) {
    throw new APIError(503, "unavailable_maintenance", "Quota tracker is unavailable", {
      hint: "Retry the request. If it persists, check the QuotaTracker Durable Object logs.",
      retriable: true,
    });
  }
  return QuotaSnapshotResultSchema.parse(await response.json());
}

async function readCachedEntitlement(
  cache: KVNamespace,
  userId: UserId,
): Promise<EntitlementCache | null> {
  const raw = await cache.get(entitlementCacheKey(userId));
  if (!raw) {
    return null;
  }
  let decoded: unknown;
  try {
    decoded = JSON.parse(raw) as unknown;
  } catch {
    createLogger({ userId }).warn("entitlement_cache_invalid_json", {});
    return null;
  }
  const parsed = EntitlementCacheSchema.safeParse(decoded);
  if (parsed.success) {
    return parsed.data;
  }
  createLogger({ userId }).warn("entitlement_cache_invalid", {});
  return null;
}

function quotaStub(env: LimitBindings, userId: UserId): DurableObjectStub<QuotaTracker> {
  return env.QUOTA_TRACKER.get(env.QUOTA_TRACKER.idFromName(`quota:${userId}`));
}

function entitlementCacheKey(userId: UserId): string {
  return `entitlement:${userId}`;
}

function defaultPeriodEnd(): string {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString();
}
