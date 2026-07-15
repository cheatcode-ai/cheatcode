import type { SandboxTerminalResult } from "@cheatcode/types";

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
