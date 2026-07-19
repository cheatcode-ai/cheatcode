"use client";

import type { ProjectSummary } from "@cheatcode/types";
import { ConfirmDialog, ModalShell, Plus, Search, X } from "@cheatcode/ui";
import {
  type FocusEvent,
  type KeyboardEvent,
  type RefObject,
  useEffect,
  useRef,
  useState,
} from "react";
import type {
  ProjectPickerController,
  ProjectPickerVariant,
} from "@/components/composer/project-picker-controller";
import {
  ProjectEditIcon,
  ProjectFolderIcon,
  ProjectMoreIcon,
  ProjectTrashIcon,
} from "@/components/composer/project-picker-icons";
import { CheatcodeLoader } from "@/components/ui/cheatcode-loader";
import { CheatcodeTooltip } from "@/components/ui/cheatcode-tooltip";
import { cn } from "@/lib/ui/cn";

export function ProjectPickerTrigger({
  compact,
  controller,
  selectedProject,
  variant,
}: {
  compact: boolean;
  controller: ProjectPickerController;
  selectedProject: ProjectSummary | null;
  variant: ProjectPickerVariant;
}) {
  return (
    <CheatcodeTooltip canShrink className="max-w-full" label="Choose project">
      <button
        aria-controls={controller.meta.dialogId}
        aria-expanded={controller.state.isOpen}
        aria-haspopup="menu"
        aria-label="Choose project"
        className={cn(
          "group/button relative isolate inline-flex h-8 min-w-0 shrink-0 cursor-pointer select-none items-center justify-center gap-1.5 overflow-hidden whitespace-nowrap rounded-full bg-background px-2.5 font-medium text-secondary-foreground text-sm transition duration-200 hover:bg-accent/70 hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-offset-1 active:scale-[0.99] disabled:pointer-events-none disabled:opacity-50 max-[340px]:max-w-[92px] max-[340px]:gap-1 max-[340px]:px-2 [&_svg]:pointer-events-none [&_svg]:shrink-0",
          compact ? "max-w-[160px]" : "max-w-[220px]",
        )}
        data-variant={variant}
        id={controller.meta.triggerId}
        onClick={controller.actions.toggle}
        onKeyDown={(event) => handleTriggerKeyDown(event, controller)}
        ref={controller.meta.triggerRef}
        type="button"
      >
        <ProjectFolderIcon className="size-3.5 shrink-0 text-muted-foreground" />
        <span
          className="min-w-0 max-w-full truncate font-medium text-xs"
          title={selectedProject?.name}
        >
          {selectedProject?.name ?? "Choose project"}
        </span>
      </button>
    </CheatcodeTooltip>
  );
}

export function ProjectPickerMenu({ controller }: { controller: ProjectPickerController }) {
  return (
    <div
      aria-labelledby={controller.meta.triggerId}
      className="absolute right-auto bottom-full left-0 z-30 mb-2 w-[min(262px,calc(100vw-32px))] origin-bottom-left rounded-2xl border-0 bg-popover p-1.5 text-popover-foreground shadow-2xl outline-none"
      id={controller.meta.dialogId}
      role="menu"
      tabIndex={-1}
    >
      <div
        className="flex w-[min(250px,calc(100vw-44px))] flex-col gap-1"
        id={controller.meta.optionsMenuId}
        onFocus={(event) => handleMenuFocus(event, MAIN_MENU_ITEM_SELECTOR)}
        onKeyDown={(event) => handleMainMenuKeyDown(event, controller)}
        ref={controller.meta.optionsMenuRef}
        role="none"
      >
        <ProjectSearch controller={controller} />
        <button
          className="flex h-8 cursor-pointer items-center justify-center gap-1.5 rounded-full bg-secondary px-3 font-medium text-foreground text-xs transition-colors hover:bg-secondary/80"
          data-project-picker-menu-item="true"
          onClick={controller.actions.selectNewProject}
          role="menuitem"
          tabIndex={0}
          type="button"
        >
          <Plus aria-hidden="true" className="size-3.5" />
          New project
        </button>
        <ProjectRows controller={controller} />
      </div>
    </div>
  );
}

