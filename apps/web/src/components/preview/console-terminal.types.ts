import type { SandboxTerminalResult } from "@cheatcode/types/api";

export type GetToken = () => Promise<string | null>;

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
  | { kind: "add-tab"; cwd?: string }
  | { kind: "append-result"; input: TerminalMutationInput; result: SandboxTerminalResult }
  | { kind: "clear-command"; tabId: string }
  | { kind: "close-tab"; tabId: string }
  | { kind: "select-tab"; tabId: string }
  | { kind: "set-context-cwd"; cwd: string }
  | { kind: "set-pending"; command: PendingTerminalCommand | null }
  | { kind: "update-command"; command: string; tabId: string };
