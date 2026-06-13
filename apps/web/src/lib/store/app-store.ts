"use client";

import type { SandboxConsoleProcess, SandboxState } from "@cheatcode/types";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { type AgentModelId, DEFAULT_AGENT_MODEL_ID, isAgentModelId } from "@/lib/agent-models";
import { type ConsoleLine, mergeConsoleLines } from "@/lib/preview/console";

export type PreviewTab = "app" | "browser" | "env" | "files" | "terminal";
export type ConnectionState = "online" | "offline";

interface ConsoleCursor {
  stderr: number;
  stdout: number;
}

interface StreamReconnect {
  at: number;
  fromSeq: number;
}

const PREVIEW_PATH_HISTORY_MAX = 50;

interface AppStore {
  activePreviewTab: PreviewTab;
  agentModelId: AgentModelId;
  budgetCapUsdByThread: Record<string, number | null>;
  commandPaletteOpen: boolean;
  connectionState: ConnectionState;
  consoleCursor: ConsoleCursor;
  consoleLines: ConsoleLine[];
  consoleProcess: SandboxConsoleProcess | null;
  consoleStripOpen: boolean;
  consoleTruncated: boolean;
  draftByThread: Record<string, string>;
  expoUrl: string | null;
  previewPanelOpen: boolean;
  previewPath: string;
  previewPathHistory: string[];
  previewReloadToken: number;
  previewUrl: string | null;
  sandboxStatus: SandboxState;
  sidebarOpen: boolean;
  streamReconnect: StreamReconnect | null;
  appendConsoleLines: (
    lines: ConsoleLine[],
    cursor: ConsoleCursor,
    process: SandboxConsoleProcess | null,
    truncated: boolean,
  ) => void;
  bumpPreviewReloadToken: () => void;
  clearDraft: (threadId: string) => void;
  goBackPreviewPath: () => void;
  navigatePreviewPath: (path: string) => void;
  resetConsole: () => void;
  resetPreviewNavigation: () => void;
  setActivePreviewTab: (tab: PreviewTab) => void;
  setAgentModelId: (modelId: AgentModelId) => void;
  setBudgetCapUsd: (threadId: string, value: number | null) => void;
  setCommandPaletteOpen: (open: boolean) => void;
  setConnectionState: (state: ConnectionState) => void;
  setConsoleStripOpen: (open: boolean) => void;
  setDraft: (threadId: string, value: string) => void;
  setExpoUrl: (url: string | null) => void;
  setPreviewPanelOpen: (open: boolean) => void;
  setPreviewUrl: (url: string | null) => void;
  setSandboxStatus: (status: SandboxState) => void;
  setSidebarOpen: (open: boolean) => void;
  setStreamReconnect: (value: StreamReconnect | null) => void;
}

type PersistedAppStore = Pick<
  AppStore,
  "activePreviewTab" | "agentModelId" | "budgetCapUsdByThread"
>;

