"use client";

import type { ProjectSummary } from "@cheatcode/types";
import { useAuth } from "@clerk/nextjs";
import {
  type QueryClient,
  useInfiniteQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { type RefObject, useEffect, useId, useRef, useState } from "react";
import { toast } from "sonner";
import {
  type CursorPage,
  deleteProject,
  listProjectsPage,
  updateProject,
} from "@/lib/api/project-thread";

export type ProjectPickerVariant = "home" | "thread";

interface ProjectPickerState {
  deleteBusy: boolean;
  hasMore: boolean;
  isLoading: boolean;
  isLoadingMore: boolean;
  isOpen: boolean;
  openProjectMenuId: string | null;
  pendingDelete: ProjectSummary | null;
  pendingRename: ProjectSummary | null;
  projects: readonly ProjectSummary[];
  renameBusy: boolean;
  search: string;
  selectedProjectId: string | null;
}

interface ProjectPickerActions {
  cancelDelete: () => void;
  cancelRename: () => void;
  confirmDelete: () => void;
  loadMore: () => void;
  requestDelete: (project: ProjectSummary) => void;
  requestRename: (project: ProjectSummary) => void;
  open: () => void;
  selectNewProject: () => void;
  selectProject: (project: ProjectSummary) => void;
  setOpenProjectMenuId: (projectId: string | null) => void;
  submitRename: (name: string) => void;
  toggle: () => void;
  updateSearch: (search: string) => void;
}

interface ProjectPickerMeta {
  dialogId: string;
  menuRef: RefObject<HTMLDivElement | null>;
  optionsMenuId: string;
  optionsMenuRef: RefObject<HTMLDivElement | null>;
  searchInputRef: RefObject<HTMLInputElement | null>;
  triggerId: string;
  triggerRef: RefObject<HTMLButtonElement | null>;
}

export interface ProjectPickerController {
  actions: ProjectPickerActions;
  meta: ProjectPickerMeta;
  state: ProjectPickerState;
}

export function useProjectPickerController({
  onSelect,
  selectedProject,
}: {
  onSelect: (project: ProjectSummary | null) => void;
  selectedProject: ProjectSummary | null;
}): ProjectPickerController {
  const { getToken } = useAuth();
  const queryClient = useQueryClient();
  const local = useProjectPickerLocalState();
  const projectsQuery = useInfiniteQuery({
    enabled: local.isOpen,
    getNextPageParam: (page: CursorPage<ProjectSummary>) =>
      page.has_more ? (page.next_cursor ?? undefined) : undefined,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) => listProjectsPage(getToken, pageParam, 25, signal),
    queryKey: ["sidebar-projects", "picker"],
    retry: false,
    staleTime: 30_000,
  });
  const renameMutation = useRenameProjectMutation({
    getToken,
    onSelect,
    queryClient,
    selectedProject,
  });
  const deleteMutation = useDeleteProjectMutation({
    getToken,
    onSelect,
    queryClient,
    selectedProject,
  });
  usePickerFocus(local.isOpen, local.searchInputRef);
  usePickerDismiss(local);
  return createProjectPickerController({
    deleteMutation,
    local,
    onSelect,
    projectsQuery,
    renameMutation,
    selectedProject,
  });
}

function useProjectPickerLocalState() {
  const reactId = useId();
  const menuRef = useRef<HTMLDivElement | null>(null);
  const optionsMenuRef = useRef<HTMLDivElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [openProjectMenuId, setOpenProjectMenuId] = useState<string | null>(null);
  const [pendingRename, setPendingRename] = useState<ProjectSummary | null>(null);
  const [pendingDelete, setPendingDelete] = useState<ProjectSummary | null>(null);
  return {
    dialogId: `project-picker-dialog-${reactId}`,
    isOpen,
    menuRef,
    optionsMenuId: `project-picker-options-${reactId}`,
    optionsMenuRef,
    openProjectMenuId,
    pendingDelete,
    pendingRename,
    search,
    searchInputRef,
    setIsOpen,
    setOpenProjectMenuId,
    setPendingDelete,
    setPendingRename,
    setSearch,
    triggerId: `project-picker-trigger-${reactId}`,
    triggerRef,
  };
}

type ProjectPickerLocalState = ReturnType<typeof useProjectPickerLocalState>;
type TokenGetter = ReturnType<typeof useAuth>["getToken"];

function useRenameProjectMutation({
  getToken,
  onSelect,
  queryClient,
  selectedProject,
}: {
  getToken: TokenGetter;
  onSelect: (project: ProjectSummary | null) => void;
  queryClient: QueryClient;
  selectedProject: ProjectSummary | null;
}) {
  return useMutation({
    mutationFn: ({ name, project }: { name: string; project: ProjectSummary }) =>
      updateProject(getToken, project.id, { name }),
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Couldn't rename that project.");
    },
    onSuccess: (project) => {
      void invalidateProjectQueries(queryClient);
      if (selectedProject?.id === project.id) {
        onSelect(project);
      }
      toast.success(`Renamed to ${project.name}`);
    },
  });
}

function useDeleteProjectMutation({
  getToken,
  onSelect,
  queryClient,
  selectedProject,
}: {
  getToken: TokenGetter;
  onSelect: (project: ProjectSummary | null) => void;
  queryClient: QueryClient;
  selectedProject: ProjectSummary | null;
}) {
  return useMutation({
    mutationFn: (project: ProjectSummary) => deleteProject(getToken, project.id),
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Couldn't delete that project.");
    },
    onSuccess: (_result, project) => {
      void invalidateProjectQueries(queryClient);
      if (selectedProject?.id === project.id) {
        onSelect(null);
      }
      toast.success(`Deleted ${project.name}`);
    },
  });
}

