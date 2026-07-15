import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from "react";
import { DAY_WIDTH } from "./activity-year-model";

export interface ActivityWindowInfo {
  clientWidth: number;
  leftPercent: number;
  scrollLeft: number;
  visibleDays: number;
  widthPercent: number;
}

export interface ActivityDrag {
  pointerId: number;
  railWidth: number;
  startClientX: number;
  startScrollLeft: number;
}

export interface ActivityWindowRailProps {
  info: ActivityWindowInfo;
  isDragging: boolean;
  onKeyDown: (event: ReactKeyboardEvent<HTMLDivElement>) => void;
  onPointerCancel: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerMove: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerUp: (event: ReactPointerEvent<HTMLDivElement>) => void;
}

export const INITIAL_ACTIVITY_WINDOW: ActivityWindowInfo = {
  clientWidth: 0,
  leftPercent: 0,
  scrollLeft: 0,
  visibleDays: 48,
  widthPercent: 13,
};

export function activityWindowInfo(scroller: HTMLElement): ActivityWindowInfo {
  const widthPercent = Math.min(100, (scroller.clientWidth / scroller.scrollWidth) * 100);
  return {
    clientWidth: scroller.clientWidth,
    leftPercent:
      (scroller.scrollLeft / Math.max(1, maxScrollLeft(scroller))) * (100 - widthPercent),
    scrollLeft: scroller.scrollLeft,
    visibleDays: Math.max(1, Math.round(scroller.clientWidth / DAY_WIDTH)),
    widthPercent,
  };
}

export function setActivityScrollLeft(
  scroller: HTMLElement,
  value: number,
  update: (info: ActivityWindowInfo) => void,
) {
  scroller.scrollLeft = Math.max(0, Math.min(maxScrollLeft(scroller), value));
  update(activityWindowInfo(scroller));
}

export function maxScrollLeft(scroller: HTMLElement): number {
  return Math.max(0, scroller.scrollWidth - scroller.clientWidth);
}

export function activityKeyboardScrollLeft(key: string, scroller: HTMLElement): number | null {
  const offsets: Record<string, number> = {
    ArrowLeft: scroller.scrollLeft - DAY_WIDTH,
    ArrowRight: scroller.scrollLeft + DAY_WIDTH,
    End: maxScrollLeft(scroller),
    Home: 0,
    PageDown: scroller.scrollLeft + scroller.clientWidth,
    PageUp: scroller.scrollLeft - scroller.clientWidth,
  };
  return offsets[key] ?? null;
}
