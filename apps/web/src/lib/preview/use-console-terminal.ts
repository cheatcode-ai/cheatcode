"use client";

import type { Dispatch } from "react";
import { useMemo, useReducer } from "react";
import type {
  ConsoleTab,
  ConsoleTerminalAction,
  GetToken,
  TerminalMutationInput,
} from "./console-terminal.types";
import {
  consoleTerminalReducer,
  createConsoleTerminalState,
  DEFAULT_TERMINAL_DISPLAY_WORKSPACE,
  terminalHostFromPreview,
} from "./console-terminal-state";
import {
  terminalScopeKey,
  useContextCwd,
  useTerminalContext,
  useTerminalMutation,
} from "./use-console-terminal-data";

type TerminalDispatch = Dispatch<ConsoleTerminalAction>;

interface UseConsoleTerminalInput {
  getToken: GetToken;
  isReady: boolean;
  onOpen: () => void;
  previewUrl: null | string;
  threadId: null | string;
}

interface ConsoleTerminalController {
  activeConsole: ConsoleTab | undefined;
  addConsoleTab: () => void;
  closeConsoleTab: (tabId: string) => void;
  consoleTabs: ConsoleTab[];
  displayWorkspacePath: string;
  isDisabled: boolean;
  isReady: boolean;
  pendingCommand: string | null;
  selectConsoleTab: (tabId: string) => void;
  submitActiveCommand: () => void;
  terminalHost: string;
  updateActiveCommand: (command: string) => void;
}

export function useConsoleTerminal({
  getToken,
  isReady,
  onOpen,
  previewUrl,
  threadId,
}: UseConsoleTerminalInput): ConsoleTerminalController {
  const [state, dispatch] = useReducer(
    consoleTerminalReducer,
    undefined,
    createConsoleTerminalState,
  );
  const terminalContext = useTerminalContext(getToken, threadId, isReady);
  useContextCwd(dispatch, terminalContext?.cwd);
  const mutation = useTerminalMutation(getToken, threadId, dispatch);
  const activeConsole = useMemo(
    () => state.tabs.find((tab) => tab.id === state.activeConsoleId) ?? state.tabs[0],
    [state.activeConsoleId, state.tabs],
  );
  const isDisabled = !isReady || mutation.isPending;
  return {
    activeConsole,
    consoleTabs: state.tabs,
    displayWorkspacePath:
      terminalContext?.displayWorkspacePath ?? DEFAULT_TERMINAL_DISPLAY_WORKSPACE,
    isDisabled,
    isReady,
    pendingCommand:
      state.pendingCommand && activeConsole && state.pendingCommand.tabId === activeConsole.id
        ? state.pendingCommand.command
        : null,
    terminalHost:
      terminalContext?.host ?? terminalHostFromPreview(previewUrl, terminalScopeKey(threadId)),
    ...createTerminalActions({
      activeConsole,
      dispatch,
      isDisabled,
      mutate: mutation.mutate,
      onOpen,
      terminalCwd: terminalContext?.cwd,
    }),
  };
}

interface CreateTerminalActionsInput {
  activeConsole: ConsoleTab | undefined;
  dispatch: TerminalDispatch;
  isDisabled: boolean;
  mutate: (input: TerminalMutationInput) => void;
  onOpen: () => void;
  terminalCwd: string | undefined;
}

function createTerminalActions({
  activeConsole,
  dispatch,
  isDisabled,
  mutate,
  onOpen,
  terminalCwd,
}: CreateTerminalActionsInput): Pick<
  ConsoleTerminalController,
  | "addConsoleTab"
  | "closeConsoleTab"
  | "selectConsoleTab"
  | "submitActiveCommand"
  | "updateActiveCommand"
> {
  return {
    addConsoleTab: () => {
      dispatch(
        terminalCwd === undefined ? { type: "add-tab" } : { cwd: terminalCwd, type: "add-tab" },
      );
      onOpen();
    },
    closeConsoleTab: (tabId) => dispatch({ tabId, type: "close-tab" }),
    selectConsoleTab: (tabId) => {
      dispatch({ tabId, type: "select-tab" });
      onOpen();
    },
    submitActiveCommand: () => submitCommand(activeConsole, isDisabled, dispatch, mutate),
    updateActiveCommand: (command) => {
      if (activeConsole) {
        dispatch({ command, tabId: activeConsole.id, type: "update-command" });
      }
    },
  };
}

function submitCommand(
  activeConsole: ConsoleTab | undefined,
  isDisabled: boolean,
  dispatch: TerminalDispatch,
  mutate: (input: TerminalMutationInput) => void,
): void {
  const command = activeConsole?.command.trim() ?? "";
  if (!activeConsole || isDisabled || command.length === 0) {
    return;
  }
  dispatch({ tabId: activeConsole.id, type: "clear-command" });
  mutate({ command, cwd: activeConsole.cwd, tabId: activeConsole.id });
}
