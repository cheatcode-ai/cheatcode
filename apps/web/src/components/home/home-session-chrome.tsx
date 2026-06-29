"use client";

import { useAuth } from "@clerk/nextjs";
import { useEffect, useRef, useState } from "react";
import { AuthModal, type AuthMode } from "@/components/auth/auth-modal";
import { CheatcodeMark } from "@/components/ui/cheatcode-mark";
import { Code, FileSpreadsheet, Monitor, MoreVertical, Plus } from "@/components/ui/icons";
import { useAppStore } from "@/lib/store/app-store";
import { cn } from "@/lib/ui/cn";

type HomeComputerTab = "browser" | "files";

const HOME_AUTH_EVENT = "cheatcode:home-auth-open";
const HOME_COMPUTER_EVENT = "cheatcode:home-computer-open";

export function HomeSessionChrome() {
  const { isLoaded, isSignedIn } = useAuth();
  const [authMode, setAuthMode] = useState<AuthMode | null>(null);

  useEffect(() => {
    if (!isLoaded || isSignedIn) {
      return;
    }

    function openAuth(event: Event) {
      const mode =
        event instanceof CustomEvent && event.detail === "sign-up" ? "sign-up" : "sign-in";
      setAuthMode(mode);
    }

    window.addEventListener(HOME_AUTH_EVENT, openAuth);
    window.addEventListener(HOME_COMPUTER_EVENT, openAuth);
    return () => {
      window.removeEventListener(HOME_AUTH_EVENT, openAuth);
      window.removeEventListener(HOME_COMPUTER_EVENT, openAuth);
    };
  }, [isLoaded, isSignedIn]);

  if (!isLoaded) {
    return null;
  }

  if (isSignedIn) {
    return <HomeComputerChrome />;
  }

  return (
    <>
      <header className="fixed top-0 right-0 left-[var(--cheatcode-sidebar-offset,16rem)] z-20 hidden h-14 items-center px-6 transition-[left] duration-200 md:flex">
        <div className="ml-auto flex items-center gap-3">
          <button
            className="paper-focus-ring h-8 rounded-full px-2.5 font-medium text-[#1b1b1b] text-[14px] leading-5 transition-colors hover:bg-[#f7f7f7]"
            onClick={() => setAuthMode("sign-in")}
            type="button"
          >
            Sign in
          </button>
          <button
            className="paper-focus-ring h-9 rounded-full bg-[#1b1b1b] px-4 font-medium text-[14px] text-white leading-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.18)] transition-colors hover:bg-[#2a2a2a]"
            onClick={() => setAuthMode("sign-up")}
            type="button"
          >
            Sign up
          </button>
        </div>
      </header>
      <AuthModal
        id="home-session-auth-modal"
        mode={authMode ?? "sign-in"}
        onClose={() => setAuthMode(null)}
        open={authMode !== null}
      />
    </>
  );
}

