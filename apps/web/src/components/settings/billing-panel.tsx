"use client";

import {
  BillingUrlResponseSchema,
  type SandboxUsageSummaryResponse,
  type SandboxUsageWarnLevel,
  type UsageRunPoint,
} from "@cheatcode/types";
import { useAuth } from "@clerk/nextjs";
import { useMutation } from "@tanstack/react-query";
import {
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";
import { ArrowUpRight, ChevronDown, Loader2 } from "@/components/ui/icons";
import { authorizedFetch } from "@/lib/api/authorized-fetch";
import { requestCheckout } from "@/lib/api/billing";
import {
  formatHoursTotal,
  formatHoursUsed,
  useSandboxUsageQuery,
  useUsageDailyQuery,
} from "@/lib/hooks/use-billing";
import { cn } from "@/lib/ui/cn";

const ACTIVITY_HOUR_LABELS = [
  { hour: 0, label: "12 AM" },
  { hour: 3, label: "3 AM" },
  { hour: 6, label: "6 AM" },
  { hour: 9, label: "9 AM" },
  { hour: 12, label: "12 PM" },
  { hour: 15, label: "3 PM" },
  { hour: 18, label: "6 PM" },
  { hour: 21, label: "9 PM" },
] as const;
const ACTIVITY_CHART_HEIGHT = 272;
const ACTIVITY_DAY_WIDTH = 20;
const ACTIVITY_GRID_HEIGHT = 200;
const ACTIVITY_MONTH_LABEL_Y = 238;
const ACTIVITY_QUERY_DAYS = 90;
const ACTIVITY_RAIL_TICKS = Array.from({ length: 360 }, (_, position) => ({
  id: `activity-rail-${position}`,
  position,
}));
const ACTIVITY_VISIBLE_FALLBACK_DAYS = 48;
const ACTIVITY_YEAR_PATTERN_ID = "cheatcode-activity-year-grid";
const WARN_BAR_CLASS: Record<SandboxUsageWarnLevel, string> = {
  exhausted: "bg-red-500",
  none: "bg-[#f8af2c]",
  warn80: "bg-[#f8af2c]",
  warn95: "bg-orange-500",
};
const SANDBOX_BAR_SEGMENTS = Array.from({ length: 84 }, (_, position) => ({
  id: `sandbox-bar-${position}`,
  position,
}));

export function BillingPanel() {
  const { getToken } = useAuth();

  return (
    <div className="text-[#1b1b1b]">
      <div className="mb-8 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="font-bold text-[#1b1b1b] text-[30px] tracking-[-0.01em]">Usage</h1>
          <p className="mt-3 text-[#4f4f4f] text-[18px] leading-7">
            Cheatcode bills sandbox hours per month. Provider inference still stays
            bring-your-own-key.
          </p>
        </div>
        <ViewPricingButton getToken={getToken} />
      </div>
      <div className="w-full space-y-8">
        <SandboxHoursMeter getToken={getToken} />
        <ActivitySection getToken={getToken} />
      </div>
    </div>
  );
}

function ViewPricingButton({ getToken }: { getToken: () => Promise<null | string> }) {
  const upgradeMutation = useUpgradeMutation(getToken);

  return (
    <button
      className="relative isolate inline-flex h-7 shrink-0 cursor-pointer items-center justify-center gap-1.5 overflow-hidden whitespace-nowrap rounded-full bg-white px-3 font-medium text-[#1b1b1b] text-[13px] leading-[19.5px] shadow-[0_0_0_1px_rgba(27,27,27,0.02),0_1px_2px_-1px_rgba(27,27,27,0.02),0_2px_4px_rgba(27,27,27,0.01)] transition duration-200 hover:bg-[#f7f7f7] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1b1b1b]/10 focus-visible:ring-offset-1 active:scale-[0.99] disabled:pointer-events-none disabled:opacity-50"
      disabled={upgradeMutation.isPending}
      onClick={() => upgradeMutation.mutate()}
      type="button"
    >
      {upgradeMutation.isPending ? (
        <Loader2 aria-hidden="true" className="h-3.5 w-3.5 animate-spin" />
      ) : null}
      View pricing
    </button>
  );
}

function SandboxHoursMeter({ getToken }: { getToken: () => Promise<null | string> }) {
  const usageQuery = useSandboxUsageQuery(getToken);
  const usage = usageQuery.data;

  return (
    <section className="rounded-3xl bg-[#f7f7f7] p-1">
      <div className="rounded-[21px] bg-white p-5 shadow-[0_0_0_1px_rgba(27,27,27,0.02),0_1px_2px_-1px_rgba(27,27,27,0.02),0_2px_4px_rgba(27,27,27,0.01)]">
        {usageQuery.isLoading ? (
          <SandboxHoursMeterSkeleton />
        ) : usageQuery.isError || !usage ? (
          <p className="text-red-700 text-xs">Sandbox usage is temporarily unavailable.</p>
        ) : (
          <SandboxHoursMeterBody getToken={getToken} usage={usage} />
        )}
      </div>
    </section>
  );
}

function SandboxHoursMeterBody({
  getToken,
  usage,
}: {
  getToken: () => Promise<null | string>;
  usage: SandboxUsageSummaryResponse;
}) {
  const [usageView, setUsageView] = useState<"remaining" | "used">("remaining");
  const portalMutation = usePortalMutation(getToken);
  const upgradeMutation = useUpgradeMutation(getToken);
  const remaining = Math.max(0, usage.sandboxHoursTotal - usage.sandboxHoursUsed);
  const displayedHours = usageView === "remaining" ? remaining : usage.sandboxHoursUsed;
  const fraction =
    usage.sandboxHoursTotal > 0 ? Math.min(1, displayedHours / usage.sandboxHoursTotal) : 0;
  const tierLabel = usage.tier.charAt(0).toUpperCase() + usage.tier.slice(1);
  const label = usageView === "remaining" ? "Sandbox hours remaining" : "Sandbox hours used";
  const inlineLabel = usageView === "remaining" ? "hours remaining" : "hours used";
  const nextLabel =
    usageView === "remaining" ? "Show sandbox hours used" : "Show sandbox hours remaining";
  const isPaidTier = usage.tier !== "free";
  const actionPending = isPaidTier ? portalMutation.isPending : upgradeMutation.isPending;
  const actionLabel = isPaidTier ? "Manage" : "Upgrade";

  return (
    <div>
      <p className="sr-only">
        {label}: {formatHoursUsed(displayedHours)} of {formatHoursTotal(usage.sandboxHoursTotal)}{" "}
        hours. Resets {dateText(usage.resetAt)}.
      </p>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <button
            aria-label={nextLabel}
            className="inline-flex w-fit cursor-pointer items-start gap-1 font-medium text-[#5f5f5f] text-[15px] transition-colors hover:text-[#1b1b1b] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1b1b1b]/10 focus-visible:ring-offset-2"
            onClick={() => setUsageView((value) => (value === "remaining" ? "used" : "remaining"))}
            type="button"
          >
            {label}
            <ArrowUpRight aria-hidden="true" className="mt-0.5 h-2.5 w-2.5" />
          </button>
          <p className="mt-1 flex flex-wrap items-baseline gap-2">
            <span className="font-semibold text-[#1b1b1b] text-[28px] leading-none">
              {formatHoursUsed(displayedHours)}
            </span>
            <span className="font-medium text-[#5f5f5f] text-[17px]">
              of {formatHoursTotal(usage.sandboxHoursTotal)} {inlineLabel}
            </span>
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2 pt-1">
          <span className="font-medium text-[#1b1b1b] text-sm">{tierLabel}</span>
          <button
            className="inline-flex h-8 items-center rounded-full bg-[#0f0f0f] px-4 font-medium text-sm text-white transition-colors hover:bg-[#2a2a2a] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1b1b1b]/20 focus-visible:ring-offset-2"
            disabled={actionPending}
            onClick={() => (isPaidTier ? portalMutation.mutate() : upgradeMutation.mutate())}
            type="button"
          >
            {actionPending ? (
              <Loader2 aria-hidden="true" className="mr-2 h-3.5 w-3.5 animate-spin" />
            ) : null}
            {actionLabel}
          </button>
        </div>
      </div>
      <div className="mt-5 flex h-5 w-full gap-1 overflow-hidden">
        {SANDBOX_BAR_SEGMENTS.map((segment) => (
          <span
            className={cn(
              "h-full min-w-[4px] flex-1 rounded-full",
              segment.position / SANDBOX_BAR_SEGMENTS.length < fraction
                ? WARN_BAR_CLASS[usage.warnLevel]
                : "bg-[#e9e9e9]",
            )}
            key={segment.id}
          />
        ))}
      </div>
    </div>
  );
}

function SandboxHoursMeterSkeleton() {
  return (
    <div aria-label="Loading sandbox usage" role="status">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="h-5 w-40 rounded-full bg-[#f5f5f5]" />
          <div className="mt-3 h-6 w-64 rounded-full bg-[#f7f7f7]" />
        </div>
        <div className="h-8 w-28 rounded-full bg-[#f5f5f5]" />
      </div>
      <div className="mt-5 flex h-5 w-full gap-1 overflow-hidden">
        {SANDBOX_BAR_SEGMENTS.map((segment) => (
          <span className="h-full min-w-[4px] flex-1 rounded-full bg-[#e9e9e9]" key={segment.id} />
        ))}
      </div>
    </div>
  );
}

function ActivitySection({ getToken }: { getToken: () => Promise<null | string> }) {
  const [currentYear] = useState(() => new Date().getFullYear());
  const [selectedYear, setSelectedYear] = useState(currentYear);
  const usageQuery = useUsageDailyQuery(getToken, ACTIVITY_QUERY_DAYS);
  const runs = usageQuery.data?.runs ?? [];
  const years = useMemo(() => buildActivityYears(runs, currentYear), [currentYear, runs]);
  const truncated = usageQuery.data?.truncated ?? false;

  useEffect(() => {
    if (years.includes(selectedYear)) {
      return;
    }
    setSelectedYear(years[0] ?? currentYear);
  }, [currentYear, selectedYear, years]);

  return (
    <ActivityYearChart
      isErrored={usageQuery.isError}
      isLoading={usageQuery.isLoading}
      onYearChange={setSelectedYear}
      runs={runs}
      selectedYear={selectedYear}
      years={years}
    >
      {truncated ? (
        <p className="sr-only">
          Showing the most recent runs only; older runs in this range were truncated.
        </p>
      ) : null}
    </ActivityYearChart>
  );
}

function ActivityYearChart({
  children,
  isErrored,
  isLoading,
  onYearChange,
  runs,
  selectedYear,
  years,
}: {
  children?: ReactNode;
  isErrored: boolean;
  isLoading: boolean;
  onYearChange: (year: number) => void;
  runs: UsageRunPoint[];
  selectedYear: number;
  years: number[];
}) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const days = useMemo(() => buildActivityYearDays(selectedYear), [selectedYear]);
  const cells = useMemo(() => buildActivityCells(days, runs), [days, runs]);
  const monthLabels = useMemo(() => buildActivityMonthLabels(days), [days]);
  const [windowInfo, setWindowInfo] = useState<ActivityWindowInfo>({
    leftPercent: 0,
    visibleDays: ACTIVITY_VISIBLE_FALLBACK_DAYS,
    widthPercent: 13,
  });
  const svgWidth = days.length * ACTIVITY_DAY_WIDTH;

  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) {
      return;
    }
    const targetIndex = targetActivityDayIndex(days, selectedYear);
    scroller.scrollLeft = Math.max(
      0,
      Math.min(
        scroller.scrollWidth - scroller.clientWidth,
        (targetIndex + 1) * ACTIVITY_DAY_WIDTH - scroller.clientWidth + ACTIVITY_DAY_WIDTH,
      ),
    );
    setWindowInfo(activityWindowInfo(scroller));
  }, [days, selectedYear]);

  function handleScroll() {
    const scroller = scrollerRef.current;
    if (!scroller) {
      return;
    }
    setWindowInfo(activityWindowInfo(scroller));
  }

  function handleRailPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    const scroller = scrollerRef.current;
    if (!scroller) {
      return;
    }
    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = (event.clientX - rect.left) / rect.width;
    scroller.scrollLeft = Math.max(
      0,
      Math.min(
        scroller.scrollWidth - scroller.clientWidth,
        ratio * scroller.scrollWidth - scroller.clientWidth / 2,
      ),
    );
    setWindowInfo(activityWindowInfo(scroller));
  }

  return (
    <section className="rounded-t-3xl rounded-b-[14px] bg-[#f7f7f7] p-1">
      <div className="flex flex-col overflow-hidden rounded-t-[21px] rounded-b-[10px] border border-[#eeeeee] border-dashed bg-white shadow-[0_0_0_1px_rgba(27,27,27,0.02),0_1px_2px_-1px_rgba(27,27,27,0.02),0_2px_4px_rgba(27,27,27,0.01)]">
        <div className="flex h-[52px] items-center justify-between gap-4 pt-2 pr-2 pb-3 pl-5">
          <h2 className="font-medium text-[#707070] text-sm">Activity</h2>
          <div className="relative">
            <label className="sr-only" htmlFor="activity-year">
              Activity year
            </label>
            <select
              className="h-8 appearance-none rounded-[10px] border border-[#eeeeee] bg-white px-3 pr-8 font-medium text-[#1b1b1b] text-[13px] shadow-[0_1px_2px_rgba(27,27,27,0.05)] outline-none transition-colors hover:bg-[#fafafa] focus-visible:border-[#d8d8d8] focus-visible:ring-2 focus-visible:ring-[#1b1b1b]/10"
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
              className="pointer-events-none absolute top-1/2 right-2.5 h-3.5 w-3.5 -translate-y-1/2 text-[#9b9b9b]"
            />
          </div>
        </div>
        <div className="relative">
          <div className="flex h-[272px] overflow-hidden border-[#eeeeee]/80 border-t border-dashed bg-white">
            <div
              aria-hidden="true"
              className="relative z-10 w-12 shrink-0 rounded-l-[21px] border-[#eeeeee]/70 border-r border-dashed bg-white"
            >
              {ACTIVITY_HOUR_LABELS.map((label, index) => (
                <div
                  className="absolute inset-x-0 pr-2 text-right text-[#707070] text-[10px] leading-none"
                  key={label.hour}
                  style={{ top: `${31 + index * 25}px` }}
                >
                  {label.label}
                </div>
              ))}
            </div>
            <section
              aria-label={`Activity for ${selectedYear}`}
              className="no-scrollbar min-w-0 flex-1 overflow-x-auto overflow-y-hidden pt-6"
              onScroll={handleScroll}
              ref={scrollerRef}
            >
              <svg
                aria-hidden="true"
                className="block"
                height={ACTIVITY_CHART_HEIGHT}
                style={{ color: "#eeeeee", minWidth: svgWidth }}
                width={svgWidth}
              >
                <defs>
                  <pattern
                    height={ACTIVITY_DAY_WIDTH}
                    id={ACTIVITY_YEAR_PATTERN_ID}
                    patternUnits="userSpaceOnUse"
                    width={ACTIVITY_DAY_WIDTH}
                  >
                    <line
                      stroke="currentColor"
                      strokeDasharray="3 3"
                      strokeOpacity="0.7"
                      strokeWidth="1"
                      x1={ACTIVITY_DAY_WIDTH}
                      x2={ACTIVITY_DAY_WIDTH}
                      y1="0"
                      y2={ACTIVITY_DAY_WIDTH}
                    />
                    <line
                      stroke="currentColor"
                      strokeDasharray="3 3"
                      strokeOpacity="0.7"
                      strokeWidth="1"
                      x1="0"
                      x2={ACTIVITY_DAY_WIDTH}
                      y1={ACTIVITY_DAY_WIDTH}
                      y2={ACTIVITY_DAY_WIDTH}
                    />
                  </pattern>
                </defs>
                <rect
                  fill={`url(#${ACTIVITY_YEAR_PATTERN_ID})`}
                  height={ACTIVITY_GRID_HEIGHT}
                  width={svgWidth}
                  x="0"
                  y="0"
                />
                {cells.map((cell) =>
                  cell.runs > 0 ? (
                    <rect
                      aria-label={`${cell.runs} run${cell.runs === 1 ? "" : "s"} on ${
                        cell.dateLabel
                      } around ${cell.hourLabel}`}
                      fill={activityCellFill(cell.level)}
                      height="10"
                      key={cell.id}
                      opacity={isLoading ? "0.35" : "1"}
                      rx="4"
                      width="10"
                      x={cell.x}
                      y={cell.y}
                    >
                      <title>{`${cell.runs} run${cell.runs === 1 ? "" : "s"} - ${
                        cell.dateLabel
                      }, ${cell.hourLabel}`}</title>
                    </rect>
                  ) : null,
                )}
                {days.map((day) =>
                  day.dayOfMonth % 2 === 0 ? (
                    <text
                      className="fill-[#8a8a8a] text-[9px]"
                      key={`day-${day.key}`}
                      textAnchor="middle"
                      x={day.index * ACTIVITY_DAY_WIDTH + ACTIVITY_DAY_WIDTH / 2}
                      y={216}
                    >
                      {day.dayOfMonth}
                    </text>
                  ) : null,
                )}
                {monthLabels.map((label) => (
                  <text
                    className="fill-[#707070] text-[10px]"
                    key={`${label.month}-${label.startIndex}`}
                    textAnchor="middle"
                    x={
                      (label.startIndex + (label.endIndex - label.startIndex + 1) / 2) *
                      ACTIVITY_DAY_WIDTH
                    }
                    y={ACTIVITY_MONTH_LABEL_Y}
                  >
                    {label.month}
                  </text>
                ))}
              </svg>
            </section>
          </div>
        </div>
      </div>
      <div className="px-0 pt-1">
        <ActivityWindowRail info={windowInfo} onPointerDown={handleRailPointerDown} />
      </div>
      <p className="sr-only">
        {isErrored
          ? "Activity is temporarily unavailable."
          : `${runs.length.toLocaleString()} runs loaded for ${selectedYear}.`}
      </p>
      {children}
    </section>
  );
}

