import type { CSSProperties } from "react";

export type TooltipSide = "bottom" | "left" | "right" | "top";

interface TooltipSize {
  height: number;
  width: number;
}

interface ViewportSize {
  height: number;
  width: number;
}

const VIEWPORT_MARGIN = 8;
const TRIGGER_GAP = 6;

export function tooltipStyle(
  rect: DOMRect,
  preferredSide: TooltipSide,
  tooltipSize: TooltipSize,
): CSSProperties {
  const viewport = { height: window.innerHeight, width: window.innerWidth };
  const side = resolveTooltipSide(rect, preferredSide, tooltipSize, viewport);
  const position = rawTooltipPosition(rect, side, tooltipSize);
  return {
    left: clamp(position.left, VIEWPORT_MARGIN, viewport.width - tooltipSize.width),
    top: clamp(position.top, VIEWPORT_MARGIN, viewport.height - tooltipSize.height),
  };
}

function resolveTooltipSide(
  rect: DOMRect,
  preferredSide: TooltipSide,
  tooltipSize: TooltipSize,
  viewport: ViewportSize,
): TooltipSide {
  if (hasRoom(rect, preferredSide, tooltipSize, viewport)) {
    return preferredSide;
  }
  const opposite = oppositeSide(preferredSide);
  return hasRoom(rect, opposite, tooltipSize, viewport) ? opposite : preferredSide;
}

function hasRoom(
  rect: DOMRect,
  side: TooltipSide,
  tooltipSize: TooltipSize,
  viewport: ViewportSize,
): boolean {
  if (side === "top") {
    return rect.top - TRIGGER_GAP - tooltipSize.height >= VIEWPORT_MARGIN;
  }
  if (side === "bottom") {
    return rect.bottom + TRIGGER_GAP + tooltipSize.height <= viewport.height - VIEWPORT_MARGIN;
  }
  if (side === "right") {
    return rect.right + TRIGGER_GAP + tooltipSize.width <= viewport.width - VIEWPORT_MARGIN;
  }
  return rect.left - TRIGGER_GAP - tooltipSize.width >= VIEWPORT_MARGIN;
}

function oppositeSide(side: TooltipSide): TooltipSide {
  if (side === "top") {
    return "bottom";
  }
  if (side === "bottom") {
    return "top";
  }
  return side === "left" ? "right" : "left";
}

function rawTooltipPosition(
  rect: DOMRect,
  side: TooltipSide,
  tooltipSize: TooltipSize,
): { left: number; top: number } {
  if (side === "bottom") {
    return {
      left: rect.left + (rect.width - tooltipSize.width) / 2,
      top: rect.bottom + TRIGGER_GAP,
    };
  }
  if (side === "right") {
    return {
      left: rect.right + TRIGGER_GAP,
      top: rect.top + (rect.height - tooltipSize.height) / 2,
    };
  }
  if (side === "left") {
    return {
      left: rect.left - TRIGGER_GAP - tooltipSize.width,
      top: rect.top + (rect.height - tooltipSize.height) / 2,
    };
  }
  return {
    left: rect.left + (rect.width - tooltipSize.width) / 2,
    top: rect.top - TRIGGER_GAP - tooltipSize.height,
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max - VIEWPORT_MARGIN));
}