function HomeComputerChrome() {
  const [computerOpen, setComputerOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<HomeComputerTab>("files");
  const sidebarCollapsed = useAppStore((state) => state.sidebarCollapsed);
  const setSidebarCollapsed = useAppStore((state) => state.setSidebarCollapsed);
  const previousSidebarCollapsedRef = useRef<boolean | null>(null);

  useEffect(() => {
    function openComputer() {
      setActiveTab("files");
      setComputerOpen(true);
    }

    window.addEventListener(HOME_COMPUTER_EVENT, openComputer);
    return () => window.removeEventListener(HOME_COMPUTER_EVENT, openComputer);
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle("cheatcode-home-computer-open", computerOpen);
    return () => {
      document.documentElement.classList.remove("cheatcode-home-computer-open");
    };
  }, [computerOpen]);

  useEffect(() => {
    if (!computerOpen) {
      return;
    }
    if (previousSidebarCollapsedRef.current === null) {
      previousSidebarCollapsedRef.current = sidebarCollapsed;
    }
    setSidebarCollapsed(true);
  }, [computerOpen, setSidebarCollapsed, sidebarCollapsed]);

  function toggleComputer() {
    if (computerOpen) {
      if (previousSidebarCollapsedRef.current !== null) {
        setSidebarCollapsed(previousSidebarCollapsedRef.current);
      }
      previousSidebarCollapsedRef.current = null;
      setComputerOpen(false);
      return;
    }

    setActiveTab("files");
    setComputerOpen(true);
  }

  return (
    <>
      {computerOpen ? <HomeComputerPanel activeTab={activeTab} onTabChange={setActiveTab} /> : null}
      <button
        aria-label={computerOpen ? "Close computer" : "Open computer"}
        aria-pressed={computerOpen}
        className={cn(
          "paper-focus-ring fixed top-3.5 right-3.5 z-40 hidden h-7 items-center gap-1.5 rounded-full py-1 pr-3 pl-2.5 font-medium text-[14px] transition-all duration-200 md:flex",
          computerOpen
            ? "bg-[#1b1b1b] text-white hover:bg-black"
            : "bg-[#f7f7f7] text-[#1b1b1b] hover:bg-[#f1f1f1]",
        )}
        onClick={toggleComputer}
        type="button"
      >
        <Monitor aria-hidden="true" className="h-3.5 w-3.5" />
        Computer
      </button>
    </>
  );
}

function HomeComputerPanel({
  activeTab,
  onTabChange,
}: {
  activeTab: HomeComputerTab;
  onTabChange: (tab: HomeComputerTab) => void;
}) {
  return (
    <aside
      aria-label="Computer"
      className="fixed top-3.5 right-3.5 bottom-3.5 z-30 hidden w-[calc(100vw-var(--cheatcode-sidebar-offset,4rem)-32rem)] min-w-[420px] max-w-[760px] flex-col overflow-hidden bg-white md:flex"
    >
      <div className="flex h-10 shrink-0 items-center justify-between pr-36">
        <div
          aria-label="Computer views"
          className="inline-flex gap-1 rounded-full bg-[#f7f7f7] p-0.5 shadow-[0_0_1px_rgba(0,0,0,0.08)]"
          role="tablist"
        >
          {(["files", "browser"] as const).map((tab) => (
            <button
              aria-selected={activeTab === tab}
              className={cn(
                "paper-focus-ring flex h-7 items-center justify-center rounded-full px-3 font-medium text-[14px] transition-colors duration-150",
                activeTab === tab
                  ? "bg-white text-[#1b1b1b] shadow-[0_1px_5px_rgba(0,0,0,0.08)]"
                  : "text-[#707070] hover:text-[#1b1b1b]",
              )}
              key={tab}
              onClick={() => onTabChange(tab)}
              role="tab"
              type="button"
            >
              {tab === "files" ? "Files" : "Browser"}
            </button>
          ))}
        </div>
        <button
          aria-label="Computer actions"
          className="paper-focus-ring flex h-7 w-7 items-center justify-center rounded-full text-[#707070] transition-colors hover:bg-[#f7f7f7] hover:text-[#1b1b1b]"
          type="button"
        >
          <MoreVertical aria-hidden="true" className="h-4 w-4" />
        </button>
      </div>
      <div className="flex min-h-0 flex-1 flex-col rounded-[24px] border border-[#f1f1f1] bg-white shadow-[0_0_1px_rgba(0,0,0,0.08)]">
        <div className="flex min-h-0 flex-1 items-center justify-center px-8">
          {activeTab === "files" ? <BootingComputerState /> : <BrowserComputerState />}
        </div>
        <ComputerConsoleStrip />
      </div>
    </aside>
  );
}

function BootingComputerState() {
  return (
    <div className="text-center">
      <CheatcodeMark aria-hidden="true" className="mx-auto h-12 w-12 text-[#f8af2c]" />
      <p className="mt-5 font-medium text-[#707070] text-[15px]">Booting computer</p>
    </div>
  );
}

function BrowserComputerState() {
  return (
    <div className="w-full max-w-md rounded-[24px] border border-[#f1f1f1] bg-[#fafafa] p-5 text-center">
      <Monitor aria-hidden="true" className="mx-auto h-8 w-8 text-[#707070]" />
      <p className="mt-4 font-semibold text-[18px]">Browser ready</p>
      <p className="mt-2 text-[#707070] text-[14px] leading-6">
        Start a task and Cheatcode will open the live browser here.
      </p>
    </div>
  );
}

function ComputerConsoleStrip() {
  return (
    <div className="flex h-9 shrink-0 items-center gap-3 border-[#f1f1f1] border-t px-3 text-[#707070] text-[14px]">
      <button
        aria-label="Expand console"
        className="paper-focus-ring flex h-7 w-7 items-center justify-center rounded-full transition-colors hover:bg-[#f7f7f7] hover:text-[#1b1b1b]"
        type="button"
      >
        <span aria-hidden="true" className="text-[16px] leading-none">
          ^
        </span>
      </button>
      <div className="flex h-7 items-center gap-2 rounded-full px-2 font-medium text-[#1b1b1b]">
        <Code aria-hidden="true" className="h-3.5 w-3.5" />
        Console
      </div>
      <button
        aria-label="New terminal"
        className="paper-focus-ring flex h-7 w-7 items-center justify-center rounded-full transition-colors hover:bg-[#f7f7f7] hover:text-[#1b1b1b]"
        type="button"
      >
        <Plus aria-hidden="true" className="h-4 w-4" />
      </button>
      <div className="ml-auto hidden items-center gap-1.5 text-[#a0a0a0] text-[12px] lg:flex">
        <FileSpreadsheet aria-hidden="true" className="h-3.5 w-3.5" />
        No files yet
      </div>
    </div>
  );
}
