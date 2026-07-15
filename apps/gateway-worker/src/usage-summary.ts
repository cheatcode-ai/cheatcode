import { quotaPeriodEndFor, sandboxHoursWarnLevel } from "@cheatcode/billing";
import type { Database } from "@cheatcode/db";
import { APIError, readBoundedResponseJson } from "@cheatcode/observability";
import {
  type SandboxUsageSummaryResponse,
  SandboxUsageSummaryResponseSchema,
  type UserId,
} from "@cheatcode/types";
import {
  QUOTA_FEATURES,
  QUOTA_TRACKER_MAX_RESPONSE_BYTES,
  QuotaPeekRequestSchema,
  QuotaUsageResponseSchema,
} from "@cheatcode/types/quota";
import { type LimitBindings, resolveEntitlement, syncQuotaLimits } from "./limits";

/**
 * Sandbox-hours usage summary. The entitlement allowance is the meter
 * denominator (`quotaSandboxHours`); the DO-stored limit is display-sync state,
 * never an input. QuotaTracker outage surfaces as 503 — no fabricated balances.
 */
export async function buildSandboxUsageSummary(
  env: LimitBindings,
  db: Database,
  userId: UserId,
): Promise<SandboxUsageSummaryResponse> {
  const entitlement = await resolveEntitlement(env, db, userId);
  await syncQuotaLimits(env, userId, entitlement);
  const periodEnd = quotaPeriodEndFor(entitlement);
  const sandboxHoursUsed = round1(await peekSandboxHoursUsed(env, userId, periodEnd));
  const sandboxHoursTotal = entitlement.quotaSandboxHours;
  return SandboxUsageSummaryResponseSchema.parse({
    resetAt: periodEnd.toISOString(),
    sandboxHoursTotal,
    sandboxHoursUsed,
    tier: entitlement.tier,
    warnLevel: sandboxHoursWarnLevel(sandboxHoursUsed, sandboxHoursTotal),
  });
}

async function peekSandboxHoursUsed(
  env: LimitBindings,
  userId: UserId,
  periodEnd: Date,
): Promise<number> {
  const stub = env.QUOTA_TRACKER.get(env.QUOTA_TRACKER.idFromName(`quota:${userId}`));
  const body = QuotaPeekRequestSchema.parse({
    feature: QUOTA_FEATURES.sandboxHours,
    periodEnd: periodEnd.toISOString(),
  });
  const response = await stub.fetch("https://quota.internal/peek", {
    body: JSON.stringify(body),
    method: "POST",
  });
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    throw new APIError(503, "unavailable_maintenance", "Quota tracker is unavailable", {
      hint: "Retry the request. If it persists, check the QuotaTracker Durable Object logs.",
      retriable: true,
    });
  }
  return QuotaUsageResponseSchema.parse(
    await readBoundedResponseJson(response, QUOTA_TRACKER_MAX_RESPONSE_BYTES, "Quota tracker"),
  ).used;
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}
