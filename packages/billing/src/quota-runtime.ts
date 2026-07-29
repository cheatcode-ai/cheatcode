import { APIError } from "@cheatcode/observability";
import {
  type QuotaFeature,
  QuotaFeatureSchema,
  type QuotaHistoryResult,
  QuotaHistoryResultSchema,
  type QuotaSnapshotResult,
  QuotaSnapshotResultSchema,
  type QuotaTryConsumeResponse,
  QuotaTryConsumeResponseSchema,
  type QuotaUsageResponse,
  QuotaUsageResponseSchema,
} from "@cheatcode/types/quota";
import { z } from "zod";
import { nextQuotaTrackerAlarm, QUOTA_TRACKER_RETENTION_MS } from "./quota-runtime-retention";
import { ensureQuotaTrackerStorage, hasQuotaTrackerStorage } from "./quota-runtime-storage";

const QuotaDateSchema = z.date();
const QuotaAmountSchema = z.number().finite().positive();
const QuotaEventIdSchema = z.string().min(1).max(200);
const QuotaLimitSchema = z.number().finite().nonnegative();
const EntitlementVersionSchema = z.number().int().nonnegative();

const FeatureAndPeriodSchema = z.strictObject({
  feature: QuotaFeatureSchema,
  periodEnd: QuotaDateSchema,
});

const QuotaOperationSchema = z.strictObject({
  ...FeatureAndPeriodSchema.shape,
  amount: QuotaAmountSchema,
  eventId: QuotaEventIdSchema,
});

const QuotaRecordSchema = z.strictObject({
  ...QuotaOperationSchema.shape,
  recordedAt: QuotaDateSchema,
});

const QuotaHistorySchema = z.strictObject({
  feature: QuotaFeatureSchema,
  from: QuotaDateSchema,
});

const QuotaLimitInputSchema = z.strictObject({
  entitlementVersion: EntitlementVersionSchema,
  feature: QuotaFeatureSchema,
  limit: QuotaLimitSchema,
});

interface CounterRow {
  used: number;
}

interface LimitRow {
  feature: QuotaFeature;
  limit_val: number;
}

interface HistoryRow {
  amount: number;
  recorded_at: number;
}

interface OperationRow {
  allowed: number;
  amount: number;
  event_id: string;
  feature: string;
  limit_val: number;
  operation: string;
  period_key: string;
  remaining: number;
  used: number;
}

interface QuotaOperationInput {
  amount: number;
  eventId: string;
  feature: QuotaFeature;
  operation: "record" | "try-consume";
  periodKey: string;
}

function isCounterRow(value: unknown): value is CounterRow {
  return isRecord(value) && typeof value["used"] === "number";
}

function isLimitRow(value: unknown): value is LimitRow {
  return (
    isRecord(value) &&
    QuotaFeatureSchema.safeParse(value["feature"]).success &&
    typeof value["limit_val"] === "number"
  );
}

function isHistoryRow(value: unknown): value is HistoryRow {
  return (
    isRecord(value) &&
    typeof value["amount"] === "number" &&
    typeof value["recorded_at"] === "number"
  );
}