function ProjectSearch({ controller }: { controller: ProjectPickerController }) {
  return (
    <div className="flex h-8 items-center gap-1.5 rounded-full bg-secondary pr-2 pl-2.5">
      <Search aria-hidden="true" className="size-3.5 shrink-0 opacity-50" />
      <input
        aria-controls={controller.meta.optionsMenuId}
        aria-label="Search projects"
        className="h-8 min-w-0 flex-1 bg-transparent text-foreground text-xs outline-none placeholder:text-muted-foreground"
        onChange={(event) => controller.actions.updateSearch(event.target.value)}
        onFocus={() => resetMenuTabStop(controller.meta.optionsMenuRef)}
        onKeyDown={(event) => handleSearchKeyDown(event, controller.meta.optionsMenuRef)}
        placeholder="Search projects"
        ref={controller.meta.searchInputRef}
        type="search"
        value={controller.state.search}
      />
    </div>
  );
}

function ProjectRows({ controller }: { controller: ProjectPickerController }) {
  if (controller.state.isLoading) {
    return (
      <div aria-disabled="true" role="menuitem" tabIndex={-1}>
        <CheatcodeLoader
          className="min-h-12 px-3 py-3"
          label="Loading projects"
          markClassName="size-6"
        />
      </div>
    );
  }
  if (controller.state.projects.length === 0 && !controller.state.hasMore) {
    return (
      <div
        aria-disabled="true"
        className="px-3 py-3 text-muted-foreground text-xs"
        role="menuitem"
        tabIndex={-1}
      >
        No projects yet
      </div>
    );
  }
  return (
    <div
      className="chat-scrollbar flex max-h-48 flex-col overflow-y-auto overscroll-contain"
      role="none"
    >
      {controller.state.projects.map((project) => (
        <ProjectRow controller={controller} key={project.id} project={project} />
      ))}
      {controller.state.hasMore ? (
        <button
          className="h-8 shrink-0 rounded-xl px-3 text-left font-medium text-muted-foreground text-xs transition-colors hover:bg-secondary hover:text-foreground disabled:opacity-50"
          data-project-picker-menu-item="true"
          disabled={controller.state.isLoadingMore}
          onClick={controller.actions.loadMore}
          role="menuitem"
          tabIndex={-1}
          type="button"
        >
          {controller.state.isLoadingMore ? "Loading..." : "Load more projects"}
        </button>
      ) : null}
    </div>
  );
}

function ProjectRow({
  controller,
  project,
}: {
  controller: ProjectPickerController;
  project: ProjectSummary;
}) {
  const isMenuOpen = controller.state.openProjectMenuId === project.id;
  const isSelected = controller.state.selectedProjectId === project.id;
  const firstActionRef = useRef<HTMLButtonElement | null>(null);
  const menuButtonRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    if (!isMenuOpen) {
      return;
    }
    const frame = requestAnimationFrame(() => firstActionRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [isMenuOpen]);
  return (
    <div
      className={cn(
        "group/folder rounded-xl transition-colors duration-200",
        isMenuOpen && "rounded-[18px] bg-bg-secondary",
      )}
      role="none"
    >
      <ProjectRowButton
        controller={controller}
        isMenuOpen={isMenuOpen}
        isSelected={isSelected}
        menuButtonRef={menuButtonRef}
        project={project}
      />
      <ProjectRowActions
        controller={controller}
        firstActionRef={firstActionRef}
        isMenuOpen={isMenuOpen}
        menuButtonRef={menuButtonRef}
        project={project}
      />
    </div>
  );
}

type ProjectRowButtonProps = {
  controller: ProjectPickerController;
  isMenuOpen: boolean;
  isSelected: boolean;
  menuButtonRef: RefObject<HTMLButtonElement | null>;
  project: ProjectSummary;
};

function ProjectRowButton(props: ProjectRowButtonProps) {
  const { controller, isMenuOpen, isSelected, menuButtonRef, project } = props;
  return (
    <div
      className={cn(
        "flex w-full items-center gap-1.5 rounded-xl px-3 py-1.5 text-left",
        project.readOnly
          ? "cursor-not-allowed text-muted-foreground opacity-50"
          : isSelected
            ? cn("cursor-pointer text-foreground", isMenuOpen ? "bg-transparent" : "bg-background")
            : "cursor-pointer text-muted-foreground hover:bg-background hover:text-foreground",
      )}
      role="none"
    >
      <button
        aria-checked={isSelected}
        className="flex h-full min-w-0 flex-1 items-center gap-1.5 text-left"
        data-project-picker-menu-item="true"
        disabled={project.readOnly}
        onClick={() => controller.actions.selectProject(project)}
        role="menuitemradio"
        tabIndex={-1}
        type="button"
      >
        <ProjectFolderIcon className="size-3 shrink-0" />
        <span className="min-w-0 flex-1 truncate text-xs">{project.name}</span>
        {project.readOnly ? (
          <span className="shrink-0 text-[11px] text-placeholder">read-only</span>
        ) : null}
      </button>
      <ProjectRowMenuButton
        controller={controller}
        isMenuOpen={isMenuOpen}
        isSelected={isSelected}
        menuButtonRef={menuButtonRef}
        project={project}
      />
    </div>
  );
}

