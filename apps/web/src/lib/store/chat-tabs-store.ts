"use client";

import { create } from "zustand";

const MAX_OPEN_TABS = 8;

export interface ChatWorkspaceTab {
  id: string;
  projectId: string;
  title: string;
}

interface ChatTabsStore {
  tabsByProject: Record<string, ChatWorkspaceTab[]>;
  closeChatTab: (projectId: string, threadId: string) => void;
  closeProjectTabs: (projectId: string) => void;
  openChatTab: (tab: ChatWorkspaceTab, placement?: "end" | "start") => void;
  resetChatTabs: () => void;
}

export const useChatTabsStore = create<ChatTabsStore>((set) => ({
  tabsByProject: {},
  closeChatTab: (projectId, threadId) =>
    set((state) => ({
      tabsByProject: {
        ...state.tabsByProject,
        [projectId]: (state.tabsByProject[projectId] ?? []).filter((tab) => tab.id !== threadId),
      },
    })),
  closeProjectTabs: (projectId) =>
    set((state) => {
      const tabsByProject = { ...state.tabsByProject };
      delete tabsByProject[projectId];
      return { tabsByProject };
    }),
  openChatTab: (tab, placement = "end") =>
    set((state) => {
      const projectTabs = state.tabsByProject[tab.projectId] ?? [];
      const existingIndex = projectTabs.findIndex((candidate) => candidate.id === tab.id);
      const nextTabs =
        existingIndex === -1
          ? placeNewTab(projectTabs, tab, placement)
          : projectTabs.map((candidate, index) => (index === existingIndex ? tab : candidate));
      return {
        tabsByProject: {
          ...state.tabsByProject,
          [tab.projectId]: nextTabs,
        },
      };
    }),
  resetChatTabs: () => set({ tabsByProject: {} }),
}));

function placeNewTab(
  tabs: readonly ChatWorkspaceTab[],
  tab: ChatWorkspaceTab,
  placement: "end" | "start",
): ChatWorkspaceTab[] {
  if (placement === "start") {
    return [tab, ...tabs].slice(0, MAX_OPEN_TABS);
  }
  return [...tabs, tab].slice(-MAX_OPEN_TABS);
}
