"use client";

import type { SandboxTerminalResult } from "@cheatcode/types";
import { useAuth } from "@clerk/nextjs";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { BudTooltip } from "@/components/ui/bud-tooltip";
import { ChevronDown, Plus, X } from "@/components/ui/icons";
import { readSandboxTerminalContext, runSandboxTerminal } from "@/lib/api/sandbox";
import type { ConsoleLine, ConsoleSeverity } from "@/lib/preview/console";
import { usePreviewConsole } from "@/lib/preview/use-preview-console";
import { useAppStore } from "@/lib/store/app-store";
import { emitConsoleStripOpened } from "@/lib/telemetry/user-events";
import { cn } from "@/lib/ui/cn";

interface ConsoleTerminalEntry {
  command: string;
  cwd: string;
  id: string;
  result: SandboxTerminalResult;
}

interface ConsoleTab {
  command: string;
  cwd: string;
  entries: ConsoleTerminalEntry[];
  id: string;
  ordinal: number;
}

interface TerminalMutationInput {
  command: string;
  cwd: string;
  tabId: string;
}

interface PendingTerminalCommand {
  command: string;
  tabId: string;
}

const DEFAULT_TERMINAL_CWD = "/workspace";
const DEFAULT_TERMINAL_DISPLAY_WORKSPACE = "/workspace";
const INITIAL_CONSOLE_ID = "console-1";

/**
 * Functional console strip (preview-surface §7.3). Collapsed by default; while
 * expanded ∧ sandbox ready it polls the dev-server console over HTTP (no
 * streaming - DOs own streaming). pid-based resets are handled in the store.
 */
