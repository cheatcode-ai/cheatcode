"use client";

import { useState } from "react";
import { UpgradeDialog } from "@/components/billing/upgrade-dialog";
import { useSandboxUsageQuery } from "@/lib/hooks/use-billing";

export function SandboxUsageBanner({ getToken }: { getToken: () => Promise<null | string> }) {
  const usageQuery = useSandboxUsageQuery(getToken);
  const [pickerOpen, setPickerOpen] = useState(false);

  if (usageQuery.data?.warnLevel !== "exhausted") {
    return null;
  }

  return (
    <div className="mx-auto -mb-2 w-full max-w-[96%]">
      <div className="overflow-hidden rounded-t-[20px] border-2 border-border border-b-0 bg-background">
        <div className="rounded-t-[18px] bg-background p-0.5 pb-1.5">
          <div className="rounded-t-[16px] bg-gradient-to-b from-bg-secondary to-transparent">
            <div className="flex items-center gap-3 px-3 pt-2 pb-2.5">
              <span className="min-w-0 flex-1 truncate font-medium text-[13px] text-foreground leading-[19.5px]">
                Sandbox hours are exhausted for this billing period
              </span>
              <button
                className="shrink-0 font-medium text-[13px] text-fg-secondary leading-[19.5px] transition-colors hover:text-foreground"
                onClick={() => setPickerOpen(true)}
                type="button"
              >
                View plans
              </button>
            </div>
          </div>
        </div>
      </div>
      <UpgradeDialog getToken={getToken} onClose={() => setPickerOpen(false)} open={pickerOpen} />
    </div>
  );
}
