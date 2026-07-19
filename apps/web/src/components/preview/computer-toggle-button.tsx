"use client";

import { Monitor } from "@cheatcode/ui";
import type { ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/ui/cn";

/** The shared Cheatcode-parity Computer pill: light at rest, dark only while open. */
export function ComputerToggleButton({
  active,
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { active: boolean }) {
  return (
    <button
      className={cn(
        "inline-flex h-7 items-center gap-1.5 rounded-full py-1 pr-3 pl-2.5 font-medium text-[14px] transition-[background-color,color,transform] duration-200 ease-[cubic-bezier(0.4,0,0.2,1)] active:scale-[0.97] motion-reduce:transition-none",
        active
          ? "bg-bg-inverse text-fg-inverse hover:bg-bg-inverse/90"
          : "bg-secondary text-foreground hover:bg-secondary",
        className,
      )}
      type="button"
      {...props}
    >
      <Monitor aria-hidden="true" className="h-3.5 w-3.5" />
      <span className="font-medium text-[14px] leading-5">Computer</span>
    </button>
  );
}
