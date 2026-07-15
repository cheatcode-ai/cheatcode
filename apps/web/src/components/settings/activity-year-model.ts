import type { ActivityRunPoint, SandboxHourPoint } from "@cheatcode/types";

export const DAY_WIDTH = 20;
export const GRID_HEIGHT = 200;

const HALF_HOUR_MINUTES = 30;
const MS_PER_DAY = 86_400_000;

type ActivityLevel = 1 | 2 | 3 | 4;

export interface ActivityDay {
  dayOfMonth: number;
  index: number;
  key: string;
  month: string;
}

export interface ActivityCell {
  bucketStart: Date;
  hours: number;
  id: string;
  level: ActivityLevel;
  runCount: number;
  x: number;
  y: number;
}

export interface ActivityMonthLabel {
  endIndex: number;
  month: string;
  startIndex: number;
}

export function buildActivityYears(
  runs: ActivityRunPoint[],
  points: SandboxHourPoint[],
  currentYear: number,
): number[] {
  const years = new Set<number>([currentYear]);
  for (const value of [
    ...runs.map((run) => run.startedAt),
    ...points.map((point) => point.recordedAt),
  ]) {
    const recordedAt = new Date(value);
    if (!Number.isNaN(recordedAt.getTime())) {
      years.add(recordedAt.getFullYear());
    }
  }
  return [...years].sort((left, right) => right - left);
}

export function buildActivityYearDays(year: number): ActivityDay[] {
  const start = new Date(year, 0, 1);
  const end = new Date(year, 11, 31);
  const dayCount = Math.round((end.getTime() - start.getTime()) / MS_PER_DAY) + 1;
  return Array.from({ length: dayCount }, (_, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    return {
      dayOfMonth: date.getDate(),
      index,
      key: localDateKey(date),
      month: MONTH_FORMATTER.format(date),
    };
  });
}

export function buildActivityCells(
  days: ActivityDay[],
  runs: ActivityRunPoint[],
  points: SandboxHourPoint[],
): ActivityCell[] {
  const dayIndexes = new Map(days.map((day) => [day.key, day.index]));
  const buckets = new Map<string, ActivityBucket>();
  addSandboxHoursToBuckets(buckets, dayIndexes, points);
  addRunsToBuckets(buckets, dayIndexes, runs);
  return positionActivityBuckets(buckets, dayIndexes);
}

export function buildActivityMonthLabels(days: ActivityDay[]): ActivityMonthLabel[] {
  const labels: ActivityMonthLabel[] = [];
  let startIndex = 0;
  let activeMonth = days[0]?.month ?? "";
  for (let index = 1; index <= days.length; index += 1) {
    const nextMonth = days[index]?.month;
    if (nextMonth !== activeMonth) {
      labels.push({ endIndex: index - 1, month: activeMonth, startIndex });
      startIndex = index;
      activeMonth = nextMonth ?? "";
    }
  }
  return labels;
}

export function activityCellOpacity(level: ActivityLevel): number {
  return ACTIVITY_OPACITY[level];
}

export function targetActivityDayIndex(days: ActivityDay[], selectedYear: number): number {
  const today = new Date();
  const targetKey =
    today.getFullYear() === selectedYear ? localDateKey(today) : (days.at(-1)?.key ?? "");
  const targetIndex = days.findIndex((day) => day.key === targetKey);
  return targetIndex >= 0 ? targetIndex : Math.max(0, days.length - 1);
}

export function activityTooltipText(cell: ActivityCell): string {
  const end = new Date(cell.bucketStart.getTime() + HALF_HOUR_MINUTES * 60_000);
  return `${formatRunCount(cell.runCount)} · ${formatSandboxHours(cell.hours)} · ${TOOLTIP_DATE_FORMATTER.format(cell.bucketStart)}, ${formatTime(
    cell.bucketStart,
  )}–${formatTime(end)}`;
}

export function totalSandboxHours(cells: ActivityCell[]): number {
  return cells.reduce((total, cell) => total + cell.hours, 0);
}

export function totalRuns(cells: ActivityCell[]): number {
  return cells.reduce((total, cell) => total + cell.runCount, 0);
}

export function formatRunCount(value: number): string {
  return `${value} ${value === 1 ? "run" : "runs"}`;
}

export function formatSandboxHours(value: number): string {
  if (value > 0 && value < 0.01) {
    return "<0.01 sandbox hours";
  }
  const formatted = SANDBOX_HOURS_FORMATTER.format(value);
  return `${formatted} sandbox ${Number(formatted) === 1 ? "hour" : "hours"}`;
}

