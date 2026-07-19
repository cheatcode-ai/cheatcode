"use client";

import { ErrorResponseSchema, PROJECT_ARCHIVE_MAX_OUTPUT_BYTES } from "@cheatcode/types";
import { gatewayRequestUrl } from "@/lib/api/gateway-url";

const KIBIBYTE = 1024;
const MEBIBYTE = 1024 * KIBIBYTE;
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;

export const API_REQUEST_TIMEOUT_MS = {
  archive: 15 * 60_000,
  provisioning: 120_000,
  terminal: 620_000,
} as const;

export interface AuthorizedFetchOptions {
  timeoutMs?: number;
}

export const API_RESPONSE_LIMIT_BYTES = {
  archive: PROJECT_ARCHIVE_MAX_OUTPUT_BYTES,
  archiveFallback: 64 * MEBIBYTE,
  billing: 2 * MEBIBYTE,
  collections: 8 * MEBIBYTE,
  console: 4 * MEBIBYTE,
  error: 64 * KIBIBYTE,
  files: 8 * MEBIBYTE,
  greeting: 64 * KIBIBYTE,
  integrations: 8 * MEBIBYTE,
  messages: 32 * MEBIBYTE,
  metadata: 2 * MEBIBYTE,
  profile: 256 * KIBIBYTE,
  providerKeys: 256 * KIBIBYTE,
  sandboxMetadata: 256 * KIBIBYTE,
  terminal: 16 * MEBIBYTE,
} as const;

export async function authorizedFetch(
  getToken: () => Promise<null | string>,
  path: string,
  init: RequestInit = {},
  options: AuthorizedFetchOptions = {},
): Promise<Response> {
  const signal = requestSignal(init.signal, options.timeoutMs);
  const token = await waitForAbortSignal(getToken(), signal);
  if (!token) {
    throw new Error("Authentication token is unavailable");
  }
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${token}`);
  if (typeof init.body === "string" && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const response = await fetch(gatewayRequestUrl(path), {
    ...init,
    headers,
    signal,
  });
  if (!response.ok) {
    throw new Error(await readErrorMessage(response));
  }
  return response;
}

function requestSignal(
  callerSignal: AbortSignal | null | undefined,
  configuredTimeoutMs: number | undefined,
): AbortSignal {
  const timeoutMs =
    configuredTimeoutMs === undefined ? DEFAULT_REQUEST_TIMEOUT_MS : configuredTimeoutMs;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
    throw new Error("Request timeout must be a positive safe integer.");
  }
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  return callerSignal ? AbortSignal.any([callerSignal, timeoutSignal]) : timeoutSignal;
}

export async function waitForAbortSignal<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) {
    throw requestAbortError(signal);
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      signal.removeEventListener("abort", onAbort);
      reject(requestAbortError(signal));
    };
    signal.addEventListener("abort", onAbort, { once: true });
    void promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

function requestAbortError(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new DOMException("Request was aborted.", "AbortError");
}

export async function readBoundedJsonResponse(response: Response, limit: number): Promise<unknown> {
  return JSON.parse(await readBoundedTextResponse(response, limit)) as unknown;
}

export async function readBoundedTextResponse(response: Response, limit: number): Promise<string> {
  return new TextDecoder().decode(await readBoundedResponseBytes(response, limit));
}

export async function readBoundedBlobResponse(response: Response, limit: number): Promise<Blob> {
  const bytes = await readBoundedResponseBytes(response, limit);
  return new Blob([bytes], { type: response.headers.get("Content-Type") ?? "" });
}

export async function consumeBoundedResponse(
  response: Response,
  limit: number,
  consume: (chunk: Uint8Array<ArrayBuffer>) => Promise<void> | void,
): Promise<number> {
  assertResponseLimit(limit);
  if (contentLengthExceeds(response.headers.get("Content-Length"), limit)) {
    await response.body?.cancel().catch(() => undefined);
    throw responseTooLargeError(limit);
  }
  if (!response.body) {
    return 0;
  }

  const reader = response.body.getReader();
  let received = 0;
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) {
        return received;
      }
      received += result.value.byteLength;
      if (received > limit) {
        throw responseTooLargeError(limit);
      }
      await consume(result.value);
    }
  } catch (error) {
    await reader.cancel(error).catch(() => undefined);
    throw error;
  } finally {
    reader.releaseLock();
  }
}

async function readErrorMessage(response: Response): Promise<string> {
  const parsed = ErrorResponseSchema.safeParse(
    await readBoundedJsonResponse(response, API_RESPONSE_LIMIT_BYTES.error).catch(() => null),
  );
  return parsed.success ? parsed.data.error.message : `Request failed with HTTP ${response.status}`;
}

async function readBoundedResponseBytes(
  response: Response,
  limit: number,
): Promise<Uint8Array<ArrayBuffer>> {
  let bytes = new Uint8Array(initialResponseCapacity(response, limit));
  let offset = 0;
  await consumeBoundedResponse(response, limit, (chunk) => {
    const required = offset + chunk.byteLength;
    if (required > bytes.byteLength) {
      const grown = new Uint8Array(nextResponseCapacity(bytes.byteLength, required, limit));
      grown.set(bytes);
      bytes = grown;
    }
    bytes.set(chunk, offset);
    offset = required;
  });
  return bytes.subarray(0, offset);
}

function initialResponseCapacity(response: Response, limit: number): number {
  assertResponseLimit(limit);
  const header = response.headers.get("Content-Length");
  if (header && /^\d+$/u.test(header)) {
    const declared = Number(header);
    if (Number.isSafeInteger(declared) && declared > 0 && declared <= limit) {
      return declared;
    }
  }
  return Math.min(64 * KIBIBYTE, limit);
}

function nextResponseCapacity(current: number, required: number, limit: number): number {
  return Math.min(limit, Math.max(required, current * 2));
}

function assertResponseLimit(limit: number): void {
  if (!Number.isSafeInteger(limit) || limit <= 0) {
    throw new Error("Response limit must be a positive safe integer.");
  }
}

function contentLengthExceeds(header: string | null, limit: number): boolean {
  if (!header || !/^\d+$/u.test(header)) {
    return false;
  }
  const length = Number(header);
  return !Number.isSafeInteger(length) || length > limit;
}

function responseTooLargeError(limit: number): Error {
  const error = new Error(`Response exceeded the ${limit}-byte client limit.`);
  error.name = "ResponseTooLargeError";
  return error;
}
