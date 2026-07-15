"use client";

import type { ProjectSummary, Thread } from "@cheatcode/types";
import { useAuth } from "@clerk/nextjs";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { type RefObject, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { tabsWithCurrent } from "@/components/chat/chat-context-model";
import { createChat } from "@/lib/api/project-thread";
import { useAppStore } from "@/lib/store/app-store";
import { type ChatWorkspaceTab, useChatTabsStore } from "@/lib/store/chat-tabs-store";

const EMPTY_TABS: ChatWorkspaceTab[] = [];

export interface ChatContextController {
  actions: {
    closeActiveTab: () => void;
    selectFolderChat: (thread: Thread) => void;
    selectTab: (tab: ChatWorkspaceTab) => void;
    startNewChat: () => void;
    toggleFolderChats: () => void;
  };
  meta: { contextRef: RefObject<HTMLDivElement | null> };
  state: {
    folderChatsOpen: boolean;
    isCreatingChat: boolean;
    tabs: readonly ChatWorkspaceTab[];
  };
}

export function useChatContextController({
  project,
  threadId,
  title,
}: {
  project: ProjectSummary | null;
  threadId: string;
  title: null | string | undefined;
}): ChatContextController {
  const tabs = useCurrentChatTabs(project?.id ?? null, threadId, title?.trim() || "New chat");
  const contextRef = useRef<HTMLDivElement | null>(null);
  const [folderChatsOpen, setFolderChatsOpen] = useState(false);
  const creation = useCreateProjectChat(project, setFolderChatsOpen);
  const closeActiveTab = useCloseActiveTab(project, tabs, threadId);
  const selectFolderChat = useSelectFolderChat(project, setFolderChatsOpen);
  useDismissFolderChats(folderChatsOpen, contextRef, setFolderChatsOpen);
  return {
    actions: {
      closeActiveTab,
      selectFolderChat,
      selectTab: useSelectChatTab(),
      startNewChat: creation.startNewChat,
      toggleFolderChats: () => setFolderChatsOpen((current) => !current),
    },
    meta: { contextRef },
    state: { folderChatsOpen, isCreatingChat: creation.isCreatingChat, tabs },
  };
}

function useCurrentChatTabs(projectId: string | null, threadId: string, title: string) {
  const openChatTab = useChatTabsStore((state) => state.openChatTab);
  const storedTabs = useChatTabsStore((state) =>
    projectId ? (state.tabsByProject[projectId] ?? EMPTY_TABS) : EMPTY_TABS,
  );
  const tabs = useMemo(
    () => tabsWithCurrent(storedTabs, projectId, threadId, title),
    [projectId, storedTabs, threadId, title],
  );
  useEffect(() => {
    if (projectId) openChatTab({ id: threadId, projectId, title });
  }, [openChatTab, projectId, threadId, title]);
  return tabs;
}

function useCreateProjectChat(
  project: ProjectSummary | null,
  setFolderChatsOpen: (open: boolean) => void,
) {
  const { getToken } = useAuth();
  const router = useRouter();
  const queryClient = useQueryClient();
  const openChatTab = useChatTabsStore((state) => state.openChatTab);
  const setPreviewPanelOpen = useAppStore((state) => state.setPreviewPanelOpen);
  const mutation = useMutation({
    mutationFn: (projectId: string) => createChat(getToken, { projectId }),
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Couldn't start a chat");
    },
    onSuccess: (thread) => {
      if (!project) return;
      openChatTab(
        { id: thread.id, projectId: project.id, title: thread.title?.trim() || "New chat" },
        "start",
      );
      void queryClient.invalidateQueries({ queryKey: ["sidebar-chats"] });
      void queryClient.invalidateQueries({ queryKey: ["sidebar-project-threads"] });
      void queryClient.invalidateQueries({ queryKey: ["folder-chats", project.id] });
      router.push(`/chats/${encodeURIComponent(thread.id)}`);
    },
  });
  const startNewChat = useCallback(() => {
    if (!project || mutation.isPending) return;
    setFolderChatsOpen(false);
    setPreviewPanelOpen(false);
    mutation.mutate(project.id);
  }, [mutation, project, setFolderChatsOpen, setPreviewPanelOpen]);
  return { isCreatingChat: mutation.isPending, startNewChat };
}

function useCloseActiveTab(
  project: ProjectSummary | null,
  tabs: readonly ChatWorkspaceTab[],
  threadId: string,
) {
  const router = useRouter();
  const closeChatTab = useChatTabsStore((state) => state.closeChatTab);
  const setPreviewPanelOpen = useAppStore((state) => state.setPreviewPanelOpen);
  return useCallback(() => {
    if (!project || tabs.length < 2) return;
    const currentIndex = tabs.findIndex((tab) => tab.id === threadId);
    const nextTab = tabs[currentIndex - 1] ?? tabs[currentIndex + 1];
    if (!nextTab) return;
    closeChatTab(project.id, threadId);
    setPreviewPanelOpen(false);
    router.push(`/chats/${encodeURIComponent(nextTab.id)}`);
  }, [closeChatTab, project, router, setPreviewPanelOpen, tabs, threadId]);
}

function useSelectChatTab() {
  const router = useRouter();
  const setPreviewPanelOpen = useAppStore((state) => state.setPreviewPanelOpen);
  return useCallback(
    (tab: ChatWorkspaceTab) => {
      setPreviewPanelOpen(false);
      router.push(`/chats/${encodeURIComponent(tab.id)}`);
    },
    [router, setPreviewPanelOpen],
  );
}

function useSelectFolderChat(
  project: ProjectSummary | null,
  setFolderChatsOpen: (open: boolean) => void,
) {
  const router = useRouter();
  const openChatTab = useChatTabsStore((state) => state.openChatTab);
  const setPreviewPanelOpen = useAppStore((state) => state.setPreviewPanelOpen);
  return useCallback(
    (thread: Thread) => {
      if (!project) return;
      openChatTab({
        id: thread.id,
        projectId: project.id,
        title: thread.title?.trim() || "New chat",
      });
      setFolderChatsOpen(false);
      setPreviewPanelOpen(false);
      router.push(`/chats/${encodeURIComponent(thread.id)}`);
    },
    [openChatTab, project, router, setFolderChatsOpen, setPreviewPanelOpen],
  );
}

function useDismissFolderChats(
  isOpen: boolean,
  contextRef: RefObject<HTMLDivElement | null>,
  setIsOpen: (open: boolean) => void,
) {
  useEffect(() => {
    if (!isOpen) return;
    const closeOnPointer = (event: PointerEvent) => {
      if (!contextRef.current?.contains(event.target as Node)) setIsOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsOpen(false);
    };
    document.addEventListener("pointerdown", closeOnPointer);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnPointer);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [contextRef, isOpen, setIsOpen]);
}
