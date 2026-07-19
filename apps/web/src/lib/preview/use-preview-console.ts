"use client";

import type { SandboxConsoleSnapshot } from "@cheatcode/types";
import { useAuth } from "@clerk/nextjs";
import { useQuery } from "@tanstack/react-query";
import { readSandboxConsole } from "@/lib/api/sandbox";
import { toConsoleLines } from "@/lib/preview/console";
import { useAppStore } from "@/lib/store/app-store";

const POLL_INTERVAL_MS = 5_000;
const POLL_BACKOFF_MS = 30_000;

export interface PreviewConsoleState {
  isPolling: boolean;
  lastError: string | null;
}

/**
 * Polls `GET /v1/threads/:threadId/sandbox/console` on a 5 s cadence while
 * `enabled` (strip open ∧ sandbox ready), backing off to 30 s once a thread
 * reports no dev server so a dead-server thread does not keep waking a standby
 * sandbox. The store holds cursor + last pid; the pid is
 * echoed as `lastPid` so the DO can detect a restart that happened while polling
 * was paused. The applied snapshot drives the next poll, so the side effects
 * live in the queryFn (react-query v5 has no onSuccess).
 */
export function usePreviewConsole(threadId: string | null, enabled: boolean): PreviewConsoleState {
  const { getToken } = useAuth();

  const { error, isFetching } = useQuery<SandboxConsoleSnapshot>({
    enabled: enabled && threadId !== null,
    queryFn: async ({ signal }) => {
      const { consoleCursor, consoleProcess } = useAppStore.getState();
      const snapshot = await readSandboxConsole(
        getToken,
        requireThreadId(threadId),
        {
          lastPid: consoleProcess?.pid ?? undefined,
          processId: consoleProcess?.id ?? undefined,
          stderrCursor: consoleCursor.stderr,
          stdoutCursor: consoleCursor.stdout,
        },
        signal,
      );
      applySnapshot(snapshot);
      return snapshot;
    },
    queryKey: ["sandbox-console", threadId],
    refetchInterval: (current) =>
      current?.state.data?.process === null ? POLL_BACKOFF_MS : POLL_INTERVAL_MS,
    refetchIntervalInBackground: false,
    retry: false,
  });

  return {
    isPolling: enabled && isFetching,
    lastError: error instanceof Error ? error.message : null,
  };
}

function requireThreadId(threadId: string | null): string {
  if (threadId === null) {
    throw new Error("A thread is required to read preview console output");
  }
  return threadId;
}

function applySnapshot(snapshot: SandboxConsoleSnapshot): void {
  const store = useAppStore.getState();
  if (snapshot.reset) {
    store.resetConsole();
  }
  store.appendConsoleLines(
    toConsoleLines(snapshot.lines),
    snapshot.cursor,
    snapshot.process,
    snapshot.truncated,
  );
}
