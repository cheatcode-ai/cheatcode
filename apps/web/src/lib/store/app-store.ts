"use client";

import type { SandboxState } from "@cheatcode/types";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { type AgentModelId, DEFAULT_AGENT_MODEL_ID, isAgentModelId } from "@/lib/agent-models";

export type PreviewTab = "app" | "browser" | "env" | "files" | "terminal";
export type ConnectionState = "online" | "offline";

interface AppStore {
  activePreviewTab: PreviewTab;
  agentModelId: AgentModelId;
  budgetCapUsdByThread: Record<string, number | null>;
  connectionState: ConnectionState;
  draftByThread: Record<string, string>;
  expoUrl: string | null;
  previewPanelOpen: boolean;
  previewReloadToken: number;
  previewUrl: string | null;
  sandboxStatus: SandboxState;
  sidebarOpen: boolean;
  bumpPreviewReloadToken: () => void;
  clearDraft: (threadId: string) => void;
  setActivePreviewTab: (tab: PreviewTab) => void;
  setAgentModelId: (modelId: AgentModelId) => void;
  setBudgetCapUsd: (threadId: string, value: number | null) => void;
  setConnectionState: (state: ConnectionState) => void;
  setDraft: (threadId: string, value: string) => void;
  setExpoUrl: (url: string | null) => void;
  setPreviewPanelOpen: (open: boolean) => void;
  setPreviewUrl: (url: string | null) => void;
  setSandboxStatus: (status: SandboxState) => void;
  setSidebarOpen: (open: boolean) => void;
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
      connectionState: "online",
      draftByThread: {},
      expoUrl: null,
      previewPanelOpen: false,
      previewReloadToken: 0,
      previewUrl: null,
      sandboxStatus: "cold",
      sidebarOpen: false,
      bumpPreviewReloadToken: () =>
        set((state) => ({ previewReloadToken: state.previewReloadToken + 1 })),
      clearDraft: (threadId) =>
        set((state) => {
          const nextDraftByThread = { ...state.draftByThread };
          nextDraftByThread[threadId] = "";
          return { draftByThread: nextDraftByThread };
        }),
      setActivePreviewTab: (tab) => set({ activePreviewTab: tab }),
      setAgentModelId: (agentModelId) => set({ agentModelId }),
      setBudgetCapUsd: (threadId, value) =>
        set((state) => ({
          budgetCapUsdByThread: { ...state.budgetCapUsdByThread, [threadId]: value },
        })),
      setConnectionState: (connectionState) => set({ connectionState }),
      setDraft: (threadId, value) =>
        set((state) => ({
          draftByThread: { ...state.draftByThread, [threadId]: value },
        })),
      setExpoUrl: (expoUrl) => set({ expoUrl }),
      setPreviewPanelOpen: (previewPanelOpen) => set({ previewPanelOpen }),
      setPreviewUrl: (previewUrl) => set({ previewUrl }),
      setSandboxStatus: (sandboxStatus) => set({ sandboxStatus }),
      setSidebarOpen: (sidebarOpen) => set({ sidebarOpen }),
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
