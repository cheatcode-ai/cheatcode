"use client";

import { usePathname } from "next/navigation";
import { type ReactNode, Suspense } from "react";
import { AppSidebar } from "@/components/shell/app-sidebar";
import { cn } from "@/lib/ui/cn";

export function AppChrome({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const isWorkspace = pathname.startsWith("/projects");

  return (
    <main className="min-h-screen bg-white text-thread-text-primary">
      <Suspense fallback={null}>
        <AppSidebar variant={isWorkspace ? "rail" : "full"} />
      </Suspense>
      <div
        className={cn(
          "min-h-screen min-w-0 transition-[padding] duration-200",
          isWorkspace ? "md:pl-16" : "md:pl-[var(--cheatcode-sidebar-offset,16rem)]",
          isWorkspace && "flex h-screen overflow-hidden",
        )}
      >
        {children}
      </div>
    </main>
  );
}
