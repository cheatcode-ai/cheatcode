import { createLogger, normalizeUnknownError } from "@cheatcode/observability";
import type {
  SandboxConsoleLine,
  SandboxConsoleProcess,
  SandboxConsoleSnapshot,
} from "@cheatcode/types";
import { z } from "zod";

const PROCESS_LOG_RETRY_DELAYS_MS = [0, 250, 750, 1_500, 3_000, 5_000] as const;
const LINE_MAX = 2_000;
const DEV_SERVER_COMMAND_PATTERN = /(next dev|expo start|expo|metro|vite|npm run dev|pnpm.*dev)/i;

export interface SandboxProcessLogsReader {
  process: {
    logs: (identifier: string, type?: "all" | "stderr" | "stdout") => Promise<string>;
  };
}

export const ProcessResponseSchema = z
  .object({
    command: z.string(),
    exitCode: z.number().int().optional(),
    logs: z.string().nullable().optional(),
    name: z.string().optional(),
    pid: z.union([z.string(), z.number()]).optional(),
    status: z.string(),
    stderr: z.string().optional(),
    stdout: z.string().optional(),
    workingDir: z.string().optional(),
  })
  .passthrough();

export const ProcessListSchema = z.array(ProcessResponseSchema);

type ProcessResponse = z.infer<typeof ProcessResponseSchema>;
type ProcessList = z.infer<typeof ProcessListSchema>;

/**
 * Reads completed-process stdout/stderr with short retries (Blaxel exposes logs
 * a beat after completion). Used by the DO exec path; kept here with the other
 * process-domain helpers so `project-sandbox.ts` stays under the line cap.
 */
export async function readCompletedProcessLogs(
  sandbox: SandboxProcessLogsReader,
  processName: string,
  sandboxId: string,
): Promise<{ stderr: string; stdout: string }> {
  for (const delayMs of PROCESS_LOG_RETRY_DELAYS_MS) {
    if (delayMs > 0) {
      await sleep(delayMs);
    }
    try {
      const [stdout, stderr] = await Promise.all([
        sandbox.process.logs(processName, "stdout"),
        sandbox.process.logs(processName, "stderr"),
      ]);
      if (stdout || stderr) {
        return { stderr, stdout };
      }
    } catch (error) {
      const normalized = normalizeUnknownError(error, "Sandbox process log fetch failed.");
      createLogger().warn("sandbox_process_logs_fetch_failed", {
        details: normalized.details,
        error: normalized.message,
        processName,
        sandboxId,
      });
    }
  }
  return { stderr: "", stdout: "" };
}

/**
 * Resolves the dev-server process from the sandbox process list (preview §A2
 * fallback chain): exact `app-preview` name first, then a running dev-server
 * command, then the single running process. Returns null when none is
 * addressable.
 */
export function resolveDevServerProcess(
  processes: ProcessList,
  preferredId: string,
): SandboxConsoleProcess | null {
  const running = processes
    .filter((process) => process.status === "running")
    .map(toConsoleProcess)
    .filter((process): process is SandboxConsoleProcess => process !== null);
  const exact = running.find((process) => process.id === preferredId);
  if (exact) {
    return exact;
  }
  const byCommand = running.find((process) => DEV_SERVER_COMMAND_PATTERN.test(process.command));
  if (byCommand) {
    return byCommand;
  }
  return running.length === 1 ? (running[0] ?? null) : null;
}

interface SliceLogsInput {
  lastPid: string | undefined;
  pid: string | null;
  stderrCursor: number;
  stderrText: string;
  stdoutCursor: number;
  stdoutText: string;
  tail: number;
}

type SlicedLogs = Omit<SandboxConsoleSnapshot, "process">;

/**
 * Cursor/line/pid-reset slicing per preview §4.1. Forces reset + slice-from-0
 * when the resolved pid differs from the client's last-seen pid (same-name
 * restart), with cursor-overrun as the null-pid fallback. Emits complete lines
 * only and keeps the last `tail` across both streams.
 */
export function sliceProcessLogs(input: SliceLogsInput): SlicedLogs {
  const reset = shouldReset(input);
  const stdout = sliceStream(input.stdoutText, input.stdoutCursor, reset);
  const stderr = sliceStream(input.stderrText, input.stderrCursor, reset);
  const combined: SandboxConsoleLine[] = [
    ...stdout.lines.map((text) => ({ stream: "stdout" as const, text })),
    ...stderr.lines.map((text) => ({ stream: "stderr" as const, text })),
  ];
  const truncated = combined.length > input.tail;
  const lines = truncated ? combined.slice(combined.length - input.tail) : combined;
  return {
    cursor: { stderr: stderr.nextCursor, stdout: stdout.nextCursor },
    lines,
    reset,
    truncated,
  };
}

export function emptyConsoleSnapshot(cursor: {
  stderr: number;
  stdout: number;
}): SandboxConsoleSnapshot {
  return {
    cursor: { stderr: cursor.stderr, stdout: cursor.stdout },
    lines: [],
    process: null,
    reset: false,
    truncated: false,
  };
}

function shouldReset(input: SliceLogsInput): boolean {
  if (input.lastPid !== undefined && input.pid !== null && input.lastPid !== input.pid) {
    return true;
  }
  return (
    input.stdoutCursor > input.stdoutText.length || input.stderrCursor > input.stderrText.length
  );
}

function sliceStream(
  text: string,
  cursor: number,
  reset: boolean,
): { lines: string[]; nextCursor: number } {
  const start = reset ? 0 : Math.min(Math.max(cursor, 0), text.length);
  const region = text.slice(start);
  const lastNewline = region.lastIndexOf("\n");
  if (lastNewline === -1) {
    return { lines: [], nextCursor: start };
  }
  const complete = region.slice(0, lastNewline);
  const lines = complete.split("\n").map((line) => line.slice(0, LINE_MAX));
  return { lines, nextCursor: start + lastNewline + 1 };
}

function toConsoleProcess(process: ProcessResponse): SandboxConsoleProcess | null {
  const pid = process.pid === undefined ? null : String(process.pid);
  const id = process.name && process.name.length > 0 ? process.name : pid;
  if (id === null) {
    return null;
  }
  return { command: process.command, id, pid, status: process.status };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
