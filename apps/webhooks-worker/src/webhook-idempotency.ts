import { DurableObject } from "cloudflare:workers";
import { APIError } from "@cheatcode/observability";
import { z } from "zod";
import {
  assertWebhookIdempotencyStorage,
  hasWebhookIdempotencyStorage,
  initializeWebhookIdempotencyStorage,
  removeRetiredInternalCommandStorage,
} from "./webhook-idempotency-storage";

const WEBHOOK_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const WEBHOOK_FAILURE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const WEBHOOK_LEASE_MS = 15 * 60 * 1000;
const SANDBOX_STATE_TTL_SECONDS = 24 * 60 * 60;
const SANDBOX_STATE_TTL_MS = SANDBOX_STATE_TTL_SECONDS * 1000;

export const WebhookProviderSchema = z.enum(["clerk", "polar", "composio", "daytona"]);

export type WebhookProvider = z.infer<typeof WebhookProviderSchema>;
type BeginWebhookResult =
  | { action: "proceed"; acceptedAt: number }
  | {
      action: "duplicate";
      acceptedAt: number;
      state: "accepted" | "running" | "processed";
    }
  | { action: "reused" };

interface BeginWebhookInput {
  bodyHash: string;
  eventId: string;
  now: number;
  provider: WebhookProvider;
  staleAfterMs: number;
  ttlMs: number;
}

interface CompleteWebhookInput extends WebhookCompletionInput {
  processedAt: number;
  ttlMs: number;
}

interface StartWebhookInput extends WebhookCompletionInput {
  startedAt: number;
}

interface FailWebhookInput extends WebhookFailureInput {
  failedAt: number;
  ttlMs: number;
}

interface DaytonaStateUpdateInput {
  receivedAt: number;
  sandboxId: string;
  state: string;
  updatedAt: number;
}

const WebhookEventRowSchema = z.object({
  attempts: z.number(),
  body_hash: z.string(),
  created_at: z.number(),
  event_key: z.string(),
  expires_at: z.number(),
  last_error: z.string().nullable(),
  state: z.enum(["accepted", "running", "processed", "failed"]),
  updated_at: z.number(),
  workflow_id: z.string().nullable(),
});

type WebhookEventRow = z.infer<typeof WebhookEventRowSchema>;

export interface WebhookIdempotencyBindings {
  WEBHOOK_IDEMPOTENCY: DurableObjectNamespace<WebhookIdempotencyStore>;
  SANDBOX_STATE?: KVNamespace;
}

export interface AcceptedWebhookEvent {
  action: "duplicate" | "proceed";
  acceptedAt: number;
  bodyHash: string;
  state?: "accepted" | "processed" | "running";
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

interface WebhookFailureInput extends WebhookCompletionInput {
  failureCode: string;
}

interface WebhookReleaseInput {
  bodyHash: string;
  eventId: string;
  provider: WebhookProvider;
}

interface WebhookIdempotencyEnv {
  SANDBOX_STATE?: KVNamespace;
}

export class WebhookIdempotencyStore extends DurableObject<WebhookIdempotencyEnv> {
  private isStorageInitialized = false;

  public override async alarm(): Promise<void> {
    if (!hasWebhookIdempotencyStorage(this.ctx)) {
      await this.ctx.storage.deleteAlarm();
      return;
    }
    removeRetiredInternalCommandStorage(this.ctx);
    this.isStorageInitialized = true;
    this.deleteExpired(Date.now());
    const nextExpiry = this.nextExpiry();
    if (nextExpiry !== null) {
      await this.ctx.storage.setAlarm(nextExpiry);
      return;
    }
    await this.ctx.storage.deleteAll();
    this.isStorageInitialized = false;
  }

  public async begin(input: BeginWebhookInput): Promise<BeginWebhookResult> {
    this.ensureStorage();
    this.deleteExpired(input.now);
    const eventKey = webhookEventKey(input.provider, input.eventId);
    const row = this.readRow(eventKey);
    if (!row) {
      this.ctx.storage.sql.exec(
        `INSERT INTO webhook_event
          (event_key, body_hash, state, created_at, updated_at, attempts, expires_at)
         VALUES (?, ?, 'accepted', ?, ?, 1, ?)`,
        eventKey,
        input.bodyHash,
        input.now,
        input.now,
        input.now + input.ttlMs,
      );
      await this.ensureAlarm(input.now + input.ttlMs);
      return { action: "proceed", acceptedAt: input.now };
    }
    await this.ensureAlarm(row.expires_at);
    if (row.body_hash !== input.bodyHash) {
      return { action: "reused" };
    }
    if (
      row.state === "failed" ||
      ((row.state === "accepted" || row.state === "running") &&
        row.updated_at <= input.now - input.staleAfterMs)
    ) {
      this.ctx.storage.sql.exec(
        `UPDATE webhook_event
         SET state = 'accepted',
             updated_at = ?,
             attempts = attempts + 1,
             last_error = NULL,
             expires_at = ?
         WHERE event_key = ? AND body_hash = ?`,
        input.now,
        input.now + input.ttlMs,
        eventKey,
        input.bodyHash,
      );
      await this.ensureAlarm(input.now + input.ttlMs);
      return { action: "proceed", acceptedAt: row.created_at };
    }
    return {
      action: "duplicate",
      acceptedAt: row.created_at,
      state: row.state,
    };
  }

