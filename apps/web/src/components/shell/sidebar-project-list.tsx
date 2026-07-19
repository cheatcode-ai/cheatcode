"use client";

import { MoreHorizontal, Pencil, Trash2 } from "@cheatcode/ui";
import { useAuth } from "@clerk/nextjs";
import { type QueryClient, useMutation, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import type { ProjectRenameMutationState } from "@/components/shell/sidebar.types";
import type { SidebarProject, useSidebarProjects } from "@/components/shell/sidebar-data";
import {
  SidebarDeleteDialog,
  SidebarInlineRenameInput,
} from "@/components/shell/sidebar-item-controls";
import {
  SidebarInlineAction,
  SidebarInlineActions,
  useSidebarInlineMenu,
} from "@/components/shell/sidebar-list-controls";
import { SidebarListLoading } from "@/components/shell/sidebar-list-loading";
import { CheatcodeTooltip } from "@/components/ui/cheatcode-tooltip";
import { createChat, deleteProject } from "@/lib/api/project-thread";
import { useChatTabsStore } from "@/lib/store/chat-tabs-store";
import { cn } from "@/lib/ui/cn";

export function ProjectList({
  activeProjectId,
  onRename,
  projects,
  renameMutation,
}: {
  activeProjectId: string | null;
  onRename: (project: SidebarProject, name: string) => void;
  projects: ReturnType<typeof useSidebarProjects>;
  renameMutation: ProjectRenameMutationState;
}) {
  const actions = useProjectActions(activeProjectId);
  if (projects.isLoading) return <SidebarListLoading label="Loading projects" />;
  if (projects.items.length === 0) {
    return <div className="px-2 py-2 text-[12px] text-placeholder">No projects yet</div>;
  }
  return (
    <>
      <ProjectRows
        actions={actions}
        activeProjectId={activeProjectId}
        onRename={onRename}
        projects={projects.items.slice(0, 6)}
        renameMutation={renameMutation}
      />
      <ProjectDeleteDialog actions={actions} />
    </>
  );
}

function ProjectRows({
  actions,
  activeProjectId,
  onRename,
  projects,
  renameMutation,
}: {
  actions: ReturnType<typeof useProjectActions>;
  activeProjectId: string | null;
  onRename: (project: SidebarProject, name: string) => void;
  projects: readonly SidebarProject[];
  renameMutation: ProjectRenameMutationState;
}) {
  return (
    <div className="space-y-0.5 py-1">
      {projects.map((project) => (
        <ProjectRow
          activeProjectId={activeProjectId}
          isCreatingChat={
            actions.newChatMutation.isPending && actions.newChatMutation.variables === project.id
          }
          isDeleting={
            actions.deleteMutation.isPending && actions.deleteMutation.variables?.id === project.id
          }
          isRenaming={
            renameMutation.isPending && renameMutation.variables?.project.id === project.id
          }
          key={project.id}
          onDelete={actions.setPendingDelete}
          onNewChat={(projectId) => actions.newChatMutation.mutate(projectId)}
          onRename={onRename}
          project={project}
        />
      ))}
    </div>
  );
}

function ProjectDeleteDialog({ actions }: { actions: ReturnType<typeof useProjectActions> }) {
  return (
    <SidebarDeleteDialog
      busy={actions.deleteMutation.isPending}
      itemKind="project"
      itemName={actions.pendingDelete?.name ?? "project"}
      onCancel={() => actions.setPendingDelete(null)}
      onConfirm={actions.confirmDelete}
      open={actions.pendingDelete !== null}
    />
  );
}

function useProjectActions(activeProjectId: string | null) {
  const { getToken } = useAuth();
  const queryClient = useQueryClient();
  const router = useRouter();
  const closeProjectTabs = useChatTabsStore((state) => state.closeProjectTabs);
  const [pendingDelete, setPendingDelete] = useState<SidebarProject | null>(null);
  const deleteMutation = useProjectDeleteMutation({
    activeProjectId,
    closeProjectTabs,
    getToken,
    queryClient,
    routerPush: (href) => router.push(href),
    setPendingDelete,
  });
  const newChatMutation = useProjectChatMutation({
    getToken,
    queryClient,
    routerPush: (href) => router.push(href),
  });
  return {
    confirmDelete: () => {
      if (pendingDelete) deleteMutation.mutate(pendingDelete);
    },
    deleteMutation,
    newChatMutation,
    pendingDelete,
    setPendingDelete,
  };
}

function useProjectDeleteMutation({
  activeProjectId,
  closeProjectTabs,
  getToken,
  queryClient,
  routerPush,
  setPendingDelete,
}: {
  activeProjectId: string | null;
  closeProjectTabs: (projectId: string) => void;
  getToken: () => Promise<null | string>;
  queryClient: QueryClient;
  routerPush: (href: string) => void;
  setPendingDelete: (project: SidebarProject | null) => void;
}) {
  return useMutation({
    mutationFn: (project: SidebarProject) => deleteProject(getToken, project.id),
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Project delete failed"),
    onSettled: () => setPendingDelete(null),
    onSuccess: (_result, project) => {
      toast.success("Project deleted");
      closeProjectTabs(project.id);
      invalidateProjectQueries(queryClient);
      if (project.id === activeProjectId) routerPush("/");
    },
  });
}

function useProjectChatMutation({
  getToken,
  queryClient,
  routerPush,
}: {
  getToken: () => Promise<null | string>;
  queryClient: QueryClient;
  routerPush: (href: string) => void;
}) {
  return useMutation({
    mutationFn: (projectId: string) => createChat(getToken, { projectId }),
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Couldn't start a chat"),
    onSuccess: (thread) => {
      void queryClient.invalidateQueries({ queryKey: ["sidebar-project-threads"] });
      void queryClient.invalidateQueries({ queryKey: ["sidebar-chats"] });
      routerPush(`/chats/${encodeURIComponent(thread.id)}`);
    },
  });
}

function invalidateProjectQueries(queryClient: QueryClient) {
  void queryClient.invalidateQueries({ queryKey: ["sidebar-projects"] });
  void queryClient.invalidateQueries({ queryKey: ["sidebar-project-threads"] });
  void queryClient.invalidateQueries({ queryKey: ["sidebar-chats"] });
}

interface ProjectRowProps {
  activeProjectId: string | null;
  isCreatingChat: boolean;
  isDeleting: boolean;
  isRenaming: boolean;
  onDelete: (project: SidebarProject) => void;
  onNewChat: (projectId: string) => void;
  onRename: (project: SidebarProject, name: string) => void;
  project: SidebarProject;
}

function ProjectRow(props: ProjectRowProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useSidebarInlineMenu(menuOpen, setMenuOpen);
  return (
    <div>
      <div
        className={cn(
          "group/row transition-colors duration-200",
          isEditing ? "rounded-full" : "rounded-[18px]",
          menuOpen && "bg-background dark:bg-bg-elevated",
        )}
        ref={menuRef}
      >
        {isEditing ? (
          <ProjectRenameEditor {...props} setIsEditing={setIsEditing} />
        ) : (
          <ProjectRowMain {...props} menuOpen={menuOpen} setMenuOpen={setMenuOpen} />
        )}
        {isEditing ? null : (
          <ProjectFolderMenu
            isDeleting={props.isDeleting}
            isRenaming={props.isRenaming}
            onClose={() => setMenuOpen(false)}
            onDelete={() => props.onDelete(props.project)}
            onRename={() => setIsEditing(true)}
            open={menuOpen}
          />
        )}
      </div>
    </div>
  );
}

function ProjectRenameEditor({
  isRenaming,
  onRename,
  project,
  setIsEditing,
}: ProjectRowProps & { setIsEditing: (editing: boolean) => void }) {
  return (
    <SidebarInlineRenameInput
      ariaLabel={`Rename ${project.name}`}
      busy={isRenaming}
      initialValue={project.name}
      onCancel={() => setIsEditing(false)}
      onSubmit={(name) => {
        setIsEditing(false);
        onRename(project, name);
      }}
      variant="project"
    />
  );
}

function ProjectRowMain({
  activeProjectId,
  isCreatingChat,
  menuOpen,
  onNewChat,
  project,
  setMenuOpen,
}: ProjectRowProps & {
  menuOpen: boolean;
  setMenuOpen: (open: boolean | ((current: boolean) => boolean)) => void;
}) {
  const isActive = project.id === activeProjectId;
  return (
    <div
      className={cn(
        "relative flex h-8 w-full items-center gap-1 rounded-full pr-1 pl-1 text-left font-medium text-[14px] leading-5 transition-colors",
        isActive
          ? "bg-background text-foreground dark:bg-white/5"
          : "text-fg-secondary hover:bg-background hover:text-foreground dark:hover:bg-white/5",
      )}
    >
      <span aria-hidden="true" className="w-5 shrink-0" />
      <ProjectDestination isCreatingChat={isCreatingChat} onNewChat={onNewChat} project={project} />
      <ProjectMenuButton menuOpen={menuOpen} project={project} setMenuOpen={setMenuOpen} />
    </div>
  );
}

function ProjectDestination({
  isCreatingChat,
  onNewChat,
  project,
}: {
  isCreatingChat: boolean;
  onNewChat: (projectId: string) => void;
  project: SidebarProject;
}) {
  const content = <span className="min-w-0 flex-1 truncate">{project.name}</span>;
  if (project.href) {
    return (
      <Link className="flex min-w-0 flex-1 items-center gap-2 pr-1" href={project.href}>
        {content}
      </Link>
    );
  }
  return (
    <button
      className="flex min-w-0 flex-1 items-center gap-2 pr-1 text-left disabled:opacity-50"
      disabled={isCreatingChat}
      onClick={() => onNewChat(project.id)}
      type="button"
    >
      {content}
    </button>
  );
}

function ProjectMenuButton({
  menuOpen,
  project,
  setMenuOpen,
}: {
  menuOpen: boolean;
  project: SidebarProject;
  setMenuOpen: (open: boolean | ((current: boolean) => boolean)) => void;
}) {
  return (
    <CheatcodeTooltip disabled={menuOpen} label={`Open ${project.name} folder menu`}>
      <button
        aria-expanded={menuOpen}
        aria-label={`Open ${project.name} folder menu`}
        className={cn(
          "flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-placeholder opacity-0 transition-[background-color,color,opacity] hover:bg-background hover:text-foreground group-hover/row:opacity-100 dark:hover:bg-white/5",
          menuOpen && "bg-background text-foreground opacity-100 dark:bg-white/5",
        )}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setMenuOpen((current) => !current);
        }}
        type="button"
      >
        <MoreHorizontal aria-hidden="true" className="h-4 w-4" />
      </button>
    </CheatcodeTooltip>
  );
}

function ProjectFolderMenu({
  isDeleting,
  isRenaming,
  onClose,
  onDelete,
  onRename,
  open,
}: {
  isDeleting: boolean;
  isRenaming: boolean;
  onClose: () => void;
  onDelete: () => void;
  onRename: () => void;
  open: boolean;
}) {
  return (
    <SidebarInlineActions open={open}>
      <SidebarInlineAction
        disabled={isRenaming}
        icon={Pencil}
        label="Rename"
        onClick={() => {
          onClose();
          onRename();
        }}
        variant="default"
      />
      <SidebarInlineAction
        disabled={isDeleting}
        icon={Trash2}
        label="Delete"
        onClick={() => {
          onClose();
          onDelete();
        }}
        variant="destructive"
      />
    </SidebarInlineActions>
  );
}
