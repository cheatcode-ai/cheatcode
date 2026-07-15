"use client";

import type { SandboxUsageSummaryResponse, SandboxUsageWarnLevel } from "@cheatcode/types";
import { ManageSubscriptionDialog } from "@/components/billing/manage-subscription-dialog";
import { UpgradeDialog } from "@/components/billing/upgrade-dialog";
import { ArrowUpRight } from "@/components/ui/icons";
import { formatHoursTotal, formatHoursUsed } from "@/lib/hooks/use-billing";
import { cn } from "@/lib/ui/cn";
import { useSandboxHoursMeter } from "./use-sandbox-hours-meter";

const WARN_BAR_CLASS: Record<SandboxUsageWarnLevel, string> = {
  exhausted: "bg-red-500",
  none: "bg-primary",
  warn80: "bg-primary",
  warn95: "bg-orange-500",
};
const SANDBOX_BAR_SEGMENTS = Array.from({ length: 84 }, (_, position) => ({
  id: `sandbox-bar-${position}`,
  position,
}));

export function SandboxHoursMeterBody({
  getToken,
  usage,
}: {
  getToken: () => Promise<null | string>;
  usage: SandboxUsageSummaryResponse;
}) {
  const meter = useSandboxHoursMeter(usage);
  return (
    <div>
      <p className="sr-only">
        {meter.label}: {formatHoursUsed(meter.displayedHours)} of{" "}
        {formatHoursTotal(usage.sandboxHoursTotal)} hours. Resets {dateText(usage.resetAt)}.
      </p>
      <SandboxHoursHeader meter={meter} usage={usage} />
      <SandboxHoursBar fraction={meter.fraction} warnLevel={usage.warnLevel} />
      <ManageSubscriptionDialog
        getToken={getToken}
        onClose={() => meter.setManagerOpen(false)}
        open={meter.managerOpen}
        planDisplayName={meter.tierLabel}
        sandboxHoursTotal={usage.sandboxHoursTotal}
      />
      <UpgradeDialog
        getToken={getToken}
        onClose={() => meter.setPickerOpen(false)}
        open={meter.pickerOpen}
      />
    </div>
  );
}

function SandboxHoursHeader({
  meter,
  usage,
}: {
  meter: ReturnType<typeof useSandboxHoursMeter>;
  usage: SandboxUsageSummaryResponse;
}) {
  return (
    <div className="flex items-start justify-between gap-1 sm:gap-3">
      <div className="flex min-w-0 flex-col gap-1">
        <button
          aria-label={meter.nextLabel}
          className="inline-flex w-fit cursor-pointer items-start gap-1 whitespace-nowrap font-medium text-fg-secondary text-xs leading-5 transition-colors hover:text-foreground sm:text-sm"
          onClick={meter.toggleUsageView}
          type="button"
        >
          {meter.label}
          <ArrowUpRight aria-hidden="true" className="mt-0.5 h-2.5 w-2.5" />
        </button>
        <p className="flex h-[25px] flex-wrap items-center gap-2 overflow-hidden leading-none">
          <span className="font-semibold text-2xl text-foreground leading-6">
            {formatHoursUsed(meter.displayedHours)}
          </span>
          <span className="font-medium text-fg-secondary text-sm leading-5">
            of {formatHoursTotal(usage.sandboxHoursTotal)} {meter.inlineLabel}
          </span>
        </p>
      </div>
      <SandboxHoursAction meter={meter} />
    </div>
  );
}

function SandboxHoursAction({ meter }: { meter: ReturnType<typeof useSandboxHoursMeter> }) {
  return (
    <div className="flex shrink-0 items-center gap-1 pt-1 sm:gap-2">
      <span className="font-medium text-foreground text-xs sm:text-sm">{meter.tierLabel}</span>
      <button
        className="inline-flex h-8 items-center rounded-full bg-bg-inverse px-3 font-medium text-fg-inverse text-xs transition-colors hover:bg-bg-inverse/90 sm:px-4 sm:text-sm"
        onClick={() => (meter.isPaidTier ? meter.setManagerOpen(true) : meter.setPickerOpen(true))}
        type="button"
      >
        {meter.actionLabel}
      </button>
    </div>
  );
}

function SandboxHoursBar({
  fraction,
  warnLevel,
}: {
  fraction: number;
  warnLevel: SandboxUsageWarnLevel;
}) {
  return (
    <div className="mt-3 flex h-5 w-full gap-1 overflow-hidden">
      {SANDBOX_BAR_SEGMENTS.map((segment) => (
        <span
          className={cn(
            "h-full min-w-[4px] flex-1 rounded-full",
            segment.position / SANDBOX_BAR_SEGMENTS.length < fraction
              ? WARN_BAR_CLASS[warnLevel]
              : "bg-bg-secondary",
          )}
          key={segment.id}
        />
      ))}
    </div>
  );
}

const BILLING_DATE_FORMATTER = new Intl.DateTimeFormat("en", {
  day: "numeric",
  month: "short",
  timeZone: "UTC",
  year: "numeric",
});

function dateText(value: string | null): string {
  return value ? BILLING_DATE_FORMATTER.format(new Date(value)) : "Not scheduled";
}
