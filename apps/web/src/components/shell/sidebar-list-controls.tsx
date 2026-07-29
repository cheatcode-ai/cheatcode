"use client";

import type { ReactNode } from "react";
import { useRef } from "react";
import type { LucideIcon } from "@/components/ui";
import { cn } from "@/lib/ui/cn";
import { useDismissable } from "@/lib/ui/use-dismissable";

export function SidebarInlineActions({ children, open }: { children: ReactNode; open: boolean }) {
  return (
    <div
      aria-hidden={!open}
      className={cn(
        "grid overflow-hidden transition-[grid-template-rows,opacity] duration-200 ease-[cubic-bezier(0.4,0,0.2,1)] motion-reduce:transition-none",
        open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
      )}
      inert={open ? undefined : true}
    >
      <div className="min-h-0 overflow-hidden">
        <div className="flex flex-col gap-0.5 p-0.5">{children}</div>
      </div>
    </div>
  );
}

export function SidebarInlineAction({
  disabled,
  icon: Icon,
  label,
  onClick,
  variant,
}: {
  disabled: boolean;
  icon: LucideIcon;
  label: string;
  onClick: () => void;
  variant: "default" | "destructive";
}) {
  return (
    <button
      className={cn(
        "flex w-full items-center gap-2 rounded-full px-[9px] py-1.5 text-left font-medium text-[14px] transition-colors disabled:cursor-not-allowed disabled:opacity-45",
        variant === "destructive"
          ? "text-danger-fg hover:bg-danger-bg hover:text-danger-fg dark:text-[#ff6b66] dark:hover:text-[#ff6b66]"
          : "text-fg-secondary hover:bg-secondary hover:text-foreground",
      )}
      disabled={disabled}
      onClick={onClick}
      type="button"
    >
      <Icon aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
      <span className="min-w-0 truncate">{label}</span>
    </button>
  );
}

export function useSidebarInlineMenu(
  isOpen: boolean,
  setOpen: (open: boolean) => void,
): React.RefObject<HTMLDivElement | null> {
  const ref = useRef<HTMLDivElement | null>(null);
  useDismissable({ isOpen, onDismiss: () => setOpen(false), ref });
  return ref;
}
