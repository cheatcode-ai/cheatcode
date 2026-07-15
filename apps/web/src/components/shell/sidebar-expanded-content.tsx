"use client";

import type { ExpandedSidebarContentProps } from "@/components/shell/sidebar.types";
import { SidebarAccountSection } from "@/components/shell/sidebar-expanded-account";
import {
  SidebarHelpNavigation,
  SidebarMainNavigation,
} from "@/components/shell/sidebar-expanded-navigation";
import { SidebarSettingsNavigation } from "@/components/shell/sidebar-expanded-settings";

export function ExpandedSidebarContent(props: ExpandedSidebarContentProps) {
  return (
    <div className="flex size-full flex-col overflow-hidden rounded-[20.5px] bg-background">
      <div className="flex min-h-0 flex-1 flex-col gap-[15px] rounded-b-[20.5px] bg-secondary">
        <SidebarAccountSection
          displayName={props.displayName}
          email={props.primaryEmail}
          getToken={props.getToken}
          imageUrl={props.profileImageUrl}
          isLoaded={props.isLoaded}
          isOpen={props.accountOpen}
          isOverlay={props.isOverlay}
          isSignedIn={props.isSignedIn}
          onAuthModeChange={props.onAuthModeChange}
          onClose={props.onCloseAccount}
          onCollapse={props.onCollapse}
          onSignOut={props.signOut}
          onToggle={props.onToggleAccount}
        />
        <SidebarMainNavigation
          activeProjectId={props.activeProjectId}
          activeThreadId={props.activeThreadId}
          chatsOpen={props.chatsOpen}
          onChatsOpenChange={props.onChatsOpenChange}
          onProjectsOpenChange={props.onProjectsOpenChange}
          onRename={props.onRename}
          pathname={props.pathname}
          projectsOpen={props.projectsOpen}
          renameMutation={props.renameMutation}
          sidebarChats={props.sidebarChats}
          sidebarProjects={props.sidebarProjects}
        />
        <SidebarHelpNavigation pathname={props.pathname} />
      </div>
      <SidebarSettingsNavigation
        onNavigate={props.onCloseSettings}
        onToggle={props.onToggleSettings}
        open={props.settingsOpen}
        pathname={props.pathname}
      />
    </div>
  );
}