  public async complete(input: CompleteWebhookInput): Promise<void> {
    this.ensureStorage();
    this.ctx.storage.sql.exec(
      `UPDATE webhook_event
       SET state = 'processed',
           workflow_id = ?,
           updated_at = ?,
           last_error = NULL,
           expires_at = ?
       WHERE event_key = ? AND body_hash = ?`,
      input.workflowId,
      input.processedAt,
      input.processedAt + input.ttlMs,
      webhookEventKey(input.provider, input.eventId),
      input.bodyHash,
    );
    await this.cleanupIfEmpty();
  }

  public async start(input: StartWebhookInput): Promise<void> {
    this.ensureStorage();
    this.ctx.storage.sql.exec(
      `UPDATE webhook_event
       SET state = 'running', workflow_id = ?, updated_at = ?
       WHERE event_key = ? AND body_hash = ? AND state IN ('accepted', 'running')`,
      input.workflowId,
      input.startedAt,
      webhookEventKey(input.provider, input.eventId),
      input.bodyHash,
    );
    await this.cleanupIfEmpty();
  }

  public async fail(input: FailWebhookInput): Promise<void> {
    this.ensureStorage();
    this.ctx.storage.sql.exec(
      `UPDATE webhook_event
       SET state = 'failed',
           workflow_id = ?,
           updated_at = ?,
           last_error = ?,
           expires_at = ?
       WHERE event_key = ? AND body_hash = ? AND state <> 'processed'`,
      input.workflowId,
      input.failedAt,
      input.failureCode,
      input.failedAt + input.ttlMs,
      webhookEventKey(input.provider, input.eventId),
      input.bodyHash,
    );
    await this.cleanupIfEmpty();
  }

  public async release(input: WebhookReleaseInput): Promise<void> {
    this.ensureStorage();
    this.ctx.storage.sql.exec(
      `DELETE FROM webhook_event
       WHERE event_key = ? AND body_hash = ? AND state = 'accepted'`,
      webhookEventKey(input.provider, input.eventId),
      input.bodyHash,
    );
    await this.cleanupIfEmpty();
  }

  public updateDaytonaState(input: DaytonaStateUpdateInput): Promise<{ updated: boolean }> {
    return this.ctx.blockConcurrencyWhile(() => this.updateDaytonaStateLocked(input));
  }

  private async updateDaytonaStateLocked(
    input: DaytonaStateUpdateInput,
  ): Promise<{ updated: boolean }> {
    this.ensureStorage();
    this.deleteExpired(input.receivedAt);
    const [existing] = this.ctx.storage.sql
      .exec("SELECT updated_at FROM daytona_sandbox_state WHERE sandbox_id = ?", input.sandboxId)
      .toArray();
    if (typeof existing?.["updated_at"] === "number" && existing["updated_at"] >= input.updatedAt) {
      await this.cleanupIfEmpty();
      return { updated: false };
    }
    await this.writeSandboxStateCache(input);
    const expiresAt = input.receivedAt + SANDBOX_STATE_TTL_MS;
    this.ctx.storage.sql.exec(
      `INSERT INTO daytona_sandbox_state (sandbox_id, updated_at, expires_at)
       VALUES (?, ?, ?)
       ON CONFLICT (sandbox_id) DO UPDATE
       SET updated_at = excluded.updated_at, expires_at = excluded.expires_at`,
      input.sandboxId,
      input.updatedAt,
      expiresAt,
    );
    await this.ensureAlarm(expiresAt);
    return { updated: true };
  }

  private async writeSandboxStateCache(input: DaytonaStateUpdateInput): Promise<void> {
    if (!this.env.SANDBOX_STATE) {
      return;
    }
    await this.env.SANDBOX_STATE.put(
      `sbx:${input.sandboxId}`,
      JSON.stringify({ state: input.state, updatedAt: new Date(input.updatedAt).toISOString() }),
      { expirationTtl: SANDBOX_STATE_TTL_SECONDS },
    );
  }

  private readRow(eventKey: string): WebhookEventRow | null {
    const [row] = this.ctx.storage.sql
      .exec(
        `SELECT event_key, body_hash, state, workflow_id, created_at, updated_at,
                attempts, last_error, expires_at
           FROM webhook_event WHERE event_key = ?`,
        eventKey,
      )
      .toArray();
    // A malformed row must read as absent so begin() re-accepts the event;
    // treating it as a body-hash mismatch would 422 and drop the webhook forever.
    const parsed = WebhookEventRowSchema.safeParse(row);
    return parsed.success ? parsed.data : null;
  }

  private deleteExpired(now: number): void {
    this.ctx.storage.sql.exec("DELETE FROM webhook_event WHERE expires_at <= ?", now);
    this.ctx.storage.sql.exec("DELETE FROM daytona_sandbox_state WHERE expires_at <= ?", now);
  }

