import { DurableObject } from "cloudflare:workers";
import {
  assertStorageReconciliationRequest,
  reconcileExactSqliteStorage,
  storageSchemaEvidence,
} from "@cheatcode/durable-storage";
import { readJsonRequest } from "@cheatcode/observability";
import type {
  InternalDurableObjectStorageRequest,
  InternalDurableObjectStorageResponse,
} from "@cheatcode/types";
import {
  QUOTA_TRACKER_MAX_REQUEST_BYTES,
  type QuotaFeature,
  QuotaFeatureSchema,
  QuotaPeekRequestSchema,
  QuotaRecordRequestSchema,
  QuotaSetLimitRequestSchema,
  QuotaSetLimitResponseSchema,
  QuotaTryConsumeRequestSchema,
  type QuotaTryConsumeResponse,
  QuotaTryConsumeResponseSchema,
  type QuotaUsageResponse,
  QuotaUsageResponseSchema,
} from "@cheatcode/types/quota";
import {
  QuotaHistoryBodySchema,
  type QuotaHistoryResult,
  QuotaHistoryResultSchema,
  QuotaSnapshotBodySchema,
  type QuotaSnapshotResult,
  QuotaSnapshotResultSchema,
} from "./quota-tracker-contract";
import {
  assertQuotaTrackerStorage,
  hasQuotaTrackerStorage,
  initializeQuotaTrackerStorage,
  reconcileQuotaTrackerStorage,
} from "./quota-tracker-storage";
import {
  assertGatewayDurableObjectOpen,
  gatewayDurableObjectClosedResponse,
  rearmClosedGatewayDurableObjectAlarm,
} from "./release-gate";
import { nextGatewayDurableObjectAlarm, QUOTA_TRACKER_RETENTION_MS } from "./retention";

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

interface QuotaTrackerEnv {
  CHEATCODE_RELEASE_GATE: "closed" | "open";
  CHEATCODE_RELEASE_SHA?: string;
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

export class QuotaTracker extends DurableObject<QuotaTrackerEnv> {
  private isStorageInitialized = false;

  public reconcileStorageSchema(
    value: InternalDurableObjectStorageRequest,
  ): InternalDurableObjectStorageResponse {
    const input = assertStorageReconciliationRequest(this.ctx, this.env, value, "QuotaTracker");
    reconcileExactSqliteStorage(
      input.mode,
      () => assertQuotaTrackerStorage(this.ctx),
      () => reconcileQuotaTrackerStorage(this.ctx),
    );
    this.isStorageInitialized = true;
    return storageSchemaEvidence(input);
  }

  public async tryConsume(
    feature: QuotaFeature,
    amount: number,
    periodEnd: Date,
    eventId: string,
  ): Promise<QuotaTryConsumeResponse> {
    this.ensureStorage();
    const periodKey = periodKeyFromDate(periodEnd);
    const input: QuotaOperationInput = {
      amount,
      eventId,
      feature,
      operation: "try-consume",
      periodKey,
    };
    const result = this.ctx.storage.transactionSync(() => this.consumeOnce(input));
    await this.ensureCleanupAlarm();
    return result;
  }

  public async peek(feature: QuotaFeature, periodEnd: Date): Promise<QuotaUsageResponse> {
    this.ensureStorage();
    const limit = this.readLimit(feature);
    const used = this.readUsed(feature, periodKeyFromDate(periodEnd));
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
    this.ensureStorage();
    const periodKey = periodKeyFromDate(periodEnd);
    const input: QuotaOperationInput = {
      amount,
      eventId,
      feature,
      operation: "record",
      periodKey,
    };
    const result = this.ctx.storage.transactionSync(() =>
      this.recordOnce(input, recordedAt.getTime()),
    );
    await this.ensureCleanupAlarm();
    return result;
  }

  public async history(feature: QuotaFeature, from: Date): Promise<QuotaHistoryResult> {
    this.ensureStorage();
    const events = this.ctx.storage.sql
      .exec(
        `SELECT SUM(amount) AS amount,
                (recorded_at / 86400000) * 86400000 AS recorded_at
         FROM usage_event
         WHERE feature = ? AND recorded_at >= ?
         GROUP BY recorded_at / 86400000
         ORDER BY recorded_at`,
        feature,
        from.getTime(),
      )
      .toArray();
    return historyResult(events);
  }