function ActivityWindowRail({
  info,
  onPointerDown,
}: {
  info: ActivityWindowInfo;
  onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void;
}) {
  const thumbWidth = Math.max(13, Math.min(100, info.widthPercent));
  const thumbLeft = Math.max(0, Math.min(100 - thumbWidth, info.leftPercent));

  return (
    <div
      aria-label={`Visible activity window, about ${info.visibleDays} days`}
      aria-valuemax={100}
      aria-valuemin={0}
      aria-valuenow={Math.round(thumbLeft)}
      aria-valuetext={`About ${info.visibleDays} days visible`}
      className="relative h-6 overflow-hidden rounded-full bg-white shadow-[0_0_0_1px_rgba(27,27,27,0.04),0_1px_2px_rgba(27,27,27,0.03)] ring-1 ring-[#eeeeee]/50"
      onPointerDown={onPointerDown}
      role="slider"
      tabIndex={0}
    >
      <div aria-hidden="true" className="absolute inset-0 flex items-center">
        {ACTIVITY_RAIL_TICKS.map((tick) => (
          <div className="h-px w-[3px] shrink-0 bg-[#707070]/10" key={tick.id} />
        ))}
      </div>
      <div
        className="absolute top-0 flex h-full cursor-grab select-none items-center justify-between gap-1.5 rounded-full bg-white/70 px-2 shadow-sm ring-1 ring-[#eeeeee] backdrop-blur-[1px] active:cursor-grabbing"
        style={{
          left: `${thumbLeft}%`,
          maxWidth: "calc(100% - 2px)",
          minWidth: "132px",
          width: `${thumbWidth}%`,
        }}
      >
        <ActivityRailGrip />
        <span className="whitespace-nowrap font-medium text-[#707070] text-[10px]">
          {info.visibleDays} Days
        </span>
        <ActivityRailGrip />
      </div>
    </div>
  );
}

