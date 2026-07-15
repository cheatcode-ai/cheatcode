"use client";

import type { ReactNode } from "react";
import { useAppStore } from "@/lib/store/app-store";
import { cn } from "@/lib/ui/cn";

/**
 * The app surface that moves as one piece when the mobile navigation drawer opens.
 * Keeping this shared prevents the home and routed app shells from drifting apart.
 */
export function SidebarContentFrame({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  const sidebarOpen = useAppStore((state) => state.sidebarOpen);

  return (
    <div
      className={cn("cheatcode-workspace-frame", className)}
      data-mobile-sidebar-open={sidebarOpen ? "true" : "false"}
      inert={sidebarOpen ? true : undefined}
    >
      {children}
    </div>
  );
}
