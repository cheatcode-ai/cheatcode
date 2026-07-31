import { z } from "zod";
import type { UserId } from "./ids";

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

export const QuotaUsageResponseSchema = z.strictObject({
  limit: QuotaLimitSchema,
  remaining: z.number().finite().nonnegative(),
  used: z.number().finite().nonnegative(),
});

export const QuotaTryConsumeResponseSchema = z.strictObject({
  allowed: z.boolean(),
  limit: QuotaLimitSchema,
  remaining: z.number().finite().nonnegative(),
});

export const QuotaHistoryResultSchema = z.array(
  z.strictObject({ amount: z.number().positive(), recordedAt: z.number().int().nonnegative() }),
);

export const QuotaSnapshotResultSchema = z.partialRecord(
  QuotaFeatureSchema,
  z.strictObject({
    limit: QuotaLimitSchema,
    used: z.number().finite().nonnegative(),
  }),
);

export type QuotaFeature = z.infer<typeof QuotaFeatureSchema>;
export type QuotaHistoryResult = z.infer<typeof QuotaHistoryResultSchema>;
export type QuotaSnapshotResult = z.infer<typeof QuotaSnapshotResultSchema>;
export type QuotaUsageResponse = z.infer<typeof QuotaUsageResponseSchema>;
export type QuotaTryConsumeResponse = z.infer<typeof QuotaTryConsumeResponseSchema>;

/** Public RPC surface of the agent-owned QuotaTracker Durable Object. */
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

type UserScopedQuotaTrackerMethod<Method extends keyof QuotaTrackerRpc> =
  QuotaTrackerRpc[Method] extends (...args: infer Args) => infer Result
    ? (userId: UserId, ...args: Args) => Result
    : never;

/**
 * A capability-scoped WorkerEntrypoint projection of selected QuotaTracker
 * methods. The user id selects the owning Durable Object; method arguments and
 * results remain derived from the single QuotaTrackerRpc contract.
 */
type UserScopedQuotaTrackerRpc<Methods extends keyof QuotaTrackerRpc> = {
  [Method in Methods]: UserScopedQuotaTrackerMethod<Method>;
};

export type GatewayQuotaServiceBinding = UserScopedQuotaTrackerRpc<"history" | "peek" | "setLimit">;

export type QuotaDeletionServiceBinding = UserScopedQuotaTrackerRpc<"deleteAllState">;
