"use client";

import { useEffect } from "react";
import { useAppStore } from "@/lib/store/app-store";

/**
 * Sets `--cheatcode-sidebar-offset` from the sidebar collapse state so the home
 * page's content (root padding-left + the fixed composer form) tracks the actual
 * sidebar width — 56px when collapsed (icon rail), 240px when expanded. The main
 * `AppSidebar` also sets this, but it is Suspense-wrapped (usePathname), so its
 * effect can lag on the home route and the var falls back to the 16rem expanded
 * default even while the rail is collapsed, shoving the content right. This runs
 * outside that Suspense boundary so the offset is always correct.
 */
export function HomeSidebarOffset() {
  const sidebarCollapsed = useAppStore((state) => state.sidebarCollapsed);

  useEffect(() => {
    document.documentElement.style.setProperty(
      "--cheatcode-sidebar-offset",
      sidebarCollapsed ? "56px" : "240px",
    );
  }, [sidebarCollapsed]);

  return null;
}
