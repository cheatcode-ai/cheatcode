import type { SandboxTerminalResult } from "@cheatcode/types";
import type {
  ConsoleTab,
  ConsoleTerminalAction,
  PendingTerminalCommand,
  TerminalMutationInput,
} from "./console-terminal.types";

export const DEFAULT_TERMINAL_CWD = "/workspace";
export const DEFAULT_TERMINAL_DISPLAY_WORKSPACE = "/workspace";
const INITIAL_CONSOLE_ID = "console-1";

interface ConsoleTerminalState {
  activeConsoleId: string;
  nextOrdinal: number;
  pendingCommand: PendingTerminalCommand | null;
  tabs: ConsoleTab[];
}

export function createConsoleTerminalState(): ConsoleTerminalState {
  return {
    activeConsoleId: INITIAL_CONSOLE_ID,
    nextOrdinal: 2,
    pendingCommand: null,
    tabs: [createConsoleTab(1)],
  };
}

export function consoleTerminalReducer(
  state: ConsoleTerminalState,
  action: ConsoleTerminalAction,
): ConsoleTerminalState {
  switch (action.type) {
    case "add-tab":
      return addConsoleTab(state, action.cwd);
    case "append-result":
      return appendTerminalResult(state, action.input, action.result);
    case "clear-command":
      return updateTab(state, action.tabId, (tab) => ({ ...tab, command: "" }));
    case "close-tab":
      return closeConsoleTab(state, action.tabId);
    case "select-tab":
      return { ...state, activeConsoleId: action.tabId };
    case "set-context-cwd":
      return applyContextCwd(state, action.cwd);
    case "set-pending":
      return { ...state, pendingCommand: action.command };
    case "update-command":
      return updateTab(state, action.tabId, (tab) => ({ ...tab, command: action.command }));
  }
}

export function consoleTabLabel(tab: ConsoleTab, tabCount: number): string {
  return tabCount === 1 ? "Console" : `Console ${tab.ordinal}`;
}

export function terminalErrorResult(command: string, error: unknown): SandboxTerminalResult {
  return {
    command,
    durationMs: 0,
    exitCode: 1,
    stderr: error instanceof Error ? error.message : "Terminal command failed",
    stdout: "",
    success: false,
  };
}

export function terminalHostFromPreview(previewUrl: null | string, scopeKey: string): string {
  const fallback = scopeKey.slice(0, 8);
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

function createConsoleTab(ordinal: number, cwd = DEFAULT_TERMINAL_CWD): ConsoleTab {
  return {
    command: "",
    cwd,
    entries: [],
    id: ordinal === 1 ? INITIAL_CONSOLE_ID : `console-${ordinal}-${crypto.randomUUID()}`,
    ordinal,
  };
}

function addConsoleTab(state: ConsoleTerminalState, cwd?: string): ConsoleTerminalState {
  const tab = createConsoleTab(state.nextOrdinal, cwd);
  return {
    ...state,
    activeConsoleId: tab.id,
    nextOrdinal: state.nextOrdinal + 1,
    tabs: [...state.tabs, tab],
  };
}

function closeConsoleTab(state: ConsoleTerminalState, tabId: string): ConsoleTerminalState {
  if (state.tabs.length === 1) {
    return state;
  }
  const tabIndex = state.tabs.findIndex((tab) => tab.id === tabId);
  if (tabIndex === -1) {
    return state;
  }
  const tabs = state.tabs.filter((tab) => tab.id !== tabId);
  const adjacentTab = tabs[Math.min(tabIndex, tabs.length - 1)] ?? tabs[0];
  return {
    ...state,
    activeConsoleId:
      state.activeConsoleId === tabId && adjacentTab ? adjacentTab.id : state.activeConsoleId,
    tabs,
  };
}

function applyContextCwd(state: ConsoleTerminalState, cwd: string): ConsoleTerminalState {
  return {
    ...state,
    tabs: state.tabs.map((tab) => (isUntouchedDefaultTab(tab) ? { ...tab, cwd } : tab)),
  };
}

function isUntouchedDefaultTab(tab: ConsoleTab): boolean {
  return tab.entries.length === 0 && tab.command.length === 0 && tab.cwd === DEFAULT_TERMINAL_CWD;
}

function appendTerminalResult(
  state: ConsoleTerminalState,
  input: TerminalMutationInput,
  result: SandboxTerminalResult,
): ConsoleTerminalState {
  return updateTab(state, input.tabId, (tab) => ({
    ...tab,
    cwd: result.cwd ?? input.cwd,
    entries: [
      ...tab.entries,
      {
        command: result.command,
        cwd: input.cwd,
        id: crypto.randomUUID(),
        result,
      },
    ],
  }));
}

function updateTab(
  state: ConsoleTerminalState,
  tabId: string,
  update: (tab: ConsoleTab) => ConsoleTab,
): ConsoleTerminalState {
  return {
    ...state,
    tabs: state.tabs.map((tab) => (tab.id === tabId ? update(tab) : tab)),
  };
}