export function ConsoleStrip({
  sandboxAvailable,
  threadId,
}: {
  sandboxAvailable: boolean;
  threadId: string;
}) {
  const { getToken } = useAuth();
  const [activeConsoleId, setActiveConsoleId] = useState(INITIAL_CONSOLE_ID);
  const [consoleTabs, setConsoleTabs] = useState<ConsoleTab[]>(() => [createConsoleTab(1)]);
  const [pendingCommand, setPendingCommand] = useState<PendingTerminalCommand | null>(null);
  const nextConsoleOrdinalRef = useRef(2);
  const consoleLines = useAppStore((state) => state.consoleLines);
  const consoleProcess = useAppStore((state) => state.consoleProcess);
  const consoleStripOpen = useAppStore((state) => state.consoleStripOpen);
  const consoleTruncated = useAppStore((state) => state.consoleTruncated);
  const previewUrl = useAppStore((state) => state.previewUrl);
  const sandboxStatus = useAppStore((state) => state.sandboxStatus);
  const setConsoleStripOpen = useAppStore((state) => state.setConsoleStripOpen);
  const consoleReady = sandboxAvailable || sandboxStatus === "ready";
  usePreviewConsole(threadId, consoleStripOpen && consoleReady);
  const terminalContextQuery = useQuery({
    enabled: consoleReady,
    queryFn: () => readSandboxTerminalContext(getToken, threadId),
    queryKey: ["sandbox-terminal-context", threadId],
    retry: 1,
    staleTime: 30_000,
  });
  const terminalContext = terminalContextQuery.data;
  const terminalHost = terminalContext?.host ?? terminalHostFromPreview(previewUrl, threadId);
  const displayWorkspacePath =
    terminalContext?.displayWorkspacePath ?? DEFAULT_TERMINAL_DISPLAY_WORKSPACE;
  const activeConsole = useMemo(
    () => consoleTabs.find((tab) => tab.id === activeConsoleId) ?? consoleTabs[0],
    [activeConsoleId, consoleTabs],
  );
  const terminalMutation = useMutation({
    mutationFn: (input: TerminalMutationInput) =>
      runSandboxTerminal(getToken, threadId, input.command, input.cwd),
    onError: (error, input) => {
      setConsoleTabs((tabs) =>
        appendTerminalEntry(
          tabs,
          input.tabId,
          terminalErrorResult(input.command, error),
          input.cwd,
          input.cwd,
        ),
      );
      toast.error(error instanceof Error ? error.message : "Terminal command failed");
    },
    onMutate: (input) => {
      setPendingCommand({ command: input.command, tabId: input.tabId });
    },
    onSettled: () => {
      setPendingCommand(null);
    },
    onSuccess: (result, input) => {
      setConsoleTabs((tabs) =>
        appendTerminalEntry(tabs, input.tabId, result, input.cwd, result.cwd ?? input.cwd),
      );
    },
  });
  const terminalDisabled = isTerminalDisabled(consoleReady, terminalMutation.isPending);

  useEffect(() => {
    if (!terminalContext) {
      return;
    }
    setConsoleTabs((tabs) =>
      tabs.map((tab) =>
        tab.entries.length === 0 && tab.command.length === 0 && tab.cwd === DEFAULT_TERMINAL_CWD
          ? { ...tab, cwd: terminalContext.cwd }
          : tab,
      ),
    );
  }, [terminalContext]);

  const toggle = () => {
    const next = !consoleStripOpen;
    setConsoleStripOpen(next);
    if (next) {
      void emitConsoleStripOpened(getToken).catch(() => undefined);
    }
  };

  const openConsoleStrip = () => {
    if (consoleStripOpen) {
      return;
    }
    setConsoleStripOpen(true);
    void emitConsoleStripOpened(getToken).catch(() => undefined);
  };

  const addConsoleTab = () => {
    const ordinal = nextConsoleOrdinalRef.current;
    nextConsoleOrdinalRef.current += 1;
    const tab = createConsoleTab(ordinal, terminalContext?.cwd);
    setConsoleTabs((tabs) => [...tabs, tab]);
    setActiveConsoleId(tab.id);
    openConsoleStrip();
  };

  const closeConsoleTab = (tabId: string) => {
    if (consoleTabs.length === 1) {
      return;
    }
    const tabIndex = consoleTabs.findIndex((tab) => tab.id === tabId);
    if (tabIndex === -1) {
      return;
    }
    const nextTabs = consoleTabs.filter((tab) => tab.id !== tabId);
    setConsoleTabs(nextTabs);
    if (activeConsoleId === tabId) {
      const nextActiveTab = nextTabs[Math.min(tabIndex, nextTabs.length - 1)] ?? nextTabs[0];
      if (nextActiveTab) {
        setActiveConsoleId(nextActiveTab.id);
      }
    }
  };

  const updateActiveCommand = (command: string) => {
    if (!activeConsole) {
      return;
    }
    setConsoleTabs((tabs) =>
      tabs.map((tab) => (tab.id === activeConsole.id ? { ...tab, command } : tab)),
    );
  };

  const submitActiveCommand = () => {
    if (!activeConsole || terminalDisabled) {
      return;
    }
    const command = activeConsole.command.trim();
    if (command.length === 0) {
      return;
    }
    setConsoleTabs((tabs) =>
      tabs.map((tab) => (tab.id === activeConsole.id ? { ...tab, command: "" } : tab)),
    );
    terminalMutation.mutate({
      command,
      cwd: activeConsole.cwd,
      tabId: activeConsole.id,
    });
  };

  return (
    <div
      className={cn(
        "flex shrink-0 flex-col border-[#f1f1f1] border-t bg-white transition-[height] duration-200 ease-[cubic-bezier(0.4,0,0.2,1)] motion-reduce:transition-none",
        consoleStripOpen ? "h-[200px]" : "h-[34px]",
      )}
    >
      <div className="flex h-[34px] shrink-0 items-center px-2 py-[5px]">
        <button
          aria-expanded={consoleStripOpen}
          aria-label={consoleStripOpen ? "Collapse console" : "Expand console"}
          className="flex h-[22px] w-[22px] items-center justify-center rounded-full text-[#5f5f5f] transition-colors hover:bg-[#f1f1f1] hover:text-[#1b1b1b]"
          onClick={toggle}
          type="button"
        >
          <ChevronDown
            aria-hidden="true"
            className={cn("h-3.5 w-3.5 transition-transform", consoleStripOpen ? "" : "-rotate-90")}
          />
        </button>
        <div
          aria-label="Console tabs"
          className="chat-scrollbar ml-3 flex min-w-0 max-w-[calc(100%-4rem)] shrink items-center gap-1 overflow-x-auto"
          role="tablist"
        >
          {consoleTabs.map((tab) => (
            <div
              className={cn(
                "group flex h-6 shrink-0 items-center rounded-full transition-colors",
                tab.id === activeConsole?.id
                  ? "bg-[#f7f7f7] text-[#1b1b1b]"
                  : "text-[#5f5f5f] hover:bg-[#f7f7f7] hover:text-[#1b1b1b]",
              )}
              key={tab.id}
            >
              <button
                aria-selected={tab.id === activeConsole?.id}
                className="flex h-6 items-center whitespace-nowrap rounded-full px-2 font-medium text-[14px]"
                onClick={() => {
                  setActiveConsoleId(tab.id);
                  openConsoleStrip();
                }}
                role="tab"
                type="button"
              >
                {consoleTabLabel(tab, consoleTabs.length)}
              </button>
              {consoleTabs.length > 1 ? (
                <BudTooltip label={`Close ${consoleTabLabel(tab, consoleTabs.length)}`} side="top">
                  <button
                    aria-label={`Close ${consoleTabLabel(tab, consoleTabs.length)}`}
                    className="mr-1 flex h-4 w-4 items-center justify-center rounded-full text-[#8a8a8a] opacity-80 transition-colors hover:bg-[#e9e9e9] hover:text-[#1b1b1b] group-hover:opacity-100"
                    onClick={(event) => {
                      event.stopPropagation();
                      closeConsoleTab(tab.id);
                    }}
                    type="button"
                  >
                    <X aria-hidden="true" className="h-3 w-3" />
                  </button>
                </BudTooltip>
              ) : null}
            </div>
          ))}
        </div>
        <BudTooltip label="New terminal" side="top">
          <button
            aria-label="New terminal"
            className="ml-1 flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full text-[#5f5f5f] transition-colors hover:bg-[#f1f1f1] hover:text-[#1b1b1b]"
            onClick={addConsoleTab}
            type="button"
          >
            <Plus aria-hidden="true" className="h-3.5 w-3.5" />
          </button>
        </BudTooltip>
      </div>
      {consoleStripOpen && activeConsole ? (
        <ConsoleTerminalPane
          command={activeConsole.command}
          disabled={terminalDisabled}
          entries={activeConsole.entries}
          lines={activeConsole.ordinal === 1 ? consoleLines : []}
          noProcess={activeConsole.ordinal === 1 && consoleProcess === null}
          onCommandChange={updateActiveCommand}
          onSubmitCommand={submitActiveCommand}
          pendingCommand={
            pendingCommand?.tabId === activeConsole.id ? pendingCommand.command : null
          }
          sandboxReady={consoleReady}
          terminalCwd={activeConsole.cwd}
          terminalDisplayWorkspace={displayWorkspacePath}
          terminalHost={terminalHost}
          truncated={activeConsole.ordinal === 1 && consoleTruncated}
        />
      ) : null}
    </div>
  );
}

