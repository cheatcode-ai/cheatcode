"use client";

import {
  SandboxTerminalCommandSchema,
  type SandboxTerminalResult,
  SandboxTerminalResultSchema,
} from "@cheatcode/types";
import { useAuth } from "@clerk/nextjs";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { authorizedFetch } from "@/lib/api/authorized-fetch";
import { cn } from "@/lib/ui/cn";

interface TerminalEntry {
  command: string;
  id: string;
  result: SandboxTerminalResult;
}

const DEFAULT_TERMINAL_COMMAND = "pwd && ls -la src/app";

export function SandboxTerminalTab({
  sandboxStatus,
  threadId,
}: {
  sandboxStatus: string;
  threadId: string;
}) {
  const { getToken } = useAuth();
  const [command, setCommand] = useState(DEFAULT_TERMINAL_COMMAND);
  const [entries, setEntries] = useState<ReadonlyArray<TerminalEntry>>([]);
  const terminalMutation = useTerminalMutation(getToken, threadId, (entry) =>
    setEntries((currentEntries) => [...currentEntries, entry]),
  );
  const isBusy = terminalMutation.isPending;

  function submitCommand() {
    const trimmedCommand = command.trim();
    if (trimmedCommand.length === 0) {
      return;
    }
    terminalMutation.mutate(trimmedCommand);
  }

  return (
    <div className="flex h-full min-h-[520px] flex-col border border-thread-border bg-black">
      <div className="flex h-10 shrink-0 items-center justify-between border-thread-border-subtle border-b px-3">
        <div className="font-mono text-[10px] text-thread-text-muted uppercase tracking-[0.22em]">
          Terminal
        </div>
        <div className="font-mono text-[9px] text-thread-text-tertiary uppercase tracking-[0.2em]">
          Sandbox {sandboxStatus}
        </div>
      </div>
      <div className="chat-scrollbar min-h-0 flex-1 space-y-4 overflow-y-auto p-3">
        {entries.length === 0 ? (
          <div className="font-mono text-[11px] text-thread-text-tertiary">
            Commands run in /workspace/app.
          </div>
        ) : null}
        {entries.map((entry) => (
          <TerminalResult entry={entry} key={entry.id} />
        ))}
      </div>
      <div className="flex shrink-0 items-center gap-2 border-thread-border-subtle border-t p-3">
        <span className="font-mono text-[11px] text-thread-status-success">$</span>
        <input
          className="min-w-0 flex-1 bg-transparent font-mono text-[11px] text-thread-text-primary outline-none"
          disabled={isBusy}
          onChange={(event) => setCommand(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              submitCommand();
            }
          }}
          value={command}
        />
        <button
          className={cn(
            "shrink-0 border border-thread-border px-3 py-2 font-mono text-[9px] text-thread-text-secondary uppercase tracking-[0.18em] transition-colors hover:bg-thread-hover hover:text-thread-text-primary",
            isBusy && "cursor-not-allowed opacity-45",
          )}
          disabled={isBusy}
          onClick={submitCommand}
          type="button"
        >
          {isBusy ? "Running" : "Run"}
        </button>
      </div>
    </div>
  );
}

function TerminalResult({ entry }: { entry: TerminalEntry }) {
  const output = [
    entry.result.stdout.trimEnd(),
    entry.result.stderr.trimEnd(),
    `exit ${entry.result.exitCode}`,
  ]
    .filter((line) => line.length > 0)
    .join("\n");

  return (
    <div className="space-y-2">
      <div className="font-mono text-[11px] text-thread-text-primary">$ {entry.command}</div>
      <pre
        className={cn(
          "whitespace-pre-wrap border-thread-border border-l bg-[var(--thread-code-bg)] p-3 font-mono text-[11px] leading-5",
          entry.result.success ? "text-thread-text-secondary" : "text-thread-status-danger",
        )}
      >
        {output}
      </pre>
    </div>
  );
}

function useTerminalMutation(
  getToken: () => Promise<null | string>,
  threadId: string,
  onTerminalEntry: (entry: TerminalEntry) => void,
) {
  return useMutation({
    mutationFn: (command: string) => runTerminalCommand(getToken, threadId, command),
    onError: (error) => toast.error(error.message),
    onSuccess: (result, command) => {
      onTerminalEntry({
        command,
        id: crypto.randomUUID(),
        result,
      });
    },
  });
}

async function runTerminalCommand(
  getToken: () => Promise<null | string>,
  threadId: string,
  command: string,
): Promise<SandboxTerminalResult> {
  const body = SandboxTerminalCommandSchema.parse({ command });
  const response = await authorizedFetch(getToken, sandboxTerminalPath(threadId), {
    body: JSON.stringify(body),
    method: "POST",
  });
  return SandboxTerminalResultSchema.parse(await response.json());
}

function sandboxTerminalPath(threadId: string): string {
  return `/v1/threads/${encodeURIComponent(threadId)}/sandbox/terminal`;
}
