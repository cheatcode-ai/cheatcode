"use client";

import type { SandboxUsageSummaryResponse } from "@cheatcode/types";
import { useState } from "react";

export function useSandboxHoursMeter(usage: SandboxUsageSummaryResponse) {
  const [usageView, setUsageView] = useState<"remaining" | "used">("remaining");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [managerOpen, setManagerOpen] = useState(false);
  const remaining = Math.max(0, usage.sandboxHoursTotal - usage.sandboxHoursUsed);
  const displayedHours = usageView === "remaining" ? remaining : usage.sandboxHoursUsed;
  const fraction =
    usage.sandboxHoursTotal > 0 ? Math.min(1, displayedHours / usage.sandboxHoursTotal) : 0;
  const tierLabel = usage.tier.charAt(0).toUpperCase() + usage.tier.slice(1);
  const isRemaining = usageView === "remaining";
  const isPaidTier = usage.tier !== "free";
  return {
    actionLabel: isPaidTier ? "Manage" : "Upgrade",
    displayedHours,
    fraction,
    inlineLabel: isRemaining ? "hours remaining" : "hours used",
    isPaidTier,
    label: isRemaining ? "Sandbox hours remaining" : "Sandbox hours used",
    managerOpen,
    nextLabel: isRemaining ? "Show sandbox hours used" : "Show sandbox hours remaining",
    pickerOpen,
    setManagerOpen,
    setPickerOpen,
    tierLabel,
    toggleUsageView: () => setUsageView((value) => (value === "remaining" ? "used" : "remaining")),
  };
}
