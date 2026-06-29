"use client";

import type { SandboxUsageWarnLevel } from "@cheatcode/types";
import { useAuth } from "@clerk/nextjs";
import Link from "next/link";
import { useState } from "react";
import { formatHoursTotal, formatHoursUsed, useSandboxUsageQuery } from "@/lib/hooks/use-billing";

const WARN_BAR_CLASS: Record<SandboxUsageWarnLevel, string> = {
  exhausted: "bg-red-500",
  none: "bg-emerald-500",
  warn80: "bg-amber-500",
  warn95: "bg-orange-500",
};

export function UsageBadge() {
  const { getToken } = useAuth();
  const usageQuery = useSandboxUsageQuery(getToken);
  const [open, setOpen] = useState(false);
  const usage = usageQuery.data;
  const label = usage
    ? `${formatHoursUsed(usage.sandboxHoursUsed)} of ${formatHoursTotal(usage.sandboxHoursTotal)} hours`
    : "… hours";

  return (
    <div className="relative hidden md:block">
      <button
        aria-expanded={open}
        className="flex h-8 items-center gap-2 rounded-md border border-thread-border bg-thread-surface px-3 font-mono text-[11px] text-thread-text-secondary uppercase tracking-wider shadow-sm transition-colors hover:border-thread-border-hover hover:bg-thread-surface-hover hover:text-thread-text-primary"
        onClick={() => setOpen((value) => !value)}
        type="button"
      >
        {label}
      </button>
      {open ? (
        <>
          <button
            aria-hidden="true"
            className="fixed inset-0 z-30 cursor-default"
            onClick={() => setOpen(false)}
            tabIndex={-1}
            type="button"
          />
          <UsagePopover usage={usage} />
        </>
      ) : null}
    </div>
  );
}

function UsagePopover({
  usage,
}: {
  usage:
    | undefined
    | {
        resetAt: string;
        sandboxHoursTotal: number;
        sandboxHoursUsed: number;
        warnLevel: SandboxUsageWarnLevel;
      };
}) {
  if (!usage) {
    return (
      <div className="absolute top-10 right-0 z-40 w-64 rounded-lg border border-thread-border bg-thread-panel p-4 text-thread-text-secondary text-xs shadow-xl">
        Loading sandbox usage…
      </div>
    );
  }
  const remaining = Math.max(0, usage.sandboxHoursTotal - usage.sandboxHoursUsed);
  const fraction =
    usage.sandboxHoursTotal > 0 ? Math.min(1, usage.sandboxHoursUsed / usage.sandboxHoursTotal) : 0;

  return (
    <div className="absolute top-10 right-0 z-40 w-64 space-y-3 rounded-lg border border-thread-border bg-thread-panel p-4 shadow-xl">
      <p className="font-mono text-[10px] text-thread-text-secondary uppercase tracking-[0.2em]">
        Sandbox time
      </p>
      <p className="font-medium text-sm text-thread-text-primary">
        {formatHoursUsed(usage.sandboxHoursUsed)} of {formatHoursTotal(usage.sandboxHoursTotal)}{" "}
        hours
      </p>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-thread-surface">
        <div
          className={`h-full ${WARN_BAR_CLASS[usage.warnLevel]}`}
          style={{ width: `${Math.round(fraction * 100)}%` }}
        />
      </div>
      <p className="text-thread-text-secondary text-xs">
        {formatHoursUsed(remaining)} hours remaining · Resets {formatResetDate(usage.resetAt)}
      </p>
      <Link
        className="inline-flex text-thread-text-secondary text-xs underline-offset-2 hover:text-thread-text-primary hover:underline"
        href="/settings/billing"
      >
        Manage plan
      </Link>
    </div>
  );
}

const RESET_DATE_FORMATTER = new Intl.DateTimeFormat("en", { day: "numeric", month: "short" });

function formatResetDate(value: string): string {
  return RESET_DATE_FORMATTER.format(new Date(value));
}
