"use client";

import { Loader2, ModalShell } from "@cheatcode/ui";
import { type KeyboardEvent, useEffect, useId, useRef, useState } from "react";
import { cn } from "@/lib/ui/cn";

interface SidebarInlineRenameInputProps {
  ariaLabel: string;
  busy: boolean;
  initialValue: string;
  onCancel: () => void;
  onSubmit: (value: string) => void;
  variant: "chat" | "project";
}

export function SidebarInlineRenameInput({
  ariaLabel,
  busy,
  initialValue,
  onCancel,
  onSubmit,
  variant,
}: SidebarInlineRenameInputProps) {
  const controller = useInlineRenameController({ busy, initialValue, onCancel, onSubmit });
  return (
    <input
      aria-label={ariaLabel}
      className={cn(
        "block w-full rounded-full bg-background text-[14px] text-foreground outline-none disabled:opacity-60",
        variant === "chat"
          ? "px-2.5 py-1.5 font-medium leading-5"
          : "h-8 pr-7 pl-[9px] font-medium leading-5",
      )}
      disabled={busy}
      maxLength={120}
      onBlur={controller.finish}
      onChange={(event) => controller.setDraft(event.target.value)}
      onKeyDown={controller.handleKeyDown}
      ref={controller.inputRef}
      value={controller.draft}
    />
  );
}

function useInlineRenameController({
  busy,
  initialValue,
  onCancel,
  onSubmit,
}: Pick<SidebarInlineRenameInputProps, "busy" | "initialValue" | "onCancel" | "onSubmit">) {
  const [draft, setDraft] = useState(initialValue);
  const inputRef = useRef<HTMLInputElement>(null);
  const cancelledRef = useRef(false);
  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);
  const finish = () => {
    if (cancelledRef.current || busy) return;
    const value = draft.trim();
    if (value.length === 0 || value === initialValue) {
      onCancel();
      return;
    }
    onSubmit(value);
  };
  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      cancelledRef.current = true;
      onCancel();
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      finish();
    }
  };
  return { draft, finish, handleKeyDown, inputRef, setDraft };
}

interface SidebarDeleteDialogProps {
  busy: boolean;
  itemKind?: "chat" | "project";
  itemName: string;
  onCancel: () => void;
  onConfirm: () => void;
  open: boolean;
}

export function SidebarDeleteDialog({
  busy,
  itemKind = "chat",
  itemName,
  onCancel,
  onConfirm,
  open,
}: SidebarDeleteDialogProps) {
  const titleId = useId();
  const descriptionId = useId();
  return (
    <ModalShell
      className="!max-w-[calc(100%-2rem)] !rounded-3xl !border-0 !bg-secondary !p-1 !shadow-lg backdrop:!bg-black/40 sm:!max-w-md gap-0 font-medium font-sans"
      describedBy={descriptionId}
      labelledBy={titleId}
      onClose={() => {
        if (!busy) onCancel();
      }}
      open={open}
    >
      <SidebarDeleteMessage
        descriptionId={descriptionId}
        itemKind={itemKind}
        itemName={itemName}
        titleId={titleId}
      />
      <SidebarDeleteActions busy={busy} onCancel={onCancel} onConfirm={onConfirm} />
    </ModalShell>
  );
}

function SidebarDeleteMessage({
  descriptionId,
  itemKind,
  itemName,
  titleId,
}: {
  descriptionId: string;
  itemKind: "chat" | "project";
  itemName: string;
  titleId: string;
}) {
  return (
    <div className="rounded-[21px] bg-background px-3 py-4 ring-1 ring-border/50 dark:bg-secondary">
      <h2 className="font-medium text-muted-foreground text-sm" id={titleId}>
        Delete
      </h2>
      <p className="mt-4 text-foreground text-sm leading-5" id={descriptionId}>
        Are you sure you want to delete the {itemKind}{" "}
        <strong className="font-semibold">{itemName}</strong>?{" "}
        {itemKind === "project"
          ? "Its workspace folder and generated files will be removed, while your cloud computer and other projects stay intact. This action cannot be undone."
          : "This action cannot be undone."}
      </p>
    </div>
  );
}

function SidebarDeleteActions({
  busy,
  onCancel,
  onConfirm,
}: Pick<SidebarDeleteDialogProps, "busy" | "onCancel" | "onConfirm">) {
  return (
    <div className="flex shrink-0 justify-end gap-3 px-2 pt-3 pb-2">
      <button
        className="h-8 rounded-full bg-background/50 px-3 font-medium text-secondary-foreground text-sm shadow-[0_0_0_1px_rgba(34,34,34,0.02),0_1px_2px_-1px_rgba(34,34,34,0.02),0_2px_4px_rgba(34,34,34,0.01)] transition-colors hover:bg-accent/70 disabled:opacity-50"
        disabled={busy}
        onClick={onCancel}
        type="button"
      >
        Cancel
      </button>
      <button
        className="inline-flex h-8 items-center gap-1.5 rounded-full bg-destructive/10 px-3 font-medium text-destructive text-sm shadow-xs transition-colors hover:bg-destructive/20 disabled:opacity-50"
        disabled={busy}
        onClick={onConfirm}
        type="button"
      >
        {busy ? <Loader2 aria-hidden="true" className="size-4 animate-spin" /> : null}
        Delete
      </button>
    </div>
  );
}
