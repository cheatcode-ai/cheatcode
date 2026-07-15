import type { ErrorCode } from "@cheatcode/types";

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
      cause?: unknown;
      hint?: string;
      retriable?: boolean;
      details?: Record<string, unknown>;
      doc_url?: string;
    } = {},
  ) {
    super(message, opts.cause === undefined ? undefined : { cause: opts.cause });
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
          retriable: this.retriable,
          request_id: requestId,
          doc_url: this.opts.doc_url ?? `https://docs.trycheatcode.com/errors/${this.code}`,
          details: this.opts.details,
        },
      },
      { status: this.status, headers: { "X-Request-Id": requestId } },
    );
  }

  public get retriable(): boolean {
    return this.opts.retriable ?? this.defaultRetriable();
  }

  private defaultRetriable(): boolean {
    return RETRIABLE_CODES.has(this.code);
  }
}

export interface SafeErrorTelemetry {
  causeCode?: string;
  causeConstraint?: string;
  causeName?: string;
  causeRetriable?: boolean;
  causeStatus?: number;
  constraint?: string;
  errorName: string;
  retriable?: boolean;
  sourceErrorCode?: string;
  status?: number;
}

interface ErrorFacts {
  code?: string;
  constraint?: string;
  name: string;
  retriable?: boolean;
  status?: number;
}

const MAX_CAUSE_DEPTH = 3;
const SAFE_ERROR_CODE = /^[A-Za-z0-9][A-Za-z0-9_.:$-]{0,127}$/u;
const SAFE_ERROR_LABEL = /^[A-Za-z][A-Za-z0-9_.:$-]{0,127}$/u;
const SAFE_CONSTRAINT = /^[A-Za-z_][A-Za-z0-9_$.-]{0,127}$/u;

/**
 * Projects an unknown exception onto a deliberately small telemetry allowlist.
 * Error messages, stacks, SQL, query parameters, response bodies, and arbitrary
 * enumerable properties are never inspected or returned.
 */
export function safeErrorTelemetry(error: unknown): SafeErrorTelemetry {
  const facts = errorFacts(error);
  const causes = errorCauses(error);
  const firstCause = causes[0];
  const telemetry: SafeErrorTelemetry = { errorName: facts.name };
  assignDefined(telemetry, "sourceErrorCode", facts.code);
  assignDefined(telemetry, "constraint", facts.constraint);
  assignDefined(telemetry, "status", facts.status);
  assignDefined(telemetry, "retriable", facts.retriable);
  assignDefined(telemetry, "causeName", firstCause?.name);
  assignDefined(telemetry, "causeCode", firstDefined(causes, "code"));
  assignDefined(telemetry, "causeConstraint", firstDefined(causes, "constraint"));
  assignDefined(telemetry, "causeStatus", firstDefined(causes, "status"));
  assignDefined(telemetry, "causeRetriable", firstDefined(causes, "retriable"));
  return telemetry;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function errorFacts(value: unknown): ErrorFacts {
  if (!isRecord(value)) {
    return { name: thrownValueName(value) };
  }
  const options = readRecord(value, "opts");
  const code = safeCode(readProperty(value, "code"));
  const constraint = safeConstraint(readProperty(value, "constraint"));
  const retriable = readRetriable(value, options);
  const status = readStatus(value);
  return {
    name:
      safeLabel(readProperty(value, "name")) ?? (value instanceof Error ? "Error" : "ThrownObject"),
    ...(code ? { code } : {}),
    ...(constraint ? { constraint } : {}),
    ...(retriable === undefined ? {} : { retriable }),
    ...(status === undefined ? {} : { status }),
  };
}

function errorCauses(error: unknown): ErrorFacts[] {
  if (!isRecord(error)) {
    return [];
  }
  const causes: ErrorFacts[] = [];
  const seen = new Set<object>([error]);
  let candidate = readProperty(error, "cause");
  while (isRecord(candidate) && causes.length < MAX_CAUSE_DEPTH && !seen.has(candidate)) {
    seen.add(candidate);
    causes.push(errorFacts(candidate));
    candidate = readProperty(candidate, "cause");
  }
  return causes;
}

function readRetriable(
  record: Record<string, unknown>,
  options: Record<string, unknown> | undefined,
): boolean | undefined {
  const direct = readProperty(record, "retriable");
  if (typeof direct === "boolean") {
    return direct;
  }
  const configured = options ? readProperty(options, "retriable") : undefined;
  return typeof configured === "boolean" ? configured : undefined;
}

function readStatus(record: Record<string, unknown>): number | undefined {
  const value = readProperty(record, "status") ?? readProperty(record, "statusCode");
  return typeof value === "number" && Number.isInteger(value) && value >= 100 && value <= 599
    ? value
    : undefined;
}

function readRecord(
  record: Record<string, unknown>,
  key: string,
): Record<string, unknown> | undefined {
  const value = readProperty(record, key);
  return isRecord(value) ? value : undefined;
}

function readProperty(record: Record<string, unknown>, key: string): unknown {
  try {
    return record[key];
  } catch {
    return undefined;
  }
}

function safeLabel(value: unknown): string | undefined {
  return typeof value === "string" && SAFE_ERROR_LABEL.test(value) ? value : undefined;
}

function safeCode(value: unknown): string | undefined {
  const normalized = typeof value === "number" && Number.isFinite(value) ? String(value) : value;
  return typeof normalized === "string" && SAFE_ERROR_CODE.test(normalized)
    ? normalized
    : undefined;
}

function safeConstraint(value: unknown): string | undefined {
  return typeof value === "string" && SAFE_CONSTRAINT.test(value) ? value : undefined;
}

function thrownValueName(value: unknown): string {
  if (value === null) {
    return "ThrownNull";
  }
  if (value === undefined) {
    return "ThrownUndefined";
  }
  const type = typeof value;
  return `Thrown${type.charAt(0).toUpperCase()}${type.slice(1)}`;
}

function firstDefined<Key extends keyof ErrorFacts>(
  values: ErrorFacts[],
  key: Key,
): ErrorFacts[Key] | undefined {
  for (const value of values) {
    if (value[key] !== undefined) {
      return value[key];
    }
  }
  return undefined;
}

function assignDefined<Key extends keyof SafeErrorTelemetry>(
  target: SafeErrorTelemetry,
  key: Key,
  value: SafeErrorTelemetry[Key] | undefined,
): void {
  if (value !== undefined) {
    target[key] = value;
  }
}
