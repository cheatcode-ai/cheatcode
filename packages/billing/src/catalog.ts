import type { BillingTier } from "./index";

/**
 * Single source of truth for plan tier id, display name, monthly price, the
 * user-facing sandbox-hour allowance, and every operational TierLimits field.
 * `TIER_LIMITS` / `entitlementValuesForTier` in ./index derive from this.
 *
 * Design pins price + sandbox hours only (15f/07b/14b/19b). Every other cap is
 * a DECIDED monotonic scale by tier (flagged assumption, not a blocker).
 * Pro rises 50 -> 60 sandbox hours and $20 -> $25: flagged product sign-off.
 * There is no "credits" unit and no `credits = hours * N` mapping anywhere.
 */
export interface PlanCatalogEntry {
  byokProviderSlots: number | null;
  dailyCostCapUsd: number | null;
  displayName: string;
  id: BillingTier;
  maxConcurrentSandboxes: number;
  maxProjects: number | null;
  maxSeats: number;
  priceUsdMonthly: number;
  quotaComposioCalls: number | null;
  quotaDeployments: number | null;
  researchFanoutSubagents: number | null;
  sandboxHours: number;
}

export type SandboxUsageWarnLevel = "none" | "warn80" | "warn95" | "exhausted";

export const PLAN_CATALOG = {
  free: {
    byokProviderSlots: 3,
    dailyCostCapUsd: 10,
    displayName: "Free",
    id: "free",
    maxConcurrentSandboxes: 1,
    maxProjects: 3,
    maxSeats: 1,
    priceUsdMonthly: 0,
    quotaComposioCalls: 1_000,
    quotaDeployments: 5,
    researchFanoutSubagents: 3,
    sandboxHours: 5,
  },
  pro: {
    byokProviderSlots: 10,
    dailyCostCapUsd: 50,
    displayName: "Pro",
    id: "pro",
    maxConcurrentSandboxes: 3,
    maxProjects: 25,
    maxSeats: 1,
    priceUsdMonthly: 25,
    quotaComposioCalls: 20_000,
    quotaDeployments: 100,
    researchFanoutSubagents: 10,
    sandboxHours: 60,
  },
  premium: {
    byokProviderSlots: null,
    dailyCostCapUsd: 100,
    displayName: "Premium",
    id: "premium",
    maxConcurrentSandboxes: 5,
    maxProjects: 50,
    maxSeats: 1,
    priceUsdMonthly: 50,
    quotaComposioCalls: 50_000,
    quotaDeployments: 250,
    researchFanoutSubagents: 15,
    sandboxHours: 140,
  },
  ultra: {
    byokProviderSlots: null,
    dailyCostCapUsd: 200,
    displayName: "Ultra",
    id: "ultra",
    maxConcurrentSandboxes: 10,
    maxProjects: 100,
    maxSeats: 1,
    priceUsdMonthly: 99,
    quotaComposioCalls: 100_000,
    quotaDeployments: null,
    researchFanoutSubagents: 25,
    sandboxHours: 320,
  },
  max: {
    byokProviderSlots: null,
    dailyCostCapUsd: null,
    displayName: "Max",
    id: "max",
    maxConcurrentSandboxes: 20,
    maxProjects: null,
    maxSeats: 1,
    priceUsdMonthly: 200,
    quotaComposioCalls: null,
    quotaDeployments: null,
    researchFanoutSubagents: 25,
    sandboxHours: 800,
  },
} as const satisfies Record<BillingTier, PlanCatalogEntry>;

/** Tier ids ordered weakest -> strongest (free < pro < premium < ultra < max). */
export const TIER_ORDER = [
  "free",
  "pro",
  "premium",
  "ultra",
  "max",
] as const satisfies readonly BillingTier[];

/** Paid tiers only (checkout-eligible), ordered weakest -> strongest. */
export const PAID_TIERS = [
  "pro",
  "premium",
  "ultra",
  "max",
] as const satisfies readonly BillingTier[];

/** Rank a tier by its position in TIER_ORDER; unknown/undefined ranks below free (-1). */
export function tierRank(tier: string | undefined): number {
  if (tier === undefined) {
    return -1;
  }
  return (TIER_ORDER as readonly string[]).indexOf(tier);
}

/** The tier's user-facing sandbox-hour allowance (the usage-meter denominator). */
export function sandboxHoursForTier(tier: BillingTier): number {
  return PLAN_CATALOG[tier].sandboxHours;
}

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
 * Canonical period-end for every sandbox_hours QuotaTracker read/write (§2.6).
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
