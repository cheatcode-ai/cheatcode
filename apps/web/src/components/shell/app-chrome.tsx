"use client";

import { usePathname } from "next/navigation";
import { type ReactNode, Suspense } from "react";
import { AppSidebar } from "@/components/shell/app-sidebar";
import { cn } from "@/lib/ui/cn";

export function AppChrome({ children }: { children: ReactNode }) {
  // The chrome layout depends on `usePathname()` (dynamic) to tell workspace
  // routes (/projects, /chats) from the rest. Under Next's `cacheComponents`,
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
  const isWorkspace = pathname.startsWith("/projects") || pathname.startsWith("/chats");

  return (
    <>
      <AppSidebar variant={isWorkspace ? "rail" : "full"} />
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
