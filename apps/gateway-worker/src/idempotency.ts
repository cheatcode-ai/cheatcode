import {
  APIError,
  readBoundedRequestText,
  readBoundedResponseJson,
  readBoundedResponseText,
} from "@cheatcode/observability";
import type { UserId } from "@cheatcode/types";
import type { IdempotencyStore } from "./durable-objects/idempotency";
import {
  type IdempotencyBeginResult,
  IdempotencyBeginResultSchema,
} from "./durable-objects/idempotency-contract";

export interface IdempotencyBindings {
  IDEMPOTENCY: DurableObjectNamespace<IdempotencyStore>;
}

export interface PreparedIdempotentRequest {
  body: string;
  bodyHash: string;
  claimId: string;
  key: string;
  keyHash: string;
  replay?: Response;
}

const MAX_CREATE_RUN_BODY_BYTES = 64 * 1024;
const IDEMPOTENCY_IN_FLIGHT_TTL_MS = 5 * 60 * 1000;
const IDEMPOTENCY_COMPLETED_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_CACHED_IDEMPOTENCY_RESPONSE_BYTES = 64 * 1024;
const MAX_IDEMPOTENCY_STORE_RESPONSE_BYTES = 1024 * 1024;

export async function prepareIdempotentRunRequest(
  env: IdempotencyBindings,
  request: Request,
  userId: UserId,
): Promise<PreparedIdempotentRequest> {
  const key = readIdempotencyKey(request);
  const body = await readBoundedRequestText(
    new Request(request),
    MAX_CREATE_RUN_BODY_BYTES,
    "Create run request",
  );
  const bodyHash = await requestBodyHash(request, body);
  const claimId = crypto.randomUUID();
  const keyHash = await idempotencyKeyHash(userId, key);
  const result = await beginIdempotency(env, userId, key, bodyHash, claimId);

  if (result.action === "proceed") {
    return { body, bodyHash, claimId, key, keyHash };
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
    bodyHash,
    claimId,
    key,
    keyHash,
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
  claimId: string,
  response: Response,
): Promise<void> {
  const stub = idempotencyStub(env, userId, key);
  const cachedBody =
    response.status === 202 || response.body === null
      ? null
      : await readBoundedResponseText(
          response.clone(),
          MAX_CACHED_IDEMPOTENCY_RESPONSE_BYTES,
          "Idempotent response",
        );
  const body = JSON.stringify({
    body: cachedBody,
    claimId,
    headers: cacheableHeaders(response.headers),
    key,
    now: Date.now(),
    status: response.status,
    ttlMs: IDEMPOTENCY_COMPLETED_TTL_MS,
  });
  const completed =
    (await attemptIdempotencyCompletion(stub, body)) ||
    (await attemptIdempotencyCompletion(stub, body));
  if (!completed) {
    throw new APIError(503, "unavailable_maintenance", "Idempotency store is unavailable", {
      retriable: true,
    });
  }
}

async function attemptIdempotencyCompletion(
  stub: DurableObjectStub<IdempotencyStore>,
  body: string,
): Promise<boolean> {
  const completed = await stub
    .fetch("https://idempotency.internal/complete", {
      method: "POST",
      body,
    })
    .catch(() => null);
  if (!completed) {
    return false;
  }
  const isCompleted = completed.ok;
  await completed.body?.cancel().catch(() => undefined);
  return isCompleted;
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
  claimId: string,
): Promise<IdempotencyBeginResult> {
  const stub = idempotencyStub(env, userId, key);
  const body = JSON.stringify({
    bodyHash,
    claimId,
    key,
    now: Date.now(),
    ttlMs: IDEMPOTENCY_IN_FLIGHT_TTL_MS,
  });
  const result =
    (await attemptIdempotencyBegin(stub, body)) ?? (await attemptIdempotencyBegin(stub, body));
  if (!result) {
    throw new APIError(503, "unavailable_maintenance", "Idempotency store is unavailable", {
      hint: "Retry the request. If it persists, check the gateway Durable Object logs.",
      retriable: true,
    });
  }
  return result;
}

async function attemptIdempotencyBegin(
  stub: DurableObjectStub<IdempotencyStore>,
  body: string,
): Promise<IdempotencyBeginResult | null> {
  try {
    const response = await stub.fetch("https://idempotency.internal/begin", {
      body,
      method: "POST",
    });
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      return null;
    }
    return IdempotencyBeginResultSchema.parse(
      await readBoundedResponseJson(
        response,
        MAX_IDEMPOTENCY_STORE_RESPONSE_BYTES,
        "Idempotency store",
      ),
    );
  } catch {
    return null;
  }
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

async function idempotencyKeyHash(userId: UserId, key: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`cheatcode:v1:create-run\0${userId}\0${key}`),
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
