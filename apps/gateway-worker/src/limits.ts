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
  type UserDatabaseSession,
} from "@cheatcode/db";
import { APIError, createLogger } from "@cheatcode/observability";
import type { UserId } from "@cheatcode/types";
import { QUOTA_FEATURES, type QuotaFeature } from "@cheatcode/types/quota";
import type { QuotaTracker } from "./durable-objects/quota-tracker";

export interface LimitBindings {
  ENTITLEMENTS_CACHE: KVNamespace;
  QUOTA_TRACKER: DurableObjectNamespace<QuotaTracker>;
}

const ENTITLEMENT_CACHE_TTL_SECONDS = 300;
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
  transaction: UserDatabaseSession["transaction"],
  userId: UserId,
): Promise<EntitlementCache> {
  const cached = await readCachedEntitlement(env.ENTITLEMENTS_CACHE, userId);
  if (cached) {
    return cached;
  }
  const entitlement = await transaction((tx) => resolveDatabaseEntitlement(tx, userId));
  await writeEntitlementCache(env.ENTITLEMENTS_CACHE, userId, entitlement);
  return entitlement;
}

/** DB-only authoritative entitlement read for mutation transactions. */
async function resolveDatabaseEntitlement(db: Database, userId: UserId): Promise<EntitlementCache> {
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
  try {
    await stub.setLimit(feature, limit, entitlementVersion);
  } catch (error) {
    throw new APIError(503, "service_maintenance_unavailable", "Quota tracker is unavailable", {
      cause: error,
      hint: "Retry the request. If it persists, check the QuotaTracker Durable Object logs.",
      retriable: true,
    });
  }
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
