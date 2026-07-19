import { DurableObject } from "cloudflare:workers";
import {
  assertStorageReconciliationRequest,
  reconcileExactSqliteStorage,
  storageSchemaEvidence,
} from "@cheatcode/durable-storage";
import { APIError, readBoundedResponseJson, readJsonRequest } from "@cheatcode/observability";
import type {
  InternalDurableObjectStorageRequest,
  InternalDurableObjectStorageResponse,
} from "@cheatcode/types";
import { z } from "zod";
import {
  assertReleaseOpen,
  type ReleaseGateBindings,
  rearmClosedWebhookAlarm,
  releaseGateError,
} from "./release-gate";
import {
  assertWebhookIdempotencyStorage,
  hasWebhookIdempotencyStorage,
  initializeWebhookIdempotencyStorage,
  reconcileWebhookIdempotencyStorage,
} from "./webhook-idempotency-storage";

const WEBHOOK_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const WEBHOOK_FAILURE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const WEBHOOK_LEASE_MS = 15 * 60 * 1000;
const INTERNAL_COMMAND_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const SANDBOX_STATE_TTL_SECONDS = 24 * 60 * 60;
const SANDBOX_STATE_TTL_MS = SANDBOX_STATE_TTL_SECONDS * 1000;
const MAX_IDEMPOTENCY_REQUEST_BYTES = 8 * 1024;
const MAX_IDEMPOTENCY_RESPONSE_BYTES = 16 * 1024;

export const WebhookProviderSchema = z.enum([
  "clerk",
  "polar",
  "composio",
  "daytona",
  "internal-alert",
]);

const BodyHashSchema = z.string().regex(/^[a-f0-9]{64}$/);

const BeginWebhookSchema = z.object({
  bodyHash: BodyHashSchema,
  eventId: z.string().min(1).max(512),
  now: z.number().int().nonnegative(),
  provider: WebhookProviderSchema,
  staleAfterMs: z.number().int().positive(),
  ttlMs: z.number().int().positive(),
});

const CompleteWebhookSchema = z.object({
  bodyHash: BodyHashSchema,
  eventId: z.string().min(1).max(512),
  processedAt: z.number().int().nonnegative(),
  provider: WebhookProviderSchema,
  ttlMs: z.number().int().positive(),
  workflowId: z.string().min(1).max(512),
});

const StartWebhookSchema = z.object({
  bodyHash: BodyHashSchema,
  eventId: z.string().min(1).max(512),
  provider: WebhookProviderSchema,
  startedAt: z.number().int().nonnegative(),
  workflowId: z.string().min(1).max(512),
});

const FailWebhookSchema = z.object({
  bodyHash: BodyHashSchema,
  eventId: z.string().min(1).max(512),
  failedAt: z.number().int().nonnegative(),
  failureCode: z.string().min(1).max(100),
  provider: WebhookProviderSchema,
  ttlMs: z.number().int().positive(),
  workflowId: z.string().min(1).max(512),
});

const WebhookStatusInputSchema = z.object({
  eventId: z.string().min(1).max(512),
  provider: WebhookProviderSchema,
});

const ReleaseWebhookSchema = z.object({
  bodyHash: BodyHashSchema,
  eventId: z.string().min(1).max(512),
  provider: WebhookProviderSchema,
});

const DaytonaStateUpdateSchema = z.object({
  receivedAt: z.number().int().nonnegative(),
  sandboxId: z.string().uuid(),
  state: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-z_]+$/),
  updatedAt: z.number().int().nonnegative(),
});

const DaytonaStateUpdateResultSchema = z.object({
  updated: z.boolean(),
});

const InternalCommandIdSchema = z.object({
  commandId: BodyHashSchema,
});

const InternalCommandSchema = InternalCommandIdSchema.extend({
  expiresAt: z.number().int().nonnegative(),
  now: z.number().int().nonnegative(),
});

