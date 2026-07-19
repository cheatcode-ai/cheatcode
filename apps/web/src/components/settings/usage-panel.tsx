"use client";

import { useAuth } from "@clerk/nextjs";
import { ActivitySection } from "./activity-year-chart";
import { SandboxHoursMeter } from "./sandbox-hours-meter";

export function UsagePanel() {
  const { getToken } = useAuth();
  return (
    <div className="text-foreground">
      <h1 className="mb-12 hidden px-1 font-semibold text-foreground text-xl leading-7 md:block">
        Usage
      </h1>
      <div className="w-full space-y-6">
        <SandboxHoursMeter getToken={getToken} />
        <ActivitySection getToken={getToken} />
      </div>
    </div>
  );
}
