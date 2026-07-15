import { z } from "zod";

export const QUOTA_FEATURES = {
  composioCalls: "composio_calls",
  sandboxHours: "sandbox_hours",
} as const;

export const QUOTA_TRACKER_MAX_REQUEST_BYTES = 16 * 1024;
export const QUOTA_TRACKER_MAX_RESPONSE_BYTES = 16 * 1024;

export const QuotaFeatureSchema = z.enum([
  QUOTA_FEATURES.composioCalls,
  QUOTA_FEATURES.sandboxHours,
]);

export const QuotaPeriodEndSchema = z.string().datetime();
const QuotaEventIdSchema = z.string().trim().min(1).max(200);
export const QuotaLimitSchema = z.number().finite().nonnegative();
const QuotaEntitlementVersionSchema = z.number().int().nonnegative();
const QuotaAmountSchema = z.number().finite().positive();

export const QuotaSetLimitRequestSchema = z
  .object({
    entitlementVersion: QuotaEntitlementVersionSchema,
    feature: QuotaFeatureSchema,
    limit: QuotaLimitSchema,
  })
  .strict();

export const QuotaSetLimitResponseSchema = z.object({ ok: z.literal(true) }).strict();

export const QuotaPeekRequestSchema = z
  .object({
    feature: QuotaFeatureSchema,
    periodEnd: QuotaPeriodEndSchema,
  })
  .strict();

export const QuotaUsageResponseSchema = z
  .object({
    limit: QuotaLimitSchema,
    remaining: z.number().finite().nonnegative(),
    used: z.number().finite().nonnegative(),
  })
  .strict();

export const QuotaTryConsumeRequestSchema = z
  .object({
    amount: QuotaAmountSchema,
    eventId: QuotaEventIdSchema,
    feature: QuotaFeatureSchema,
    periodEnd: QuotaPeriodEndSchema,
  })
  .strict();

export const QuotaTryConsumeResponseSchema = z
  .object({
    allowed: z.boolean(),
    limit: QuotaLimitSchema,
    remaining: z.number().finite().nonnegative(),
  })
  .strict();

export const QuotaRecordRequestSchema = QuotaTryConsumeRequestSchema.extend({
  recordedAt: z.string().datetime(),
}).strict();

export type QuotaFeature = z.infer<typeof QuotaFeatureSchema>;
export type QuotaUsageResponse = z.infer<typeof QuotaUsageResponseSchema>;
export type QuotaTryConsumeResponse = z.infer<typeof QuotaTryConsumeResponseSchema>;