export const useAppStore = create<AppStore>()(
  persist(
    (set) => ({
      activePreviewTab: "app",
      agentModelId: DEFAULT_AGENT_MODEL_ID,
      budgetCapUsdByThread: {},
      commandPaletteOpen: false,
      connectionState: "online",
      consoleCursor: { stderr: 0, stdout: 0 },
      consoleLines: [],
      consoleProcess: null,
      consoleStripOpen: false,
      consoleTruncated: false,
      draftByThread: {},
      expoUrl: null,
      previewPanelOpen: false,
      previewPath: "/",
      previewPathHistory: [],
      previewReloadToken: 0,
      previewUrl: null,
      sandboxStatus: "cold",
      sidebarOpen: false,
      streamReconnect: null,
      appendConsoleLines: (lines, cursor, process, truncated) =>
        set((state) => ({
          consoleCursor: cursor,
          consoleLines: mergeConsoleLines(state.consoleLines, lines),
          consoleProcess: process,
          consoleTruncated: state.consoleTruncated || truncated,
        })),
      bumpPreviewReloadToken: () =>
        set((state) => ({ previewReloadToken: state.previewReloadToken + 1 })),
      clearDraft: (threadId) =>
        set((state) => {
          const nextDraftByThread = { ...state.draftByThread };
          nextDraftByThread[threadId] = "";
          return { draftByThread: nextDraftByThread };
        }),
      goBackPreviewPath: () =>
        set((state) => {
          if (state.previewPathHistory.length === 0) {
            return {};
          }
          const history = [...state.previewPathHistory];
          const previous = history.pop() ?? "/";
          return { previewPath: previous, previewPathHistory: history };
        }),
      navigatePreviewPath: (path) =>
        set((state) => {
          if (path === state.previewPath) {
            return {};
          }
          const history = [...state.previewPathHistory, state.previewPath];
          return {
            previewPath: path,
            previewPathHistory:
              history.length > PREVIEW_PATH_HISTORY_MAX
                ? history.slice(history.length - PREVIEW_PATH_HISTORY_MAX)
                : history,
          };
        }),
      resetConsole: () =>
        set({
          consoleCursor: { stderr: 0, stdout: 0 },
          consoleLines: [],
          consoleProcess: null,
          consoleTruncated: false,
        }),
      resetPreviewNavigation: () => set({ previewPath: "/", previewPathHistory: [] }),
      setActivePreviewTab: (tab) => set({ activePreviewTab: tab }),
      setAgentModelId: (agentModelId) => set({ agentModelId }),
      setCommandPaletteOpen: (commandPaletteOpen) => set({ commandPaletteOpen }),
      setBudgetCapUsd: (threadId, value) =>
        set((state) => ({
          budgetCapUsdByThread: { ...state.budgetCapUsdByThread, [threadId]: value },
        })),
      setConnectionState: (connectionState) => set({ connectionState }),
      setConsoleStripOpen: (consoleStripOpen) => set({ consoleStripOpen }),
      setDraft: (threadId, value) =>
        set((state) => ({
          draftByThread: { ...state.draftByThread, [threadId]: value },
        })),
      setExpoUrl: (expoUrl) => set({ expoUrl }),
      setPreviewPanelOpen: (previewPanelOpen) => set({ previewPanelOpen }),
      setPreviewUrl: (previewUrl) => set({ previewUrl }),
      setSandboxStatus: (sandboxStatus) => set({ sandboxStatus }),
      setSidebarOpen: (sidebarOpen) => set({ sidebarOpen }),
      setStreamReconnect: (streamReconnect) => set({ streamReconnect }),
    }),
    {
      name: "cheatcode-ui",
      partialize: (state): PersistedAppStore => ({
        activePreviewTab: state.activePreviewTab,
        agentModelId: state.agentModelId,
        budgetCapUsdByThread: state.budgetCapUsdByThread,
      }),
      migrate: migratePersistedState,
      version: 5,
      skipHydration: true,
      storage: createJSONStorage(() => localStorage),
    },
  ),
);

function migratePersistedState(persistedState: unknown): PersistedAppStore {
  if (!isRecord(persistedState)) {
    return {
      activePreviewTab: "app",
      agentModelId: DEFAULT_AGENT_MODEL_ID,
      budgetCapUsdByThread: {},
    };
  }
  return {
    activePreviewTab: migratePreviewTab(persistedState["activePreviewTab"]),
    agentModelId: migrateAgentModelId(persistedState["agentModelId"]),
    budgetCapUsdByThread: migrateBudgetCaps(persistedState["budgetCapUsdByThread"]),
  };
}

function migratePreviewTab(value: unknown): PreviewTab {
  if (
    value === "app" ||
    value === "browser" ||
    value === "env" ||
    value === "files" ||
    value === "terminal"
  ) {
    return value;
  }
  if (value === "code" || value === "data") {
    return "files";
  }
  return "app";
}

function migrateAgentModelId(value: unknown): AgentModelId {
  return isAgentModelId(value) ? value : DEFAULT_AGENT_MODEL_ID;
}

function migrateBudgetCaps(value: unknown): Record<string, number | null> {
  if (!isRecord(value)) {
    return {};
  }
  const output: Record<string, number | null> = {};
  for (const [threadId, budgetCapUsd] of Object.entries(value)) {
    if (budgetCapUsd === null) {
      output[threadId] = null;
    }
    if (typeof budgetCapUsd === "number" && budgetCapUsd > 0 && budgetCapUsd <= 5) {
      output[threadId] = budgetCapUsd;
    }
  }
  return output;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
