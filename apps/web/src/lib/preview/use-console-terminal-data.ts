import type { SandboxTerminalContext } from "@cheatcode/types";
import { useMutation, useQuery } from "@tanstack/react-query";
import type { Dispatch } from "react";
import { useEffect } from "react";
import { toast } from "sonner";
import {
  readComputerTerminalContext,
  readSandboxTerminalContext,
  runComputerTerminal,
  runSandboxTerminal,
} from "@/lib/api/sandbox";
import type {
  ConsoleTerminalAction,
  GetToken,
  TerminalMutationInput,
} from "./console-terminal.types";
import { terminalErrorResult } from "./console-terminal-state";

type TerminalDispatch = Dispatch<ConsoleTerminalAction>;

export function useTerminalContext(
  getToken: GetToken,
  threadId: null | string,
  isReady: boolean,
): SandboxTerminalContext | undefined {
  return useQuery({
    enabled: isReady,
    queryFn: ({ signal }) => readTerminalContext(getToken, threadId, signal),
    queryKey: ["sandbox-terminal-context", terminalScopeKey(threadId)],
    retry: 1,
    staleTime: 30_000,
  }).data;
}

export function useContextCwd(dispatch: TerminalDispatch, cwd: string | undefined): void {
  useEffect(() => {
    if (cwd !== undefined) {
      dispatch({ type: "set-context-cwd", cwd });
    }
  }, [cwd, dispatch]);
}

export function useTerminalMutation(
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

function readTerminalContext(getToken: GetToken, threadId: null | string, signal: AbortSignal) {
  return threadId === null
    ? readComputerTerminalContext(getToken, signal)
    : readSandboxTerminalContext(getToken, threadId, signal);
}

function runTerminal(getToken: GetToken, threadId: null | string, input: TerminalMutationInput) {
  return threadId === null
    ? runComputerTerminal(getToken, input.command, input.cwd)
    : runSandboxTerminal(getToken, threadId, input.command, input.cwd);
}

export function terminalScopeKey(threadId: null | string): string {
  return threadId ?? "computer";
}