function ActivityRailGrip() {
  return (
    <span aria-hidden="true" className="flex h-3 w-3 items-center justify-center gap-[2px]">
      <span className="h-3 w-px rounded-full bg-[#d7d7d7]" />
      <span className="h-3 w-px rounded-full bg-[#d7d7d7]" />
      <span className="h-3 w-px rounded-full bg-[#d7d7d7]" />
    </span>
  );
}

type ActivityLevel = 1 | 2 | 3 | 4;

interface ActivityDay {
  date: Date;
  dateLabel: string;
  dayOfMonth: number;
  index: number;
  key: string;
  month: string;
}

interface ActivityCell {
  dateLabel: string;
  hourLabel: string;
  id: string;
  level: ActivityLevel;
  runs: number;
  x: number;
  y: number;
}

interface ActivityMonthLabel {
  endIndex: number;
  month: string;
  startIndex: number;
}

interface ActivityWindowInfo {
  leftPercent: number;
  visibleDays: number;
  widthPercent: number;
}

function buildActivityYears(runs: UsageRunPoint[], currentYear: number): number[] {
  const years = new Set<number>([currentYear]);
  for (const run of runs) {
    const startedAt = new Date(run.startedAt);
    if (!Number.isNaN(startedAt.getTime())) {
      years.add(startedAt.getFullYear());
    }
  }
  return [...years].sort((left, right) => right - left);
}

