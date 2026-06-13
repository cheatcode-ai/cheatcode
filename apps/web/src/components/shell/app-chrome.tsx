"use client";

import Image from "next/image";
import { type ReactNode, Suspense } from "react";
import { AppSidebar } from "@/components/shell/app-sidebar";
import { ThreadHeader } from "@/components/shell/thread-header";

export function AppChrome({ children }: { children: ReactNode }) {
  return (
    <main className="min-h-screen bg-thread-panel text-thread-text-primary">
      <Suspense fallback={null}>
        <AppSidebar />
      </Suspense>
      <Suspense fallback={<ThreadHeaderFallback />}>
        <ThreadHeader />
      </Suspense>
      <div className="flex h-screen min-h-0 pt-14">{children}</div>
    </main>
  );
}

function ThreadHeaderFallback() {
  return (
    <header className="fixed top-0 right-0 left-0 z-30 flex h-14 w-full items-center justify-between border-thread-border-subtle border-b bg-thread-panel-translucent px-6 backdrop-blur-md">
      <div className="flex items-center gap-6">
        <div className="flex h-8 w-8 items-center justify-center rounded-sm">
          <Image alt="" height={18} src="/cheatcode-symbol.png" width={18} />
        </div>
        <div className="h-4 w-32 rounded-md bg-thread-skeleton" />
      </div>
    </header>
  );
}
