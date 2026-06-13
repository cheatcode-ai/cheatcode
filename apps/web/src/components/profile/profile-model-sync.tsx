"use client";

import { useEffect } from "react";
import type { AgentModelId } from "@/lib/agent-models";
import { useProfileQuery } from "@/lib/hooks/use-profile";
import { useAppStore } from "@/lib/store/app-store";

/**
 * One-way sync: when the server profile loads, seed the composer's `agentModelId`
 * from the App builder default. Server wins on load; user edits flow the other way
 * (mutation → store). Reads the current store value via `getState()` so a manual
 * composer change does not retrigger this effect — it only fires when the server
 * value changes. Lives in a dedicated component so the seeding effect is never
 * stripped by component-level transforms.
 */
export function ProfileModelSync(): null {
  const profileQuery = useProfileQuery();
  const setAgentModelId = useAppStore((state) => state.setAgentModelId);
  const appbuilderDefaultModel = profileQuery.data?.appbuilderDefaultModel ?? null;
  const hasProfile = profileQuery.data !== undefined;

  useEffect(() => {
    if (!hasProfile) {
      return;
    }
    const target: AgentModelId = appbuilderDefaultModel ?? "auto";
    if (useAppStore.getState().agentModelId !== target) {
      setAgentModelId(target);
    }
  }, [hasProfile, appbuilderDefaultModel, setAgentModelId]);

  return null;
}