function buildActivityYearDays(year: number): ActivityDay[] {
  const start = new Date(year, 0, 1);
  const end = new Date(year, 11, 31);
  const dayCount = Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1;

  return Array.from({ length: dayCount }, (_, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    return {
      date,
      dateLabel: ACTIVITY_DATE_FORMATTER.format(date),
      dayOfMonth: date.getDate(),
      index,
      key: localDateKey(date),
      month: ACTIVITY_MONTH_FORMATTER.format(date),
    };
  });
}

function buildActivityCells(days: ActivityDay[], runs: UsageRunPoint[]): ActivityCell[] {
  const runCounts = countActivityRuns(runs);
  const maxRuns = Math.max(1, ...runCounts.values());
  return days.flatMap((day) =>
    ACTIVITY_HOUR_LABELS.map((hour, hourIndex) => {
      const key = activityCellKey(day.key, hour.hour);
      const runCount = runCounts.get(key) ?? 0;
      return {
        dateLabel: day.dateLabel,
        hourLabel: hour.label,
        id: key,
        level: activityLevel(runCount, maxRuns),
        runs: runCount,
        x: day.index * ACTIVITY_DAY_WIDTH + 5,
        y: hourIndex * 25 + 7,
      };
    }),
  );
}

function buildActivityMonthLabels(days: ActivityDay[]): ActivityMonthLabel[] {
  if (days.length === 0) {
    return [];
  }

  const labels: ActivityMonthLabel[] = [];
  let startIndex = 0;
  let activeMonth = days[0]?.month ?? "";

  for (let index = 1; index <= days.length; index += 1) {
    const nextMonth = days[index]?.month;
    if (nextMonth === activeMonth) {
      continue;
    }
    labels.push({ endIndex: index - 1, month: activeMonth, startIndex });
    startIndex = index;
    activeMonth = nextMonth ?? "";
  }

  return labels;
}