  public async setLimit(
    feature: QuotaFeature,
    limit: number,
    entitlementVersion: number,
  ): Promise<void> {
    this.ensureStorage();
    this.ctx.storage.sql.exec(
      `INSERT INTO limit_override (feature, limit_val, entitlement_version)
       VALUES (?, ?, ?)
       ON CONFLICT(feature) DO UPDATE SET
         limit_val = excluded.limit_val,
         entitlement_version = excluded.entitlement_version
       WHERE excluded.entitlement_version >= limit_override.entitlement_version`,
      feature,
      limit,
      entitlementVersion,
    );
  }

  public async deleteAllState(): Promise<void> {
    assertGatewayDurableObjectOpen(this.env);
    await this.ctx.storage.deleteAll();
    this.isStorageInitialized = false;
  }

  public async snapshot(periodEnd: Date): Promise<QuotaSnapshotResult> {
    this.ensureStorage();
    const periodKey = periodKeyFromDate(periodEnd);
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

  public override async fetch(request: Request): Promise<Response> {
    if (this.env.CHEATCODE_RELEASE_GATE === "closed") {
      return gatewayDurableObjectClosedResponse();
    }
    if (request.method !== "POST") {
      return new Response("Method not allowed", { status: 405 });
    }
    return this.handlePost(new URL(request.url).pathname, request);
  }

  private async handlePost(pathname: string, request: Request): Promise<Response> {
    if (pathname === "/try-consume") {
      const body = QuotaTryConsumeRequestSchema.parse(await readQuotaRequest(request));
      return Response.json(
        QuotaTryConsumeResponseSchema.parse(
          await this.tryConsume(body.feature, body.amount, new Date(body.periodEnd), body.eventId),
        ),
      );
    }
    if (pathname === "/peek") {
      const body = QuotaPeekRequestSchema.parse(await readQuotaRequest(request));
      return Response.json(
        QuotaUsageResponseSchema.parse(await this.peek(body.feature, new Date(body.periodEnd))),
      );
    }
    if (pathname === "/record") {
      const body = QuotaRecordRequestSchema.parse(await readQuotaRequest(request));
      return Response.json(
        QuotaUsageResponseSchema.parse(
          await this.record(
            body.feature,
            body.amount,
            new Date(body.periodEnd),
            body.eventId,
            new Date(body.recordedAt),
          ),
        ),
      );
    }
    if (pathname === "/history") {
      const body = QuotaHistoryBodySchema.parse(await readQuotaRequest(request));
      return Response.json(await this.history(body.feature, new Date(body.from)));
    }
    if (pathname === "/set-limit") {
      const body = QuotaSetLimitRequestSchema.parse(await readQuotaRequest(request));
      await this.setLimit(body.feature, body.limit, body.entitlementVersion);
      return Response.json(QuotaSetLimitResponseSchema.parse({ ok: true }));
    }
    if (pathname === "/snapshot") {
      const body = QuotaSnapshotBodySchema.parse(await readQuotaRequest(request));
      return Response.json(await this.snapshot(new Date(body.periodEnd)));
    }
    if (pathname === "/delete-all") {
      await this.deleteAllState();
      return Response.json({ ok: true });
    }
    return new Response("Not found", { status: 404 });
  }

  public override async alarm(): Promise<void> {
    if (!hasQuotaTrackerStorage(this.ctx)) {
      await this.ctx.storage.deleteAlarm();
      return;
    }
    if (this.env.CHEATCODE_RELEASE_GATE === "closed") {
      await rearmClosedGatewayDurableObjectAlarm(this.ctx);
      return;
    }
    this.isStorageInitialized = true;
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
    assertGatewayDurableObjectOpen(this.env);
    if (this.isStorageInitialized) {
      return;
    }
    if (hasQuotaTrackerStorage(this.ctx)) {
      assertQuotaTrackerStorage(this.ctx);
    } else {
      initializeQuotaTrackerStorage(this.ctx);
    }
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
      await this.ctx.storage.setAlarm(nextGatewayDurableObjectAlarm(Date.now()));
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

async function readQuotaRequest(request: Request): Promise<unknown> {
  return readJsonRequest(request, QUOTA_TRACKER_MAX_REQUEST_BYTES, "Quota tracker request");
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
