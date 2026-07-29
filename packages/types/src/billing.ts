import { z } from "zod";

/** Billing tiers ordered from the least to the most capable plan. */
export const BILLING_TIERS = ["free", "pro", "premium"] as const;

export const BillingTierSchema = z.enum(BILLING_TIERS);
export const PaidBillingTierSchema = BillingTierSchema.exclude(["free"]);

/** Rank a tier by product order; invalid or absent tiers sort below `free`. */
export function billingTierRank(tier: string | undefined): number {
  return tier === undefined ? -1 : (BILLING_TIERS as readonly string[]).indexOf(tier);
}

const BillingReturnPathSchema = z
  .string()
  .min(1)
  .max(2_000)
  .refine(isSafeAppPath, "Billing return path must be a local application path.");

export const BillingCheckoutSchema = z.strictObject({
  returnPath: BillingReturnPathSchema.optional(),
  tier: PaidBillingTierSchema,
});

function isSafeAppPath(value: string): boolean {
  if (!value.startsWith("/") || value.startsWith("//") || value.includes("\\")) {
    return false;
  }
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (codePoint !== undefined && (codePoint < 32 || codePoint === 127)) {
      return false;
    }
  }
  const base = "https://app.invalid";
  try {
    return new URL(value, base).origin === base;
  } catch {
    return false;
  }
}

const BillingCancellationReasonSchema = z.enum([
  "too_expensive",
  "missing_features",
  "switched_service",
  "unused",
  "customer_service",
  "low_quality",
  "too_complex",
  "other",
]);

export const BillingCancelSchema = z.strictObject({
  comment: z.string().trim().max(1_000).optional(),
  reason: BillingCancellationReasonSchema.optional(),
});

export const BillingStateResponseSchema = z.strictObject({
  cancelAtPeriodEnd: z.boolean(),
  canCancel: z.boolean(),
  canReactivate: z.boolean(),
  currentPeriodEnd: z.string().datetime().nullable(),
  currentPeriodStart: z.string().datetime().nullable(),
  subscriptionStatus: z.string(),
  tier: BillingTierSchema,
});

export const BillingSubscriptionActionResponseSchema = z.strictObject({
  cancelAtPeriodEnd: z.boolean(),
  currentPeriodEnd: z.string().datetime().nullable(),
  currentPeriodStart: z.string().datetime().nullable(),
  status: z.string(),
});

export const BillingUrlResponseSchema = z.strictObject({ url: z.string().url() });
const SandboxUsageWarnLevelSchema = z.enum(["none", "warn80", "warn95", "exhausted"]);

export const SandboxUsageSummaryResponseSchema = z.strictObject({
  resetAt: z.string().datetime(),
  sandboxHoursTotal: z.number().nonnegative(),
  sandboxHoursUsed: z.number().nonnegative(),
  tier: BillingTierSchema,
  warnLevel: SandboxUsageWarnLevelSchema,
});

const PlanSummarySchema = z.strictObject({
  available: z.boolean(),
  current: z.boolean(),
  displayName: z.string(),
  id: BillingTierSchema,
  limits: z.strictObject({
    maxProjects: z.number().int().positive().nullable(),
    quotaComposioCalls: z.number().int().positive().nullable(),
  }),
  monthlyPriceUsd: z.number().nonnegative(),
  sandboxHoursPerMonth: z.number().positive(),
});

export const BillingCatalogResponseSchema = z.strictObject({
  currentTier: BillingTierSchema,
  plans: z.array(PlanSummarySchema),
});

export type BillingCancel = z.infer<typeof BillingCancelSchema>;
export type BillingCancellationReason = z.infer<typeof BillingCancellationReasonSchema>;
export type BillingCatalogResponse = z.infer<typeof BillingCatalogResponseSchema>;
export type BillingCheckout = z.infer<typeof BillingCheckoutSchema>;
export type BillingStateResponse = z.infer<typeof BillingStateResponseSchema>;
export type BillingSubscriptionActionResponse = z.infer<
  typeof BillingSubscriptionActionResponseSchema
>;
export type BillingTier = z.infer<typeof BillingTierSchema>;
export type PaidBillingTier = z.infer<typeof PaidBillingTierSchema>;
export type PlanSummary = z.infer<typeof PlanSummarySchema>;
export type SandboxUsageSummaryResponse = z.infer<typeof SandboxUsageSummaryResponseSchema>;
export type SandboxUsageWarnLevel = z.infer<typeof SandboxUsageWarnLevelSchema>;
