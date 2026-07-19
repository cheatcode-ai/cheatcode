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
import { z } from "zod";
import {
  IdempotencyBeginBodySchema,
  type IdempotencyBeginResult,
  IdempotencyBeginResultSchema,
  IdempotencyCompleteBodySchema,
} from "./idempotency-contract";
import {
  assertIdempotencyStorage,
  hasIdempotencyStorage,
  initializeIdempotencyStorage,
  reconcileIdempotencyStorage,
} from "./idempotency-storage";
import {
  gatewayDurableObjectClosedResponse,
  rearmClosedGatewayDurableObjectAlarm,
} from "./release-gate";

interface IdempotencyRow {
  body_hash: string;
  claim_id: string | null;
  expires_at: number;
  response_body: string | null;
  response_headers_json: string | null;
  response_status: number | null;
  state: "completed" | "in_flight";
}

interface IdempotencyEnv {
  CHEATCODE_RELEASE_GATE: "closed" | "open";
  CHEATCODE_RELEASE_SHA?: string;
}
const MAX_IDEMPOTENCY_REQUEST_BYTES = 1024 * 1024;

export class IdempotencyStore extends DurableObject<IdempotencyEnv> {
  private isStorageInitialized = false;

  public reconcileStorageSchema(
    value: InternalDurableObjectStorageRequest,
  ): InternalDurableObjectStorageResponse {
    const input = assertStorageReconciliationRequest(this.ctx, this.env, value, "IdempotencyStore");
    reconcileExactSqliteStorage(
      input.mode,
      () => assertIdempotencyStorage(this.ctx),
      () => reconcileIdempotencyStorage(this.ctx),
    );
    this.isStorageInitialized = true;
    return storageSchemaEvidence(input);
  }

  public override async fetch(request: Request): Promise<Response> {
    if (this.env.CHEATCODE_RELEASE_GATE === "closed") {
      return gatewayDurableObjectClosedResponse();
    }
    if (request.method !== "POST") {
      return new Response("Method not allowed", { status: 405 });
    }
    const url = new URL(request.url);
    if (url.pathname === "/begin") {
      return Response.json(
        await this.begin(
          await readJsonRequest(request, MAX_IDEMPOTENCY_REQUEST_BYTES, "Idempotency request"),
        ),
      );
    }
    if (url.pathname === "/complete") {
      await this.complete(
        await readJsonRequest(request, MAX_IDEMPOTENCY_REQUEST_BYTES, "Idempotency request"),
      );
      return Response.json({ ok: true });
    }
    return new Response("Not found", { status: 404 });
  }

  public override async alarm(): Promise<void> {
    if (!hasIdempotencyStorage(this.ctx)) {
      await this.ctx.storage.deleteAlarm();
      return;
    }
    if (this.env.CHEATCODE_RELEASE_GATE === "closed") {
      await rearmClosedGatewayDurableObjectAlarm(this.ctx);
      return;
    }
    this.isStorageInitialized = true;
    this.deleteExpired(Date.now());
    await this.scheduleNextAlarm();
  }

  private async begin(value: unknown): Promise<IdempotencyBeginResult> {
    const input = IdempotencyBeginBodySchema.parse(value);
    this.ensureStorage();
    this.deleteExpired(input.now);
    const row = this.readRow(input.key);
    if (!row) {
      this.ctx.storage.sql.exec(
        `INSERT INTO idempotency_entry
          (key, body_hash, claim_id, state, expires_at)
         VALUES (?, ?, ?, 'in_flight', ?)`,
        input.key,
        input.bodyHash,
        input.claimId,
        input.now + input.ttlMs,
      );
      await this.scheduleNextAlarm();
      return IdempotencyBeginResultSchema.parse({ action: "proceed" });
    }
    if (row.body_hash !== input.bodyHash) {
      return IdempotencyBeginResultSchema.parse({ action: "reused" });
    }
    if (row.state === "in_flight") {
      if (row.claim_id === input.claimId) {
        return IdempotencyBeginResultSchema.parse({ action: "proceed" });
      }
      return IdempotencyBeginResultSchema.parse({
        action: "conflict_in_flight",
        retryAfterMs: Math.max(1_000, row.expires_at - input.now),
      });
    }
    return IdempotencyBeginResultSchema.parse({
      action: "replay",
      response: {
        body: row.response_body,
        headers: parseHeaders(row.response_headers_json),
        status: row.response_status ?? 200,
      },
    });
  }

  private async complete(value: unknown): Promise<void> {
    const input = IdempotencyCompleteBodySchema.parse(value);
    this.ensureStorage();
    this.ctx.storage.sql.exec(
      `UPDATE idempotency_entry
       SET state = 'completed',
           response_status = ?,
           response_headers_json = ?,
           response_body = ?,
           expires_at = ?
       WHERE key = ? AND claim_id = ? AND state = 'in_flight'`,
      input.status,
      JSON.stringify(input.headers),
      input.body,
      input.now + input.ttlMs,
      input.key,
      input.claimId,
    );
    await this.scheduleNextAlarm();
  }

  private readRow(key: string): IdempotencyRow | null {
    const [row] = this.ctx.storage.sql
      .exec("SELECT * FROM idempotency_entry WHERE key = ?", key)
      .toArray();
    return isIdempotencyRow(row) ? row : null;
  }

  private deleteExpired(now: number): void {
    this.ctx.storage.sql.exec("DELETE FROM idempotency_entry WHERE expires_at <= ?", now);
  }

  private async scheduleNextAlarm(): Promise<void> {
    const [row] = this.ctx.storage.sql
      .exec("SELECT MIN(expires_at) AS expires_at FROM idempotency_entry")
      .toArray();
    const expiresAt = row?.["expires_at"];
    if (typeof expiresAt === "number") {
      await this.ctx.storage.setAlarm(expiresAt);
      return;
    }
    await this.ctx.storage.deleteAll();
    this.isStorageInitialized = false;
  }

  private ensureStorage(): void {
    if (this.isStorageInitialized) {
      return;
    }
    if (hasIdempotencyStorage(this.ctx)) {
      assertIdempotencyStorage(this.ctx);
    } else {
      initializeIdempotencyStorage(this.ctx);
    }
    this.isStorageInitialized = true;
  }
}

function parseHeaders(value: string | null): [string, string][] {
  if (!value) {
    return [];
  }
  const parsed = z.array(z.tuple([z.string(), z.string()])).safeParse(JSON.parse(value));
  return parsed.success ? parsed.data : [];
}

function isIdempotencyRow(value: unknown): value is IdempotencyRow {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const row = value as Record<string, unknown>;
  return (
    typeof row["body_hash"] === "string" &&
    (row["claim_id"] === null || typeof row["claim_id"] === "string") &&
    typeof row["expires_at"] === "number" &&
    (row["response_body"] === null || typeof row["response_body"] === "string") &&
    (row["response_headers_json"] === null || typeof row["response_headers_json"] === "string") &&
    (row["response_status"] === null || typeof row["response_status"] === "number") &&
    (row["state"] === "completed" || row["state"] === "in_flight")
  );
}
