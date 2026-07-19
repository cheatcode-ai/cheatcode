import {
  type EntitlementCache,
  EntitlementCacheSchema,
  entitlementCacheFromValues,
} from "@cheatcode/billing";
import {
  countActiveProjects,
  type Database,
  findEntitlementByUserId,
  lockUserEntitlementMutations,
  lockUserProjectMutations,
  withUserContext,
} from "@cheatcode/db";
import { APIError, createLogger, readBoundedResponseJson } from "@cheatcode/observability";
import { type LimitsSnapshot, LimitsSnapshotSchema, type UserId } from "@cheatcode/types";
import {
  QUOTA_FEATURES,
  QUOTA_TRACKER_MAX_RESPONSE_BYTES,
  type QuotaFeature,
  QuotaSetLimitRequestSchema,
  QuotaSetLimitResponseSchema,
} from "@cheatcode/types/quota";
import type { QuotaTracker } from "./durable-objects/quota-tracker";
import { QuotaSnapshotResultSchema } from "./durable-objects/quota-tracker-contract";

export interface LimitBindings {
  ENTITLEMENTS_CACHE: KVNamespace;
  QUOTA_TRACKER: DurableObjectNamespace<QuotaTracker>;
}

const ENTITLEMENT_CACHE_TTL_SECONDS = 300;
const MAX_QUOTA_SNAPSHOT_RESPONSE_BYTES = 128 * 1024;

export async function buildLimitsSnapshot(
  env: LimitBindings,
  db: Database,
  userId: UserId,
): Promise<LimitsSnapshot> {
  const entitlement = await resolveEntitlement(env, db, userId);
  const projectCount = await withUserContext(db, userId, (tx) => countActiveProjects(tx, userId));
  const periodEnd = entitlement.currentPeriodEnd ?? defaultPeriodEnd();
  await syncQuotaLimits(env, userId, entitlement);
  const quotaSnapshot = await readQuotaSnapshot(env, userId, periodEnd);
  return LimitsSnapshotSchema.parse({
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
      sandbox_hours: quotaResponse(
        quotaSnapshot[QUOTA_FEATURES.sandboxHours],
        entitlement.quotaSandboxHours,
        periodEnd,
      ),
    },
  });
}

export async function enforceActiveProjectLimit(db: Database, userId: UserId): Promise<void> {
  await lockUserEntitlementMutations(db, userId);
  await lockUserProjectMutations(db, userId);
  const entitlement = await resolveDatabaseEntitlement(db, userId);
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

export async function resolveEntitlement(
  env: LimitBindings,
  db: Database,
  userId: UserId,
): Promise<EntitlementCache> {
  const cached = await readCachedEntitlement(env.ENTITLEMENTS_CACHE, userId);
  if (cached) {
    return cached;
  }
  const entitlement = await withUserContext(db, userId, (tx) =>
    resolveDatabaseEntitlement(tx, userId),
  );
  await writeEntitlementCache(env.ENTITLEMENTS_CACHE, userId, entitlement);
  return entitlement;
}

/** DB-only authoritative entitlement read for mutation transactions. */
export async function resolveDatabaseEntitlement(
  db: Database,
  userId: UserId,
): Promise<EntitlementCache> {
  const row = await findEntitlementByUserId(db, userId);
  return entitlementCacheFromValues(row ?? { tier: "free" });
}

async function writeEntitlementCache(
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
  const entitlementVersion = Date.parse(entitlement.updatedAt);
  await Promise.all([
    setQuotaLimit(
      stub,
      QUOTA_FEATURES.sandboxHours,
      entitlement.quotaSandboxHours,
      entitlementVersion,
    ),
    setQuotaLimit(
      stub,
      QUOTA_FEATURES.composioCalls,
      entitlement.quotaComposioCalls,
      entitlementVersion,
    ),
  ]);
}

async function setQuotaLimit(
  stub: DurableObjectStub<QuotaTracker>,
  feature: QuotaFeature,
  limit: number,
  entitlementVersion: number,
): Promise<void> {
  const body = QuotaSetLimitRequestSchema.parse({ entitlementVersion, feature, limit });
  const response = await stub.fetch("https://quota.internal/set-limit", {
    body: JSON.stringify(body),
    method: "POST",
  });
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    throw new APIError(503, "unavailable_maintenance", "Quota tracker is unavailable", {
      hint: "Retry the request. If it persists, check the QuotaTracker Durable Object logs.",
      retriable: true,
    });
  }
  QuotaSetLimitResponseSchema.parse(
    await readBoundedResponseJson(response, QUOTA_TRACKER_MAX_RESPONSE_BYTES, "Quota set-limit"),
  );
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
    await response.body?.cancel().catch(() => undefined);
    throw new APIError(503, "unavailable_maintenance", "Quota tracker is unavailable", {
      hint: "Retry the request. If it persists, check the QuotaTracker Durable Object logs.",
      retriable: true,
    });
  }
  return QuotaSnapshotResultSchema.parse(
    await readBoundedResponseJson(response, MAX_QUOTA_SNAPSHOT_RESPONSE_BYTES, "Quota snapshot"),
  );
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
