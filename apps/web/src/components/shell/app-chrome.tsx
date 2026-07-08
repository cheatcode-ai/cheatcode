"use client";

import { usePathname } from "next/navigation";
import { type ReactNode, Suspense, useEffect, useRef } from "react";
import { AppSidebar } from "@/components/shell/app-sidebar";
import { useAppStore } from "@/lib/store/app-store";
import { cn } from "@/lib/ui/cn";

export function AppChrome({ children }: { children: ReactNode }) {
  // The chrome layout depends on `usePathname()` (dynamic) to tell workspace
  // chat routes from the rest. Under Next's `cacheComponents`,
  // that dynamic read must live inside a <Suspense> boundary or the dynamic
  // `/chats/[chatId]` route fails to prerender. Keeping the whole pathname-aware
  // frame in WorkspaceChrome satisfies that without changing runtime behavior.
  return (
    <main className="min-h-screen bg-white text-thread-text-primary">
      <Suspense fallback={null}>
        <WorkspaceChrome>{children}</WorkspaceChrome>
      </Suspense>
    </main>
  );
}

function WorkspaceChrome({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const isWorkspace = pathname.startsWith("/chats");
  const previewPanelOpen = useAppStore((state) => state.previewPanelOpen);
  const sidebarCollapsed = useAppStore((state) => state.sidebarCollapsed);
  const setSidebarCollapsed = useAppStore((state) => state.setSidebarCollapsed);
  const previousSidebarCollapsedRef = useRef<boolean | null>(null);

  useEffect(() => {
    if (!isWorkspace || !previewPanelOpen) {
      if (previousSidebarCollapsedRef.current !== null) {
        setSidebarCollapsed(previousSidebarCollapsedRef.current);
        previousSidebarCollapsedRef.current = null;
      }
      return;
    }

    // Collapse the rail ONCE when the preview opens (saving the prior state to
    // restore on close), but let the user re-expand it while the preview stays
    // open. Guarding on the ref — rather than re-collapsing on every
    // sidebarCollapsed change — is what makes the Expand-sidebar button work here.
    if (previousSidebarCollapsedRef.current === null) {
      previousSidebarCollapsedRef.current = sidebarCollapsed;
      setSidebarCollapsed(true);
    }
  }, [isWorkspace, previewPanelOpen, setSidebarCollapsed, sidebarCollapsed]);

  return (
    <>
      <AppSidebar variant="full" />
      <div
        className={cn(
          "min-h-screen min-w-0",
          isWorkspace
            ? "cheatcode-workspace-frame"
            : "md:pl-[var(--cheatcode-sidebar-offset,16rem)]",
          isWorkspace && "flex h-screen overflow-hidden",
        )}
      >
        {children}
      </div>
    </>
  );
}
