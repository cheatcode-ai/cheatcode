import type { AuthMode } from "@/components/auth/auth-modal";
import type {
  SidebarProject,
  useSidebarChats,
  useSidebarProjects,
} from "@/components/shell/sidebar-data";

export type SidebarBooleanUpdater = (updater: (current: boolean) => boolean) => void;

export interface ProjectRenameMutationState {
  isPending: boolean;
  variables?: { name: string; project: SidebarProject } | undefined;
}

export interface ExpandedSidebarContentProps {
  accountOpen: boolean;
  activeProjectId: string | null;
  activeThreadId: string | null;
  chatsOpen: boolean;
  displayName: string;
  getToken: () => Promise<null | string>;
  isLoaded: boolean;
  isOverlay: boolean;
  isSignedIn: boolean;
  onAuthModeChange: (mode: AuthMode) => void;
  onChatsOpenChange: SidebarBooleanUpdater;
  onCloseAccount: () => void;
  onCloseSettings: () => void;
  onCollapse: () => void;
  onProjectsOpenChange: SidebarBooleanUpdater;
  onRename: (project: SidebarProject, name: string) => void;
  onToggleAccount: () => void;
  onToggleSettings: () => void;
  pathname: string;
  primaryEmail: null | string;
  profileImageUrl: null | string;
  projectsOpen: boolean;
  renameMutation: ProjectRenameMutationState;
  settingsOpen: boolean;
  sidebarChats: ReturnType<typeof useSidebarChats>;
  sidebarProjects: ReturnType<typeof useSidebarProjects>;
  signOut: () => void;
}
