"use client";

import type { ActivityRunPoint, SandboxHourPoint } from "@cheatcode/types";
import { ChevronDown } from "@cheatcode/ui";
import type { ReactNode } from "react";
import { ActivityHourAxis, ActivitySvg, ActivityTooltip } from "./activity-year-graphics";
import {
  formatRunCount,
  formatSandboxHours,
  totalRuns,
  totalSandboxHours,
} from "./activity-year-model";
import { ActivityWindowRail } from "./activity-year-window-rail";
import { useActivityYearChart } from "./use-activity-year-chart";

interface ActivityYearChartProps {
  children?: ReactNode;
  onYearChange: (year: number) => void;
  runs: ActivityRunPoint[];
  sandboxHours: SandboxHourPoint[];
  selectedYear: number;
  years: number[];
}

export function ActivityYearChart(props: ActivityYearChartProps) {
  const chart = useActivityYearChart(props.runs, props.sandboxHours, props.selectedYear);
  return (
    <section className="rounded-t-3xl rounded-b-[14px] bg-secondary p-1 dark:bg-bg-lifted">
      <div className="flex flex-col overflow-hidden rounded-t-[21px] rounded-b-[10px] border border-border border-dashed bg-background shadow-[0_0_0_1px_rgba(27,27,27,0.02),0_1px_2px_-1px_rgba(27,27,27,0.02),0_2px_4px_rgba(27,27,27,0.01)]">
        <ActivityHeader {...props} />
        <ActivityChartViewport chart={chart} selectedYear={props.selectedYear} />
      </div>
      <div className="pt-1">
        <ActivityWindowRail
          info={chart.windowInfo}
          isDragging={chart.isDragging}
          onKeyDown={chart.onRailKeyDown}
          onPointerCancel={chart.onRailPointerCancel}
          onPointerDown={chart.onRailPointerDown}
          onPointerMove={chart.onRailPointerMove}
          onPointerUp={chart.onRailPointerUp}
        />
      </div>
      <ActivitySummary cells={chart.cells} selectedYear={props.selectedYear} />
      {props.children}
    </section>
  );
}

function ActivityChartViewport({
  chart,
  selectedYear,
}: {
  chart: ReturnType<typeof useActivityYearChart>;
  selectedYear: number;
}) {
  return (
    <div className="relative">
      <div className="flex h-[272px] overflow-hidden border-border/80 border-t border-dashed bg-background">
        <ActivityHourAxis />
        <section
          aria-label={`Activity for ${selectedYear}`}
          className="chat-scrollbar min-w-0 flex-1 overflow-x-auto overflow-y-hidden pt-6"
          onPointerLeave={chart.onChartPointerLeave}
          onPointerMove={chart.onChartPointerMove}
          onScroll={chart.onChartScroll}
          ref={chart.scrollerRef}
        >
          <ActivitySvg
            cells={chart.cells}
            days={chart.days}
            monthLabels={chart.monthLabels}
            svgWidth={chart.svgWidth}
          />
        </section>
      </div>
      <ActivityTooltip cell={chart.hoveredCell} info={chart.windowInfo} />
    </div>
  );
}

function ActivityHeader({
  onYearChange,
  selectedYear,
  years,
}: Pick<ActivityYearChartProps, "onYearChange" | "selectedYear" | "years">) {
  return (
    <div className="flex h-[52px] items-center justify-between gap-4 pt-2 pr-2 pb-3 pl-5">
      <h2 className="font-medium text-fg-secondary text-sm">Activity</h2>
      <div className="relative">
        <label className="sr-only" htmlFor="activity-year">
          Activity year
        </label>
        <select
          className="h-8 appearance-none rounded-[10px] border border-border bg-background px-3 pr-8 font-medium text-[13px] text-foreground shadow-[0_1px_2px_rgba(27,27,27,0.05)] outline-none transition-colors hover:bg-bg-secondary"
          id="activity-year"
          onChange={(event) => onYearChange(Number(event.target.value))}
          value={selectedYear}
        >
          {years.map((year) => (
            <option key={year} value={year}>
              {year}
            </option>
          ))}
        </select>
        <ChevronDown
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 right-2.5 h-3.5 w-3.5 -translate-y-1/2 text-placeholder"
        />
      </div>
    </div>
  );
}

function ActivitySummary({
  cells,
  selectedYear,
}: {
  cells: ReturnType<typeof useActivityYearChart>["cells"];
  selectedYear: number;
}) {
  return (
    <p className="sr-only">
      {formatRunCount(totalRuns(cells))} and {formatSandboxHours(totalSandboxHours(cells))} plotted
      for {selectedYear}.
    </p>
  );
}