function ProjectRowMenuButton({
  controller,
  isMenuOpen,
  isSelected,
  menuButtonRef,
  project,
}: ProjectRowButtonProps) {
  const actionMenuId = projectActionMenuId(project.id);
  return (
    <button
      aria-controls={actionMenuId}
      aria-expanded={isMenuOpen}
      aria-haspopup="menu"
      aria-label={`Open ${project.name} project menu`}
      className={cn(
        "flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-full text-muted-foreground opacity-0 transition-opacity hover:bg-secondary hover:text-foreground focus-visible:opacity-100 disabled:cursor-not-allowed",
        (isMenuOpen || isSelected) && "opacity-100",
        !project.readOnly && "group-hover/folder:opacity-100",
      )}
      data-project-picker-menu-item="true"
      disabled={project.readOnly}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        controller.actions.setOpenProjectMenuId(isMenuOpen ? null : project.id);
      }}
      ref={menuButtonRef}
      role="menuitem"
      tabIndex={-1}
      type="button"
    >
      <ProjectMoreIcon className="size-3.5" />
    </button>
  );
}

type ProjectRowActionsProps = {
  controller: ProjectPickerController;
  firstActionRef: RefObject<HTMLButtonElement | null>;
  isMenuOpen: boolean;
  menuButtonRef: RefObject<HTMLButtonElement | null>;
  project: ProjectSummary;
};

function ProjectRowActions({
  controller,
  firstActionRef,
  isMenuOpen,
  menuButtonRef,
  project,
}: ProjectRowActionsProps) {
  return (
    <div
      aria-hidden={!isMenuOpen}
      className={cn(
        "grid transition-[grid-template-rows,opacity] duration-200 ease-out",
        isMenuOpen ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
      )}
    >
      <div className="min-h-0 overflow-hidden" role="none">
        <div
          aria-hidden={!isMenuOpen}
          aria-label={`${project.name} actions`}
          className="flex flex-col gap-0.5 p-0.5"
          id={projectActionMenuId(project.id)}
          onFocus={(event) => handleMenuFocus(event, SUBMENU_ITEM_SELECTOR)}
          onKeyDown={(event) => handleSubmenuKeyDown(event, controller, menuButtonRef)}
          role="menu"
        >
          <ProjectRowAction
            actionRef={firstActionRef}
            icon="edit"
            isFirst
            isMenuOpen={isMenuOpen}
            label="Rename"
            onClick={() => controller.actions.requestRename(project)}
            variant="default"
          />
          <ProjectRowAction
            icon="trash"
            isMenuOpen={isMenuOpen}
            label="Delete"
            onClick={() => controller.actions.requestDelete(project)}
            variant="destructive"
          />
        </div>
      </div>
    </div>
  );
}

function ProjectRowAction({
  actionRef,
  icon,
  isFirst = false,
  isMenuOpen,
  label,
  onClick,
  variant,
}: {
  actionRef?: RefObject<HTMLButtonElement | null> | undefined;
  icon: "edit" | "trash";
  isFirst?: boolean | undefined;
  isMenuOpen: boolean;
  label: string;
  onClick: () => void;
  variant: "default" | "destructive";
}) {
  return (
    <button
      className={
        variant === "destructive"
          ? "flex w-full cursor-pointer items-center gap-2 rounded-full py-1.5 pr-3 pl-7 text-left text-destructive text-xs hover:bg-background hover:text-destructive"
          : "flex w-full cursor-pointer items-center gap-2 rounded-full py-1.5 pr-3 pl-7 text-left text-muted-foreground text-xs hover:bg-background hover:text-foreground"
      }
      data-project-picker-submenu-item="true"
      onClick={onClick}
      ref={actionRef}
      role="menuitem"
      tabIndex={isMenuOpen && isFirst ? 0 : -1}
      type="button"
    >
      {icon === "edit" ? (
        <ProjectEditIcon className="size-3.5 shrink-0" />
      ) : (
        <ProjectTrashIcon className="size-3.5 shrink-0" />
      )}
      {label}
    </button>
  );
}

const MAIN_MENU_ITEM_SELECTOR = '[data-project-picker-menu-item="true"]:not(:disabled)';
const SUBMENU_ITEM_SELECTOR = '[data-project-picker-submenu-item="true"]:not(:disabled)';