interface ActivityBucket {
  bucketStart: Date;
  hours: number;
  runCount: number;
}

function addSandboxHoursToBuckets(
  buckets: Map<string, ActivityBucket>,
  dayIndexes: Map<string, number>,
  points: SandboxHourPoint[],
) {
  for (const point of points) {
    const recordedAt = new Date(point.recordedAt);
    if (Number.isNaN(recordedAt.getTime()) || point.hours <= 0) {
      continue;
    }
    if (!dayIndexes.has(localDateKey(recordedAt))) {
      continue;
    }
    const bucketStart = halfHourStart(recordedAt);
    const key = activityBucketKey(bucketStart);
    const bucket = buckets.get(key);
    buckets.set(key, {
      bucketStart,
      hours: (bucket?.hours ?? 0) + point.hours,
      runCount: bucket?.runCount ?? 0,
    });
  }
}

function addRunsToBuckets(
  buckets: Map<string, ActivityBucket>,
  dayIndexes: Map<string, number>,
  runs: ActivityRunPoint[],
) {
  for (const run of runs) {
    const startedAt = new Date(run.startedAt);
    if (Number.isNaN(startedAt.getTime()) || !dayIndexes.has(localDateKey(startedAt))) {
      continue;
    }
    const bucketStart = halfHourStart(startedAt);
    const key = activityBucketKey(bucketStart);
    const bucket = buckets.get(key);
    buckets.set(key, {
      bucketStart,
      hours: bucket?.hours ?? 0,
      runCount: (bucket?.runCount ?? 0) + 1,
    });
  }
}

function positionActivityBuckets(
  buckets: Map<string, ActivityBucket>,
  dayIndexes: Map<string, number>,
): ActivityCell[] {
  const maxActivity = Math.max(
    1,
    ...[...buckets.values()].map((bucket) => bucket.runCount + bucket.hours),
  );
  return [...buckets.entries()].flatMap(([id, bucket]) => {
    const dayIndex = dayIndexes.get(localDateKey(bucket.bucketStart));
    if (dayIndex === undefined) {
      return [];
    }
    const minutes = bucket.bucketStart.getHours() * 60 + bucket.bucketStart.getMinutes();
    return [
      {
        bucketStart: bucket.bucketStart,
        hours: bucket.hours,
        id,
        level: activityLevel(bucket.runCount + bucket.hours, maxActivity),
        runCount: bucket.runCount,
        x: dayIndex * DAY_WIDTH + DAY_WIDTH / 2,
        y: Math.max(4.4, Math.min(GRID_HEIGHT - 4.4, (minutes / 1_440) * GRID_HEIGHT)),
      },
    ];
  });
}

function activityLevel(activity: number, maxActivity: number): ActivityLevel {
  const ratio = activity / maxActivity;
  if (ratio <= 0.25) return 1;
  if (ratio <= 0.5) return 2;
  if (ratio <= 0.75) return 3;
  return 4;
}

function halfHourStart(value: Date): Date {
  const bucket = new Date(value);
  bucket.setMinutes(Math.floor(bucket.getMinutes() / HALF_HOUR_MINUTES) * HALF_HOUR_MINUTES, 0, 0);
  return bucket;
}

function activityBucketKey(value: Date): string {
  return `${localDateKey(value)}-${value.getHours()}-${value.getMinutes()}`;
}

function formatTime(value: Date): string {
  const formatter = value.getMinutes() === 0 ? HOUR_FORMATTER : HOUR_MINUTE_FORMATTER;
  return formatter.format(value);
}

function localDateKey(value: Date): string {
  return [
    value.getFullYear(),
    String(value.getMonth() + 1).padStart(2, "0"),
    String(value.getDate()).padStart(2, "0"),
  ].join("-");
}

const ACTIVITY_OPACITY: Record<ActivityLevel, number> = { 1: 0.2, 2: 0.38, 3: 0.65, 4: 0.9 };
const MONTH_FORMATTER = new Intl.DateTimeFormat("en", { month: "short" });
const TOOLTIP_DATE_FORMATTER = new Intl.DateTimeFormat("en", {
  day: "numeric",
  month: "short",
  weekday: "short",
});
const SANDBOX_HOURS_FORMATTER = new Intl.NumberFormat("en", {
  maximumFractionDigits: 2,
  minimumFractionDigits: 0,
});
const HOUR_FORMATTER = new Intl.DateTimeFormat("en", { hour: "numeric" });
const HOUR_MINUTE_FORMATTER = new Intl.DateTimeFormat("en", {
  hour: "numeric",
  minute: "2-digit",
});
