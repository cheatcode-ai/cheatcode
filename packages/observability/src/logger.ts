import type { LogicalModelId } from "@cheatcode/types";
import { safeErrorTelemetry } from "./errors";
import { redactSecrets } from "./redact";

type LogLevel = "debug" | "info" | "warn" | "error";

interface LogContext {
  userId?: string;
  runId?: string;
  threadId?: string;
  projectId?: string;
  toolName?: string;
  logicalModelId?: LogicalModelId;
  requestId?: string;
}

const MAX_LOG_DEPTH = 4;
const MAX_LOG_ENTRIES = 50;
const SUPPRESSED_LOG_KEYS = new Set([
  "body",
  "causemessage",
  "content",
  "cookie",
  "cookies",
  "detail",
  "error",
  "errormessage",
  "headers",
  "internalquery",
  "message",
  "params",
  "parameters",
  "prompt",
  "query",
  "rawbody",
  "sql",
  "stack",
  "stderr",
  "stdout",
  "trace",
  "where",
]);

export interface Logger {
  debug(message: string, extra?: Record<string, unknown>): void;
  info(message: string, extra?: Record<string, unknown>): void;
  warn(message: string, extra?: Record<string, unknown>): void;
  error(message: string, extra?: Record<string, unknown>): void;
  child(context: LogContext): Logger;
}

function emit(
  level: LogLevel,
  message: string,
  context: LogContext,
  extra?: Record<string, unknown>,
) {
  const payload = redactSecrets(
    sanitizeLogValue(
      {
        level,
        msg: message,
        timestamp: new Date().toISOString(),
        ...context,
        ...extra,
      },
      0,
    ),
  );
  emitWorkerLog(level, JSON.stringify(payload));
}

function sanitizeLogValue(value: unknown, depth: number, key?: string): unknown {
  if (value instanceof Error) {
    return safeErrorTelemetry(value);
  }
  if (key && SUPPRESSED_LOG_KEYS.has(key.toLowerCase())) {
    return "[SUPPRESSED]";
  }
  if (depth >= MAX_LOG_DEPTH) {
    return "[TRUNCATED]";
  }
  if (Array.isArray(value)) {
    return value.slice(0, MAX_LOG_ENTRIES).map((item) => sanitizeLogValue(item, depth + 1));
  }
  if (!value || typeof value !== "object") {
    return value;
  }
  const output: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const [entryKey, entryValue] of Object.entries(value).slice(0, MAX_LOG_ENTRIES)) {
    output[entryKey] = sanitizeLogValue(entryValue, depth + 1, entryKey);
  }
  return output;
}

function emitWorkerLog(level: LogLevel, line: string): void {
  if (level === "error") {
    console.error(line);
    return;
  }
  if (level === "warn") {
    console.warn(line);
    return;
  }
  console.info(line);
}

export function createLogger(context: LogContext = {}): Logger {
  return {
    debug: (message, extra) => emit("debug", message, context, extra),
    info: (message, extra) => emit("info", message, context, extra),
    warn: (message, extra) => emit("warn", message, context, extra),
    error: (message, extra) => emit("error", message, context, extra),
    child: (nextContext) => createLogger({ ...context, ...nextContext }),
  };
}
