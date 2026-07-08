"use client";

import { useAuth } from "@clerk/nextjs";
import { Suspense, useEffect, useRef, useState } from "react";
import { HomeComposerFromSearchParams } from "@/components/home/home-composer-from-search-params";
import { HomeComputerPane } from "@/components/home/home-computer-pane";
import { HomeGreeting } from "@/components/home/home-greeting";
import { HomeHeadline } from "@/components/home/home-headline";
import { HomeSessionChrome } from "@/components/home/home-session-chrome";
import { HomeSidebarOffset } from "@/components/home/home-sidebar-offset";
import { AppSidebar } from "@/components/shell/app-sidebar";
import { CheatcodeMark } from "@/components/ui/cheatcode-mark";
import { WorkspaceRunLayout } from "@/components/workspace/workspace-run-layout";
import { useAppStore } from "@/lib/store/app-store";

/**
 * The home page (`/`). Reuses the same {@link WorkspaceRunLayout} shell as the
 * chat/projects view so the "computer open" split is structurally identical —
 * only the pane content differs (home greeting/composer instead of a chat
 * thread). Signed-in users get the demo Computer pane; signed-out users get a
 * single centered greeting/composer column plus the auth header.
 */
export function HomeWorkspace() {
  const { isLoaded, isSignedIn } = useAuth();
  const [computerOpen, setComputerOpen] = useState(false);
  const hasComputer = Boolean(isLoaded && isSignedIn);
  const computerVisible = hasComputer && computerOpen;

  useHomeComputerSidebarCollapse(computerVisible);

  // Drop the open state if the signed-in surface goes away (e.g. sign-out).
  useEffect(() => {
    if (!hasComputer && computerOpen) {
      setComputerOpen(false);
    }
  }, [hasComputer, computerOpen]);

  return (
    <div className="cheatcode-workspace-frame flex h-screen min-h-screen min-w-0 overflow-hidden bg-white text-[#1b1b1b]">
      <HomeSidebarOffset />
      <Suspense fallback={null}>
        <AppSidebar variant="full" />
      </Suspense>
      <HomeSessionChrome />
      <WorkspaceRunLayout
        computer={
          hasComputer ? (
            <HomeComputerPane
              computerOpen={computerOpen}
              onClose={() => setComputerOpen(false)}
              onOpen={() => setComputerOpen(true)}
            />
          ) : null
        }
        computerOpen={computerVisible}
        content={<HomeContentPane />}
        hasPreviewSurface={hasComputer}
      />
    </div>
  );
}

function HomeContentPane() {
  // The quick-action pills belong in the greeting cluster (below the headline),
  // but their intent state is owned by the composer at the bottom of the pane and
  // is entangled with the composer's skill/repo/project state, textarea focus, and
  // search-param seeding. The composer portals the pills into this slot so they
  // render in the greeting cluster while staying in the composer's React tree —
  // the intent wiring flows through the React tree, not the DOM, so it is
  // unchanged. See `HomeComposer`.
  const [quickActionsSlot, setQuickActionsSlot] = useState<HTMLElement | null>(null);
  return (
    <div className="relative flex min-h-0 flex-1 flex-col bg-white">
      <div className="chat-scrollbar flex min-h-0 flex-1 flex-col items-center justify-center overflow-y-auto px-6 py-10">
        <div className="mx-auto flex w-full max-w-[740px] flex-col items-center px-4">
          <CheatcodeMark aria-hidden="true" className="h-[42px] w-[42px] text-[#f8af2c]" />
          <Suspense fallback={<div className="mt-4 h-4 w-40 rounded-full bg-[#f7f7f7]" />}>
            <HomeGreeting />
          </Suspense>
          <HomeHeadline />
          <div className="mt-6 w-full" ref={setQuickActionsSlot} />
        </div>
      </div>
      <div className="shrink-0 px-6 pb-8">
        <HomeComposerFromSearchParams quickActionsSlot={quickActionsSlot} />
      </div>
    </div>
  );
}

/**
 * Collapse the sidebar rail while the home Computer pane is open (and restore the
 * user's previous rail state on close), mirroring the chat workspace behaviour in
 * `AppChrome`.
 */
function useHomeComputerSidebarCollapse(active: boolean): void {
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
    }
    setSidebarCollapsed(true);
  }, [active, setSidebarCollapsed, sidebarCollapsed]);
}
