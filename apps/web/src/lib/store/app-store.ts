"use client";

import type { SandboxConsoleProcess, SandboxState } from "@cheatcode/types";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { type AgentModelId, DEFAULT_AGENT_MODEL_ID, isAgentModelId } from "@/lib/agent-models";
import { type ConsoleLine, mergeConsoleLines } from "@/lib/preview/console";

export type PreviewTab = "app" | "files";
export type PreviewDevice = "desktop" | "tablet" | "phone";
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
  connectionState: ConnectionState;
  consoleCursor: ConsoleCursor;
  consoleLines: ConsoleLine[];
  consoleProcess: SandboxConsoleProcess | null;
  consoleStripOpen: boolean;
  consoleTruncated: boolean;
  draftByThread: Record<string, string>;
  expoUrl: string | null;
  previewDevice: PreviewDevice;
  previewPanelOpen: boolean;
  previewPath: string;
  previewPathHistory: string[];
  previewReloadToken: number;
  previewUrl: string | null;
  sandboxStatus: SandboxState;
  sidebarCollapsed: boolean;
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
  setConnectionState: (state: ConnectionState) => void;
  setConsoleStripOpen: (open: boolean) => void;
  setDraft: (threadId: string, value: string) => void;
  setExpoUrl: (url: string | null) => void;
  setPreviewDevice: (device: PreviewDevice) => void;
  setPreviewPanelOpen: (open: boolean) => void;
  setPreviewUrl: (url: string | null) => void;
  setSandboxStatus: (status: SandboxState) => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  setSidebarOpen: (open: boolean) => void;
  setStreamReconnect: (value: StreamReconnect | null) => void;
}

type PersistedAppStore = Pick<
  AppStore,
  "activePreviewTab" | "agentModelId" | "previewDevice" | "sidebarCollapsed"
>;

export const useAppStore = create<AppStore>()(
  persist(
    (set) => ({
      activePreviewTab: "app",
      agentModelId: DEFAULT_AGENT_MODEL_ID,
      connectionState: "online",
      consoleCursor: { stderr: 0, stdout: 0 },
      consoleLines: [],
      consoleProcess: null,
      consoleStripOpen: false,
      consoleTruncated: false,
      draftByThread: {},
      expoUrl: null,
      previewDevice: "desktop",
      previewPanelOpen: false,
      previewPath: "/",
      previewPathHistory: [],
      previewReloadToken: 0,
      previewUrl: null,
      sandboxStatus: "cold",
      sidebarCollapsed: false,
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
      setConnectionState: (connectionState) => set({ connectionState }),
      setConsoleStripOpen: (consoleStripOpen) => set({ consoleStripOpen }),
      setDraft: (threadId, value) =>
        set((state) => ({
          draftByThread: { ...state.draftByThread, [threadId]: value },
        })),
      setExpoUrl: (expoUrl) => set({ expoUrl }),
      setPreviewDevice: (previewDevice) => set({ previewDevice }),
      setPreviewPanelOpen: (previewPanelOpen) => set({ previewPanelOpen }),
      setPreviewUrl: (previewUrl) => set({ previewUrl }),
      setSandboxStatus: (sandboxStatus) => set({ sandboxStatus }),
      setSidebarCollapsed: (sidebarCollapsed) => set({ sidebarCollapsed }),
      setSidebarOpen: (sidebarOpen) => set({ sidebarOpen }),
      setStreamReconnect: (streamReconnect) => set({ streamReconnect }),
    }),
    {
      name: "cheatcode-ui",
      partialize: (state): PersistedAppStore => ({
        activePreviewTab: state.activePreviewTab,
        agentModelId: state.agentModelId,
        previewDevice: state.previewDevice,
        sidebarCollapsed: state.sidebarCollapsed,
      }),
      migrate: migratePersistedState,
      version: 8,
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
      previewDevice: "desktop",
      sidebarCollapsed: false,
    };
  }
  return {
    activePreviewTab: migratePreviewTab(persistedState["activePreviewTab"]),
    agentModelId: migrateAgentModelId(persistedState["agentModelId"]),
    previewDevice: migratePreviewDevice(persistedState["previewDevice"]),
    sidebarCollapsed: persistedState["sidebarCollapsed"] === true,
  };
}

function migratePreviewTab(value: unknown): PreviewTab {
  if (value === "files" || value === "code" || value === "data" || value === "env") {
    return "files";
  }
  if (value === "app" || value === "browser" || value === "terminal") {
    return "app";
  }
  return "app";
}

function migratePreviewDevice(value: unknown): PreviewDevice {
  if (value === "desktop" || value === "tablet" || value === "phone") {
    return value;
  }
  return "desktop";
}

function migrateAgentModelId(value: unknown): AgentModelId {
  return isAgentModelId(value) ? value : DEFAULT_AGENT_MODEL_ID;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
