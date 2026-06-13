import { quotaPeriodEndFor, sandboxHoursWarnLevel } from "@cheatcode/billing";
import type { Database } from "@cheatcode/db";
import { APIError } from "@cheatcode/observability";
import {
  type SandboxUsageSummaryResponse,
  SandboxUsageSummaryResponseSchema,
  type UserId,
} from "@cheatcode/types";
import { QuotaPeekResultSchema } from "./durable-objects/quota-tracker-contract";
import { type LimitBindings, resolveEntitlement, syncQuotaLimits } from "./limits";

const SANDBOX_HOURS_FEATURE = "sandbox_hours";

/**
 * Sandbox-hours usage summary (§4.1). The entitlement allowance is the meter
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
  const response = await stub.fetch("https://quota.internal/peek", {
    body: JSON.stringify({ feature: SANDBOX_HOURS_FEATURE, periodEnd: periodEnd.toISOString() }),
    method: "POST",
  });
  if (!response.ok) {
    throw new APIError(503, "unavailable_maintenance", "Quota tracker is unavailable", {
      hint: "Retry the request. If it persists, check the QuotaTracker Durable Object logs.",
      retriable: true,
    });
  }
  return QuotaPeekResultSchema.parse(await response.json()).used;
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}