  private nextExpiry(): number | null {
    const [row] = this.ctx.storage.sql
      .exec(
        `SELECT MIN(next_expiry) AS next_expiry
         FROM (
           SELECT MIN(expires_at) AS next_expiry FROM webhook_event
           UNION ALL
           SELECT MIN(expires_at) AS next_expiry FROM daytona_sandbox_state
         )`,
      )
      .toArray();
    return typeof row?.["next_expiry"] === "number" ? row["next_expiry"] : null;
  }

  private async ensureAlarm(timestamp: number): Promise<void> {
    const currentAlarm = await this.ctx.storage.getAlarm();
    if (currentAlarm === null || currentAlarm > timestamp) {
      await this.ctx.storage.setAlarm(timestamp);
    }
  }

  private ensureStorage(): void {
    if (this.isStorageInitialized) {
      return;
    }
    if (hasWebhookIdempotencyStorage(this.ctx)) {
      removeRetiredInternalCommandStorage(this.ctx);
      assertWebhookIdempotencyStorage(this.ctx);
    } else {
      initializeWebhookIdempotencyStorage(this.ctx);
    }
    this.isStorageInitialized = true;
  }

  private async cleanupIfEmpty(): Promise<void> {
    const nextExpiry = this.nextExpiry();
    if (nextExpiry !== null) {
      await this.ensureAlarm(nextExpiry);
      return;
    }
    await this.ctx.storage.deleteAll();
    this.isStorageInitialized = false;
  }
}

/**
 * Providers retry on 503 but treat 500 as terminal; a store outage must stay
 * retriable, so every stub failure is translated instead of leaking as
 * internal_error.
 */
async function callIdempotencyStore<Result>(operation: () => Promise<Result>): Promise<Result> {
  try {
    return await operation();
  } catch {
    throw new APIError(503, "unavailable_maintenance", "Webhook idempotency store is unavailable", {
      hint: "Retry the provider callback after the WebhookIdempotencyStore Durable Object recovers.",
      retriable: true,
    });
  }
}

export async function acceptWebhookEvent(
  env: WebhookIdempotencyBindings,
  input: WebhookIdempotencyInput,
): Promise<AcceptedWebhookEvent> {
  const bodyHash = await sha256Hex(`${input.provider}\n${input.eventId}\n${input.rawBody}`);
  const result = await callIdempotencyStore<BeginWebhookResult>(() =>
    idempotencyStub(env, input).begin({
      bodyHash,
      eventId: input.eventId,
      now: Date.now(),
      provider: input.provider,
      staleAfterMs: WEBHOOK_LEASE_MS,
      ttlMs: WEBHOOK_TTL_MS,
    }),
  );
  if (result.action === "reused") {
    throw new APIError(422, "idempotency_key_reused", "Webhook event id reused with a new body", {
      hint: "Rejecting provider event id reuse prevents duplicate or forged webhook writes.",
      retriable: false,
    });
  }
  return {
    action: result.action,
    acceptedAt: "acceptedAt" in result ? result.acceptedAt : Date.now(),
    bodyHash,
    ...(result.action === "duplicate" ? { state: result.state } : {}),
  };
}

export async function startWebhookEvent(
  env: WebhookIdempotencyBindings,
  input: WebhookCompletionInput,
): Promise<void> {
  await callIdempotencyStore(() =>
    idempotencyStub(env, input).start({
      ...input,
      startedAt: Date.now(),
    }),
  );
}

export async function completeWebhookEvent(
  env: WebhookIdempotencyBindings,
  input: WebhookCompletionInput,
): Promise<void> {
  await callIdempotencyStore(() =>
    idempotencyStub(env, input).complete({
      ...input,
      processedAt: Date.now(),
      ttlMs: WEBHOOK_TTL_MS,
    }),
  );
}

export async function failWebhookEvent(
  env: WebhookIdempotencyBindings,
  input: WebhookFailureInput,
): Promise<void> {
  await callIdempotencyStore(() =>
    idempotencyStub(env, input).fail({
      ...input,
      failedAt: Date.now(),
      ttlMs: WEBHOOK_FAILURE_TTL_MS,
    }),
  );
}

/** Persist a Daytona lifecycle transition in event-time order before exposing it via KV. */
export async function updateDaytonaSandboxState(
  env: WebhookIdempotencyBindings,
  input: { sandboxId: string; state: string; updatedAt: number },
): Promise<boolean> {
  const stub = env.WEBHOOK_IDEMPOTENCY.get(
    env.WEBHOOK_IDEMPOTENCY.idFromName(`daytona-sandbox:${input.sandboxId}`),
  );
  return (
    await callIdempotencyStore(() => stub.updateDaytonaState({ ...input, receivedAt: Date.now() }))
  ).updated;
}

export async function releaseWebhookEvent(
  env: WebhookIdempotencyBindings,
  input: WebhookReleaseInput,
): Promise<void> {
  await callIdempotencyStore(() => idempotencyStub(env, input).release(input));
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
