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
import { SidebarContentFrame } from "@/components/shell/sidebar-content-frame";
import { CheatcodeCursorField } from "@/components/ui/cheatcode-cursor-field";
import { CheatcodeMark } from "@/components/ui/cheatcode-mark";
import { WorkspaceRunLayout } from "@/components/workspace/workspace-run-layout";
import { useAppStore } from "@/lib/store/app-store";
import { cn } from "@/lib/ui/cn";

/**
 * The home page (`/`). Reuses the same {@link WorkspaceRunLayout} shell as the
 * chat/projects view so the "computer open" split is structurally identical —
 * only the pane content differs (home greeting/composer instead of a chat
 * thread). Signed-in users get their user-scoped Computer pane; signed-out users get a
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
    <main
      className="cheatcode-app-shell bg-background text-foreground"
      id="main-content"
      tabIndex={-1}
    >
      <HomeSidebarOffset />
      <Suspense fallback={null}>
        <AppSidebar variant="full" />
      </Suspense>
      <SidebarContentFrame className="flex min-w-0 overflow-hidden bg-background">
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
          content={<HomeContentPane computerOpen={computerVisible} />}
          hasPreviewSurface={hasComputer}
        />
      </SidebarContentFrame>
    </main>
  );
}

function HomeContentPane({ computerOpen }: { computerOpen: boolean }) {
  // The quick-action pills belong in the greeting cluster (below the headline),
  // but their intent state is owned by the composer at the bottom of the pane and
  // is entangled with the composer's skill/repo/project state, textarea focus, and
  // search-param seeding. The composer portals the pills into this slot so they
  // render in the greeting cluster while staying in the composer's React tree —
  // the intent wiring flows through the React tree, not the DOM, so it is
  // unchanged. See `HomeComposer`.
  const [quickActionsSlot, setQuickActionsSlot] = useState<HTMLElement | null>(null);
  return (
    <div className="relative isolate flex min-h-0 flex-1 flex-col overflow-hidden bg-background">
      <div className="relative z-20 h-10 shrink-0 bg-background md:hidden" data-cheatcode-ignore>
        <Suspense fallback={null}>
          <HomeGreeting variant="mobile" />
        </Suspense>
      </div>
      <CheatcodeCursorField className="z-0" />
      <div className="chat-scrollbar relative z-10 flex min-h-0 flex-1 flex-col items-center justify-start overflow-y-auto px-4 py-6 md:px-6 md:py-10 [@media(max-height:500px)]:py-0">
        <div
          className="mx-auto my-auto flex w-full max-w-[740px] flex-col items-center md:px-4"
          data-cheatcode-ignore
        >
          <CheatcodeMark aria-hidden="true" className="h-[42px] w-[42px] text-primary" />
          <div className="hidden md:block">
            <Suspense fallback={null}>
              <HomeGreeting />
            </Suspense>
          </div>
          <HomeHeadline />
          <div className="mt-6 w-full" ref={setQuickActionsSlot} />
        </div>
      </div>
      <div
        className={cn(
          "relative z-10 shrink-0 px-3 sm:px-4",
          computerOpen ? "pb-2" : "pb-3 md:pb-10",
        )}
        data-cheatcode-ignore
      >
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
    // Collapse the rail ONCE when the computer opens (saving the prior state to
    // restore on close), but let the user re-expand it while the computer stays
    // open — Cheatcode keeps the sidebar expandable in this state. Guarding on the ref
    // (not re-collapsing on every sidebarCollapsed change) is what makes the
    // Expand-sidebar button work here.
    if (previousSidebarCollapsedRef.current === null) {
      previousSidebarCollapsedRef.current = sidebarCollapsed;
      setSidebarCollapsed(true);
    }
  }, [active, setSidebarCollapsed, sidebarCollapsed]);
}