function handleTriggerKeyDown(
  event: KeyboardEvent<HTMLButtonElement>,
  controller: ProjectPickerController,
) {
  if (event.key !== "ArrowDown" && event.key !== "ArrowUp") {
    return;
  }
  event.preventDefault();
  controller.actions.open();
}

function handleSearchKeyDown(
  event: KeyboardEvent<HTMLInputElement>,
  optionsMenuRef: RefObject<HTMLDivElement | null>,
) {
  if (event.key !== "ArrowDown" && event.key !== "ArrowUp") {
    return;
  }
  const items = menuItems(optionsMenuRef.current, MAIN_MENU_ITEM_SELECTOR);
  const index = event.key === "ArrowDown" ? 0 : items.length - 1;
  event.preventDefault();
  setMenuTabStop(items, index, true);
}

function handleMainMenuKeyDown(
  event: KeyboardEvent<HTMLDivElement>,
  controller: ProjectPickerController,
) {
  const target = event.target;
  if (!(target instanceof HTMLButtonElement) || !target.dataset["projectPickerMenuItem"]) {
    return;
  }
  if (event.key === "ArrowRight" && target.getAttribute("aria-haspopup") === "menu") {
    event.preventDefault();
    target.click();
    return;
  }
  if (moveMenuFocus(event, menuItems(event.currentTarget, MAIN_MENU_ITEM_SELECTOR))) {
    controller.actions.setOpenProjectMenuId(null);
  }
}

function handleSubmenuKeyDown(
  event: KeyboardEvent<HTMLDivElement>,
  controller: ProjectPickerController,
  menuButtonRef: RefObject<HTMLButtonElement | null>,
) {
  if (event.key === "Escape" || event.key === "ArrowLeft") {
    event.preventDefault();
    event.stopPropagation();
    controller.actions.setOpenProjectMenuId(null);
    menuButtonRef.current?.focus();
    return;
  }
  moveMenuFocus(event, menuItems(event.currentTarget, SUBMENU_ITEM_SELECTOR));
}

function moveMenuFocus(
  event: KeyboardEvent<HTMLElement>,
  items: readonly HTMLButtonElement[],
): boolean {
  if (items.length === 0 || !["ArrowDown", "ArrowUp", "End", "Home"].includes(event.key)) {
    return false;
  }
  const currentIndex = items.indexOf(event.target as HTMLButtonElement);
  const lastIndex = items.length - 1;
  const nextIndex = menuMoveIndex(event.key, currentIndex, lastIndex);
  event.preventDefault();
  event.stopPropagation();
  setMenuTabStop(items, nextIndex, true);
  return true;
}

function menuMoveIndex(key: string, currentIndex: number, lastIndex: number): number {
  if (key === "Home" || (key === "ArrowDown" && currentIndex === lastIndex)) {
    return 0;
  }
  if (key === "End" || (key === "ArrowUp" && currentIndex <= 0)) {
    return lastIndex;
  }
  return key === "ArrowDown" ? currentIndex + 1 : currentIndex - 1;
}

function menuItems(container: HTMLElement | null, selector: string): HTMLButtonElement[] {
  return container ? Array.from(container.querySelectorAll<HTMLButtonElement>(selector)) : [];
}

function handleMenuFocus(event: FocusEvent<HTMLDivElement>, selector: string) {
  const target = event.target;
  if (!(target instanceof HTMLButtonElement)) {
    return;
  }
  const items = menuItems(event.currentTarget, selector);
  const focusedIndex = items.indexOf(target);
  if (focusedIndex >= 0) {
    setMenuTabStop(items, focusedIndex, false);
  }
}

function resetMenuTabStop(optionsMenuRef: RefObject<HTMLDivElement | null>) {
  setMenuTabStop(menuItems(optionsMenuRef.current, MAIN_MENU_ITEM_SELECTOR), 0, false);
}

function setMenuTabStop(
  items: readonly HTMLButtonElement[],
  activeIndex: number,
  shouldFocus: boolean,
) {
  for (const [index, item] of items.entries()) {
    item.tabIndex = index === activeIndex ? 0 : -1;
  }
  if (shouldFocus) {
    items[activeIndex]?.focus();
  }
}

function projectActionMenuId(projectId: string): string {
  return `project-picker-actions-${projectId}`;
}

export function ProjectPickerDialogs({ controller }: { controller: ProjectPickerController }) {
  return (
    <>
      <ProjectRenameDialog controller={controller} />
      <ProjectDeleteDialog controller={controller} />
    </>
  );
}

