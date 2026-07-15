import { cn } from "@/lib/ui/cn";
import type { ActivityWindowInfo, ActivityWindowRailProps } from "./activity-year-scroll";

const RAIL_TICKS = Array.from({ length: 360 }, (_, position) => ({
  id: `activity-rail-${position}`,
}));

export function ActivityWindowRail(props: ActivityWindowRailProps) {
  const thumbWidth = Math.max(13, Math.min(100, props.info.widthPercent));
  const thumbLeft = Math.max(0, Math.min(100 - thumbWidth, props.info.leftPercent));
  return (
    <div
      aria-label={`Visible activity window, about ${props.info.visibleDays} days`}
      aria-valuemax={100}
      aria-valuemin={0}
      aria-valuenow={Math.round(thumbLeft)}
      aria-valuetext={`About ${props.info.visibleDays} days visible`}
      className="relative h-6 touch-none overflow-hidden rounded-full bg-background shadow-[0_0_0_1px_rgba(27,27,27,0.04),0_1px_2px_rgba(27,27,27,0.03)] ring-1 ring-border/50"
      onKeyDown={props.onKeyDown}
      onPointerCancel={props.onPointerCancel}
      onPointerDown={props.onPointerDown}
      onPointerMove={props.onPointerMove}
      onPointerUp={props.onPointerUp}
      role="slider"
      tabIndex={0}
    >
      <ActivityRailTicks />
      <ActivityRailThumb
        info={props.info}
        isDragging={props.isDragging}
        left={thumbLeft}
        width={thumbWidth}
      />
    </div>
  );
}

function ActivityRailTicks() {
  return (
    <div aria-hidden="true" className="absolute inset-0 flex items-center">
      {RAIL_TICKS.map((tick) => (
        <div className="h-px w-[3px] shrink-0 bg-fg-secondary/10" key={tick.id} />
      ))}
    </div>
  );
}

function ActivityRailThumb({
  info,
  isDragging,
  left,
  width,
}: {
  info: ActivityWindowInfo;
  isDragging: boolean;
  left: number;
  width: number;
}) {
  return (
    <div
      className={cn(
        "absolute top-0 flex h-full select-none items-center justify-between gap-1.5 rounded-full bg-background/70 px-2 shadow-sm ring-1 ring-border backdrop-blur-[1px]",
        isDragging ? "cursor-grabbing" : "cursor-grab",
      )}
      data-activity-thumb=""
      style={{
        left: `${left}%`,
        maxWidth: "calc(100% - 2px)",
        minWidth: "132px",
        width: `${width}%`,
      }}
    >
      <ActivityRailGrip />
      <span className="whitespace-nowrap font-medium text-[10px] text-fg-secondary">
        {info.visibleDays} Days
      </span>
      <ActivityRailGrip />
    </div>
  );
}

function ActivityRailGrip() {
  return (
    <span aria-hidden="true" className="flex h-3 w-3 items-center justify-center gap-[2px]">
      <span className="h-3 w-px rounded-full bg-border-tree" />
      <span className="h-3 w-px rounded-full bg-border-tree" />
      <span className="h-3 w-px rounded-full bg-border-tree" />
    </span>
  );
}
