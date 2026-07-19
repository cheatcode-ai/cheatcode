"use client";

import { Clock3 } from "@cheatcode/ui";
import { CheatcodeLoader } from "@/components/ui/cheatcode-loader";
import { RecoveryCard } from "@/components/ui/recovery-card";
import { useSandboxUsageQuery } from "@/lib/hooks/use-billing";
import { SandboxHoursMeterBody } from "./sandbox-hours-meter-body";

export function SandboxHoursMeter({ getToken }: { getToken: () => Promise<null | string> }) {
  const usageQuery = useSandboxUsageQuery(getToken);
  const usage = usageQuery.data;
  return (
    <section className="rounded-3xl bg-secondary p-1 dark:bg-bg-lifted">
      <div className="rounded-[21px] bg-background p-3 shadow-[0_0_0_1px_rgba(27,27,27,0.02),0_1px_2px_-1px_rgba(27,27,27,0.02),0_2px_4px_rgba(27,27,27,0.01)] sm:p-5">
        {usageQuery.isLoading ? (
          <SandboxHoursMeterLoading />
        ) : usageQuery.isError || !usage ? (
          <SandboxHoursLoadError query={usageQuery} />
        ) : (
          <SandboxHoursMeterBody getToken={getToken} usage={usage} />
        )}
      </div>
    </section>
  );
}

function SandboxHoursLoadError({ query }: { query: ReturnType<typeof useSandboxUsageQuery> }) {
  return (
    <div className="flex min-h-52 items-center justify-center">
      <RecoveryCard
        action={{
          isPending: query.isFetching,
          label: "Reload usage",
          onClick: () => void query.refetch(),
          pendingLabel: "Loading usage…",
        }}
        description="Cheatcode couldn't reach your latest sandbox usage. Try loading it again."
        icon={Clock3}
        size="compact"
        title="Usage couldn't load"
      />
    </div>
  );
}

function SandboxHoursMeterLoading() {
  return <CheatcodeLoader className="min-h-[76px]" label="Loading sandbox usage" />;
}
