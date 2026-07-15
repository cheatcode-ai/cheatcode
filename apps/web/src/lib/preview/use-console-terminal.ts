"use client";

import type { SandboxTerminalContext } from "@cheatcode/types";
import { useMutation, useQuery } from "@tanstack/react-query";
import type { Dispatch } from "react";
import { useEffect, useMemo, useReducer } from "react";
import { toast } from "sonner";
import {
  readComputerTerminalContext,
  readSandboxTerminalContext,
  runComputerTerminal,
  runSandboxTerminal,
} from "@/lib/api/sandbox";
import type { ConsoleTab, TerminalMutationInput } from "./console-terminal.types";
import {
  consoleTerminalReducer,
  createConsoleTerminalState,
  DEFAULT_TERMINAL_DISPLAY_WORKSPACE,
  terminalErrorResult,
  terminalHostFromPreview,
} from "./console-terminal-state";

type GetToken = () => Promise<null | string>;
type TerminalDispatch = Dispatch<Parameters<typeof consoleTerminalReducer>[1]>;

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

function useTerminalContext(
  getToken: GetToken,
  threadId: null | string,
  isReady: boolean,
): SandboxTerminalContext | undefined {
  return useQuery({
    enabled: isReady,
    queryFn: () => readTerminalContext(getToken, threadId),
    queryKey: ["sandbox-terminal-context", terminalScopeKey(threadId)],
    retry: 1,
    staleTime: 30_000,
  }).data;
}

function useContextCwd(dispatch: TerminalDispatch, cwd: string | undefined): void {
  useEffect(() => {
    if (cwd !== undefined) {
      dispatch({ type: "set-context-cwd", cwd });
    }
  }, [cwd, dispatch]);
}

function useTerminalMutation(
  getToken: GetToken,
  threadId: null | string,
  dispatch: TerminalDispatch,
) {
  return useMutation({
    mutationFn: (input: TerminalMutationInput) => runTerminal(getToken, threadId, input),
    onError: (error, input) => {
      dispatch({
        input,
        result: terminalErrorResult(input.command, error),
        type: "append-result",
      });
      toast.error(error instanceof Error ? error.message : "Terminal command failed");
    },
    onMutate: (input) => {
      dispatch({ command: input, type: "set-pending" });
    },
    onSettled: () => {
      dispatch({ command: null, type: "set-pending" });
    },
    onSuccess: (result, input) => {
      dispatch({ input, result, type: "append-result" });
    },
  });
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

function readTerminalContext(getToken: GetToken, threadId: null | string) {
  return threadId === null
    ? readComputerTerminalContext(getToken)
    : readSandboxTerminalContext(getToken, threadId);
}

function runTerminal(getToken: GetToken, threadId: null | string, input: TerminalMutationInput) {
  return threadId === null
    ? runComputerTerminal(getToken, input.command, input.cwd)
    : runSandboxTerminal(getToken, threadId, input.command, input.cwd);
}

function terminalScopeKey(threadId: null | string): string {
  return threadId ?? "computer";
}