function ConsoleTerminalPane({
  command,
  disabled,
  entries,
  lines,
  noProcess,
  onCommandChange,
  onSubmitCommand,
  pendingCommand,
  sandboxReady,
  terminalCwd,
  terminalDisplayWorkspace,
  terminalHost,
  truncated,
}: {
  command: string;
  disabled: boolean;
  entries: ConsoleTerminalEntry[];
  lines: ConsoleLine[];
  noProcess: boolean;
  onCommandChange: (command: string) => void;
  onSubmitCommand: () => void;
  pendingCommand: string | null;
  sandboxReady: boolean;
  terminalCwd: string;
  terminalDisplayWorkspace: string;
  terminalHost: string;
  truncated: boolean;
}) {
  const [cursorIndex, setCursorIndex] = useState(command.length);
  const clampedCursorIndex = Math.min(cursorIndex, command.length);
  const commandBeforeCursor = command.slice(0, clampedCursorIndex);
  const commandAfterCursor = command.slice(clampedCursorIndex);

  return (
    <div className="min-h-0 flex-1 border-[#f1f1f1] border-t bg-[#f5f5f5]">
      <div className="chat-scrollbar h-full overflow-y-auto px-3 py-2 font-mono text-[#232323] text-[12px] leading-[18px]">
        {truncated ? <div className="mb-1 text-[#8a8a8a]">earlier output truncated</div> : null}
        {noProcess && lines.length === 0 && entries.length === 0 ? (
          <div className="h-2" aria-hidden="true" />
        ) : null}
        {lines.map((line) => (
          <pre
            className={cn("whitespace-pre-wrap break-words", severityClass(line.severity))}
            data-severity={line.severity}
            key={line.id}
          >
            {line.text}
          </pre>
        ))}
        {entries.map((entry) => (
          <TerminalEntryView
            displayWorkspacePath={terminalDisplayWorkspace}
            entry={entry}
            key={entry.id}
            terminalHost={terminalHost}
          />
        ))}
        {pendingCommand ? (
          <PendingTerminalCommand
            command={pendingCommand}
            cwd={terminalCwd}
            displayWorkspacePath={terminalDisplayWorkspace}
            terminalHost={terminalHost}
          />
        ) : null}
        <div className="flex min-w-0 items-center">
          <TerminalPrompt
            cwd={terminalCwd}
            displayWorkspacePath={terminalDisplayWorkspace}
            terminalHost={terminalHost}
          />
          {sandboxReady ? (
            <div className="relative ml-1 flex min-h-[18px] min-w-0 flex-1 cursor-text items-center">
              <span aria-hidden="true" className="whitespace-pre-wrap break-words">
                {commandBeforeCursor}
              </span>
              <span
                aria-hidden="true"
                className={cn(
                  "ml-px inline-block h-[14px] w-[7px] translate-y-px bg-[#232323]",
                  disabled && "opacity-25",
                )}
              />
              <span aria-hidden="true" className="whitespace-pre-wrap break-words">
                {commandAfterCursor}
              </span>
              <input
                aria-label="Terminal input"
                className="absolute inset-0 h-full w-full cursor-text bg-transparent text-transparent caret-transparent outline-none disabled:cursor-not-allowed"
                disabled={disabled}
                onChange={(event) => {
                  onCommandChange(event.target.value);
                  setCursorIndex(event.target.selectionStart ?? event.target.value.length);
                }}
                onClick={(event) => {
                  setCursorIndex(event.currentTarget.selectionStart ?? command.length);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    onSubmitCommand();
                  }
                }}
                onSelect={(event) => {
                  setCursorIndex(event.currentTarget.selectionStart ?? command.length);
                }}
                spellCheck={false}
                value={command}
              />
            </div>
          ) : (
            <span className="pl-1 text-[#8a8a8a]">Sandbox not ready</span>
          )}
        </div>
      </div>
    </div>
  );
}