const InternalCommandResultSchema = z.object({ claimed: z.boolean() });

const BeginWebhookResultSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("proceed"), acceptedAt: z.number().int().nonnegative() }),
  z.object({
    action: z.literal("duplicate"),
    acceptedAt: z.number().int().nonnegative(),
    state: z.enum(["accepted", "running", "processed"]),
  }),
  z.object({ action: z.literal("reused") }),
]);

const WebhookStatusSchema = z
  .object({
    attempts: z.number().int().nonnegative(),
    bodyHash: BodyHashSchema,
    eventId: z.string().min(1).max(512),
    failureCode: z.string().nullable(),
    provider: WebhookProviderSchema,
    state: z.enum(["accepted", "running", "processed", "failed"]),
    workflowId: z.string().nullable(),
  })
  .nullable();

export type WebhookProvider = z.infer<typeof WebhookProviderSchema>;
type BeginWebhookResult = z.infer<typeof BeginWebhookResultSchema>;

interface WebhookEventRow {
  attempts: number;
  body_hash: string;
  created_at: number;
  event_key: string;
  expires_at: number;
  last_error: string | null;
  state: "accepted" | "running" | "processed" | "failed";
  updated_at: number;
  workflow_id: string | null;
}

export interface WebhookIdempotencyBindings extends ReleaseGateBindings {
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

interface WebhookIdempotencyEnv extends ReleaseGateBindings {
  SANDBOX_STATE?: KVNamespace;
}

export class WebhookIdempotencyStore extends DurableObject<WebhookIdempotencyEnv> {
  private isStorageInitialized = false;

  public reconcileStorageSchema(
    value: InternalDurableObjectStorageRequest,
  ): InternalDurableObjectStorageResponse {
    const input = assertStorageReconciliationRequest(
      this.ctx,
      this.env,
      value,
      "WebhookIdempotencyStore",
    );
    reconcileExactSqliteStorage(
      input.mode,
      () => assertWebhookIdempotencyStorage(this.ctx),
      () => reconcileWebhookIdempotencyStorage(this.ctx),
    );
    this.isStorageInitialized = true;
    return storageSchemaEvidence(input);
  }

  public override async fetch(request: Request): Promise<Response> {
    if (this.env.CHEATCODE_RELEASE_GATE === "closed") {
      const response = releaseGateError("closed").toResponse(
        `req_${crypto.randomUUID().replaceAll("-", "")}`,
      );
      response.headers.set("Cache-Control", "no-store");
      response.headers.set("Retry-After", "5");
      return response;
    }
    if (request.method !== "POST") {
      return new Response("Method not allowed", { status: 405 });
    }
    const url = new URL(request.url);
    if (url.pathname === "/begin") {
      return Response.json(await this.begin(await readIdempotencyRequest(request)));
    }
    if (url.pathname === "/complete") {
      await this.complete(await readIdempotencyRequest(request));
      return Response.json({ ok: true });
    }
    if (url.pathname === "/start") {
      await this.start(await readIdempotencyRequest(request));
      return Response.json({ ok: true });
    }
    if (url.pathname === "/fail") {
      await this.fail(await readIdempotencyRequest(request));
      return Response.json({ ok: true });
    }
    if (url.pathname === "/status") {
      return Response.json(await this.status(await readIdempotencyRequest(request)));
    }
    if (url.pathname === "/release") {
      await this.release(await readIdempotencyRequest(request));
      return Response.json({ ok: true });
    }
    if (url.pathname === "/daytona-state") {
      const value = await readIdempotencyRequest(request);
      const result = await this.ctx.blockConcurrencyWhile(() => this.updateDaytonaState(value));
      return Response.json(result);
    }
    if (url.pathname === "/claim-command") {
      return Response.json({
        claimed: await this.claimInternalCommand(await readIdempotencyRequest(request)),
      });
    }
    if (url.pathname === "/release-command") {
      await this.releaseInternalCommand(await readIdempotencyRequest(request));
      return Response.json({ ok: true });
    }
    return new Response("Not found", { status: 404 });
  }

