import { z } from "zod";

export const QUOTA_FEATURES = {
  composioCalls: "composio_calls",
  sandboxHours: "sandbox_hours",
} as const;

export const QuotaFeatureSchema = z.enum([
  QUOTA_FEATURES.composioCalls,
  QUOTA_FEATURES.sandboxHours,
]);

export const QuotaPeriodEndSchema = z.string().datetime();
const QuotaLimitSchema = z.number().finite().nonnegative();

export const QuotaUsageResponseSchema = z
  .object({
    limit: QuotaLimitSchema,
    remaining: z.number().finite().nonnegative(),
    used: z.number().finite().nonnegative(),
  })
  .strict();

export const QuotaTryConsumeResponseSchema = z
  .object({
    allowed: z.boolean(),
    limit: QuotaLimitSchema,
    remaining: z.number().finite().nonnegative(),
  })
  .strict();

export const QuotaHistoryResultSchema = z.array(
  z.object({ amount: z.number().positive(), recordedAt: z.number().int().nonnegative() }).strict(),
);

export const QuotaSnapshotResultSchema = z.partialRecord(
  QuotaFeatureSchema,
  z
    .object({
      limit: QuotaLimitSchema,
      used: z.number().finite().nonnegative(),
    })
    .strict(),
);

export type QuotaFeature = z.infer<typeof QuotaFeatureSchema>;
export type QuotaHistoryResult = z.infer<typeof QuotaHistoryResultSchema>;
export type QuotaSnapshotResult = z.infer<typeof QuotaSnapshotResultSchema>;
export type QuotaUsageResponse = z.infer<typeof QuotaUsageResponseSchema>;
export type QuotaTryConsumeResponse = z.infer<typeof QuotaTryConsumeResponseSchema>;

/** Cross-script public surface of the gateway-owned QuotaTracker Durable Object. */
export interface QuotaTrackerRpc {
  deleteAllState(): Promise<void>;
  history(feature: QuotaFeature, from: Date): Promise<QuotaHistoryResult>;
  peek(feature: QuotaFeature, periodEnd: Date): Promise<QuotaUsageResponse>;
  record(
    feature: QuotaFeature,
    amount: number,
    periodEnd: Date,
    eventId: string,
    recordedAt: Date,
  ): Promise<QuotaUsageResponse>;
  setLimit(feature: QuotaFeature, limit: number, entitlementVersion: number): Promise<void>;
  snapshot(periodEnd: Date): Promise<QuotaSnapshotResult>;
  tryConsume(
    feature: QuotaFeature,
    amount: number,
    periodEnd: Date,
    eventId: string,
  ): Promise<QuotaTryConsumeResponse>;
}
