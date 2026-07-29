import { DurableObject } from "cloudflare:workers";
import { QuotaTrackerRuntime } from "@cheatcode/billing/quota-runtime";
import type {
  QuotaFeature,
  QuotaHistoryResult,
  QuotaSnapshotResult,
  QuotaTryConsumeResponse,
  QuotaUsageResponse,
} from "@cheatcode/types/quota";

/** Gateway-owned Durable Object facade over the worker-only billing runtime. */
export class QuotaTracker extends DurableObject<unknown> {
  private readonly runtime: QuotaTrackerRuntime;

  public constructor(ctx: DurableObjectState, env: unknown) {
    super(ctx, env);
    this.runtime = new QuotaTrackerRuntime(ctx);
  }

  public tryConsume(
    feature: QuotaFeature,
    amount: number,
    periodEnd: Date,
    eventId: string,
  ): Promise<QuotaTryConsumeResponse> {
    return this.runtime.tryConsume(feature, amount, periodEnd, eventId);
  }

  public peek(feature: QuotaFeature, periodEnd: Date): Promise<QuotaUsageResponse> {
    return this.runtime.peek(feature, periodEnd);
  }

  public record(
    feature: QuotaFeature,
    amount: number,
    periodEnd: Date,
    eventId: string,
    recordedAt: Date,
  ): Promise<QuotaUsageResponse> {
    return this.runtime.record(feature, amount, periodEnd, eventId, recordedAt);
  }

  public history(feature: QuotaFeature, from: Date): Promise<QuotaHistoryResult> {
    return this.runtime.history(feature, from);
  }

  public setLimit(feature: QuotaFeature, limit: number, entitlementVersion: number): Promise<void> {
    return this.runtime.setLimit(feature, limit, entitlementVersion);
  }

  public deleteAllState(): Promise<void> {
    return this.runtime.deleteAllState();
  }

  public snapshot(periodEnd: Date): Promise<QuotaSnapshotResult> {
    return this.runtime.snapshot(periodEnd);
  }

  public override alarm(): Promise<void> {
    return this.runtime.alarm();
  }
}
