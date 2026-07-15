"use client";

import { useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { type TooltipSide, tooltipStyle } from "@/components/ui/cheatcode-tooltip-position";
import { cn } from "@/lib/ui/cn";

export function TooltipPortal({
  id,
  label,
  rect,
  shortcut,
  side,
}: {
  id: string;
  label: string;
  rect: DOMRect;
  shortcut?: readonly string[];
  side: TooltipSide;
}) {
  const portalRoot = useSyncExternalStore(
    subscribeToPortalRoot,
    readPortalRoot,
    readServerPortalRoot,
  );
  const shortcutKeys = shortcut?.filter((key) => key.trim().length > 0) ?? [];
  return portalRoot
    ? createPortal(
        <TooltipContent
          id={id}
          label={label}
          rect={rect}
          shortcutKeys={shortcutKeys}
          side={side}
        />,
        portalRoot,
      )
    : null;
}

function TooltipContent({
  id,
  label,
  rect,
  shortcutKeys,
  side,
}: {
  id: string;
  label: string;
  rect: DOMRect;
  shortcutKeys: readonly string[];
  side: TooltipSide;
}) {
  return (
    <span
      className={cn(
        "fade-in-0 zoom-in-95 pointer-events-none fixed z-[100] w-fit max-w-[320px] animate-in overflow-hidden whitespace-nowrap rounded-[6px] border border-fg-inverse/10 bg-bg-inverse py-1 pl-2 font-semibold text-[10.5px] text-fg-inverse leading-[15.75px] shadow-none duration-150",
        shortcutKeys.length > 0 ? "pr-1" : "pr-2",
      )}
      id={id}
      role="tooltip"
      style={tooltipStyle(rect, side)}
    >
      <span className="flex min-w-0 items-center gap-2 whitespace-nowrap">
        <span className="block min-w-0 truncate">{label}</span>
        {shortcutKeys.length > 0 ? <TooltipShortcut keys={shortcutKeys} /> : null}
      </span>
    </span>
  );
}

function TooltipShortcut({ keys }: { keys: readonly string[] }) {
  return (
    <span className="inline-flex shrink-0 items-center gap-0.5">
      {keys.map((key) => (
        <kbd
          className="inline-flex h-[18px] min-w-[18px] shrink-0 select-none items-center justify-center rounded-[5px] bg-gradient-to-b from-fg-inverse/10 to-fg-inverse/5 px-1 font-medium text-[10px] text-fg-inverse/80 shadow-[inset_0_0.5px_0.5px_rgba(255,255,255,0.15),0_1px_1px_rgba(0,0,0,0.15)] ring-[0.5px] ring-fg-inverse/20"
          key={key}
        >
          {key}
        </kbd>
      ))}
    </span>
  );
}

function subscribeToPortalRoot(): () => void {
  return () => undefined;
}

function readPortalRoot(): HTMLElement {
  return document.body;
}

function readServerPortalRoot(): null {
  return null;
}
