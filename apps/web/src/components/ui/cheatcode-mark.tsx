"use client";

import type { CSSProperties, HTMLAttributes } from "react";
import { cn } from "@/lib/ui/cn";

const MASK_STYLE: CSSProperties = {
  WebkitMaskImage: "url('/cheatcode-symbol.png')",
  WebkitMaskPosition: "center",
  WebkitMaskRepeat: "no-repeat",
  WebkitMaskSize: "contain",
  maskImage: "url('/cheatcode-symbol.png')",
  maskPosition: "center",
  maskRepeat: "no-repeat",
  maskSize: "contain",
};

export function CheatcodeMark({ className, style, ...props }: HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      {...props}
      className={cn("inline-block shrink-0 bg-current", className)}
      style={{ ...MASK_STYLE, ...style }}
    />
  );
}
