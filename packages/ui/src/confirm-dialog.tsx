"use client";

import { type ReactNode, useEffect, useRef } from "react";
import { cn } from "./cn";
import { Loader2 } from "./icons";

export interface ModalShellProps {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  // `| undefined` so JSX consumers may pass a conditionally-undefined value under
  // exactOptionalPropertyTypes (e.g. `describedBy={hasDescription ? id : undefined}`).
  ariaLabel?: string | undefined;
  labelledBy?: string | undefined;
  describedBy?: string | undefined;
  className?: string | undefined;
}

/**
 * Controlled modal built on the native `<dialog>` element. `showModal()` gives a
 * free focus trap, top-layer rendering, and a `::backdrop`; Escape arrives via the
 * `cancel` event and is routed to `onClose`. Backdrop clicks (target === dialog)
 * also close. Consumers own the padded inner content.
 */
export function ModalShell({
  open,
  onClose,
  children,
  ariaLabel,
  labelledBy,
  describedBy,
  className,
}: ModalShellProps) {
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

  return (
    <dialog
      aria-describedby={describedBy}
      aria-label={ariaLabel}
      aria-labelledby={labelledBy}
      className={cn(
        "m-auto w-full max-w-md rounded-lg border border-border bg-background p-0 text-foreground shadow-lg backdrop:bg-black/60",
        className,
      )}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === dialogRef.current) {
          onClose();
        }
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          onClose();
        }
      }}
      ref={dialogRef}
    >
      {children}
    </dialog>
  );
}

export interface ConfirmDialogProps {
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

/**
 * Controlled confirm/cancel dialog on top of {@link ModalShell}. While `busy`,
 * both actions and dismissal (Escape/backdrop) are disabled so an in-flight
 * mutation cannot be interrupted.
 */
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

  return (
    <ModalShell
      describedBy={description ? descriptionId : undefined}
      labelledBy={titleId}
      onClose={() => {
        if (!busy) {
          onCancel();
        }
      }}
      open={open}
    >
      <div className="flex flex-col gap-4 p-5">
        <div className="flex flex-col gap-2">
          <h2 className="font-semibold text-base text-foreground" id={titleId}>
            {title}
          </h2>
          {description ? (
            <p className="text-muted-foreground text-sm" id={descriptionId}>
              {description}
            </p>
          ) : null}
        </div>
        <div className="flex justify-end gap-2">
          <button
            className="rounded-md border border-border px-3 py-1.5 text-foreground text-sm hover:bg-muted disabled:opacity-50"
            disabled={busy}
            onClick={onCancel}
            type="button"
          >
            {cancelLabel}
          </button>
          <button
            className={cn(
              "inline-flex items-center gap-2 rounded-md px-3 py-1.5 font-medium text-sm disabled:opacity-50",
              destructive
                ? "bg-destructive text-destructive-foreground hover:bg-destructive/90"
                : "bg-primary text-primary-foreground hover:bg-primary/90",
            )}
            disabled={busy}
            onClick={onConfirm}
            type="button"
          >
            {busy ? <Loader2 aria-hidden className="size-4 animate-spin" /> : null}
            {confirmLabel}
          </button>
        </div>
      </div>
    </ModalShell>
  );
}
