import { type BillingTier, billingTierRank, type PlanSummary } from "@cheatcode/types";

export function isBillingUpgrade(targetTier: BillingTier, currentTier: BillingTier): boolean {
  return billingTierRank(targetTier) > billingTierRank(currentTier);
}

export function canCheckoutPlan(plan: PlanSummary, currentTier: BillingTier): boolean {
  return plan.available && isBillingUpgrade(plan.id, currentTier);
}
