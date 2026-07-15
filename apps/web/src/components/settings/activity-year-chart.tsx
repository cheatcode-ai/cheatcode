"use client";

import type { ActivityRunPoint, SandboxHourPoint } from "@cheatcode/types";
import { useEffect, useMemo, useState } from "react";
import { CheatcodeLoader } from "@/components/ui/cheatcode-loader";
import { ChartNoAxesCombined } from "@/components/ui/icons";
import { RecoveryCard } from "@/components/ui/recovery-card";
import { useActivityQuery } from "@/lib/hooks/use-billing";
import { ActivityYearChart } from "./activity-year-chart-view";
import { buildActivityYears } from "./activity-year-model";

const QUERY_DAYS = 90;
const EMPTY_RUNS: ActivityRunPoint[] = [];
const EMPTY_SANDBOX_HOURS: SandboxHourPoint[] = [];

export function ActivitySection({ getToken }: { getToken: () => Promise<null | string> }) {
  const activity = useActivitySection(getToken);
  if (activity.query.isLoading) {
    return <ActivityLoading />;
  }
  if (activity.query.isError) {
    return <ActivityLoadError activity={activity} />;
  }
  return (
    <ActivityYearChart
      onYearChange={activity.setSelectedYear}
      runs={activity.runs}
      sandboxHours={activity.sandboxHours}
      selectedYear={activity.selectedYear}
      years={activity.years}
    >
      {activity.query.data?.truncated ? (
        <p className="sr-only">Only the most recent activity in this range is shown.</p>
      ) : null}
    </ActivityYearChart>
  );
}

function useActivitySection(getToken: () => Promise<null | string>) {
  const [currentYear] = useState(() => new Date().getFullYear());
  const [selectedYear, setSelectedYear] = useState(currentYear);
  const query = useActivityQuery(getToken, QUERY_DAYS);
  const runs = query.data?.runs ?? EMPTY_RUNS;
  const sandboxHours = query.data?.sandboxHours ?? EMPTY_SANDBOX_HOURS;
  const years = useMemo(
    () => buildActivityYears(runs, sandboxHours, currentYear),
    [currentYear, runs, sandboxHours],
  );
  useEffect(() => {
    if (!years.includes(selectedYear)) {
      setSelectedYear(years[0] ?? currentYear);
    }
  }, [currentYear, selectedYear, years]);
  return { query, runs, sandboxHours, selectedYear, setSelectedYear, years };
}

function ActivityLoading() {
  return (
    <CheatcodeLoader className="min-h-[360px] rounded-3xl bg-background" label="Loading activity" />
  );
}

function ActivityLoadError({ activity }: { activity: ReturnType<typeof useActivitySection> }) {
  return (
    <section className="flex min-h-[360px] items-center justify-center rounded-3xl bg-bg-secondary p-5">
      <RecoveryCard
        action={{
          isPending: activity.query.isFetching,
          label: "Reload activity",
          onClick: () => void activity.query.refetch(),
          pendingLabel: "Loading activity…",
        }}
        description="Cheatcode couldn't reach your recent activity. Try loading the chart again."
        icon={ChartNoAxesCombined}
        size="compact"
        title="Activity couldn't load"
      />
    </section>
  );
}
