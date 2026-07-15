import type { ActivityCell, ActivityDay, ActivityMonthLabel } from "./activity-year-model";
import {
  activityCellOpacity,
  activityTooltipText,
  DAY_WIDTH,
  GRID_HEIGHT,
} from "./activity-year-model";
import type { ActivityWindowInfo } from "./activity-year-scroll";

const HOUR_LABELS = [
  { hour: 0, label: "12 AM" },
  { hour: 3, label: "3 AM" },
  { hour: 6, label: "6 AM" },
  { hour: 9, label: "9 AM" },
  { hour: 12, label: "12 PM" },
  { hour: 15, label: "3 PM" },
  { hour: 18, label: "6 PM" },
  { hour: 21, label: "9 PM" },
] as const;
const CHART_HEIGHT = 272;
const MONTH_LABEL_Y = 238;
const YEAR_PATTERN_ID = "cheatcode-activity-year-grid";

export function ActivityHourAxis() {
  return (
    <div
      aria-hidden="true"
      className="relative z-10 w-12 shrink-0 rounded-l-[21px] border-border/70 border-r border-dashed bg-background"
    >
      {HOUR_LABELS.map((label, index) => (
        <div
          className="absolute inset-x-0 pr-2 text-right text-[10px] text-fg-secondary leading-none"
          key={label.hour}
          style={{ top: `${31 + index * 25}px` }}
        >
          {label.label}
        </div>
      ))}
    </div>
  );
}

export function ActivitySvg({
  cells,
  days,
  monthLabels,
  svgWidth,
}: {
  cells: ActivityCell[];
  days: ActivityDay[];
  monthLabels: ActivityMonthLabel[];
  svgWidth: number;
}) {
  return (
    <svg
      aria-hidden="true"
      className="block text-border-subtle"
      height={CHART_HEIGHT}
      style={{ minWidth: svgWidth }}
      width={svgWidth}
    >
      <ActivityGrid svgWidth={svgWidth} />
      <ActivityCells cells={cells} />
      <ActivityDayLabels days={days} />
      <ActivityMonthLabels labels={monthLabels} />
    </svg>
  );
}

function ActivityCells({ cells }: { cells: ActivityCell[] }) {
  return cells.map((cell) => (
    <circle
      className="cursor-pointer transition-[r,fill-opacity] duration-150 hover:[r:5.25px]"
      cx={cell.x}
      cy={cell.y}
      fill="#e8a234"
      fillOpacity={activityCellOpacity(cell.level)}
      key={cell.id}
      data-activity-cell={cell.id}
      r="4.4"
    />
  ));
}

function ActivityDayLabels({ days }: { days: ActivityDay[] }) {
  return days.map((day) =>
    day.dayOfMonth % 2 === 0 ? (
      <text
        className="fill-placeholder text-[9px]"
        key={`day-${day.key}`}
        textAnchor="middle"
        x={day.index * DAY_WIDTH + DAY_WIDTH / 2}
        y={216}
      >
        {day.dayOfMonth}
      </text>
    ) : null,
  );
}

function ActivityMonthLabels({ labels }: { labels: ActivityMonthLabel[] }) {
  return labels.map((label) => (
    <text
      className="fill-[#707070] text-[10px]"
      key={`${label.month}-${label.startIndex}`}
      textAnchor="middle"
      x={(label.startIndex + (label.endIndex - label.startIndex + 1) / 2) * DAY_WIDTH}
      y={MONTH_LABEL_Y}
    >
      {label.month}
    </text>
  ));
}

function ActivityGrid({ svgWidth }: { svgWidth: number }) {
  return (
    <>
      <defs>
        <pattern
          height={DAY_WIDTH}
          id={YEAR_PATTERN_ID}
          patternUnits="userSpaceOnUse"
          width={DAY_WIDTH}
        >
          <path
            d={`M ${DAY_WIDTH} 0 V ${DAY_WIDTH} H 0`}
            fill="none"
            stroke="currentColor"
            strokeOpacity="0.2"
            strokeWidth="1"
          />
        </pattern>
      </defs>
      <rect fill={`url(#${YEAR_PATTERN_ID})`} height={GRID_HEIGHT} width={svgWidth} />
    </>
  );
}

export function ActivityTooltip({
  cell,
  info,
}: {
  cell: ActivityCell | null;
  info: ActivityWindowInfo;
}) {
  if (!cell || info.clientWidth === 0) {
    return null;
  }
  const pointLeft = 48 + cell.x - info.scrollLeft;
  const left = Math.max(138, Math.min(48 + info.clientWidth - 138, pointLeft));
  return (
    <div
      className="pointer-events-none absolute z-50 flex -translate-x-1/2 -translate-y-full items-center gap-1.5 whitespace-nowrap rounded-lg border border-border bg-background px-2.5 py-1.5 text-foreground text-xs shadow-[0_8px_24px_rgba(27,27,27,0.12)]"
      role="tooltip"
      style={{ left, top: 24 + cell.y - 5 }}
    >
      {activityTooltipText(cell)}
    </div>
  );
}
