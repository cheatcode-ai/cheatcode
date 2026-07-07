"use client";

import {
  type CSSProperties,
  type ReactNode,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/ui/cn";

type TooltipSide = "bottom" | "left" | "right" | "top";

interface BudTooltipProps {
  children: ReactNode;
  className?: string;
  disabled?: boolean;
  label: string;
  shortcut?: readonly string[];
  side?: TooltipSide;
}

export function BudTooltip({
  children,
  className,
  disabled = false,
  label,
  shortcut,
  side = "top",
}: BudTooltipProps) {
  const id = useId();
  const triggerRef = useRef<HTMLSpanElement | null>(null);
  const [open, setOpen] = useState(false);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const canOpen = !disabled && label.trim().length > 0;

  useLayoutEffect(() => {
    if (!open || !canOpen) {
      return;
    }
    const updatePosition = () => {
      const nextRect = triggerRef.current?.getBoundingClientRect() ?? null;
      setRect(nextRect);
    };
    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [canOpen, open]);

  function openTooltip() {
    if (!canOpen) {
      return;
    }
    setRect(triggerRef.current?.getBoundingClientRect() ?? null);
    setOpen(true);
  }

  function closeTooltip() {
    setOpen(false);
  }

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: the child button/link remains the control; this wrapper only positions the Bud-style tooltip.
    <span
      aria-describedby={open && canOpen ? id : undefined}
      className={cn("inline-flex shrink-0", className)}
      onBlur={closeTooltip}
      onFocus={openTooltip}
      onPointerEnter={openTooltip}
      onPointerLeave={closeTooltip}
      ref={triggerRef}
    >
      {children}
      {open && rect && canOpen ? (
        <TooltipPortal
          id={id}
          label={label}
          rect={rect}
          {...(shortcut ? { shortcut } : {})}
          side={side}
        />
      ) : null}
    </span>
  );
}

function TooltipPortal({
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
  const [mounted, setMounted] = useState(false);
  const shortcutKeys = shortcut?.filter((key) => key.trim().length > 0) ?? [];

  useLayoutEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return null;
  }

  return createPortal(
    <span
      className={cn(
        "fade-in-0 zoom-in-95 pointer-events-none fixed z-[100] w-fit max-w-[320px] animate-in overflow-hidden whitespace-nowrap rounded-[6px] border border-white/10 bg-[#1b1b1b] py-1 pl-2 font-semibold text-[10.5px] text-white leading-[15.75px] shadow-none duration-150",
        shortcutKeys.length > 0 ? "pr-1" : "pr-2",
      )}
      id={id}
      role="tooltip"
      style={tooltipStyle(rect, side)}
    >
      <span className="flex min-w-0 items-center gap-2 whitespace-nowrap">
        <span className="block min-w-0 truncate">{label}</span>
        {shortcutKeys.length > 0 ? (
          <span className="inline-flex shrink-0 items-center gap-0.5">
            {shortcutKeys.map((key) => (
              <kbd
                className="inline-flex h-[18px] min-w-[18px] shrink-0 select-none items-center justify-center rounded-[5px] bg-gradient-to-b from-white/10 to-white/5 px-1 font-medium text-[10px] text-white/80 shadow-[inset_0_0.5px_0.5px_rgba(255,255,255,0.15),0_1px_1px_rgba(0,0,0,0.15)] ring-[0.5px] ring-white/20"
                key={key}
              >
                {key}
              </kbd>
            ))}
          </span>
        ) : null}
      </span>
    </span>,
    document.body,
  );
}

function tooltipStyle(rect: DOMRect, side: TooltipSide): CSSProperties {
  if (side === "bottom") {
    return {
      left: rect.left + rect.width / 2,
      top: rect.bottom + 6,
      transform: "translateX(-50%)",
    };
  }
  if (side === "right") {
    return {
      left: rect.right + 6,
      top: rect.top + rect.height / 2,
      transform: "translateY(-50%)",
    };
  }
  if (side === "left") {
    return {
      right: window.innerWidth - rect.left + 6,
      top: rect.top + rect.height / 2,
      transform: "translateY(-50%)",
    };
  }
  return {
    bottom: window.innerHeight - rect.top + 6,
    left: rect.left + rect.width / 2,
    transform: "translateX(-50%)",
  };
}