function ProjectRenameDialog({ controller }: { controller: ProjectPickerController }) {
  const [draft, setDraft] = useState("");
  const project = controller.state.pendingRename;
  useEffect(() => {
    if (project) {
      setDraft(project.name);
    }
  }, [project]);
  const trimmed = draft.trim();
  const canSubmit = project !== null && trimmed.length > 0 && trimmed !== project.name;
  const submit = () => {
    if (canSubmit && !controller.state.renameBusy) {
      controller.actions.submitRename(trimmed);
    }
  };
  return (
    <ModalShell
      className="relative max-w-md rounded-[10px]"
      labelledBy="composer-rename-project-dialog-title"
      onClose={controller.actions.cancelRename}
      open={project !== null}
    >
      <RenameDialogContent
        busy={controller.state.renameBusy}
        canSubmit={canSubmit}
        draft={draft}
        onCancel={controller.actions.cancelRename}
        onChange={setDraft}
        onSubmit={submit}
      />
    </ModalShell>
  );
}

function RenameDialogContent({
  busy,
  canSubmit,
  draft,
  onCancel,
  onChange,
  onSubmit,
}: {
  busy: boolean;
  canSubmit: boolean;
  draft: string;
  onCancel: () => void;
  onChange: (draft: string) => void;
  onSubmit: () => void;
}) {
  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      onSubmit();
    }
  };
  return (
    <div className="flex flex-col gap-4 p-6">
      <h2
        className="font-semibold text-foreground text-lg leading-none"
        id="composer-rename-project-dialog-title"
      >
        Rename project
      </h2>
      <button
        aria-label="Close"
        className="absolute top-3 right-3 flex size-6 items-center justify-center rounded-sm text-placeholder opacity-70 transition-opacity hover:opacity-100"
        disabled={busy}
        onClick={onCancel}
        type="button"
      >
        <X aria-hidden="true" className="size-4" />
      </button>
      <RenameProjectInput busy={busy} draft={draft} onChange={onChange} onKeyDown={handleKeyDown} />
      <RenameDialogActions
        busy={busy}
        canSubmit={canSubmit}
        onCancel={onCancel}
        onSubmit={onSubmit}
      />
    </div>
  );
}

function RenameProjectInput({
  busy,
  draft,
  onChange,
  onKeyDown,
}: {
  busy: boolean;
  draft: string;
  onChange: (draft: string) => void;
  onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;
}) {
  return (
    <input
      aria-label="Project name"
      className="h-8 w-full rounded-full border border-border bg-transparent px-3 font-medium text-foreground text-sm leading-5 outline-none transition-[border-color,box-shadow]"
      disabled={busy}
      maxLength={120}
      onChange={(event) => onChange(event.target.value)}
      onKeyDown={onKeyDown}
      value={draft}
    />
  );
}

function RenameDialogActions({
  busy,
  canSubmit,
  onCancel,
  onSubmit,
}: {
  busy: boolean;
  canSubmit: boolean;
  onCancel: () => void;
  onSubmit: () => void;
}) {
  return (
    <div className="flex justify-end gap-2">
      <button
        className="h-8 rounded-full px-4 font-medium text-foreground text-sm transition-colors hover:bg-secondary active:scale-[0.99] disabled:opacity-50"
        disabled={busy}
        onClick={onCancel}
        type="button"
      >
        Cancel
      </button>
      <button
        className="inline-flex h-8 items-center gap-2 rounded-full bg-foreground px-4 font-medium text-background text-sm shadow-[inset_0_1px_0_rgba(255,255,255,0.15),0_1px_3px_rgba(0,0,0,0.2)] transition-colors hover:bg-foreground/90 active:scale-[0.99] disabled:opacity-50"
        disabled={busy || !canSubmit}
        onClick={onSubmit}
        type="button"
      >
        {busy ? "Renaming..." : "Rename"}
      </button>
    </div>
  );
}

function ProjectDeleteDialog({ controller }: { controller: ProjectPickerController }) {
  const project = controller.state.pendingDelete;
  return (
    <ConfirmDialog
      busy={controller.state.deleteBusy}
      cancelLabel="Cancel"
      confirmLabel="Delete project"
      description="This removes the project, its workspace folder, and all generated files. Your cloud computer and other projects stay intact."
      destructive
      id="composer-delete-project-dialog"
      onCancel={controller.actions.cancelDelete}
      onConfirm={controller.actions.confirmDelete}
      open={project !== null}
      title={project ? `Delete ${project.name}?` : "Delete project?"}
    />
  );
}
