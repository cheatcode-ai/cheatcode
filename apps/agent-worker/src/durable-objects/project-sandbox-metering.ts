import { createLogger, normalizeUnknownError } from "@cheatcode/observability";
import { z } from "zod";

const SANDBOX_HOURS_FEATURE = "sandbox_hours";
const SANDBOX_METER_CHECKPOINT_KEY = "sandbox_meter_checkpoint_ms";
const SANDBOX_QUOTA_PERIOD_END_KEY = "sandbox_quota_period_end";
const MILLIS_PER_HOUR = 60 * 60 * 1_000;

const QuotaPeriodEndSchema = z.string().datetime();

interface SandboxMeteringEnv {
  QUOTA_TRACKER?: DurableObjectNamespace;
}

export interface SandboxMeteringContext {
  env: SandboxMeteringEnv;
  ownerUserId: string | null;
  sandboxId: string;
  storage: DurableObjectStorage;
}

/**
 * Seed the metering checkpoint when a run lease opens (idempotent). Lifecycle-aware
 * (Codex R1): the checkpoint exists ONLY while ≥1 run lease is active, so we accrue
 * running-hours during agent runs and never bill idle/stopped time.
 */
export async function initSandboxMeterCheckpoint(storage: DurableObjectStorage): Promise<void> {
  if ((await meterCheckpointMs(storage)) === null) {
    await storage.put(SANDBOX_METER_CHECKPOINT_KEY, Date.now());
  }
}

/** Drop the metering checkpoint when the last run lease closes / sandbox destroyed. */
export async function clearSandboxMeterCheckpoint(storage: DurableObjectStorage): Promise<void> {
  await storage.delete(SANDBOX_METER_CHECKPOINT_KEY);
}

/**
 * Persist the entitlement-resolved sandbox_hours period end (§2.6) so the metering
 * writer keys usage into the same bucket the gateway/run-gate read from.
 */
export async function setSandboxQuotaPeriod(
  storage: DurableObjectStorage,
  periodEndIso: string,
): Promise<void> {
  await storage.put(SANDBOX_QUOTA_PERIOD_END_KEY, QuotaPeriodEndSchema.parse(periodEndIso));
}

export async function recordSandboxUsageBestEffort(ctx: SandboxMeteringContext): Promise<void> {
  try {
    await recordSandboxUsage(ctx);
  } catch (error) {
    const normalized = normalizeUnknownError(error, "Sandbox usage metering failed.");
    createLogger().warn("sandbox_usage_meter_failed", {
      details: normalized.details,
      error: normalized.message,
      sandboxId: ctx.sandboxId,
    });
  }
}

async function recordSandboxUsage(ctx: SandboxMeteringContext): Promise<void> {
  const quotaTracker = ctx.env.QUOTA_TRACKER;
  if (!ctx.ownerUserId || !quotaTracker) {
    return;
  }
  const previousCheckpointMs = await meterCheckpointMs(ctx.storage);
  const now = Date.now();
  if (previousCheckpointMs === null) {
    // No active run lease → not running on our behalf → do not accrue (lifecycle-aware).
    return;
  }
  const hours = (now - previousCheckpointMs) / MILLIS_PER_HOUR;
  if (hours <= 0) {
    return;
  }
  const periodEnd = (await storedQuotaPeriodEnd(ctx.storage)) ?? nextQuotaPeriodEnd();
  const stub = quotaTracker.get(quotaTracker.idFromName(`quota:${ctx.ownerUserId}`));
  const response = await stub.fetch("https://quota.internal/record", {
    body: JSON.stringify({
      amount: hours,
      feature: SANDBOX_HOURS_FEATURE,
      periodEnd: periodEnd.toISOString(),
    }),
    method: "POST",
  });
  if (!response.ok) {
    throw new Error(`QuotaTracker record failed with HTTP ${response.status}`);
  }
  await ctx.storage.put(SANDBOX_METER_CHECKPOINT_KEY, now);
}

async function meterCheckpointMs(storage: DurableObjectStorage): Promise<number | null> {
  const value = await storage.get(SANDBOX_METER_CHECKPOINT_KEY);
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

async function storedQuotaPeriodEnd(storage: DurableObjectStorage): Promise<Date | null> {
  const value = await storage.get(SANDBOX_QUOTA_PERIOD_END_KEY);
  if (typeof value !== "string") {
    return null;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function nextQuotaPeriodEnd(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
}
