"use client";

import { cloneElement, type ReactElement, useId } from "react";
import { TooltipPortal } from "@/components/ui/cheatcode-tooltip-portal";
import type { TooltipSide } from "@/components/ui/cheatcode-tooltip-position";
import { useCheatcodeTooltip } from "@/components/ui/use-cheatcode-tooltip";
import { cn } from "@/lib/ui/cn";

interface CheatcodeTooltipProps {
  canShrink?: boolean;
  children: ReactElement<TooltipTriggerProps>;
  className?: string;
  disabled?: boolean;
  label: string;
  shortcut?: readonly string[];
  side?: TooltipSide;
}

interface TooltipTriggerProps {
  "aria-describedby"?: string | undefined;
}

export function CheatcodeTooltip({
  canShrink = false,
  children,
  className,
  disabled = false,
  label,
  shortcut,
  side = "top",
}: CheatcodeTooltipProps) {
  const id = useId();
  const tooltip = useCheatcodeTooltip(!disabled && label.trim().length > 0);
  const describedBy = mergeDescribedBy(
    children.props["aria-describedby"],
    tooltip.isVisible ? id : undefined,
  );
  return (
    <span
      className={cn("inline-flex", canShrink ? "min-w-0 shrink" : "shrink-0", className)}
      ref={tooltip.triggerRef}
    >
      {cloneElement(children, { "aria-describedby": describedBy })}
      {tooltip.isVisible && tooltip.rect ? (
        <TooltipPortal
          id={id}
          label={label}
          rect={tooltip.rect}
          {...(shortcut ? { shortcut } : {})}
          side={side}
        />
      ) : null}
    </span>
  );
}

function mergeDescribedBy(current: string | undefined, tooltipId: string | undefined) {
  const ids = [current, tooltipId].filter((value): value is string => Boolean(value));
  return ids.length > 0 ? ids.join(" ") : undefined;
}
