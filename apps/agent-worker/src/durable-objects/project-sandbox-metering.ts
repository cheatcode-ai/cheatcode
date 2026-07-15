import {
  createLogger,
  readBoundedResponseJson,
  safeErrorTelemetry,
} from "@cheatcode/observability";
import {
  QUOTA_FEATURES,
  QUOTA_TRACKER_MAX_RESPONSE_BYTES,
  QuotaPeriodEndSchema,
  QuotaRecordRequestSchema,
  QuotaUsageResponseSchema,
} from "@cheatcode/types/quota";
import { z } from "zod";

const SANDBOX_METER_STATE_KEY = "sandbox_meter_state";
const SANDBOX_QUOTA_PERIOD_END_KEY = "sandbox_quota_period_end";
const MILLIS_PER_HOUR = 60 * 60 * 1_000;
const MILLIS_PER_DAY = 24 * MILLIS_PER_HOUR;

const TimestampSchema = z.number().int().nonnegative().finite();
const AccrualSchema = z
  .object({
    amountMs: z.number().int().positive().finite(),
    periodEnd: QuotaPeriodEndSchema,
    recordedAtMs: TimestampSchema,
  })
  .strict();
const PendingAccrualSchema = AccrualSchema.extend({ eventId: z.string().min(1).max(200) }).strict();
const MeterStateSchema = z
  .object({
    accruals: z.array(AccrualSchema),
    active: z.boolean(),
    checkpointMs: TimestampSchema.nullable(),
    pending: PendingAccrualSchema.nullable(),
  })
  .strict();

type Accrual = z.infer<typeof AccrualSchema>;
type MeterState = z.infer<typeof MeterStateSchema>;
type PendingAccrual = z.infer<typeof PendingAccrualSchema>;

interface SandboxMeteringEnv {
  QUOTA_TRACKER: DurableObjectNamespace;
}

export interface SandboxMeteringContext {
  env: SandboxMeteringEnv;
  ownerUserId: string | null;
  sandboxId: string;
  storage: DurableObjectStorage;
}

/** Begin or join an active run interval, preserving any unflushed prior accrual. */
export async function beginSandboxUsageBestEffort(ctx: SandboxMeteringContext): Promise<void> {
  await meterBestEffort(ctx, "begin");
}

/** Capture elapsed active time and flush the durable outbox to QuotaTracker. */
export async function recordSandboxUsageBestEffort(ctx: SandboxMeteringContext): Promise<void> {
  await meterBestEffort(ctx, "record");
}

/** Close the active interval at a fixed instant so later retries never bill idle time. */
export async function finalizeSandboxUsageBestEffort(ctx: SandboxMeteringContext): Promise<void> {
  await meterBestEffort(ctx, "finalize");
}

/** Explicit cleanup after the underlying sandbox is permanently destroyed. */
export async function clearSandboxMeterState(storage: DurableObjectStorage): Promise<void> {
  await storage.delete(SANDBOX_METER_STATE_KEY);
}

/** Store the entitlement-resolved period before a run is allowed to start. */
export async function setSandboxQuotaPeriod(
  storage: DurableObjectStorage,
  periodEndIso: string,
): Promise<void> {
  const nextPeriodEnd = QuotaPeriodEndSchema.parse(periodEndIso);
  const now = Date.now();
  await storage.transaction(async (transaction) => {
    const state = await readMeterState(transaction);
    const currentPeriodEnd = await storedQuotaPeriodEnd(transaction);
    if (state.active && state.checkpointMs !== null && now > state.checkpointMs) {
      accrueInterval(state.accruals, state.checkpointMs, now, currentPeriodEnd);
      state.checkpointMs = now;
      await transaction.put(SANDBOX_METER_STATE_KEY, state);
    }
    await transaction.put(SANDBOX_QUOTA_PERIOD_END_KEY, nextPeriodEnd);
  });
}

async function meterBestEffort(
  ctx: SandboxMeteringContext,
  transition: "begin" | "finalize" | "record",
): Promise<void> {
  if (!ctx.ownerUserId) {
    return;
  }
  try {
    const now = Date.now();
    const periodEnd = await storedQuotaPeriodEnd(ctx.storage);
    await captureTransition(ctx.storage, transition, now, periodEnd);
    await flushAccruals(ctx);
  } catch (error) {
    logMeterFailure(ctx.sandboxId, error);
  }
}

async function captureTransition(
  storage: DurableObjectStorage,
  transition: "begin" | "finalize" | "record",
  now: number,
  periodEnd: Date,
): Promise<void> {
  await storage.transaction(async (transaction) => {
    const state = await readMeterState(transaction);
    if (state.active && state.checkpointMs !== null && now > state.checkpointMs) {
      accrueInterval(state.accruals, state.checkpointMs, now, periodEnd);
    }
    applyTransition(state, transition, now);
    if (hasMeterState(state)) {
      await transaction.put(SANDBOX_METER_STATE_KEY, state);
    } else {
      await transaction.delete(SANDBOX_METER_STATE_KEY);
    }
  });
}

function applyTransition(
  state: MeterState,
  transition: "begin" | "finalize" | "record",
  now: number,
): void {
  if (transition === "begin") {
    state.active = true;
    state.checkpointMs = now;
    return;
  }
  if (transition === "finalize") {
    state.active = false;
    state.checkpointMs = null;
    return;
  }
  if (state.active) {
    state.checkpointMs = now;
  }
}

