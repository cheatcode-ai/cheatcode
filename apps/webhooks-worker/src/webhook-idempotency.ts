import { DurableObject } from "cloudflare:workers";
import { APIError } from "@cheatcode/observability";
import { z } from "zod";

const WEBHOOK_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export const WebhookProviderSchema = z.enum(["clerk", "polar", "composio"]);

const BodyHashSchema = z.string().regex(/^[a-f0-9]{64}$/);

const BeginWebhookSchema = z.object({
  bodyHash: BodyHashSchema,
  eventId: z.string().min(1).max(512),
  now: z.number().int().nonnegative(),
  provider: WebhookProviderSchema,
  ttlMs: z.number().int().positive(),
});

const CompleteWebhookSchema = z.object({
  bodyHash: BodyHashSchema,
  eventId: z.string().min(1).max(512),
  processedAt: z.number().int().nonnegative(),
  provider: WebhookProviderSchema,
  workflowId: z.string().min(1).max(512),
});

const ReleaseWebhookSchema = z.object({
  bodyHash: BodyHashSchema,
  eventId: z.string().min(1).max(512),
  provider: WebhookProviderSchema,
});

const BeginWebhookResultSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("proceed") }),
  z.object({ action: z.literal("duplicate"), state: z.enum(["accepted", "processed"]) }),
  z.object({ action: z.literal("reused") }),
]);

export type WebhookProvider = z.infer<typeof WebhookProviderSchema>;
type BeginWebhookResult = z.infer<typeof BeginWebhookResultSchema>;

interface WebhookEventRow {
  body_hash: string;
  event_key: string;
  expires_at: number;
  state: "accepted" | "processed";
}

export interface WebhookIdempotencyBindings {
  WEBHOOK_IDEMPOTENCY: DurableObjectNamespace<WebhookIdempotencyStore>;
}

export interface AcceptedWebhookEvent {
  action: "duplicate" | "proceed";
  bodyHash: string;
}

interface WebhookIdempotencyInput {
  eventId: string;
  provider: WebhookProvider;
  rawBody: string;
}

interface WebhookCompletionInput {
  bodyHash: string;
  eventId: string;
  provider: WebhookProvider;
  workflowId: string;
}

interface WebhookReleaseInput {
  bodyHash: string;
  eventId: string;
  provider: WebhookProvider;
}

type WebhookIdempotencyEnv = Record<never, never>;

export class WebhookIdempotencyStore extends DurableObject<WebhookIdempotencyEnv> {
  public constructor(ctx: DurableObjectState, env: WebhookIdempotencyEnv) {
    super(ctx, env);
    this.ctx.blockConcurrencyWhile(async () => {
      this.ctx.storage.sql.exec(
        `CREATE TABLE IF NOT EXISTS webhook_event (
          event_key TEXT PRIMARY KEY,
          body_hash TEXT NOT NULL,
          state TEXT NOT NULL,
          workflow_id TEXT,
          created_at INTEGER NOT NULL,
          processed_at INTEGER,
          expires_at INTEGER NOT NULL
        )`,
      );
    });
  }

  public override async fetch(request: Request): Promise<Response> {
    if (request.method !== "POST") {
      return new Response("Method not allowed", { status: 405 });
    }
    const url = new URL(request.url);
    if (url.pathname === "/begin") {
      return Response.json(await this.begin(await request.json()));
    }
    if (url.pathname === "/complete") {
      this.complete(await request.json());
      return Response.json({ ok: true });
    }
    if (url.pathname === "/release") {
      this.release(await request.json());
      return Response.json({ ok: true });
    }
    return new Response("Not found", { status: 404 });
  }

  public override async alarm(): Promise<void> {
    this.deleteExpired(Date.now());
  }

  private async begin(value: unknown): Promise<BeginWebhookResult> {
    const input = BeginWebhookSchema.parse(value);
    this.deleteExpired(input.now);
    const eventKey = webhookEventKey(input.provider, input.eventId);
    const row = this.readRow(eventKey);
    if (!row) {
      this.ctx.storage.sql.exec(
        `INSERT INTO webhook_event
          (event_key, body_hash, state, created_at, expires_at)
         VALUES (?, ?, 'accepted', ?, ?)`,
        eventKey,
        input.bodyHash,
        input.now,
        input.now + input.ttlMs,
      );
      await this.ensureAlarm(input.now + input.ttlMs);
      return BeginWebhookResultSchema.parse({ action: "proceed" });
    }
    if (row.body_hash !== input.bodyHash) {
      return BeginWebhookResultSchema.parse({ action: "reused" });
    }
    return BeginWebhookResultSchema.parse({ action: "duplicate", state: row.state });
  }

