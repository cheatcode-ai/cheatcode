"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { type ReactNode, Suspense } from "react";
import { AppSidebar } from "@/components/shell/app-sidebar";
import { SidebarContentFrame } from "@/components/shell/sidebar-content-frame";
import { useAutoCollapseSidebar } from "@/components/shell/use-auto-collapse-sidebar";
import { Plus } from "@/components/ui";
import { useAppStore } from "@/lib/store/app-store";

const MOBILE_ROUTE_TITLES = {
  "/101": "Cheatcode 101",
  "/models": "Models",
  "/personalization": "Personalization",
  "/pricing": "Pricing",
  "/skills": "Skills",
  "/usage": "Usage",
} as const satisfies Readonly<Record<string, string>>;

export function AppChrome({ children }: { children: ReactNode }) {
  // The chrome layout depends on `usePathname()` (dynamic) to tell workspace
  // chat routes from the rest. Under Next's `cacheComponents`,
  // that dynamic read must live inside a <Suspense> boundary or the dynamic
  // `/chats/[chatId]` route fails to prerender. Keeping the whole pathname-aware
  // frame in WorkspaceChrome satisfies that without changing runtime behavior.
  return (
    <main
      className="cheatcode-app-shell bg-background text-thread-text-primary"
      id="main-content"
      tabIndex={-1}
    >
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
  useAutoCollapseSidebar(isWorkspace && previewPanelOpen);

  return (
    <>
      <AppSidebar variant="full" />
      <SidebarContentFrame className="flex min-w-0 flex-col overflow-hidden">
        <MobileRouteHeader pathname={pathname} />
        {children}
      </SidebarContentFrame>
    </>
  );
}

function MobileRouteHeader({ pathname }: { pathname: string }) {
  const title = MOBILE_ROUTE_TITLES[pathname as keyof typeof MOBILE_ROUTE_TITLES];
  if (!title) {
    return null;
  }

  return (
    <header className="relative z-40 flex h-10 shrink-0 items-center bg-background md:hidden">
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
        <span className="max-w-[50vw] truncate font-medium text-[13px] text-foreground/70 leading-[19.5px]">
          {title}
        </span>
      </div>
      {pathname === "/skills" ? (
        <Link
          aria-label="Create skill"
          className="ml-auto flex size-8 items-center justify-center rounded-full text-fg-secondary transition-colors hover:bg-secondary hover:text-foreground"
          href="/?intent=skill-creator"
        >
          <Plus aria-hidden="true" className="size-4" />
        </Link>
      ) : null}
    </header>
  );
}
