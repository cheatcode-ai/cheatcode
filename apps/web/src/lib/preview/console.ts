import type { SandboxConsoleLine } from "@cheatcode/types";

export type ConsoleSeverity = "error" | "info" | "warn";

export interface ConsoleLine {
  id: string;
  severity: ConsoleSeverity;
  stream: "stdout" | "stderr";
  text: string;
}

const STDOUT_ERROR_PATTERN = /\b(error|err!|failed|exception)\b/i;
const WARN_PATTERN = /\bwarn(ing)?\b/i;

/**
 * Client-side severity classification (A4). The wire format carries only the
 * source stream; the heuristics live here so they can iterate without a Worker
 * redeploy. stderr defaults to `error` unless it reads as a warning.
 */
function parseConsoleSeverity(stream: "stdout" | "stderr", text: string): ConsoleSeverity {
  if (stream === "stderr") {
    return WARN_PATTERN.test(text) ? "warn" : "error";
  }
  if (STDOUT_ERROR_PATTERN.test(text)) {
    return "error";
  }
  return WARN_PATTERN.test(text) ? "warn" : "info";
}

export function toConsoleLines(snapshotLines: readonly SandboxConsoleLine[]): ConsoleLine[] {
  return snapshotLines.map((line) => ({
    id: crypto.randomUUID(),
    severity: parseConsoleSeverity(line.stream, line.text),
    stream: line.stream,
    text: line.text,
  }));
}

/** Ring buffer: append `incoming`, keeping at most `max` newest lines. */
export function mergeConsoleLines(
  existing: readonly ConsoleLine[],
  incoming: readonly ConsoleLine[],
  max = 500,
): ConsoleLine[] {
  if (incoming.length === 0) {
    return existing.length > max ? existing.slice(existing.length - max) : [...existing];
  }
  const merged = [...existing, ...incoming];
  return merged.length > max ? merged.slice(merged.length - max) : merged;
}