  private complete(value: unknown): void {
    const input = CompleteWebhookSchema.parse(value);
    this.ctx.storage.sql.exec(
      `UPDATE webhook_event
       SET state = 'processed',
           workflow_id = ?,
           processed_at = ?
       WHERE event_key = ? AND body_hash = ?`,
      input.workflowId,
      input.processedAt,
      webhookEventKey(input.provider, input.eventId),
      input.bodyHash,
    );
  }

  private release(value: unknown): void {
    const input = ReleaseWebhookSchema.parse(value);
    this.ctx.storage.sql.exec(
      `DELETE FROM webhook_event
       WHERE event_key = ? AND body_hash = ? AND state = 'accepted'`,
      webhookEventKey(input.provider, input.eventId),
      input.bodyHash,
    );
  }

  private readRow(eventKey: string): WebhookEventRow | null {
    const [row] = this.ctx.storage.sql
      .exec(
        "SELECT event_key, body_hash, state, expires_at FROM webhook_event WHERE event_key = ?",
        eventKey,
      )
      .toArray();
    return isWebhookEventRow(row) ? row : null;
  }

  private deleteExpired(now: number): void {
    this.ctx.storage.sql.exec("DELETE FROM webhook_event WHERE expires_at <= ?", now);
  }

  private async ensureAlarm(timestamp: number): Promise<void> {
    const currentAlarm = await this.ctx.storage.getAlarm();
    if (currentAlarm === null || currentAlarm > timestamp) {
      await this.ctx.storage.setAlarm(timestamp);
    }
  }
}

export async function acceptWebhookEvent(
  env: WebhookIdempotencyBindings,
  input: WebhookIdempotencyInput,
): Promise<AcceptedWebhookEvent> {
  const bodyHash = await sha256Hex(`${input.provider}\n${input.eventId}\n${input.rawBody}`);
  const response = await idempotencyStub(env, input).fetch("https://webhook-idempotency/begin", {
    body: JSON.stringify({
      bodyHash,
      eventId: input.eventId,
      now: Date.now(),
      provider: input.provider,
      ttlMs: WEBHOOK_TTL_MS,
    }),
    method: "POST",
  });
  if (!response.ok) {
    throw unavailableStore();
  }
  const result = BeginWebhookResultSchema.parse(await response.json());
  if (result.action === "reused") {
    throw new APIError(422, "idempotency_key_reused", "Webhook event id reused with a new body", {
      hint: "Rejecting provider event id reuse prevents duplicate or forged webhook writes.",
      retriable: false,
    });
  }
  return { action: result.action, bodyHash };
}

export async function completeWebhookEvent(
  env: WebhookIdempotencyBindings,
  input: WebhookCompletionInput,
): Promise<void> {
  const response = await idempotencyStub(env, input).fetch("https://webhook-idempotency/complete", {
    body: JSON.stringify({
      ...input,
      processedAt: Date.now(),
    }),
    method: "POST",
  });
  if (!response.ok) {
    throw unavailableStore();
  }
}

export async function releaseWebhookEvent(
  env: WebhookIdempotencyBindings,
  input: WebhookReleaseInput,
): Promise<void> {
  const response = await idempotencyStub(env, input).fetch("https://webhook-idempotency/release", {
    body: JSON.stringify(input),
    method: "POST",
  });
  if (!response.ok) {
    throw unavailableStore();
  }
}

function idempotencyStub(
  env: WebhookIdempotencyBindings,
  input: { eventId: string; provider: WebhookProvider },
): DurableObjectStub<WebhookIdempotencyStore> {
  const eventKey = webhookEventKey(input.provider, input.eventId);
  return env.WEBHOOK_IDEMPOTENCY.get(env.WEBHOOK_IDEMPOTENCY.idFromName(eventKey));
}

function webhookEventKey(provider: WebhookProvider, eventId: string): string {
  return `${provider}:${eventId}`;
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function isWebhookEventRow(value: unknown): value is WebhookEventRow {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const row = value as Record<string, unknown>;
  return (
    typeof row["body_hash"] === "string" &&
    typeof row["event_key"] === "string" &&
    typeof row["expires_at"] === "number" &&
    (row["state"] === "accepted" || row["state"] === "processed")
  );
}

function unavailableStore(): APIError {
  return new APIError(503, "unavailable_maintenance", "Webhook idempotency store is unavailable", {
    hint: "Retry the provider callback after the WebhookIdempotencyStore Durable Object recovers.",
    retriable: true,
  });
}
