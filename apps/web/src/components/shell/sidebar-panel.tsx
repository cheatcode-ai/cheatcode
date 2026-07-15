"use client";

import type {
  useSidebarIdentity,
  useSidebarNavigationData,
  useSidebarPanelState,
} from "@/components/shell/sidebar-controller";
import { ExpandedSidebarContent } from "@/components/shell/sidebar-expanded-content";
import { SidebarPanelToggleIcon } from "@/components/shell/sidebar-nav-icons";
import { SidebarRailContent } from "@/components/shell/sidebar-rail";
import { useAppStore } from "@/lib/store/app-store";
import { cn } from "@/lib/ui/cn";

interface SidebarPanelProps {
  identity: ReturnType<typeof useSidebarIdentity>;
  navigation: ReturnType<typeof useSidebarNavigationData>;
  panel: ReturnType<typeof useSidebarPanelState>;
  pathname: string;
}

export function SidebarPanel({ identity, navigation, panel, pathname }: SidebarPanelProps) {
  return (
    <>
      {panel.isOverlay ? null : <MobileSidebarButton onClick={() => panel.setSidebarOpen(true)} />}
      <SidebarBackdrop panel={panel} />
      <SidebarAside identity={identity} navigation={navigation} panel={panel} pathname={pathname} />
    </>
  );
}

function SidebarBackdrop({ panel }: { panel: SidebarPanelProps["panel"] }) {
  return (
    <button
      aria-hidden={!panel.sidebarOpen}
      aria-label={panel.sidebarOpen ? "Close sidebar" : undefined}
      className={sidebarBackdropClass(panel.isOverlay)}
      data-sidebar-open={panel.sidebarOpen ? "true" : "false"}
      onClick={() => panel.setSidebarOpen(false)}
      tabIndex={-1}
      type="button"
    />
  );
}

function SidebarAside({ identity, navigation, panel, pathname }: SidebarPanelProps) {
  return (
    <aside
      aria-hidden={panel.sidebarIsHidden}
      className={cn(
        "cheatcode-sidebar-panel fixed top-2 left-2 z-50 flex h-[calc(100dvh-16px)] flex-col overflow-hidden rounded-[24px] border-2 border-border bg-transparent p-0.5 shadow-none",
        panel.isDockedCollapsed ? "w-12" : "w-[240px]",
      )}
      data-sidebar-mode={panel.isOverlay ? "overlay" : "docked"}
      data-sidebar-open={panel.sidebarOpen ? "true" : "false"}
      inert={panel.sidebarIsHidden ? true : undefined}
    >
      {panel.isDockedCollapsed ? (
        <SidebarRailContent onExpand={() => panel.setSidebarCollapsed(false)} pathname={pathname} />
      ) : (
        <ExpandedPanelContent
          identity={identity}
          navigation={navigation}
          panel={panel}
          pathname={pathname}
        />
      )}
    </aside>
  );
}

function ExpandedPanelContent({ identity, navigation, panel, pathname }: SidebarPanelProps) {
  const collapse = () => {
    panel.setAccountOpen(false);
    panel.setProjectsOpen(false);
    panel.setSettingsOpen(false);
    if (panel.isDesktopViewport) panel.setSidebarCollapsed(true);
    else panel.setSidebarOpen(false);
  };
  return (
    <ExpandedSidebarContent
      accountOpen={panel.accountOpen}
      activeProjectId={navigation.activeProjectId}
      activeThreadId={navigation.activeThreadId}
      chatsOpen={panel.chatsOpen}
      displayName={identity.displayName}
      getToken={identity.getToken}
      isLoaded={identity.isLoaded}
      isOverlay={panel.isOverlay}
      isSignedIn={identity.isSignedIn}
      onAuthModeChange={panel.setAuthMode}
      onChatsOpenChange={panel.setChatsOpen}
      onCloseAccount={() => panel.setAccountOpen(false)}
      onCloseSettings={() => panel.setSettingsOpen(false)}
      onCollapse={collapse}
      onProjectsOpenChange={panel.setProjectsOpen}
      onRename={(project, name) => navigation.renameMutation.mutate({ name, project })}
      onToggleAccount={() => toggleAccountMenu(panel)}
      onToggleSettings={() => toggleSettingsMenu(panel)}
      pathname={pathname}
      primaryEmail={identity.primaryEmail}
      profileImageUrl={identity.profileImageUrl}
      projectsOpen={panel.projectsOpen}
      renameMutation={navigation.renameMutation}
      settingsOpen={panel.settingsOpen}
      sidebarChats={navigation.sidebarChats}
      sidebarProjects={navigation.sidebarProjects}
      signOut={identity.signOut}
    />
  );
}

function toggleAccountMenu(panel: SidebarPanelProps["panel"]) {
  panel.setAccountOpen((current) => !current);
  panel.setSettingsOpen(false);
}

function toggleSettingsMenu(panel: SidebarPanelProps["panel"]) {
  panel.setSettingsOpen((current) => !current);
  panel.setAccountOpen(false);
}

function sidebarBackdropClass(isOverlay: boolean): string {
  return cn(
    "cheatcode-sidebar-backdrop fixed inset-0 z-40 bg-gradient-to-r from-background/80 to-background/20",
    isOverlay ? "md:bg-none md:bg-transparent" : "md:hidden",
  );
}

export function MobileSidebarButton({ onClick }: { onClick: () => void }) {
  const sidebarOpen = useAppStore((state) => state.sidebarOpen);
  if (sidebarOpen) return null;
  return (
    <button
      aria-label="Open sidebar"
      className="fixed top-2 left-2 z-50 flex size-10 cursor-pointer items-center justify-center rounded-[14px] bg-transparent text-fg-secondary transition-colors duration-150 hover:text-foreground md:hidden"
      onClick={onClick}
      type="button"
    >
      <SidebarPanelToggleIcon className="size-4" />
    </button>
  );
}
