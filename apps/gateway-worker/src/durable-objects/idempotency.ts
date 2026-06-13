import { DurableObject } from "cloudflare:workers";
import { z } from "zod";
import {
  IdempotencyBeginBodySchema,
  type IdempotencyBeginResult,
  IdempotencyBeginResultSchema,
  IdempotencyCompleteBodySchema,
} from "./idempotency-contract";

interface IdempotencyRow {
  body_hash: string;
  expires_at: number;
  response_body: string | null;
  response_headers_json: string | null;
  response_status: number | null;
  state: "completed" | "in_flight";
}

type IdempotencyEnv = Record<never, never>;

export class IdempotencyStore extends DurableObject<IdempotencyEnv> {
  public override async fetch(request: Request): Promise<Response> {
    if (request.method !== "POST") {
      return new Response("Method not allowed", { status: 405 });
    }
    const url = new URL(request.url);
    if (url.pathname === "/begin") {
      return Response.json(await this.begin(await request.json()));
    }
    if (url.pathname === "/complete") {
      await this.complete(await request.json());
      return Response.json({ ok: true });
    }
    return new Response("Not found", { status: 404 });
  }

  public override async alarm(): Promise<void> {
    this.deleteExpired(Date.now());
  }

  public constructor(ctx: DurableObjectState, env: IdempotencyEnv) {
    super(ctx, env);
    this.ctx.blockConcurrencyWhile(async () => {
      this.ctx.storage.sql.exec(
        `CREATE TABLE IF NOT EXISTS idempotency_entry (
          key TEXT PRIMARY KEY,
          body_hash TEXT NOT NULL,
          state TEXT NOT NULL,
          response_status INTEGER,
          response_headers_json TEXT,
          response_body TEXT,
          created_at INTEGER NOT NULL,
          expires_at INTEGER NOT NULL
        )`,
      );
    });
  }

  private async begin(value: unknown): Promise<IdempotencyBeginResult> {
    const input = IdempotencyBeginBodySchema.parse(value);
    this.deleteExpired(input.now);
    const row = this.readRow(input.key);
    if (!row) {
      this.ctx.storage.sql.exec(
        `INSERT INTO idempotency_entry
          (key, body_hash, state, created_at, expires_at)
         VALUES (?, ?, 'in_flight', ?, ?)`,
        input.key,
        input.bodyHash,
        input.now,
        input.now + input.ttlMs,
      );
      await this.ensureAlarm(input.now + input.ttlMs);
      return IdempotencyBeginResultSchema.parse({ action: "proceed" });
    }
    if (row.body_hash !== input.bodyHash) {
      return IdempotencyBeginResultSchema.parse({ action: "reused" });
    }
    if (row.state === "in_flight") {
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
    this.ctx.storage.sql.exec(
      `UPDATE idempotency_entry
       SET state = 'completed',
           response_status = ?,
           response_headers_json = ?,
           response_body = ?
       WHERE key = ?`,
      input.status,
      JSON.stringify(input.headers),
      input.body,
      input.key,
    );
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

  private async ensureAlarm(timestamp: number): Promise<void> {
    const currentAlarm = await this.ctx.storage.getAlarm();
    if (currentAlarm === null || currentAlarm > timestamp) {
      await this.ctx.storage.setAlarm(timestamp);
    }
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
    typeof row["expires_at"] === "number" &&
    (row["response_body"] === null || typeof row["response_body"] === "string") &&
    (row["response_headers_json"] === null || typeof row["response_headers_json"] === "string") &&
    (row["response_status"] === null || typeof row["response_status"] === "number") &&
    (row["state"] === "completed" || row["state"] === "in_flight")
  );
}
