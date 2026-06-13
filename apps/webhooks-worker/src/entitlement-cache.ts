import { entitlementCacheFromValues } from "@cheatcode/billing";
import { type Database, findEntitlementByUserId } from "@cheatcode/db";
import type { UserId } from "@cheatcode/types";

const ENTITLEMENT_CACHE_TTL_SECONDS = 300;

export async function refreshEntitlementCache(
  db: Database,
  cache: KVNamespace,
  userId: UserId,
): Promise<void> {
  const row = await findEntitlementByUserId(db, userId);
  const payload = entitlementCacheFromValues(row ?? { tier: "free" });
  await cache.put(`entitlement:${userId}`, JSON.stringify(payload), {
    expirationTtl: ENTITLEMENT_CACHE_TTL_SECONDS,
  });
}