function TerminalEntryView({
  displayWorkspacePath,
  entry,
  terminalHost,
}: {
  displayWorkspacePath: string;
  entry: ConsoleTerminalEntry;
  terminalHost: string;
}) {
  const output = terminalOutput(entry.result);
  return (
    <div>
      <pre className="whitespace-pre-wrap break-words">
        {promptText(entry.cwd, terminalHost, displayWorkspacePath)} {entry.command}
      </pre>
      {output.length > 0 ? (
        <pre
          className={cn(
            "whitespace-pre-wrap break-words",
            entry.result.success ? "text-[#383a42]" : "text-red-700",
          )}
        >
          {output}
        </pre>
      ) : null}
    </div>
  );
}

function PendingTerminalCommand({
  command,
  cwd,
  displayWorkspacePath,
  terminalHost,
}: {
  command: string;
  cwd: string;
  displayWorkspacePath: string;
  terminalHost: string;
}) {
  return (
    <div className="text-[#8a8a8a]">
      <pre className="whitespace-pre-wrap break-words">
        {promptText(cwd, terminalHost, displayWorkspacePath)} {command}
      </pre>
    </div>
  );
}

function TerminalPrompt({
  cwd,
  displayWorkspacePath,
  terminalHost,
}: {
  cwd: string;
  displayWorkspacePath: string;
  terminalHost: string;
}) {
  return (
    <span className="shrink-0 whitespace-pre">
      {promptText(cwd, terminalHost, displayWorkspacePath)}
    </span>
  );
}