function countActivityRuns(runs: UsageRunPoint[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const run of runs) {
    const startedAt = new Date(run.startedAt);
    if (Number.isNaN(startedAt.getTime())) {
      continue;
    }
    const bucketHour = Math.floor(startedAt.getHours() / 3) * 3;
    const key = activityCellKey(localDateKey(startedAt), bucketHour);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

function activityCellFill(level: ActivityLevel): string {
  switch (level) {
    case 1:
      return "#fbe2aa";
    case 2:
      return "#f8c55c";
    case 3:
      return "#ecaa38";
    case 4:
      return "#d98f1d";
  }
}

function activityLevel(runCount: number, maxRuns: number): ActivityLevel {
  if (maxRuns <= 1) {
    return 2;
  }

  const ratio = runCount / maxRuns;
  if (ratio <= 0.25) {
    return 1;
  }
  if (ratio <= 0.5) {
    return 2;
  }
  if (ratio <= 0.75) {
    return 3;
  }
  return 4;
}

function targetActivityDayIndex(days: ActivityDay[], selectedYear: number): number {
  const today = new Date();
  const targetKey =
    today.getFullYear() === selectedYear ? localDateKey(today) : (days.at(-1)?.key ?? "");
  const targetIndex = days.findIndex((day) => day.key === targetKey);
  return targetIndex >= 0 ? targetIndex : Math.max(0, days.length - 1);
}

function activityWindowInfo(scroller: HTMLDivElement): ActivityWindowInfo {
  const maxScroll = Math.max(1, scroller.scrollWidth - scroller.clientWidth);
  const widthPercent = Math.min(100, (scroller.clientWidth / scroller.scrollWidth) * 100);
  const leftPercent = (scroller.scrollLeft / maxScroll) * (100 - widthPercent);

  return {
    leftPercent,
    visibleDays: Math.max(1, Math.round(scroller.clientWidth / ACTIVITY_DAY_WIDTH)),
    widthPercent,
  };
}

function activityCellKey(dateKey: string, hour: number): string {
  return `${dateKey}-${hour}`;
}

function localDateKey(value: Date): string {
  return [
    value.getFullYear(),
    String(value.getMonth() + 1).padStart(2, "0"),
    String(value.getDate()).padStart(2, "0"),
  ].join("-");
}

function usePortalMutation(getToken: () => Promise<null | string>) {
  return useMutation({
    mutationFn: async () => {
      const response = await authorizedFetch(getToken, "/v1/billing/portal", { method: "POST" });
      return BillingUrlResponseSchema.parse(await response.json()).url;
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Billing redirect failed");
    },
    onSuccess: (url) => {
      window.location.assign(url);
    },
  });
}

function useUpgradeMutation(getToken: () => Promise<null | string>) {
  return useMutation({
    mutationFn: () =>
      requestCheckout(getToken, {
        returnUrl: window.location.href,
        successUrl: window.location.href,
        tier: "pro",
      }),
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Checkout failed");
    },
    onSuccess: (url) => {
      window.location.assign(url);
    },
  });
}

const BILLING_DATE_FORMATTER = new Intl.DateTimeFormat("en", {
  day: "numeric",
  month: "short",
  year: "numeric",
});

const ACTIVITY_DATE_FORMATTER = new Intl.DateTimeFormat("en", {
  day: "numeric",
  month: "short",
  year: "numeric",
});

const ACTIVITY_MONTH_FORMATTER = new Intl.DateTimeFormat("en", {
  month: "short",
});

function dateText(value: string | null): string {
  if (!value) {
    return "Not scheduled";
  }
  return BILLING_DATE_FORMATTER.format(new Date(value));
}
