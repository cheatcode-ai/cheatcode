import { redactSecrets } from "./redact";

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogContext {
  userId?: string;
  runId?: string;
  threadId?: string;
  projectId?: string;
  toolName?: string;
  modelId?: string;
  requestId?: string;
}

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
  const payload = redactSecrets({
    level,
    msg: message,
    timestamp: new Date().toISOString(),
    ...context,
    ...extra,
  });
  emitWorkerLog(level, JSON.stringify(payload));
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

export const logger = createLogger();
