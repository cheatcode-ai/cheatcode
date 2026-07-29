"use client";

import { useEffect, useRef } from "react";
import { useAppStore } from "@/lib/store/app-store";

/**
 * Collapses the sidebar once while a secondary workspace surface is active,
 * then restores the prior state when that surface closes. The saved-state guard
 * intentionally lets the user re-expand the sidebar while the surface remains open.
 */
export function useAutoCollapseSidebar(active: boolean): void {
  const sidebarCollapsed = useAppStore((state) => state.sidebarCollapsed);
  const setSidebarCollapsed = useAppStore((state) => state.setSidebarCollapsed);
  const previousSidebarCollapsedRef = useRef<boolean | null>(null);

  useEffect(() => {
    if (!active) {
      if (previousSidebarCollapsedRef.current !== null) {
        setSidebarCollapsed(previousSidebarCollapsedRef.current);
        previousSidebarCollapsedRef.current = null;
      }
      return;
    }
    if (previousSidebarCollapsedRef.current === null) {
      previousSidebarCollapsedRef.current = sidebarCollapsed;
      setSidebarCollapsed(true);
    }
  }, [active, setSidebarCollapsed, sidebarCollapsed]);
}
