import type { ErrorCode } from "@cheatcode/types";
import { redactSecrets } from "./redact";

const RETRIABLE_CODES = new Set<ErrorCode>([
  "rate_limit_exceeded",
  "upstream_llm_overloaded",
  "upstream_timeout_llm",
  "upstream_timeout_sandbox",
  "internal_error",
  "unavailable_maintenance",
  "conflict_in_flight",
]);

export class APIError extends Error {
  public readonly status: number;
  public readonly code: ErrorCode;
  public readonly opts: {
    hint?: string;
    retriable?: boolean;
    details?: Record<string, unknown>;
    doc_url?: string;
  };

  public constructor(
    status: number,
    code: ErrorCode,
    message: string,
    opts: {
      hint?: string;
      retriable?: boolean;
      details?: Record<string, unknown>;
      doc_url?: string;
    } = {},
  ) {
    super(message);
    this.status = status;
    this.code = code;
    this.opts = opts;
  }

  public toResponse(requestId: string): Response {
    return Response.json(
      {
        error: {
          code: this.code,
          message: this.message,
          hint: this.opts.hint,
          retriable: this.opts.retriable ?? this.defaultRetriable(),
          request_id: requestId,
          doc_url: this.opts.doc_url ?? `https://docs.trycheatcode.com/errors/${this.code}`,
          details: this.opts.details,
        },
      },
      { status: this.status, headers: { "X-Request-Id": requestId } },
    );
  }

  private defaultRetriable(): boolean {
    return RETRIABLE_CODES.has(this.code);
  }
}

export interface NormalizedUnknownError {
  details: Record<string, unknown>;
  message: string;
}

export function toAPIError(error: unknown): APIError {
  if (error instanceof APIError) {
    return error;
  }
  return new APIError(500, "internal_error", "Internal error", {
    hint: "Retry the request. If it persists, check Workers Logs with the request_id.",
    retriable: true,
  });
}

export function normalizeUnknownError(
  error: unknown,
  fallbackMessage = "Unknown error",
): NormalizedUnknownError {
  if (error instanceof Error) {
    return {
      details: redactSecrets({
        message: error.message,
        name: error.name,
      }),
      message: redactSecrets(error.message || fallbackMessage),
    };
  }

  if (typeof error === "string") {
    return { details: { value: redactSecrets(error) }, message: redactSecrets(error) };
  }

  if (!isRecord(error)) {
    return { details: { value: error }, message: fallbackMessage };
  }

  const details = sanitizeErrorDetails(error);
  return {
    details,
    message: extractErrorMessage(error) ?? fallbackMessage,
  };
}

function sanitizeErrorDetails(value: Record<string, unknown>): Record<string, unknown> {
  return redactSecrets(pruneErrorValue(value, 0)) as Record<string, unknown>;
}

function pruneErrorValue(value: unknown, depth: number): unknown {
  if (depth > 3) {
    return "[Truncated]";
  }

  if (Array.isArray(value)) {
    return value.slice(0, 10).map((item) => pruneErrorValue(item, depth + 1));
  }

  if (!isRecord(value)) {
    return value;
  }

  const output: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value).slice(0, 20)) {
    output[key] = pruneErrorValue(item, depth + 1);
  }
  return output;
}

function extractErrorMessage(error: Record<string, unknown>): string | undefined {
  const direct = firstString(error, ["message", "error", "reason", "detail", "statusText"]);
  if (direct) {
    return redactSecrets(direct);
  }

  for (const key of ["body", "response", "data"]) {
    const nested = error[key];
    if (!isRecord(nested)) {
      continue;
    }
    const message = firstString(nested, ["message", "error", "reason", "detail", "statusText"]);
    if (message) {
      return redactSecrets(message);
    }
  }

  const status = firstPrimitive(error, ["status", "statusCode", "code"]);
  if (status !== undefined) {
    return `Upstream error ${String(status)}`;
  }

  return undefined;
}

function firstString(record: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value;
    }
  }
  return undefined;
}

function firstPrimitive(
  record: Record<string, unknown>,
  keys: string[],
): string | number | boolean | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      return value;
    }
  }
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