function severityClass(severity: ConsoleSeverity): string {
  if (severity === "error") {
    return "text-red-700";
  }
  if (severity === "warn") {
    return "text-amber-700";
  }
  return "text-[#383a42]";
}

function createConsoleTab(ordinal: number, cwd = DEFAULT_TERMINAL_CWD): ConsoleTab {
  return {
    command: "",
    cwd,
    entries: [],
    id: ordinal === 1 ? INITIAL_CONSOLE_ID : `console-${ordinal}-${crypto.randomUUID()}`,
    ordinal,
  };
}

function isTerminalDisabled(consoleReady: boolean, mutationPending: boolean): boolean {
  return !consoleReady || mutationPending;
}

function consoleTabLabel(tab: ConsoleTab, tabCount: number): string {
  return tabCount === 1 ? "Console" : `Console ${tab.ordinal}`;
}

function appendTerminalEntry(
  tabs: ConsoleTab[],
  tabId: string,
  result: SandboxTerminalResult,
  promptCwd: string,
  nextCwd: string,
): ConsoleTab[] {
  return tabs.map((tab) =>
    tab.id === tabId
      ? {
          ...tab,
          cwd: nextCwd,
          entries: [
            ...tab.entries,
            {
              command: result.command,
              cwd: promptCwd,
              id: crypto.randomUUID(),
              result,
            },
          ],
        }
      : tab,
  );
}

function terminalErrorResult(command: string, error: unknown): SandboxTerminalResult {
  return {
    command,
    durationMs: 0,
    exitCode: 1,
    stderr: error instanceof Error ? error.message : "Terminal command failed",
    stdout: "",
    success: false,
  };
}

function terminalOutput(result: SandboxTerminalResult): string {
  const lines = [result.stdout.trimEnd(), result.stderr.trimEnd()].filter(Boolean);
  return lines.join("\n");
}

function promptText(cwd: string, terminalHost: string, displayWorkspacePath: string): string {
  return `root@${terminalHost}:${displayTerminalCwd(cwd, displayWorkspacePath)}#`;
}

function displayTerminalCwd(cwd: string, displayWorkspacePath: string): string {
  if (cwd === DEFAULT_TERMINAL_CWD) {
    return displayWorkspacePath;
  }
  if (cwd.startsWith(`${DEFAULT_TERMINAL_CWD}/`)) {
    return `${displayWorkspacePath}/${cwd.slice(DEFAULT_TERMINAL_CWD.length + 1)}`;
  }
  return cwd;
}

function terminalHostFromPreview(previewUrl: null | string, threadId: string): string {
  const fallback = threadId.slice(0, 8);
  if (!previewUrl) {
    return fallback;
  }
  try {
    const hostname = new URL(previewUrl).hostname;
    const sandboxId = hostname.split("--")[0];
    return sandboxId && sandboxId !== hostname ? sandboxId : fallback;
  } catch {
    return fallback;
  }
}