  public override async alarm(): Promise<void> {
    if (!hasWebhookIdempotencyStorage(this.ctx)) {
      await this.ctx.storage.deleteAlarm();
      return;
    }
    if (this.env.CHEATCODE_RELEASE_GATE === "closed") {
      await rearmClosedWebhookAlarm(this.ctx);
      return;
    }
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

  private async begin(value: unknown): Promise<BeginWebhookResult> {
    const input = BeginWebhookSchema.parse(value);
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
      return BeginWebhookResultSchema.parse({ action: "proceed", acceptedAt: input.now });
    }
    await this.ensureAlarm(row.expires_at);
    if (row.body_hash !== input.bodyHash) {
      return BeginWebhookResultSchema.parse({ action: "reused" });
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
      return BeginWebhookResultSchema.parse({ action: "proceed", acceptedAt: row.created_at });
    }
    return BeginWebhookResultSchema.parse({
      action: "duplicate",
      acceptedAt: row.created_at,
      state: row.state,
    });
  }

  private async complete(value: unknown): Promise<void> {
    const input = CompleteWebhookSchema.parse(value);
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

  private async start(value: unknown): Promise<void> {
    const input = StartWebhookSchema.parse(value);
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

  private async fail(value: unknown): Promise<void> {
    const input = FailWebhookSchema.parse(value);
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

  private async status(value: unknown): Promise<z.infer<typeof WebhookStatusSchema>> {
    const input = WebhookStatusInputSchema.parse(value);
    this.ensureStorage();
    this.deleteExpired(Date.now());
    const row = this.readRow(webhookEventKey(input.provider, input.eventId));
    const result = WebhookStatusSchema.parse(
      row
        ? {
            attempts: row.attempts,
            bodyHash: row.body_hash,
            eventId: input.eventId,
            failureCode: row.last_error,
            provider: input.provider,
            state: row.state,
            workflowId: row.workflow_id,
          }
        : null,
    );
    await this.cleanupIfEmpty();
    return result;
  }

  private async release(value: unknown): Promise<void> {
    const input = ReleaseWebhookSchema.parse(value);
    this.ensureStorage();
    this.ctx.storage.sql.exec(
      `DELETE FROM webhook_event
       WHERE event_key = ? AND body_hash = ? AND state = 'accepted'`,
      webhookEventKey(input.provider, input.eventId),
      input.bodyHash,
    );
    await this.cleanupIfEmpty();
  }

  private async claimInternalCommand(value: unknown): Promise<boolean> {
    const input = InternalCommandSchema.parse(value);
    this.ensureStorage();
    this.deleteExpired(input.now);
    const [existing] = this.ctx.storage.sql
      .exec("SELECT command_id FROM internal_command WHERE command_id = ?", input.commandId)
      .toArray();
    if (existing) {
      await this.cleanupIfEmpty();
      return false;
    }
    this.ctx.storage.sql.exec(
      "INSERT INTO internal_command (command_id, expires_at) VALUES (?, ?)",
      input.commandId,
      input.expiresAt,
    );
    await this.ensureAlarm(input.expiresAt);
    return true;
  }

  private async releaseInternalCommand(value: unknown): Promise<void> {
    const input = InternalCommandIdSchema.parse(value);
    this.ensureStorage();
    this.ctx.storage.sql.exec("DELETE FROM internal_command WHERE command_id = ?", input.commandId);
    await this.cleanupIfEmpty();
  }

  private async updateDaytonaState(
    value: unknown,
  ): Promise<z.infer<typeof DaytonaStateUpdateResultSchema>> {
    const input = DaytonaStateUpdateSchema.parse(value);
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

  private async writeSandboxStateCache(
    input: z.infer<typeof DaytonaStateUpdateSchema>,
  ): Promise<void> {
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
    return isWebhookEventRow(row) ? row : null;
  }

  private deleteExpired(now: number): void {
    this.ctx.storage.sql.exec("DELETE FROM webhook_event WHERE expires_at <= ?", now);
    this.ctx.storage.sql.exec("DELETE FROM daytona_sandbox_state WHERE expires_at <= ?", now);
    this.ctx.storage.sql.exec("DELETE FROM internal_command WHERE expires_at <= ?", now);
  }

  private nextExpiry(): number | null {
    const [row] = this.ctx.storage.sql
      .exec(
        `SELECT MIN(next_expiry) AS next_expiry
         FROM (
           SELECT MIN(expires_at) AS next_expiry FROM webhook_event
           UNION ALL
           SELECT MIN(expires_at) AS next_expiry FROM daytona_sandbox_state
           UNION ALL
           SELECT MIN(expires_at) AS next_expiry FROM internal_command
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

export async function acceptWebhookEvent(
  env: WebhookIdempotencyBindings,
  input: WebhookIdempotencyInput,
): Promise<AcceptedWebhookEvent> {
  assertReleaseOpen(env);
  const bodyHash = await sha256Hex(`${input.provider}\n${input.eventId}\n${input.rawBody}`);
  const response = await idempotencyStub(env, input).fetch("https://webhook-idempotency/begin", {
    body: JSON.stringify({
      bodyHash,
      eventId: input.eventId,
      now: Date.now(),
      provider: input.provider,
      staleAfterMs: WEBHOOK_LEASE_MS,
      ttlMs: WEBHOOK_TTL_MS,
    }),
    method: "POST",
  });
  const result = await parseIdempotencyResponse(response, BeginWebhookResultSchema);
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
  await postIdempotency(env, input, "/start", {
    ...input,
    startedAt: Date.now(),
  });
}

export async function completeWebhookEvent(
  env: WebhookIdempotencyBindings,
  input: WebhookCompletionInput,
): Promise<void> {
  await postIdempotency(env, input, "/complete", {
    ...input,
    processedAt: Date.now(),
    ttlMs: WEBHOOK_TTL_MS,
  });
}

export async function failWebhookEvent(
  env: WebhookIdempotencyBindings,
  input: WebhookFailureInput,
): Promise<void> {
  await postIdempotency(env, input, "/fail", {
    ...input,
    failedAt: Date.now(),
    ttlMs: WEBHOOK_FAILURE_TTL_MS,
  });
}

export async function getWebhookEventStatus(
  env: WebhookIdempotencyBindings,
  input: { eventId: string; provider: WebhookProvider },
): Promise<z.infer<typeof WebhookStatusSchema>> {
  const response = await idempotencyStub(env, input).fetch("https://webhook-idempotency/status", {
    body: JSON.stringify(input),
    method: "POST",
  });
  return parseIdempotencyResponse(response, WebhookStatusSchema);
}

/** Persist a Daytona lifecycle transition in event-time order before exposing it via KV. */
export async function updateDaytonaSandboxState(
  env: WebhookIdempotencyBindings,
  input: { sandboxId: string; state: string; updatedAt: number },
): Promise<boolean> {
  const stub = env.WEBHOOK_IDEMPOTENCY.get(
    env.WEBHOOK_IDEMPOTENCY.idFromName(`daytona-sandbox:${input.sandboxId}`),
  );
  const response = await stub.fetch("https://webhook-idempotency/daytona-state", {
    body: JSON.stringify({ ...input, receivedAt: Date.now() }),
    method: "POST",
  });
  return (await parseIdempotencyResponse(response, DaytonaStateUpdateResultSchema)).updated;
}

export async function claimInternalWebhookReplay(
  env: WebhookIdempotencyBindings,
  input: { rawBody: string; timestamp: string },
): Promise<{ claimed: boolean; commandId: string }> {
  const commandId = await sha256Hex(`webhook-replay\n${input.timestamp}\n${input.rawBody}`);
  const stub = internalCommandStub(env, commandId);
  const now = Date.now();
  const response = await stub.fetch("https://webhook-idempotency/claim-command", {
    body: JSON.stringify({ commandId, expiresAt: now + INTERNAL_COMMAND_TTL_MS, now }),
    method: "POST",
  });
  const { claimed } = await parseIdempotencyResponse(response, InternalCommandResultSchema);
  return { claimed, commandId };
}

export async function releaseInternalWebhookReplay(
  env: WebhookIdempotencyBindings,
  commandId: string,
): Promise<void> {
  const response = await internalCommandStub(env, commandId).fetch(
    "https://webhook-idempotency/release-command",
    {
      body: JSON.stringify({ commandId }),
      method: "POST",
    },
  );
  await discardIdempotencyResponse(response);
}

export async function releaseWebhookEvent(
  env: WebhookIdempotencyBindings,
  input: WebhookReleaseInput,
): Promise<void> {
  const response = await idempotencyStub(env, input).fetch("https://webhook-idempotency/release", {
    body: JSON.stringify(input),
    method: "POST",
  });
  await discardIdempotencyResponse(response);
}

function idempotencyStub(
  env: WebhookIdempotencyBindings,
  input: { eventId: string; provider: WebhookProvider },
): DurableObjectStub<WebhookIdempotencyStore> {
  const eventKey = webhookEventKey(input.provider, input.eventId);
  return env.WEBHOOK_IDEMPOTENCY.get(env.WEBHOOK_IDEMPOTENCY.idFromName(eventKey));
}

function internalCommandStub(
  env: WebhookIdempotencyBindings,
  commandId: string,
): DurableObjectStub<WebhookIdempotencyStore> {
  return env.WEBHOOK_IDEMPOTENCY.get(
    env.WEBHOOK_IDEMPOTENCY.idFromName(`internal-command:${commandId}`),
  );
}

async function postIdempotency(
  env: WebhookIdempotencyBindings,
  input: { eventId: string; provider: WebhookProvider },
  path: string,
  body: unknown,
): Promise<void> {
  const response = await idempotencyStub(env, input).fetch(`https://webhook-idempotency${path}`, {
    body: JSON.stringify(body),
    method: "POST",
  });
  await discardIdempotencyResponse(response);
}

async function readIdempotencyRequest(request: Request): Promise<unknown> {
  return readJsonRequest(request, MAX_IDEMPOTENCY_REQUEST_BYTES, "Idempotency request");
}

async function parseIdempotencyResponse<T>(response: Response, schema: z.ZodType<T>): Promise<T> {
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    throw unavailableStore();
  }
  return schema.parse(
    await readBoundedResponseJson(
      response,
      MAX_IDEMPOTENCY_RESPONSE_BYTES,
      "Webhook idempotency store",
    ),
  );
}

async function discardIdempotencyResponse(response: Response): Promise<void> {
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    throw unavailableStore();
  }
  await response.body?.cancel().catch(() => undefined);
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
    typeof row["created_at"] === "number" &&
    typeof row["event_key"] === "string" &&
    typeof row["expires_at"] === "number" &&
    typeof row["updated_at"] === "number" &&
    typeof row["attempts"] === "number" &&
    (typeof row["last_error"] === "string" || row["last_error"] === null) &&
    (typeof row["workflow_id"] === "string" || row["workflow_id"] === null) &&
    (row["state"] === "accepted" ||
      row["state"] === "running" ||
      row["state"] === "processed" ||
      row["state"] === "failed")
  );
}

function unavailableStore(): APIError {
  return new APIError(503, "unavailable_maintenance", "Webhook idempotency store is unavailable", {
    hint: "Retry the provider callback after the WebhookIdempotencyStore Durable Object recovers.",
    retriable: true,
  });
}
