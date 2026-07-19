"use client";

import {
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
  type SyntheticEvent,
  useEffect,
  useRef,
} from "react";
import { cn } from "./cn";
import { Loader2 } from "./icons";

interface ModalShellProps {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  ariaLabel?: string | undefined;
  labelledBy?: string | undefined;
  describedBy?: string | undefined;
  className?: string | undefined;
}

/** Controlled native dialog with top-layer focus, Escape, and backdrop dismissal. */
export function ModalShell({
  open,
  onClose,
  children,
  ariaLabel,
  labelledBy,
  describedBy,
  className,
}: ModalShellProps) {
  const modal = useModalShell(open, onClose);
  return (
    <dialog
      aria-describedby={describedBy}
      aria-label={ariaLabel}
      aria-labelledby={labelledBy}
      className={cn(
        "m-auto w-full max-w-md rounded-lg border border-border bg-background p-0 text-foreground shadow-lg backdrop:bg-black/60",
        className,
      )}
      onCancel={modal.onCancel}
      onClick={modal.onClick}
      onKeyDown={modal.onKeyDown}
      ref={modal.dialogRef}
      style={open ? undefined : { display: "none" }}
    >
      {children}
    </dialog>
  );
}

function useModalShell(open: boolean, onClose: () => void) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) {
      return;
    }
    if (open && !dialog.open) {
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);
  return {
    dialogRef,
    onCancel: (event: SyntheticEvent<HTMLDialogElement>) => {
      event.preventDefault();
      onClose();
    },
    onClick: (event: MouseEvent<HTMLDialogElement>) => {
      if (event.target === dialogRef.current) {
        onClose();
      }
    },
    onKeyDown: (event: KeyboardEvent<HTMLDialogElement>) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    },
  };
}

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description?: string | undefined;
  confirmLabel: string;
  cancelLabel: string;
  id?: string | undefined;
  destructive?: boolean | undefined;
  busy?: boolean | undefined;
  onConfirm: () => void;
  onCancel: () => void;
}

/** Controlled confirm/cancel dialog that blocks dismissal while its action is busy. */
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  cancelLabel,
  id = "confirm-dialog",
  destructive = false,
  busy = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const titleId = `${id}-title`;
  const descriptionId = `${id}-description`;
  const close = () => {
    if (!busy) {
      onCancel();
    }
  };
  return (
    <ModalShell
      describedBy={description ? descriptionId : undefined}
      labelledBy={titleId}
      onClose={close}
      open={open}
    >
      <ConfirmDialogContent
        busy={busy}
        cancelLabel={cancelLabel}
        confirmLabel={confirmLabel}
        description={description}
        descriptionId={descriptionId}
        destructive={destructive}
        onCancel={onCancel}
        onConfirm={onConfirm}
        title={title}
        titleId={titleId}
      />
    </ModalShell>
  );
}

interface ConfirmDialogContentProps {
  busy: boolean;
  cancelLabel: string;
  confirmLabel: string;
  description: string | undefined;
  descriptionId: string;
  destructive: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  title: string;
  titleId: string;
}

function ConfirmDialogContent(props: ConfirmDialogContentProps) {
  return (
    <div className="flex flex-col gap-4 p-5">
      <div className="flex flex-col gap-2">
        <h2 className="font-semibold text-base text-foreground" id={props.titleId}>
          {props.title}
        </h2>
        {props.description ? (
          <p className="text-muted-foreground text-sm" id={props.descriptionId}>
            {props.description}
          </p>
        ) : null}
      </div>
      <ConfirmDialogActions {...props} />
    </div>
  );
}

function ConfirmDialogActions(props: ConfirmDialogContentProps) {
  return (
    <div className="flex justify-end gap-2">
      <button
        className="rounded-md border border-border px-3 py-1.5 text-foreground text-sm hover:bg-muted disabled:opacity-50"
        disabled={props.busy}
        onClick={props.onCancel}
        type="button"
      >
        {props.cancelLabel}
      </button>
      <button
        className={cn(
          "inline-flex items-center gap-2 rounded-md px-3 py-1.5 font-medium text-sm disabled:opacity-50",
          props.destructive
            ? "bg-destructive text-destructive-foreground hover:bg-destructive/90"
            : "bg-primary text-primary-foreground hover:bg-primary/90",
        )}
        disabled={props.busy}
        onClick={props.onConfirm}
        type="button"
      >
        {props.busy ? <Loader2 aria-hidden className="size-4 animate-spin" /> : null}
        {props.confirmLabel}
      </button>
    </div>
  );
}
