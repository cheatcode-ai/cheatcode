import { DurableObject } from "cloudflare:workers";
import {
  QuotaConsumeBodySchema,
  type QuotaConsumeResult,
  QuotaPeekBodySchema,
  type QuotaPeekResult,
  QuotaPeekResultSchema,
  QuotaRecordBodySchema,
  QuotaResetBodySchema,
  QuotaSetLimitBodySchema,
  QuotaSnapshotBodySchema,
  type QuotaSnapshotResult,
  QuotaSnapshotResultSchema,
} from "./quota-tracker-contract";
import { nextGatewayDurableObjectAlarm, QUOTA_TRACKER_RETENTION_MS } from "./retention";

interface CounterRow {
  used: number;
}

interface LimitRow {
  feature: string;
  limit_val: number;
}

type QuotaTrackerEnv = Record<never, never>;

function isCounterRow(value: unknown): value is CounterRow {
  return isRecord(value) && typeof value["used"] === "number";
}

function isLimitRow(value: unknown): value is LimitRow {
  return (
    isRecord(value) &&
    typeof value["feature"] === "string" &&
    typeof value["limit_val"] === "number"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export class QuotaTracker extends DurableObject<QuotaTrackerEnv> {
  public async tryConsume(
    feature: string,
    amount: number,
    periodEnd: Date,
  ): Promise<QuotaConsumeResult> {
    const limit = this.readLimit(feature);
    const periodKey = periodKeyFromDate(periodEnd);
    const used = this.readUsed(feature, periodKey);
    if (used + amount > limit) {
      return {
        allowed: false,
        limit,
        remaining: Math.max(0, limit - used),
      };
    }

    const nextUsed = used + amount;
    this.writeUsed(feature, periodKey, nextUsed);
    return {
      allowed: true,
      limit,
      remaining: Math.max(0, limit - nextUsed),
    };
  }

  public async peek(feature: string, periodEnd: Date): Promise<QuotaPeekResult> {
    const limit = this.readLimit(feature);
    const used = this.readUsed(feature, periodKeyFromDate(periodEnd));
    return QuotaPeekResultSchema.parse({
      limit,
      remaining: Math.max(0, limit - used),
      used,
    });
  }

  public async record(feature: string, amount: number, periodEnd: Date): Promise<QuotaPeekResult> {
    const periodKey = periodKeyFromDate(periodEnd);
    const nextUsed = this.readUsed(feature, periodKey) + amount;
    this.writeUsed(feature, periodKey, nextUsed);
    const limit = this.readLimit(feature);
    return QuotaPeekResultSchema.parse({
      limit,
      remaining: Math.max(0, limit - nextUsed),
      used: nextUsed,
    });
  }

  public async reset(feature: string): Promise<void> {
    this.ctx.storage.sql.exec("DELETE FROM counter WHERE feature = ?", feature);
  }

  public async setLimit(feature: string, limit: number, source: string): Promise<void> {
    this.ctx.storage.sql.exec(
      `INSERT INTO limit_override (feature, limit_val, source, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(feature) DO UPDATE SET
         limit_val = excluded.limit_val,
         source = excluded.source,
         updated_at = excluded.updated_at`,
      feature,
      limit,
      source,
      Date.now(),
    );
  }

  public async deleteAllState(): Promise<void> {
    this.ctx.storage.sql.exec("DELETE FROM counter");
    this.ctx.storage.sql.exec("DELETE FROM limit_override");
  }

  public async snapshot(periodEnd: Date): Promise<QuotaSnapshotResult> {
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
    if (request.method !== "POST") {
      return new Response("Method not allowed", { status: 405 });
    }

    const url = new URL(request.url);
    if (url.pathname === "/try-consume") {
      const body = QuotaConsumeBodySchema.parse(await request.json());
      return Response.json(
        await this.tryConsume(body.feature, body.amount, new Date(body.periodEnd)),
      );
    }
    if (url.pathname === "/peek") {
      const body = QuotaPeekBodySchema.parse(await request.json());
      return Response.json(await this.peek(body.feature, new Date(body.periodEnd)));
    }
    if (url.pathname === "/record") {
      const body = QuotaRecordBodySchema.parse(await request.json());
      return Response.json(await this.record(body.feature, body.amount, new Date(body.periodEnd)));
    }
    if (url.pathname === "/set-limit") {
      const body = QuotaSetLimitBodySchema.parse(await request.json());
      await this.setLimit(body.feature, body.limit, body.source);
      return Response.json({ ok: true });
    }
    if (url.pathname === "/snapshot") {
      const body = QuotaSnapshotBodySchema.parse(await request.json());
      return Response.json(await this.snapshot(new Date(body.periodEnd)));
    }
    if (url.pathname === "/reset") {
      const body = QuotaResetBodySchema.parse(await request.json());
      await this.reset(body.feature);
      return Response.json({ ok: true });
    }
    if (url.pathname === "/delete-all") {
      await this.deleteAllState();
      return Response.json({ ok: true });
    }
    return new Response("Not found", { status: 404 });
  }

  public override async alarm(): Promise<void> {
    this.ctx.storage.sql.exec(
      "DELETE FROM counter WHERE updated_at < ?",
      Date.now() - QUOTA_TRACKER_RETENTION_MS,
    );
    await this.ensureCleanupAlarm();
  }

  public constructor(ctx: DurableObjectState, env: QuotaTrackerEnv) {
    super(ctx, env);
    this.ctx.blockConcurrencyWhile(async () => {
      this.ctx.storage.sql.exec(
        `CREATE TABLE IF NOT EXISTS counter (
          feature TEXT NOT NULL,
          period_key TEXT NOT NULL,
          used REAL NOT NULL DEFAULT 0,
          updated_at INTEGER NOT NULL,
          PRIMARY KEY (feature, period_key)
        )`,
      );
      this.ctx.storage.sql.exec(
        `CREATE TABLE IF NOT EXISTS limit_override (
          feature TEXT PRIMARY KEY,
          limit_val REAL NOT NULL,
          source TEXT,
          updated_at INTEGER NOT NULL
        )`,
      );
      await this.ensureCleanupAlarm();
    });
  }

  private async ensureCleanupAlarm(): Promise<void> {
    const currentAlarm = await this.ctx.storage.getAlarm();
    if (currentAlarm === null) {
      await this.ctx.storage.setAlarm(nextGatewayDurableObjectAlarm(Date.now()));
    }
  }

  private readLimit(feature: string): number {
    const [rawRow] = this.ctx.storage.sql
      .exec("SELECT limit_val FROM limit_override WHERE feature = ?", feature)
      .toArray();
    return isRecord(rawRow) && typeof rawRow["limit_val"] === "number" ? rawRow["limit_val"] : 0;
  }

  private readUsed(feature: string, periodKey: string): number {
    const [rawRow] = this.ctx.storage.sql
      .exec("SELECT used FROM counter WHERE feature = ? AND period_key = ?", feature, periodKey)
      .toArray();
    return isCounterRow(rawRow) ? rawRow.used : 0;
  }

  private writeUsed(feature: string, periodKey: string, used: number): void {
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
  }
}

function periodKeyFromDate(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}
