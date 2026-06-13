"use client";

import { UserButton, useAuth } from "@clerk/nextjs";
import { useQuery } from "@tanstack/react-query";
import Image from "next/image";
import { usePathname, useSearchParams } from "next/navigation";
import { Zap } from "@/components/ui/icons";
import { getThread } from "@/lib/api/project-thread";
import { useAppStore } from "@/lib/store/app-store";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function ThreadHeader() {
  const { getToken } = useAuth();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const sidebarOpen = useAppStore((state) => state.sidebarOpen);
  const setSidebarOpen = useAppStore((state) => state.setSidebarOpen);
  const routeTitle = titleFromPath(pathname);
  const threadId = validThreadId(searchParams.get("thread"));
  const threadQuery = useQuery({
    enabled: pathname === "/projects" && threadId !== null,
    queryFn: () => getThread(getToken, String(threadId)),
    queryKey: ["threads", threadId],
    retry: false,
    staleTime: 5_000,
  });
  const title = pathname === "/projects" ? threadQuery.data?.title || "New project" : routeTitle;

  return (
    <header className="fixed top-0 right-0 left-0 z-30 flex h-14 w-full items-center justify-between border-thread-border-subtle border-b bg-thread-panel-translucent px-6 backdrop-blur-md">
      <div className="flex items-center gap-6">
        <button
          aria-label={sidebarOpen ? "Close sidebar" : "Open sidebar"}
          className="flex h-8 w-8 items-center justify-center rounded-sm text-thread-text-secondary transition-colors hover:bg-transparent hover:text-thread-text-primary"
          onClick={() => setSidebarOpen(!sidebarOpen)}
          type="button"
        >
          <Image alt="" height={18} src="/cheatcode-symbol.png" width={18} />
        </button>
        <div className="-ms-2 flex min-w-0 flex-col px-2 py-1">
          {threadQuery.isPending && pathname === "/projects" && threadId !== null ? (
            <>
              <span aria-hidden="true" className="block h-4 w-32 rounded-md bg-thread-skeleton" />
              <span className="sr-only">Loading project title</span>
            </>
          ) : (
            <h1 className="max-w-[46vw] truncate font-medium text-sm text-thread-text-primary md:max-w-[34rem]">
              {title}
            </h1>
          )}
        </div>
      </div>
      <div className="flex items-center gap-4">
        <a
          className="hidden h-8 items-center gap-2 rounded-md border border-thread-border bg-thread-surface px-3 font-mono text-[11px] text-thread-text-secondary uppercase tracking-wider shadow-sm transition-colors hover:border-thread-border-hover hover:bg-thread-surface-hover hover:text-thread-text-primary md:flex"
          href="/settings/integrations"
        >
          <Zap aria-hidden="true" className="h-3.5 w-3.5" />
          Integrations
        </a>
        <UserButton />
      </div>
    </header>
  );
}

function validThreadId(value: null | string): null | string {
  return value && UUID_PATTERN.test(value) ? value : null;
}

function titleFromPath(pathname: string): string {
  if (pathname.startsWith("/settings")) {
    return "Settings";
  }
  if (pathname.startsWith("/skills")) {
    return "Curated Skills";
  }
  return "Cheatcode";
}
