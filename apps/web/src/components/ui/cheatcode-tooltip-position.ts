import type { CSSProperties } from "react";

export type TooltipSide = "bottom" | "left" | "right" | "top";

export function tooltipStyle(rect: DOMRect, side: TooltipSide): CSSProperties {
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
