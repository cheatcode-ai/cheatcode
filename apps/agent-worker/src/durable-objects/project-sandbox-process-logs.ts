import type { SandboxConsoleLine, SandboxConsoleSnapshot } from "@cheatcode/types";

const LINE_MAX = 2_000;

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
 * Cursor/line/pid-reset slicing for the preview console strip. Daytona session
 * logs are a single combined buffer with no byte cursor, so the DO diffs the
 * full buffer against the client's stored `stdoutCursor` (passing the buffer as
 * `stdoutText`, `stderrText: ""`) and treats the Daytona `cmdId` as the restart
 * identity (`pid`). Forces reset + slice-from-0 on a cmdId change (restart) or
 * cursor-overrun (buffer rotation). Emits complete lines only; keeps the last
 * `tail`.
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
