"use client";

import { useAuth, useClerk, useUser } from "@clerk/nextjs";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { Dispatch, SetStateAction } from "react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import type { AuthMode } from "@/components/auth/auth-modal";
import {
  type SidebarProject,
  useActiveProjectId,
  useSidebarChats,
  useSidebarProjects,
} from "@/components/shell/sidebar-data";
import { activeChatIdFromPathname } from "@/components/shell/sidebar-navigation-model";
import { updateProject } from "@/lib/api/project-thread";
import { useAppStore } from "@/lib/store/app-store";

export type FullSidebarMode = "docked" | "overlay";

export function useSidebarIdentity() {
  const { getToken, isLoaded, isSignedIn } = useAuth();
  const { signOut } = useClerk();
  const { user } = useUser();
  const primaryEmail = user?.primaryEmailAddress?.emailAddress ?? null;
  return {
    displayName: user?.fullName ?? user?.firstName ?? primaryEmail ?? "cheatcode",
    getToken,
    isLoaded,
    isSignedIn: Boolean(isSignedIn),
    primaryEmail,
    profileImageUrl: user?.hasImage && user.imageUrl ? user.imageUrl : null,
    signOut: () => void signOut({ redirectUrl: "/" }),
  };
}

export function useSidebarNavigationData({
  getToken,
  isSignedIn,
  pathname,
}: {
  getToken: () => Promise<null | string>;
  isSignedIn: boolean;
  pathname: string;
}) {
  const activeThreadId = activeChatIdFromPathname(pathname);
  const activeProjectId = useActiveProjectId(getToken, activeThreadId, isSignedIn);
  return {
    activeProjectId,
    activeThreadId,
    renameMutation: useProjectRenameMutation(getToken),
    sidebarChats: useSidebarChats(getToken, isSignedIn),
    sidebarProjects: useSidebarProjects(getToken, isSignedIn, activeProjectId),
  };
}

function useProjectRenameMutation(getToken: () => Promise<null | string>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ name, project }: { name: string; project: SidebarProject }) =>
      updateProject(getToken, project.id, { name }),
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Project rename failed");
    },
    onSuccess: (result) => {
      toast.success(`Renamed to ${result.name}`);
      void queryClient.invalidateQueries({ queryKey: ["sidebar-projects"] });
      void queryClient.invalidateQueries({ queryKey: ["sidebar-project-threads"] });
      void queryClient.invalidateQueries({ queryKey: ["sidebar-chats"] });
    },
  });
}

export function useSidebarPanelState(mode: FullSidebarMode, pathname: string) {
  const appState = useSidebarAppState();
  const disclosures = useSidebarDisclosures();
  const isDesktopViewport = useIsDesktopViewport();
  const isOverlay = mode === "overlay";
  const isDockedCollapsed = !isOverlay && isDesktopViewport && appState.sidebarCollapsed;
  useViewportSidebarSynchronization({ ...appState, ...disclosures, isDesktopViewport });
  useSidebarOffset(isDockedCollapsed, isOverlay);
  useCloseSidebarOnNavigation(pathname, appState.setSidebarOpen, disclosures);
  return {
    ...appState,
    ...disclosures,
    isDesktopViewport,
    isDockedCollapsed,
    isOverlay,
    sidebarIsHidden: isOverlay
      ? !appState.sidebarOpen
      : !isDesktopViewport && !appState.sidebarOpen,
  };
}

function useSidebarAppState() {
  return {
    setSidebarCollapsed: useAppStore((state) => state.setSidebarCollapsed),
    setSidebarOpen: useAppStore((state) => state.setSidebarOpen),
    sidebarCollapsed: useAppStore((state) => state.sidebarCollapsed),
    sidebarOpen: useAppStore((state) => state.sidebarOpen),
  };
}

function useSidebarDisclosures() {
  const [authMode, setAuthMode] = useState<AuthMode | null>(null);
  const [accountOpen, setAccountOpen] = useState(false);
  const [chatsOpen, setChatsOpen] = useState(false);
  const [projectsOpen, setProjectsOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  return {
    accountOpen,
    authMode,
    chatsOpen,
    projectsOpen,
    setAccountOpen,
    setAuthMode,
    setChatsOpen,
    setProjectsOpen,
    setSettingsOpen,
    settingsOpen,
  };
}

interface ViewportSynchronizationState {
  isDesktopViewport: boolean;
  setAccountOpen: Dispatch<SetStateAction<boolean>>;
  setChatsOpen: Dispatch<SetStateAction<boolean>>;
  setProjectsOpen: Dispatch<SetStateAction<boolean>>;
  setSettingsOpen: Dispatch<SetStateAction<boolean>>;
  setSidebarCollapsed: (collapsed: boolean) => void;
  setSidebarOpen: (open: boolean) => void;
  sidebarOpen: boolean;
}

function useViewportSidebarSynchronization(state: ViewportSynchronizationState) {
  useEffect(() => {
    state.setSidebarOpen(false);
    if (!state.isDesktopViewport) {
      state.setAccountOpen(false);
      state.setChatsOpen(false);
      state.setProjectsOpen(false);
      state.setSettingsOpen(false);
    }
  }, [
    state.isDesktopViewport,
    state.setAccountOpen,
    state.setChatsOpen,
    state.setProjectsOpen,
    state.setSettingsOpen,
    state.setSidebarOpen,
  ]);
  useEffect(() => {
    if (!state.isDesktopViewport) state.setSidebarCollapsed(!state.sidebarOpen);
  }, [state.isDesktopViewport, state.setSidebarCollapsed, state.sidebarOpen]);
}

function useSidebarOffset(isDockedCollapsed: boolean, isOverlay: boolean) {
  useEffect(() => {
    if (isOverlay) return;
    document.documentElement.style.setProperty(
      "--cheatcode-sidebar-offset",
      isDockedCollapsed ? "56px" : "248px",
    );
  }, [isDockedCollapsed, isOverlay]);
}

function useCloseSidebarOnNavigation(
  pathname: string,
  setSidebarOpen: (open: boolean) => void,
  disclosures: ReturnType<typeof useSidebarDisclosures>,
) {
  useEffect(() => {
    if (pathname.length === 0) return;
    disclosures.setAccountOpen(false);
    disclosures.setSettingsOpen(false);
    setSidebarOpen(false);
  }, [disclosures.setAccountOpen, disclosures.setSettingsOpen, pathname, setSidebarOpen]);
}

function useIsDesktopViewport(): boolean {
  const [isDesktop, setIsDesktop] = useState(true);
  useEffect(() => {
    const media = window.matchMedia("(min-width: 768px)");
    const update = () => setIsDesktop(media.matches);
    update();
    media.addEventListener("change", update);
    window.addEventListener("resize", update);
    return () => {
      media.removeEventListener("change", update);
      window.removeEventListener("resize", update);
    };
  }, []);
  return isDesktop;
}
