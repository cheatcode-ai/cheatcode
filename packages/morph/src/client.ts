import { readBoundedResponseJson, readBoundedResponseText } from "@cheatcode/observability";
import { parseMorphCompletion } from "./schemas";
import type { MorphApplyInput, MorphApplyResult, MorphApplyRuntime } from "./types";

const MORPH_ENDPOINT = "https://api.morphllm.com/v1/chat/completions";
const MORPH_MODEL = "morph-v3-fast";
const REQUEST_BODY_MAX_BYTES = 2 * 1024 * 1024;
const RESPONSE_MAX_BYTES = 2 * 1024 * 1024;
const ERROR_RESPONSE_MAX_BYTES = 64 * 1024;
const MAX_ATTEMPTS = 3;
const RETRY_DELAYS_MS = [150, 400] as const;
const TRANSIENT_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

class MorphApiError extends Error {
  readonly isRetriable: boolean;
  readonly status: number;

  constructor(status: number, isRetriable: boolean, message = `Morph request failed (${status})`) {
    super(message);
    this.name = "MorphApiError";
    this.isRetriable = isRetriable;
    this.status = status;
  }
}

export class MorphClient implements MorphApplyRuntime {
  readonly #apiKey: string;

  constructor(apiKey: string) {
    const normalized = apiKey.trim();
    if (!normalized || normalized.length > 2_000) {
      throw new TypeError("A valid Morph API key is required");
    }
    this.#apiKey = normalized;
  }

  async applyEdit(input: MorphApplyInput, timeoutMs: number): Promise<MorphApplyResult> {
    const deadline = Date.now() + validTimeout(timeoutMs);
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
      try {
        return { mergedCode: await this.#applyOnce(input, remainingMs(deadline)) };
      } catch (error) {
        if (!shouldRetry(error, attempt, input.abortSignal)) {
          throw error;
        }
        await retryDelay(RETRY_DELAYS_MS[attempt] ?? 400, deadline, input.abortSignal);
      }
    }
    throw new MorphApiError(503, false, "Morph request exhausted its retry budget");
  }

  async #applyOnce(input: MorphApplyInput, timeoutMs: number): Promise<string> {
    const response = await fetch(MORPH_ENDPOINT, {
      body: requestBody(input),
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${this.#apiKey}`,
        "Content-Type": "application/json",
      },
      method: "POST",
      redirect: "manual",
      signal: requestSignal(input.abortSignal, timeoutMs),
    });
    if (!response.ok) {
      await discardErrorBody(response);
      throw new MorphApiError(response.status, TRANSIENT_STATUS.has(response.status));
    }
    const value = await readBoundedResponseJson(response, RESPONSE_MAX_BYTES, "Morph");
    try {
      return parseMorphCompletion(value);
    } catch {
      throw new MorphApiError(502, false, "Morph returned an invalid response");
    }
  }
}

function requestBody(input: MorphApplyInput): string {
  const content = `<instruction>${input.instruction}</instruction>\n<code>${input.originalCode}</code>\n<update>${input.codeEdit}</update>`;
  const body = JSON.stringify({
    messages: [{ content, role: "user" }],
    model: MORPH_MODEL,
  });
  if (new TextEncoder().encode(body).byteLength > REQUEST_BODY_MAX_BYTES) {
    throw new RangeError("Morph request exceeds the transport limit");
  }
  return body;
}

async function discardErrorBody(response: Response): Promise<void> {
  await readBoundedResponseText(response, ERROR_RESPONSE_MAX_BYTES, "Morph error").catch(
    () => undefined,
  );
}

function shouldRetry(
  error: unknown,
  attempt: number,
  callerSignal: AbortSignal | undefined,
): boolean {
  if (attempt >= MAX_ATTEMPTS - 1 || callerSignal?.aborted) {
    return false;
  }
  if (error instanceof MorphApiError) {
    return error.isRetriable;
  }
  return error instanceof TypeError;
}

function requestSignal(callerSignal: AbortSignal | undefined, timeoutMs: number): AbortSignal {
  const timeout = AbortSignal.timeout(validTimeout(timeoutMs));
  return callerSignal ? AbortSignal.any([callerSignal, timeout]) : timeout;
}

async function retryDelay(
  delayMs: number,
  deadline: number,
  callerSignal: AbortSignal | undefined,
): Promise<void> {
  const duration = Math.min(delayMs, remainingMs(deadline));
  callerSignal?.throwIfAborted();
  await new Promise<void>((resolve, reject) => {
    const finish = (): void => {
      callerSignal?.removeEventListener("abort", abort);
      resolve();
    };
    const abort = (): void => {
      clearTimeout(timer);
      reject(callerSignal?.reason);
    };
    const timer = setTimeout(finish, duration);
    callerSignal?.addEventListener("abort", abort, { once: true });
  });
}

function remainingMs(deadline: number): number {
  const remaining = deadline - Date.now();
  if (remaining <= 0) {
    throw new DOMException("Morph request timed out", "TimeoutError");
  }
  return remaining;
}

function validTimeout(timeoutMs: number): number {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > 120_000) {
    throw new RangeError("Morph timeout must be between 1 and 120000 milliseconds");
  }
  return Math.floor(timeoutMs);
}
