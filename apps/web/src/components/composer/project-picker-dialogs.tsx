"use client";

import type { KeyboardEvent } from "react";
import { useEffect, useState } from "react";
import type { ProjectPickerController } from "@/components/composer/project-picker-controller";
import { ConfirmDialog, ModalShell, X } from "@/components/ui";

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
