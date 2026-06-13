import { DurableObject } from "cloudflare:workers";
import {
  type RateLimitConfig,
  RateLimitConsumeBodySchema,
  type RateLimitResult,
} from "./rate-limit-contract";
import { nextGatewayDurableObjectAlarm, RATE_LIMITER_RETENTION_MS } from "./retention";

interface BucketRow {
  tokens: number;
  last_refill_ms: number;
}

type RateLimiterEnv = Record<never, never>;

function isBucketRow(value: unknown): value is BucketRow {
  if (!value || typeof value !== "object") {
    return false;
  }
  const row = value as Record<string, unknown>;
  return typeof row["tokens"] === "number" && typeof row["last_refill_ms"] === "number";
}

export class RateLimiter extends DurableObject<RateLimiterEnv> {
  public async consume(
    key: string,
    cost: number,
    config: RateLimitConfig,
  ): Promise<RateLimitResult> {
    const now = Date.now();
    const [rawRow] = this.ctx.storage.sql
      .exec("SELECT tokens, last_refill_ms FROM bucket WHERE key = ?", key)
      .toArray();
    const row = isBucketRow(rawRow) ? rawRow : null;
    const lastRefill = row?.last_refill_ms ?? now;
    const currentTokens = row?.tokens ?? config.capacity;
    const refill = ((now - lastRefill) / 1000) * config.refillPerSec;
    const tokens = Math.min(config.capacity, currentTokens + refill);

    if (tokens < cost) {
      const retryAfterMs = Math.ceil(((cost - tokens) / config.refillPerSec) * 1000);
      return { allowed: false, remaining: Math.floor(tokens), retryAfterMs };
    }

    const nextTokens = tokens - cost;
    this.ctx.storage.sql.exec(
      `INSERT INTO bucket (key, tokens, last_refill_ms, capacity, refill_per_sec)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET
         tokens = excluded.tokens,
         last_refill_ms = excluded.last_refill_ms,
         capacity = excluded.capacity,
         refill_per_sec = excluded.refill_per_sec`,
      key,
      nextTokens,
      now,
      config.capacity,
      config.refillPerSec,
    );

    return { allowed: true, remaining: Math.floor(nextTokens), retryAfterMs: 0 };
  }

  public override async fetch(request: Request): Promise<Response> {
    if (request.method !== "POST") {
      return new Response("Method not allowed", { status: 405 });
    }
    const body = RateLimitConsumeBodySchema.parse(await request.json());
    return Response.json(await this.consume(body.key, body.cost, body.config));
  }

  public override async alarm(): Promise<void> {
    this.ctx.storage.sql.exec(
      "DELETE FROM bucket WHERE last_refill_ms < ?",
      Date.now() - RATE_LIMITER_RETENTION_MS,
    );
    await this.ensureCleanupAlarm();
  }

  public constructor(ctx: DurableObjectState, env: RateLimiterEnv) {
    super(ctx, env);
    this.ctx.blockConcurrencyWhile(async () => {
      this.ctx.storage.sql.exec(
        `CREATE TABLE IF NOT EXISTS bucket (
          key TEXT PRIMARY KEY,
          tokens REAL NOT NULL,
          last_refill_ms INTEGER NOT NULL,
          capacity INTEGER NOT NULL,
          refill_per_sec REAL NOT NULL
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
}
