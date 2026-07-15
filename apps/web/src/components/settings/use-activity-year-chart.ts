"use client";

import type { ActivityRunPoint, SandboxHourPoint } from "@cheatcode/types";
import {
  type Dispatch,
  type MutableRefObject,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type UIEvent as ReactUIEvent,
  type RefObject,
  type SetStateAction,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  buildActivityCells,
  buildActivityMonthLabels,
  buildActivityYearDays,
  DAY_WIDTH,
  targetActivityDayIndex,
} from "./activity-year-model";
import {
  type ActivityDrag,
  type ActivityWindowInfo,
  activityKeyboardScrollLeft,
  activityWindowInfo,
  INITIAL_ACTIVITY_WINDOW,
  maxScrollLeft,
  setActivityScrollLeft,
} from "./activity-year-scroll";

type WindowUpdate = Dispatch<SetStateAction<ActivityWindowInfo>>;
type ScrollerRef = RefObject<HTMLElement | null>;

export function useActivityYearChart(
  runs: ActivityRunPoint[],
  sandboxHours: SandboxHourPoint[],
  selectedYear: number,
) {
  const scrollerRef = useRef<HTMLElement>(null);
  const data = useActivityChartData(runs, sandboxHours, selectedYear);
  const [hoveredCell, setHoveredCell] = useState<(typeof data.cells)[number] | null>(null);
  const [windowInfo, setWindowInfo] = useState(INITIAL_ACTIVITY_WINDOW);
  const rail = useActivityRail(scrollerRef, setWindowInfo);
  useInitialActivityScroll(scrollerRef, data.days, selectedYear, setWindowInfo);
  return {
    ...data,
    ...rail,
    hoveredCell,
    onChartPointerLeave: () => setHoveredCell(null),
    onChartPointerMove: (event: ReactPointerEvent<HTMLElement>) =>
      setHoveredCell(findActivityCell(event, data.cellsById)),
    onChartScroll: (event: ReactUIEvent<HTMLElement>) =>
      setWindowInfo(activityWindowInfo(event.currentTarget)),
    scrollerRef,
    windowInfo,
  };
}

function useActivityChartData(
  runs: ActivityRunPoint[],
  sandboxHours: SandboxHourPoint[],
  selectedYear: number,
) {
  const days = useMemo(() => buildActivityYearDays(selectedYear), [selectedYear]);
  const cells = useMemo(
    () => buildActivityCells(days, runs, sandboxHours),
    [days, runs, sandboxHours],
  );
  const cellsById = useMemo(() => new Map(cells.map((cell) => [cell.id, cell])), [cells]);
  const monthLabels = useMemo(() => buildActivityMonthLabels(days), [days]);
  return { cells, cellsById, days, monthLabels, svgWidth: days.length * DAY_WIDTH };
}

function useInitialActivityScroll(
  scrollerRef: ScrollerRef,
  days: ReturnType<typeof buildActivityYearDays>,
  selectedYear: number,
  update: WindowUpdate,
) {
  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) {
      return;
    }
    const targetIndex = targetActivityDayIndex(days, selectedYear);
    setActivityScrollLeft(
      scroller,
      (targetIndex + 1) * DAY_WIDTH - scroller.clientWidth + DAY_WIDTH,
      update,
    );
  }, [days, scrollerRef, selectedYear, update]);
}

function useActivityRail(scrollerRef: ScrollerRef, update: WindowUpdate) {
  const dragRef = useRef<ActivityDrag | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  return {
    isDragging,
    onRailKeyDown: (event: ReactKeyboardEvent<HTMLDivElement>) =>
      handleRailKeyDown(event, scrollerRef, update),
    onRailPointerCancel: (event: ReactPointerEvent<HTMLDivElement>) =>
      endRailDrag(event, dragRef, setIsDragging),
    onRailPointerDown: (event: ReactPointerEvent<HTMLDivElement>) =>
      startRailDrag(event, scrollerRef, dragRef, setIsDragging, update),
    onRailPointerMove: (event: ReactPointerEvent<HTMLDivElement>) =>
      moveRailDrag(event, scrollerRef, dragRef, update),
    onRailPointerUp: (event: ReactPointerEvent<HTMLDivElement>) =>
      endRailDrag(event, dragRef, setIsDragging),
  };
}

function startRailDrag(
  event: ReactPointerEvent<HTMLDivElement>,
  scrollerRef: ScrollerRef,
  dragRef: MutableRefObject<ActivityDrag | null>,
  setDragging: (value: boolean) => void,
  update: WindowUpdate,
) {
  const scroller = scrollerRef.current;
  if (!scroller) {
    return;
  }
  const railRect = event.currentTarget.getBoundingClientRect();
  const target = event.target instanceof Element ? event.target : null;
  if (!target?.closest("[data-activity-thumb]")) {
    const ratio = (event.clientX - railRect.left) / railRect.width;
    setActivityScrollLeft(
      scroller,
      ratio * scroller.scrollWidth - scroller.clientWidth / 2,
      update,
    );
  }
  dragRef.current = {
    pointerId: event.pointerId,
    railWidth: railRect.width,
    startClientX: event.clientX,
    startScrollLeft: scroller.scrollLeft,
  };
  event.currentTarget.setPointerCapture(event.pointerId);
  event.preventDefault();
  setDragging(true);
}

function moveRailDrag(
  event: ReactPointerEvent<HTMLDivElement>,
  scrollerRef: ScrollerRef,
  dragRef: MutableRefObject<ActivityDrag | null>,
  update: WindowUpdate,
) {
  const drag = dragRef.current;
  const scroller = scrollerRef.current;
  if (!drag || !scroller || drag.pointerId !== event.pointerId) {
    return;
  }
  const thumbWidth = (drag.railWidth * scroller.clientWidth) / scroller.scrollWidth;
  const travel = Math.max(1, drag.railWidth - thumbWidth);
  const delta = ((event.clientX - drag.startClientX) / travel) * maxScrollLeft(scroller);
  setActivityScrollLeft(scroller, drag.startScrollLeft + delta, update);
}

function endRailDrag(
  event: ReactPointerEvent<HTMLDivElement>,
  dragRef: MutableRefObject<ActivityDrag | null>,
  setDragging: (value: boolean) => void,
) {
  if (dragRef.current?.pointerId !== event.pointerId) {
    return;
  }
  if (event.currentTarget.hasPointerCapture(event.pointerId)) {
    event.currentTarget.releasePointerCapture(event.pointerId);
  }
  dragRef.current = null;
  setDragging(false);
}

function handleRailKeyDown(
  event: ReactKeyboardEvent<HTMLDivElement>,
  scrollerRef: ScrollerRef,
  update: WindowUpdate,
) {
  const scroller = scrollerRef.current;
  if (!scroller) {
    return;
  }
  const next = activityKeyboardScrollLeft(event.key, scroller);
  if (next === null) {
    return;
  }
  event.preventDefault();
  setActivityScrollLeft(scroller, next, update);
}

function findActivityCell(
  event: ReactPointerEvent<HTMLElement>,
  cellsById: ReturnType<typeof useActivityChartData>["cellsById"],
) {
  const target =
    event.target instanceof Element ? event.target.closest("[data-activity-cell]") : null;
  const cellId = target?.getAttribute("data-activity-cell");
  return cellId ? (cellsById.get(cellId) ?? null) : null;
}