function isOperationRow(value: unknown): value is OperationRow {
  if (!isRecord(value)) {
    return false;
  }
  return (
    typeof value["allowed"] === "number" &&
    typeof value["amount"] === "number" &&
    typeof value["event_id"] === "string" &&
    typeof value["feature"] === "string" &&
    typeof value["limit_val"] === "number" &&
    typeof value["operation"] === "string" &&
    typeof value["period_key"] === "string" &&
    typeof value["remaining"] === "number" &&
    typeof value["used"] === "number"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * Worker-only QuotaTracker implementation. The Durable Object facade delegates
 * every public operation here so validation and storage ownership cannot drift.
 */
export class QuotaTrackerRuntime {
  private isStorageInitialized = false;

  public constructor(private readonly ctx: DurableObjectState) {}

  public async tryConsume(
    feature: QuotaFeature,
    amount: number,
    periodEnd: Date,
    eventId: string,
  ): Promise<QuotaTryConsumeResponse> {
    const parsed = parseQuotaInput(
      QuotaOperationSchema,
      { amount, eventId, feature, periodEnd },
      "tryConsume",
    );
    this.ensureStorage();
    const input: QuotaOperationInput = {
      amount: parsed.amount,
      eventId: parsed.eventId,
      feature: parsed.feature,
      operation: "try-consume",
      periodKey: periodKeyFromDate(parsed.periodEnd),
    };
    const result = this.ctx.storage.transactionSync(() => this.consumeOnce(input));
    await this.ensureCleanupAlarm();
    return result;
  }

  public async peek(feature: QuotaFeature, periodEnd: Date): Promise<QuotaUsageResponse> {
    const parsed = parseQuotaInput(FeatureAndPeriodSchema, { feature, periodEnd }, "peek");
    this.ensureStorage();
    const limit = this.readLimit(parsed.feature);
    const used = this.readUsed(parsed.feature, periodKeyFromDate(parsed.periodEnd));
    return QuotaUsageResponseSchema.parse({
      limit,
      remaining: Math.max(0, limit - used),
      used,
    });
  }

  public async record(
    feature: QuotaFeature,
    amount: number,
    periodEnd: Date,
    eventId: string,
    recordedAt: Date,
  ): Promise<QuotaUsageResponse> {
    const parsed = parseQuotaInput(
      QuotaRecordSchema,
      { amount, eventId, feature, periodEnd, recordedAt },
      "record",
    );
    this.ensureStorage();
    const input: QuotaOperationInput = {
      amount: parsed.amount,
      eventId: parsed.eventId,
      feature: parsed.feature,
      operation: "record",
      periodKey: periodKeyFromDate(parsed.periodEnd),
    };
    const result = this.ctx.storage.transactionSync(() =>
      this.recordOnce(input, parsed.recordedAt.getTime()),
    );
    await this.ensureCleanupAlarm();
    return result;
  }

  public async history(feature: QuotaFeature, from: Date): Promise<QuotaHistoryResult> {
    const parsed = parseQuotaInput(QuotaHistorySchema, { feature, from }, "history");
    this.ensureStorage();
    const events = this.ctx.storage.sql
      .exec(
        `SELECT SUM(amount) AS amount,
                (recorded_at / 86400000) * 86400000 AS recorded_at
         FROM usage_event
         WHERE feature = ? AND recorded_at >= ?
         GROUP BY recorded_at / 86400000
         ORDER BY recorded_at`,
        parsed.feature,
        parsed.from.getTime(),
      )
      .toArray();
    return historyResult(events);
  }

  public async setLimit(
    feature: QuotaFeature,
    limit: number,
    entitlementVersion: number,
  ): Promise<void> {
    const parsed = parseQuotaInput(
      QuotaLimitInputSchema,
      { entitlementVersion, feature, limit },
      "setLimit",
    );
    this.ensureStorage();
    this.ctx.storage.sql.exec(
      `INSERT INTO limit_override (feature, limit_val, entitlement_version)
       VALUES (?, ?, ?)
       ON CONFLICT(feature) DO UPDATE SET
         limit_val = excluded.limit_val,
         entitlement_version = excluded.entitlement_version
       WHERE excluded.entitlement_version >= limit_override.entitlement_version`,
      parsed.feature,
      parsed.limit,
      parsed.entitlementVersion,
    );
  }

  public async deleteAllState(): Promise<void> {
    await this.ctx.storage.deleteAll();
    this.isStorageInitialized = false;
  }

  public async snapshot(periodEnd: Date): Promise<QuotaSnapshotResult> {
    const parsed = parseQuotaInput(
      z.strictObject({ periodEnd: QuotaDateSchema }),
      {
        periodEnd,
      },
      "snapshot",
    );
    this.ensureStorage();
    const periodKey = periodKeyFromDate(parsed.periodEnd);
    const rawRows = this.ctx.storage.sql
      .exec("SELECT feature, limit_val FROM limit_override ORDER BY feature")
      .toArray();
    const rows: LimitRow[] = [];
    for (const row of rawRows) {
      if (isLimitRow(row)) {
        rows.push(row);
      }
    }
    const snapshot: QuotaSnapshotResult = {};
    for (const row of rows) {
      snapshot[row.feature] = {
        limit: row.limit_val,
        used: this.readUsed(row.feature, periodKey),
      };
    }
    return QuotaSnapshotResultSchema.parse(snapshot);
  }

  public async alarm(): Promise<void> {
    if (!hasQuotaTrackerStorage(this.ctx)) {
      await this.ctx.storage.deleteAlarm();
      return;
    }
    this.ensureStorage();
    this.ctx.storage.sql.exec(
      "DELETE FROM counter WHERE updated_at < ?",
      Date.now() - QUOTA_TRACKER_RETENTION_MS,
    );
    this.ctx.storage.sql.exec(
      "DELETE FROM usage_event WHERE recorded_at < ?",
      Date.now() - QUOTA_TRACKER_RETENTION_MS,
    );
    this.ctx.storage.sql.exec(
      "DELETE FROM quota_operation WHERE recorded_at < ?",
      Date.now() - QUOTA_TRACKER_RETENTION_MS,
    );
    await this.refreshCleanupAlarm();
  }

  private ensureStorage(): void {
    if (this.isStorageInitialized) {
      return;
    }
    ensureQuotaTrackerStorage(this.ctx);
    this.isStorageInitialized = true;
  }

  private consumeOnce(input: QuotaOperationInput): QuotaTryConsumeResponse {
    const existing = this.readOperation(input);
    if (existing) {
      return operationConsumeResult(existing);
    }
    const limit = this.readLimit(input.feature);
    const used = this.readUsed(input.feature, input.periodKey);
    const allowed = used + input.amount <= limit;
    const nextUsed = allowed ? used + input.amount : used;
    const remaining = Math.max(0, limit - nextUsed);
    if (allowed) {
      this.writeUsage(input.feature, input.periodKey, input.amount, nextUsed, Date.now());
    }
    this.insertOperation(input, { allowed, limit, remaining, used: nextUsed });
    return QuotaTryConsumeResponseSchema.parse({ allowed, limit, remaining });
  }

  private recordOnce(input: QuotaOperationInput, recordedAt: number): QuotaUsageResponse {
    const existing = this.readOperation(input);
    if (existing) {
      return operationPeekResult(existing);
    }
    const nextUsed = this.readUsed(input.feature, input.periodKey) + input.amount;
    const limit = this.readLimit(input.feature);
    const remaining = Math.max(0, limit - nextUsed);
    this.writeUsage(input.feature, input.periodKey, input.amount, nextUsed, recordedAt);
    this.insertOperation(input, { allowed: true, limit, remaining, used: nextUsed });
    return QuotaUsageResponseSchema.parse({ limit, remaining, used: nextUsed });
  }

  private readOperation(input: QuotaOperationInput): OperationRow | null {
    const [row] = this.ctx.storage.sql
      .exec("SELECT * FROM quota_operation WHERE event_id = ?", input.eventId)
      .toArray();
    if (!isOperationRow(row)) {
      return null;
    }
    if (
      row.operation !== input.operation ||
      row.feature !== input.feature ||
      row.period_key !== input.periodKey ||
      row.amount !== input.amount
    ) {
      throw new Error("Quota event id was reused with different operation data.");
    }
    return row;
  }

  private insertOperation(
    input: QuotaOperationInput,
    result: { allowed: boolean; limit: number; remaining: number; used: number },
  ): void {
    this.ctx.storage.sql.exec(
      `INSERT INTO quota_operation
       (event_id, operation, feature, period_key, amount, allowed, limit_val, remaining, used, recorded_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      input.eventId,
      input.operation,
      input.feature,
      input.periodKey,
      input.amount,
      result.allowed ? 1 : 0,
      result.limit,
      result.remaining,
      result.used,
      Date.now(),
    );
  }

  private async ensureCleanupAlarm(): Promise<void> {
    const currentAlarm = await this.ctx.storage.getAlarm();
    if (currentAlarm === null) {
      await this.ctx.storage.setAlarm(nextQuotaTrackerAlarm(Date.now()));
    }
  }

  private async refreshCleanupAlarm(): Promise<void> {
    if (this.hasRetainedUsage()) {
      await this.ensureCleanupAlarm();
      return;
    }
    await this.ctx.storage.deleteAlarm();
  }

  private hasRetainedUsage(): boolean {
    for (const table of ["counter", "usage_event", "quota_operation"] as const) {
      const [row] = this.ctx.storage.sql
        .exec(`SELECT 1 AS present FROM ${table} LIMIT 1`)
        .toArray();
      if (isRecord(row) && row["present"] === 1) {
        return true;
      }
    }
    return false;
  }

  private readLimit(feature: QuotaFeature): number {
    const [rawRow] = this.ctx.storage.sql
      .exec("SELECT limit_val FROM limit_override WHERE feature = ?", feature)
      .toArray();
    return isRecord(rawRow) && typeof rawRow["limit_val"] === "number" ? rawRow["limit_val"] : 0;
  }

  private readUsed(feature: QuotaFeature, periodKey: string): number {
    const [rawRow] = this.ctx.storage.sql
      .exec("SELECT used FROM counter WHERE feature = ? AND period_key = ?", feature, periodKey)
      .toArray();
    return isCounterRow(rawRow) ? rawRow.used : 0;
  }

  private writeUsage(
    feature: QuotaFeature,
    periodKey: string,
    amount: number,
    used: number,
    recordedAt: number,
  ): void {
    this.ctx.storage.sql.exec(
      `INSERT INTO counter (feature, period_key, used, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(feature, period_key) DO UPDATE SET
         used = excluded.used,
         updated_at = excluded.updated_at`,
      feature,
      periodKey,
      used,
      Date.now(),
    );
    this.ctx.storage.sql.exec(
      "INSERT INTO usage_event (feature, amount, recorded_at) VALUES (?, ?, ?)",
      feature,
      amount,
      recordedAt,
    );
  }
}

function parseQuotaInput<T>(schema: z.ZodType<T>, value: unknown, method: string): T {
  const result = schema.safeParse(value);
  if (result.success) {
    return result.data;
  }
  throw new APIError(400, "request_body_invalid", `Invalid QuotaTracker ${method} input`, {
    details: {
      fields: result.error.issues.map((issue) => issue.path.map(String).join(".")),
    },
    retriable: false,
  });
}

function operationConsumeResult(row: OperationRow): QuotaTryConsumeResponse {
  return QuotaTryConsumeResponseSchema.parse({
    allowed: row.allowed === 1,
    limit: row.limit_val,
    remaining: row.remaining,
  });
}

function operationPeekResult(row: OperationRow): QuotaUsageResponse {
  return QuotaUsageResponseSchema.parse({
    limit: row.limit_val,
    remaining: row.remaining,
    used: row.used,
  });
}

function historyResult(rows: unknown[]): QuotaHistoryResult {
  return QuotaHistoryResultSchema.parse(
    rows.filter(isHistoryRow).map((row) => ({ amount: row.amount, recordedAt: row.recorded_at })),
  );
}

function periodKeyFromDate(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}