function accrueInterval(accruals: Accrual[], startMs: number, endMs: number, period: Date): void {
  let cursor = startMs;
  let periodEnd = periodAfter(period, cursor);
  while (cursor < endMs) {
    const dayEnd = (Math.floor(cursor / MILLIS_PER_DAY) + 1) * MILLIS_PER_DAY;
    const segmentEnd = Math.min(endMs, dayEnd, periodEnd.getTime());
    addAccrual(accruals, {
      amountMs: segmentEnd - cursor,
      periodEnd: periodEnd.toISOString(),
      recordedAtMs: Math.floor(cursor / MILLIS_PER_DAY) * MILLIS_PER_DAY,
    });
    cursor = segmentEnd;
    if (cursor >= periodEnd.getTime()) {
      periodEnd = nextMonthlyPeriodEnd(periodEnd);
    }
  }
}

function addAccrual(accruals: Accrual[], next: Accrual): void {
  const existing = accruals.find(
    (item) => item.periodEnd === next.periodEnd && item.recordedAtMs === next.recordedAtMs,
  );
  if (existing) {
    existing.amountMs += next.amountMs;
  } else {
    accruals.push(next);
  }
}

async function flushAccruals(ctx: SandboxMeteringContext): Promise<void> {
  if (!ctx.ownerUserId) {
    return;
  }
  for (;;) {
    const pending = await stageNextAccrual(ctx.storage, ctx.sandboxId);
    if (!pending) {
      return;
    }
    await sendAccrual(ctx.env.QUOTA_TRACKER, ctx.ownerUserId, pending);
    await acknowledgeAccrual(ctx.storage, pending.eventId);
  }
}

async function stageNextAccrual(
  storage: DurableObjectStorage,
  sandboxId: string,
): Promise<PendingAccrual | null> {
  return storage.transaction(async (transaction) => {
    const state = await readMeterState(transaction);
    if (state.pending) {
      return state.pending;
    }
    const next = state.accruals.shift();
    if (!next) {
      return null;
    }
    state.pending = { ...next, eventId: `sandbox:${sandboxId}:${crypto.randomUUID()}` };
    await transaction.put(SANDBOX_METER_STATE_KEY, state);
    return state.pending;
  });
}

async function sendAccrual(
  namespace: DurableObjectNamespace,
  ownerUserId: string,
  pending: PendingAccrual,
): Promise<void> {
  const stub = namespace.get(namespace.idFromName(`quota:${ownerUserId}`));
  const body = QuotaRecordRequestSchema.parse({
    amount: pending.amountMs / MILLIS_PER_HOUR,
    eventId: pending.eventId,
    feature: QUOTA_FEATURES.sandboxHours,
    periodEnd: pending.periodEnd,
    recordedAt: new Date(pending.recordedAtMs).toISOString(),
  });
  const response = await stub.fetch("https://quota.internal/record", {
    body: JSON.stringify(body),
    method: "POST",
  });
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error(`QuotaTracker record failed with HTTP ${response.status}`);
  }
  QuotaUsageResponseSchema.parse(
    await readBoundedResponseJson(response, QUOTA_TRACKER_MAX_RESPONSE_BYTES, "Quota record"),
  );
}

async function acknowledgeAccrual(storage: DurableObjectStorage, eventId: string): Promise<void> {
  await storage.transaction(async (transaction) => {
    const state = await readMeterState(transaction);
    if (state.pending?.eventId !== eventId) {
      return;
    }
    state.pending = null;
    if (hasMeterState(state)) {
      await transaction.put(SANDBOX_METER_STATE_KEY, state);
    } else {
      await transaction.delete(SANDBOX_METER_STATE_KEY);
    }
  });
}

async function readMeterState(storage: {
  get<T = unknown>(key: string): Promise<T | undefined>;
}): Promise<MeterState> {
  const parsed = MeterStateSchema.safeParse(await storage.get(SANDBOX_METER_STATE_KEY));
  return parsed.success
    ? parsed.data
    : { accruals: [], active: false, checkpointMs: null, pending: null };
}

function hasMeterState(state: MeterState): boolean {
  return state.active || state.accruals.length > 0 || state.pending !== null;
}

async function storedQuotaPeriodEnd(storage: {
  get<T = unknown>(key: string): Promise<T | undefined>;
}): Promise<Date> {
  const parsed = QuotaPeriodEndSchema.safeParse(await storage.get(SANDBOX_QUOTA_PERIOD_END_KEY));
  return parsed.success ? new Date(parsed.data) : firstOfNextUtcMonth(new Date());
}

function periodAfter(period: Date, timestampMs: number): Date {
  let candidate = period;
  while (candidate.getTime() <= timestampMs) {
    candidate = nextMonthlyPeriodEnd(candidate);
  }
  return candidate;
}

function nextMonthlyPeriodEnd(current: Date): Date {
  const nextMonthStart = new Date(
    Date.UTC(
      current.getUTCFullYear(),
      current.getUTCMonth() + 1,
      1,
      current.getUTCHours(),
      current.getUTCMinutes(),
      current.getUTCSeconds(),
      current.getUTCMilliseconds(),
    ),
  );
  const daysInNextMonth = new Date(
    Date.UTC(nextMonthStart.getUTCFullYear(), nextMonthStart.getUTCMonth() + 1, 0),
  ).getUTCDate();
  return new Date(
    Date.UTC(
      nextMonthStart.getUTCFullYear(),
      nextMonthStart.getUTCMonth(),
      Math.min(current.getUTCDate(), daysInNextMonth),
      current.getUTCHours(),
      current.getUTCMinutes(),
      current.getUTCSeconds(),
      current.getUTCMilliseconds(),
    ),
  );
}

function firstOfNextUtcMonth(current: Date): Date {
  return new Date(Date.UTC(current.getUTCFullYear(), current.getUTCMonth() + 1, 1));
}

function logMeterFailure(sandboxId: string, error: unknown): void {
  createLogger().warn("sandbox_usage_meter_failed", {
    sandboxId,
    ...safeErrorTelemetry(error),
  });
}
