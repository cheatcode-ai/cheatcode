import type { BillingTier } from "@cheatcode/types/billing";

/**
 * Single source of truth for plan tier id, display name, monthly price, the
 * user-facing sandbox-hour allowance, and every operational `TierLimits` field.
 * `TIER_LIMITS` / `entitlementValuesForTier` in ./index derive from this.
 *
 * Sandbox tenancy is a product invariant: every account has one shared private
 * computer, so it is not represented as a plan entitlement.
 * Pro rises 50 -> 60 sandbox hours and $20 -> $25: flagged product sign-off.
 * There is no "credits" unit and no `credits = hours * N` mapping anywhere.
 */
export interface PlanCatalogEntry {
  displayName: string;
  id: BillingTier;
  maxProjects: number | null;
  priceUsdMonthly: number;
  quotaComposioCalls: number | null;
  sandboxHours: number;
}

type SandboxUsageWarnLevel = "none" | "warn80" | "warn95" | "exhausted";

export const PLAN_CATALOG = {
  free: {
    displayName: "Free",
    id: "free",
    maxProjects: 3,
    priceUsdMonthly: 0,
    quotaComposioCalls: 1_000,
    sandboxHours: 5,
  },
  pro: {
    displayName: "Pro",
    id: "pro",
    maxProjects: 25,
    priceUsdMonthly: 25,
    quotaComposioCalls: 20_000,
    sandboxHours: 60,
  },
  premium: {
    displayName: "Premium",
    id: "premium",
    maxProjects: 50,
    priceUsdMonthly: 50,
    quotaComposioCalls: 50_000,
    sandboxHours: 140,
  },
  ultra: {
    displayName: "Ultra",
    id: "ultra",
    maxProjects: 100,
    priceUsdMonthly: 99,
    quotaComposioCalls: 100_000,
    sandboxHours: 320,
  },
  max: {
    displayName: "Max",
    id: "max",
    maxProjects: null,
    priceUsdMonthly: 200,
    quotaComposioCalls: null,
    sandboxHours: 800,
  },
} as const satisfies Record<BillingTier, PlanCatalogEntry>;

/** Map used/total sandbox hours onto the warn ladder (>=1 exhausted, >=0.95, >=0.8). */
export function sandboxHoursWarnLevel(
  usedHours: number,
  totalHours: number,
): SandboxUsageWarnLevel {
  if (!(totalHours > 0)) {
    return "none";
  }
  const ratio = usedHours / totalHours;
  if (ratio >= 1) {
    return "exhausted";
  }
  if (ratio >= 0.95) {
    return "warn95";
  }
  if (ratio >= 0.8) {
    return "warn80";
  }
  return "none";
}

/**
 * Canonical period end for every sandbox-hours quota read and write.
 * Uses the subscription's currentPeriodEnd when it is still in the future,
 * otherwise the first of the next UTC month (free-tier / lapsed fallback).
 */
export function quotaPeriodEndFor(entitlement: { currentPeriodEnd: string | null }): Date {
  const candidate = entitlement.currentPeriodEnd;
  if (candidate) {
    const end = new Date(candidate);
    if (!Number.isNaN(end.getTime()) && end.getTime() > Date.now()) {
      return end;
    }
  }
  return firstOfNextUtcMonth(new Date());
}

function firstOfNextUtcMonth(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
}
