import { APIError } from "@cheatcode/observability";
import type { UserId } from "@cheatcode/types";
import type { IdempotencyStore } from "./durable-objects/idempotency";
import { IdempotencyBeginResultSchema } from "./durable-objects/idempotency-contract";

export interface IdempotencyBindings {
  IDEMPOTENCY: DurableObjectNamespace<IdempotencyStore>;
}

export interface PreparedIdempotentRequest {
  body: string;
  key: string;
  replay?: Response;
}

const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;

export async function prepareIdempotentRunRequest(
  env: IdempotencyBindings,
  request: Request,
  userId: UserId,
): Promise<PreparedIdempotentRequest> {
  const key = readIdempotencyKey(request);
  const body = await request.clone().text();
  const bodyHash = await requestBodyHash(request, body);
  const result = await beginIdempotency(env, userId, key, bodyHash);

  if (result.action === "proceed") {
    return { body, key };
  }
  if (result.action === "reused") {
    throw new APIError(422, "idempotency_key_reused", "Idempotency key was reused", {
      hint: "Generate a new Idempotency-Key for a different request body.",
      retriable: false,
    });
  }
  if (result.action === "conflict_in_flight") {
    throw new APIError(409, "conflict_in_flight", "Idempotent request is already running", {
      details: { retry_after_ms: result.retryAfterMs },
      hint: "Wait briefly, then reconnect to the run stream instead of starting another run.",
      retriable: true,
    });
  }
  if (result.response.body === null) {
    throw new APIError(409, "conflict_in_flight", "Run was already started for this key", {
      hint: "Reconnect through GET /v1/threads/{threadId}/runs/stream to resume the stream.",
      retriable: true,
    });
  }
  return {
    body,
    key,
    replay: new Response(result.response.body, {
      headers: result.response.headers,
      status: result.response.status,
    }),
  };
}

export async function completeIdempotentRunRequest(
  env: IdempotencyBindings,
  userId: UserId,
  key: string,
  response: Response,
): Promise<void> {
  const stub = idempotencyStub(env, userId, key);
  await stub.fetch("https://idempotency.internal/complete", {
    method: "POST",
    body: JSON.stringify({
      body: null,
      headers: cacheableHeaders(response.headers),
      key,
      status: response.status,
    }),
  });
}

function readIdempotencyKey(request: Request): string {
  const key = request.headers.get("Idempotency-Key")?.trim();
  if (!key) {
    throw new APIError(400, "invalid_request_body", "Missing Idempotency-Key header", {
      hint: "POST /v1/threads/{threadId}/runs requires a unique Idempotency-Key.",
      retriable: false,
    });
  }
  if (key.length > 255) {
    throw new APIError(400, "invalid_request_body", "Invalid Idempotency-Key header", {
      hint: "Idempotency-Key must be 1-255 characters.",
      retriable: false,
    });
  }
  return key;
}

async function beginIdempotency(
  env: IdempotencyBindings,
  userId: UserId,
  key: string,
  bodyHash: string,
) {
  const response = await idempotencyStub(env, userId, key).fetch(
    "https://idempotency.internal/begin",
    {
      method: "POST",
      body: JSON.stringify({
        bodyHash,
        key,
        now: Date.now(),
        ttlMs: IDEMPOTENCY_TTL_MS,
      }),
    },
  );
  if (!response.ok) {
    throw new APIError(503, "unavailable_maintenance", "Idempotency store is unavailable", {
      hint: "Retry the request. If it persists, check the gateway Durable Object logs.",
      retriable: true,
    });
  }
  return IdempotencyBeginResultSchema.parse(await response.json());
}

function idempotencyStub(env: IdempotencyBindings, userId: UserId, key: string) {
  return env.IDEMPOTENCY.get(env.IDEMPOTENCY.idFromName(`idempotency:${userId}:${key}`));
}

async function requestBodyHash(request: Request, body: string): Promise<string> {
  const url = new URL(request.url);
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`${request.method}\n${url.pathname}\n${url.search}\n${body}`),
  );
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function cacheableHeaders(headers: Headers): [string, string][] {
  const output: [string, string][] = [];
  for (const name of ["Cache-Control", "Content-Type", "Location", "X-Request-Id"]) {
    const value = headers.get(name);
    if (value) {
      output.push([name, value]);
    }
  }
  return output;
}
