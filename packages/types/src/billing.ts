import { z } from "zod";

/** Billing tiers ordered from the least to the most capable plan. */
export const BILLING_TIERS = ["free", "pro", "premium", "ultra", "max"] as const;

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

export const BillingCheckoutSchema = z
  .object({
    returnPath: BillingReturnPathSchema.optional(),
    tier: PaidBillingTierSchema,
  })
  .strict();

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

export const BillingCancelSchema = z
  .object({
    comment: z.string().trim().max(1_000).optional(),
    reason: BillingCancellationReasonSchema.optional(),
  })
  .strict();

export const BillingStateResponseSchema = z
  .object({
    cancelAtPeriodEnd: z.boolean(),
    canCancel: z.boolean(),
    canReactivate: z.boolean(),
    currentPeriodEnd: z.string().datetime().nullable(),
    currentPeriodStart: z.string().datetime().nullable(),
    subscriptionStatus: z.string(),
    tier: BillingTierSchema,
  })
  .strict();

export const BillingSubscriptionActionResponseSchema = z
  .object({
    cancelAtPeriodEnd: z.boolean(),
    currentPeriodEnd: z.string().datetime().nullable(),
    currentPeriodStart: z.string().datetime().nullable(),
    status: z.string(),
  })
  .strict();

export const BillingUrlResponseSchema = z.object({ url: z.string().url() }).strict();
const SandboxUsageWarnLevelSchema = z.enum(["none", "warn80", "warn95", "exhausted"]);

export const SandboxUsageSummaryResponseSchema = z
  .object({
    resetAt: z.string().datetime(),
    sandboxHoursTotal: z.number().nonnegative(),
    sandboxHoursUsed: z.number().nonnegative(),
    tier: BillingTierSchema,
    warnLevel: SandboxUsageWarnLevelSchema,
  })
  .strict();

const PlanSummarySchema = z
  .object({
    available: z.boolean(),
    current: z.boolean(),
    displayName: z.string(),
    id: BillingTierSchema,
    limits: z
      .object({
        maxProjects: z.number().int().positive().nullable(),
        quotaComposioCalls: z.number().int().positive().nullable(),
      })
      .strict(),
    monthlyPriceUsd: z.number().nonnegative(),
    sandboxHoursPerMonth: z.number().positive(),
  })
  .strict();

export const BillingCatalogResponseSchema = z
  .object({
    currentTier: BillingTierSchema,
    plans: z.array(PlanSummarySchema),
  })
  .strict();

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
