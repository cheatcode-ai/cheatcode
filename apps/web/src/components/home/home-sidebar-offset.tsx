"use client";

import { useEffect } from "react";
import { useAppStore } from "@/lib/store/app-store";

/**
 * Sets `--cheatcode-sidebar-offset` from the sidebar collapse state so the home
 * workspace frame (its padding-left + the signed-out header's left inset) tracks
 * the actual sidebar width — 56px when collapsed (icon rail), 240px when expanded.
 * The main `AppSidebar` also sets this, but it is Suspense-wrapped (usePathname),
 * so its effect can lag on the home route and the var falls back to the expanded
 * default even while the rail is collapsed, shoving the content right. This runs
 * outside that Suspense boundary so the offset is always correct.
 */
export function HomeSidebarOffset() {
  const sidebarCollapsed = useAppStore((state) => state.sidebarCollapsed);

  useEffect(() => {
    document.documentElement.style.setProperty(
      "--cheatcode-sidebar-offset",
      sidebarCollapsed ? "56px" : "248px",
    );
  }, [sidebarCollapsed]);

  return null;
}
