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
  type RateLimitConfig,
  RateLimitConsumeBodySchema,
  type RateLimitResult,
} from "./rate-limit-contract";
import {
  assertRateLimiterStorage,
  hasRateLimiterStorage,
  initializeRateLimiterStorage,
  reconcileRateLimiterStorage,
} from "./rate-limiter-storage";
import {
  assertGatewayDurableObjectOpen,
  gatewayDurableObjectClosedResponse,
  rearmClosedGatewayDurableObjectAlarm,
} from "./release-gate";
import { nextGatewayDurableObjectAlarm, RATE_LIMITER_RETENTION_MS } from "./retention";

interface BucketRow {
  tokens: number;
  last_refill_ms: number;
}

interface RateLimiterEnv {
  CHEATCODE_RELEASE_GATE: "closed" | "open";
  CHEATCODE_RELEASE_SHA?: string;
}
const MAX_RATE_LIMIT_REQUEST_BYTES = 16 * 1024;

function isBucketRow(value: unknown): value is BucketRow {
  if (!value || typeof value !== "object") {
    return false;
  }
  const row = value as Record<string, unknown>;
  return typeof row["tokens"] === "number" && typeof row["last_refill_ms"] === "number";
}

export class RateLimiter extends DurableObject<RateLimiterEnv> {
  private isStorageInitialized = false;

  public reconcileStorageSchema(
    value: InternalDurableObjectStorageRequest,
  ): InternalDurableObjectStorageResponse {
    const input = assertStorageReconciliationRequest(this.ctx, this.env, value, "RateLimiter");
    reconcileExactSqliteStorage(
      input.mode,
      () => assertRateLimiterStorage(this.ctx),
      () => reconcileRateLimiterStorage(this.ctx),
    );
    this.isStorageInitialized = true;
    return storageSchemaEvidence(input);
  }

  public async consume(
    key: string,
    cost: number,
    config: RateLimitConfig,
  ): Promise<RateLimitResult> {
    assertGatewayDurableObjectOpen(this.env);
    this.ensureStorage();
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
    await this.ensureCleanupAlarm();

    return { allowed: true, remaining: Math.floor(nextTokens), retryAfterMs: 0 };
  }

  public override async fetch(request: Request): Promise<Response> {
    if (this.env.CHEATCODE_RELEASE_GATE === "closed") {
      return gatewayDurableObjectClosedResponse();
    }
    if (request.method !== "POST") {
      return new Response("Method not allowed", { status: 405 });
    }
    const body = RateLimitConsumeBodySchema.parse(
      await readJsonRequest(request, MAX_RATE_LIMIT_REQUEST_BYTES, "Rate limit request"),
    );
    return Response.json(await this.consume(body.key, body.cost, body.config));
  }

  public override async alarm(): Promise<void> {
    if (!hasRateLimiterStorage(this.ctx)) {
      await this.ctx.storage.deleteAlarm();
      return;
    }
    if (this.env.CHEATCODE_RELEASE_GATE === "closed") {
      await rearmClosedGatewayDurableObjectAlarm(this.ctx);
      return;
    }
    this.isStorageInitialized = true;
    this.ctx.storage.sql.exec(
      "DELETE FROM bucket WHERE last_refill_ms < ?",
      Date.now() - RATE_LIMITER_RETENTION_MS,
    );
    if (this.hasBuckets()) {
      await this.ensureCleanupAlarm();
    } else {
      await this.ctx.storage.deleteAll();
      this.isStorageInitialized = false;
    }
  }

  private ensureStorage(): void {
    if (this.isStorageInitialized) {
      return;
    }
    if (hasRateLimiterStorage(this.ctx)) {
      assertRateLimiterStorage(this.ctx);
    } else {
      initializeRateLimiterStorage(this.ctx);
    }
    this.isStorageInitialized = true;
  }

  private hasBuckets(): boolean {
    return this.ctx.storage.sql.exec("SELECT 1 FROM bucket LIMIT 1").toArray().length > 0;
  }

  private async ensureCleanupAlarm(): Promise<void> {
    const currentAlarm = await this.ctx.storage.getAlarm();
    if (currentAlarm === null) {
      await this.ctx.storage.setAlarm(nextGatewayDurableObjectAlarm(Date.now()));
    }
  }
}
