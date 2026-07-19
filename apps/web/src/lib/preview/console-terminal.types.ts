import type { SandboxTerminalResult } from "@cheatcode/types";

export type GetToken = () => Promise<null | string>;

export interface ConsoleTerminalEntry {
  command: string;
  cwd: string;
  id: string;
  result: SandboxTerminalResult;
}

export interface ConsoleTab {
  command: string;
  cwd: string;
  entries: ConsoleTerminalEntry[];
  id: string;
  ordinal: number;
}

export interface PendingTerminalCommand {
  command: string;
  tabId: string;
}

export interface TerminalMutationInput {
  command: string;
  cwd: string;
  tabId: string;
}

export type ConsoleTerminalAction =
  | { type: "add-tab"; cwd?: string }
  | { type: "append-result"; input: TerminalMutationInput; result: SandboxTerminalResult }
  | { type: "clear-command"; tabId: string }
  | { type: "close-tab"; tabId: string }
  | { type: "select-tab"; tabId: string }
  | { type: "set-context-cwd"; cwd: string }
  | { type: "set-pending"; command: PendingTerminalCommand | null }
  | { type: "update-command"; command: string; tabId: string };
