import type { ProjectMode } from "@cheatcode/types/api";

export type AppBuildTarget = "mobile" | "web";

export function isAppBuildTarget(value: unknown): value is AppBuildTarget {
  return value === "mobile" || value === "web";
}

/** Maps a runtime-specific app target to the persisted project topology. */
export function appBuildTargetToProjectMode(target: AppBuildTarget | null): ProjectMode {
  if (target === "mobile") {
    return "app-builder-mobile";
  }
  return target === "web" ? "app-builder" : "general";
}
