"use client";

import type { SandboxConsoleProcess, SandboxState } from "@cheatcode/types";
import { create, type StateCreator } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { type AgentModelId, DEFAULT_AGENT_MODEL_ID, isAgentModelId } from "@/lib/agent-models";
import { type ConsoleLine, mergeConsoleLines } from "@/lib/preview/console";

export type PreviewTab = "app" | "files";
export type PreviewDevice = "desktop" | "tablet" | "phone";
type ConnectionState = "online" | "offline";

interface ConsoleCursor {
  stderr: number;
  stdout: number;
}

interface StreamReconnect {
  at: number;
  fromSeq: number;
}

const PREVIEW_PATH_HISTORY_MAX = 50;

interface AppStoreState {
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
}

interface AppStoreActions {
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
  resetIdentityState: () => void;
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

interface AppStore extends AppStoreState, AppStoreActions {}

type PersistedAppStore = Pick<
  AppStore,
  "activePreviewTab" | "agentModelId" | "previewDevice" | "sidebarCollapsed"
>;

const DEFAULT_PERSISTED_APP_STORE: PersistedAppStore = {
  activePreviewTab: "app",
  agentModelId: DEFAULT_AGENT_MODEL_ID,
  previewDevice: "desktop",
  sidebarCollapsed: false,
};

export const useAppStore = create<AppStore>()(
  persist(createAppStore, {
    merge: mergePersistedAppStore,
    migrate: () => ({ ...DEFAULT_PERSISTED_APP_STORE }),
    name: "cheatcode-ui-v2",
    // Preview and Expo URLs are bearer capabilities. They must remain memory-only and are
    // reacquired from authenticated endpoints whenever the corresponding panel opens.
    partialize: (state): PersistedAppStore => ({
      activePreviewTab: state.activePreviewTab,
      agentModelId: state.agentModelId,
      previewDevice: state.previewDevice,
      sidebarCollapsed: state.sidebarCollapsed,
    }),
    skipHydration: true,
    storage: createJSONStorage(() => localStorage),
    version: 1,
  }),
);

type AppStoreSet = Parameters<StateCreator<AppStore>>[0];

function createAppStore(set: AppStoreSet): AppStore {
  return {
    ...initialAppStoreState(),
    ...createConsoleActions(set),
    ...createDraftActions(set),
    ...createPreviewActions(set),
    ...createUiActions(set),
  };
}

function initialAppStoreState(): AppStoreState {
  return {
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
  };
}

function createConsoleActions(set: AppStoreSet) {
  return {
    appendConsoleLines: (
      lines: ConsoleLine[],
      cursor: ConsoleCursor,
      process: SandboxConsoleProcess | null,
      truncated: boolean,
    ) =>
      set((state) => ({
        consoleCursor: cursor,
        consoleLines: mergeConsoleLines(state.consoleLines, lines),
        consoleProcess: process,
        consoleTruncated: state.consoleTruncated || truncated,
      })),
    resetConsole: () =>
      set({
        consoleCursor: { stderr: 0, stdout: 0 },
        consoleLines: [],
        consoleProcess: null,
        consoleTruncated: false,
      }),
    setConsoleStripOpen: (consoleStripOpen: boolean) => set({ consoleStripOpen }),
  };
}

function createDraftActions(set: AppStoreSet) {
  return {
    clearDraft: (threadId: string) =>
      set((state) => {
        const nextDraftByThread = { ...state.draftByThread };
        nextDraftByThread[threadId] = "";
        return { draftByThread: nextDraftByThread };
      }),
    setDraft: (threadId: string, value: string) =>
      set((state) => ({
        draftByThread: { ...state.draftByThread, [threadId]: value },
      })),
  };
}

function createPreviewActions(set: AppStoreSet) {
  return {
    bumpPreviewReloadToken: () =>
      set((state) => ({ previewReloadToken: state.previewReloadToken + 1 })),
    goBackPreviewPath: () => set(goBackPreviewPath),
    navigatePreviewPath: (path: string) => set((state) => navigatePreviewPath(state, path)),
    resetPreviewNavigation: () => set({ previewPath: "/", previewPathHistory: [] }),
    setActivePreviewTab: (activePreviewTab: PreviewTab) => set({ activePreviewTab }),
    setExpoUrl: (expoUrl: string | null) => set({ expoUrl }),
    setPreviewDevice: (previewDevice: PreviewDevice) => set({ previewDevice }),
    setPreviewPanelOpen: (previewPanelOpen: boolean) => set({ previewPanelOpen }),
    setPreviewUrl: (previewUrl: string | null) => set({ previewUrl }),
  };
}

function goBackPreviewPath(state: AppStore): Partial<AppStore> {
  if (state.previewPathHistory.length === 0) return {};
  const history = [...state.previewPathHistory];
  const previous = history.pop() ?? "/";
  return { previewPath: previous, previewPathHistory: history };
}

function navigatePreviewPath(state: AppStore, path: string): Partial<AppStore> {
  if (path === state.previewPath) return {};
  const history = [...state.previewPathHistory, state.previewPath];
  return {
    previewPath: path,
    previewPathHistory:
      history.length > PREVIEW_PATH_HISTORY_MAX
        ? history.slice(history.length - PREVIEW_PATH_HISTORY_MAX)
        : history,
  };
}

function createUiActions(set: AppStoreSet) {
  return {
    resetIdentityState: () => set(identityScopedInitialState()),
    setAgentModelId: (agentModelId: AgentModelId) => set({ agentModelId }),
    setConnectionState: (connectionState: ConnectionState) => set({ connectionState }),
    setSandboxStatus: (sandboxStatus: SandboxState) => set({ sandboxStatus }),
    setSidebarCollapsed: (sidebarCollapsed: boolean) => set({ sidebarCollapsed }),
    setSidebarOpen: (sidebarOpen: boolean) => set({ sidebarOpen }),
    setStreamReconnect: (streamReconnect: StreamReconnect | null) => set({ streamReconnect }),
  };
}

function mergePersistedAppStore(persisted: unknown, current: AppStore): AppStore {
  if (!isRecord(persisted)) {
    return current;
  }
  return {
    ...current,
    activePreviewTab:
      persisted["activePreviewTab"] === "app" || persisted["activePreviewTab"] === "files"
        ? persisted["activePreviewTab"]
        : current.activePreviewTab,
    agentModelId: isAgentModelId(persisted["agentModelId"])
      ? persisted["agentModelId"]
      : current.agentModelId,
    previewDevice: isPreviewDevice(persisted["previewDevice"])
      ? persisted["previewDevice"]
      : current.previewDevice,
    sidebarCollapsed:
      typeof persisted["sidebarCollapsed"] === "boolean"
        ? persisted["sidebarCollapsed"]
        : current.sidebarCollapsed,
  };
}

function isPreviewDevice(value: unknown): value is PreviewDevice {
  return value === "desktop" || value === "tablet" || value === "phone";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function identityScopedInitialState(): Pick<
  AppStore,
  | "consoleCursor"
  | "consoleLines"
  | "consoleProcess"
  | "consoleStripOpen"
  | "consoleTruncated"
  | "draftByThread"
  | "expoUrl"
  | "previewPanelOpen"
  | "previewPath"
  | "previewPathHistory"
  | "previewReloadToken"
  | "previewUrl"
  | "sandboxStatus"
  | "sidebarOpen"
  | "streamReconnect"
> {
  return {
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
  };
}