function usePickerFocus(isOpen: boolean, searchInputRef: RefObject<HTMLInputElement | null>) {
  useEffect(() => {
    if (isOpen) {
      searchInputRef.current?.focus();
    }
  }, [isOpen, searchInputRef]);
}

function usePickerDismiss(local: ProjectPickerLocalState) {
  const { isOpen, menuRef, setIsOpen, setOpenProjectMenuId, triggerRef } = local;
  useEffect(() => {
    if (!isOpen) {
      return;
    }
    function closePicker(shouldRestoreFocus: boolean) {
      setIsOpen(false);
      setOpenProjectMenuId(null);
      if (shouldRestoreFocus) {
        triggerRef.current?.focus();
      }
    }
    function handlePointerDown(event: PointerEvent) {
      if (!menuRef.current?.contains(event.target as Node)) {
        closePicker(false);
      }
    }
    function handleFocusIn(event: FocusEvent) {
      if (!menuRef.current?.contains(event.target as Node)) {
        closePicker(false);
      }
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        closePicker(true);
      }
    }
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("focusin", handleFocusIn);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("focusin", handleFocusIn);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen, menuRef, setIsOpen, setOpenProjectMenuId, triggerRef]);
}

type ProjectPickerDependencies = {
  deleteMutation: ReturnType<typeof useDeleteProjectMutation>;
  local: ProjectPickerLocalState;
  onSelect: (project: ProjectSummary | null) => void;
  projectsQuery: ReturnType<typeof useInfiniteQuery<CursorPage<ProjectSummary>>>;
  renameMutation: ReturnType<typeof useRenameProjectMutation>;
  selectedProject: ProjectSummary | null;
};

function createProjectPickerController({
  deleteMutation,
  local,
  onSelect,
  projectsQuery,
  renameMutation,
  selectedProject,
}: ProjectPickerDependencies): ProjectPickerController {
  const projects = filterProjects(
    projectsQuery.data?.pages.flatMap((page) => page.data) ?? [],
    local.search,
  );
  return {
    actions: createProjectPickerActions({
      deleteMutation,
      local,
      onSelect,
      projectsQuery,
      renameMutation,
    }),
    meta: {
      dialogId: local.dialogId,
      menuRef: local.menuRef,
      optionsMenuId: local.optionsMenuId,
      optionsMenuRef: local.optionsMenuRef,
      searchInputRef: local.searchInputRef,
      triggerId: local.triggerId,
      triggerRef: local.triggerRef,
    },
    state: {
      deleteBusy: deleteMutation.isPending,
      hasMore: Boolean(projectsQuery.hasNextPage),
      isLoading: projectsQuery.isPending,
      isLoadingMore: projectsQuery.isFetchingNextPage,
      isOpen: local.isOpen,
      openProjectMenuId: local.openProjectMenuId,
      pendingDelete: local.pendingDelete,
      pendingRename: local.pendingRename,
      projects,
      renameBusy: renameMutation.isPending,
      search: local.search,
      selectedProjectId: selectedProject?.id ?? null,
    },
  };
}

function createProjectPickerActions({
  deleteMutation,
  local,
  onSelect,
  projectsQuery,
  renameMutation,
}: Omit<ProjectPickerDependencies, "selectedProject">): ProjectPickerActions {
  return {
    cancelDelete: () => local.setPendingDelete(null),
    cancelRename: () => local.setPendingRename(null),
    confirmDelete: () => {
      if (local.pendingDelete) {
        deleteMutation.mutate(local.pendingDelete, {
          onSettled: () => local.setPendingDelete(null),
        });
      }
    },
    loadMore: () => void projectsQuery.fetchNextPage(),
    open: () => local.setIsOpen(true),
    requestDelete: (project) => {
      local.setPendingDelete(project);
      local.setIsOpen(false);
      local.setOpenProjectMenuId(null);
    },
    requestRename: (project) => {
      local.setPendingRename(project);
      local.setIsOpen(false);
      local.setOpenProjectMenuId(null);
    },
    selectNewProject: () => selectAndClose(null, local, onSelect),
    selectProject: (project) => selectAndClose(project, local, onSelect),
    setOpenProjectMenuId: local.setOpenProjectMenuId,
    submitRename: (name) => {
      if (local.pendingRename) {
        renameMutation.mutate(
          { name, project: local.pendingRename },
          { onSettled: () => local.setPendingRename(null) },
        );
      }
    },
    toggle: () => {
      local.setIsOpen((current) => !current);
      local.setOpenProjectMenuId(null);
    },
    updateSearch: (search) => {
      local.setSearch(search);
      local.setOpenProjectMenuId(null);
    },
  };
}

function selectAndClose(
  project: ProjectSummary | null,
  local: ProjectPickerLocalState,
  onSelect: (project: ProjectSummary | null) => void,
) {
  onSelect(project);
  local.setIsOpen(false);
  local.setSearch("");
  local.setOpenProjectMenuId(null);
  local.triggerRef.current?.focus();
}

function filterProjects(projects: readonly ProjectSummary[], search: string): ProjectSummary[] {
  const trimmed = search.trim().toLowerCase();
  if (trimmed.length === 0) {
    return [...projects];
  }
  return projects.filter((project) => project.name.toLowerCase().includes(trimmed));
}

async function invalidateProjectQueries(queryClient: QueryClient) {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: ["sidebar-projects"] }),
    queryClient.invalidateQueries({ queryKey: ["sidebar-project-threads"] }),
    queryClient.invalidateQueries({ queryKey: ["sidebar-chats"] }),
  ]);
}
