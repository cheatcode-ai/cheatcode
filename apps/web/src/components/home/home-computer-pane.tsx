"use client";

import { useState } from "react";
import { BudTooltip } from "@/components/ui/bud-tooltip";
import { CheatcodeMark } from "@/components/ui/cheatcode-mark";
import { Code, FileSpreadsheet, Monitor, MoreVertical, Plus } from "@/components/ui/icons";
import { cn } from "@/lib/ui/cn";

type HomeComputerTab = "browser" | "files";

/**
 * The home page's demo "Computer" pane. Renders as the `.cc-agent-computer-pane`
 * flex child of {@link WorkspaceRunLayout} (not `position: fixed`), mirroring the
 * chat's {@link PreviewSidePanel} structure. The home has no threadId/real sandbox,
 * so the body stays a demo "Booting computer" state. Also renders the floating
 * "Open computer" pill shown while the pane is collapsed.
 */
export function HomeComputerPane({
  computerOpen,
  onClose,
  onOpen,
}: {
  computerOpen: boolean;
  onClose: () => void;
  onOpen: () => void;
}) {
  const [activeTab, setActiveTab] = useState<HomeComputerTab>("files");

  function openComputer() {
    setActiveTab("files");
    onOpen();
  }

  return (
    <>
      <BudTooltip
        className={cn(
          "fixed top-3.5 right-3.5 z-40 hidden transition-[opacity,transform] duration-200 ease-[cubic-bezier(0.4,0,0.2,1)] motion-reduce:transition-none md:flex",
          computerOpen
            ? "pointer-events-none translate-y-0 scale-[0.98] opacity-0"
            : "translate-y-0 scale-100 opacity-100",
        )}
        label="Open computer"
        side="bottom"
      >
        <button
          aria-hidden={computerOpen}
          aria-label="Open computer"
          className="flex h-7 items-center gap-1.5 rounded-full bg-[#1b1b1b] py-1 pr-3 pl-2.5 font-medium text-[14px] text-white transition-[background-color,transform] duration-200 ease-[cubic-bezier(0.4,0,0.2,1)] hover:bg-black active:scale-[0.97] motion-reduce:transition-none"
          onClick={openComputer}
          tabIndex={computerOpen ? -1 : undefined}
          type="button"
        >
          <Monitor aria-hidden="true" className="h-4 w-4" />
          <span>Computer</span>
        </button>
      </BudTooltip>
      <aside
        aria-hidden={!computerOpen}
        aria-label="Computer"
        className={cn(
          "cc-agent-computer-pane hidden min-h-0 min-w-0 overflow-hidden bg-white transition-[opacity,transform,filter] duration-200 ease-[cubic-bezier(0.4,0,0.2,1)] motion-reduce:transform-none motion-reduce:transition-none md:flex",
          computerOpen
            ? "translate-x-0 opacity-100 blur-0"
            : "pointer-events-none translate-x-3 opacity-0 blur-[1px]",
        )}
        inert={computerOpen ? undefined : true}
      >
        <div className="flex h-full max-h-full w-full min-w-0 flex-col gap-2 overflow-hidden bg-white">
          <HomeComputerTabs activeTab={activeTab} onClose={onClose} onTabChange={setActiveTab} />
          <div className="flex min-h-0 w-full flex-1 flex-col overflow-hidden rounded-[24px] border border-[#f1f1f1] bg-white shadow-[0_0_1px_rgba(0,0,0,0.08)]">
            <div className="flex min-h-0 flex-1 items-center justify-center px-8">
              {activeTab === "files" ? <BootingComputerState /> : <BrowserComputerState />}
            </div>
            <ComputerConsoleStrip />
          </div>
        </div>
      </aside>
    </>
  );
}

function HomeComputerTabs({
  activeTab,
  onClose,
  onTabChange,
}: {
  activeTab: HomeComputerTab;
  onClose: () => void;
  onTabChange: (tab: HomeComputerTab) => void;
}) {
  return (
    <div className="hidden h-12 w-full shrink-0 items-center justify-between overflow-visible px-[3px] md:flex">
      <div
        aria-label="Computer views"
        className="inline-flex items-center gap-1 rounded-full bg-[#f7f7f7] p-0.5 shadow-[0_0_1px_rgba(0,0,0,0.08)]"
        role="tablist"
      >
        {(["files", "browser"] as const).map((tab) => (
          <button
            aria-selected={activeTab === tab}
            className={cn(
              "flex h-7 items-center justify-center whitespace-nowrap rounded-full px-3 font-medium text-[14px] transition-colors",
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
      <div className="flex shrink-0 items-center gap-1 pr-1">
        <button
          aria-label="Computer actions"
          className="flex h-7 w-7 items-center justify-center rounded-full text-[#5f5f5f] transition-colors hover:bg-[#f7f7f7] hover:text-[#1b1b1b]"
          type="button"
        >
          <MoreVertical aria-hidden="true" className="h-4 w-4" />
        </button>
        <BudTooltip label="Close computer" side="bottom">
          <button
            aria-label="Close computer"
            className="inline-flex h-7 items-center gap-1.5 rounded-full bg-[#1b1b1b] py-1 pr-3 pl-2.5 font-medium text-[14px] text-white transition-[background-color,transform] duration-200 ease-[cubic-bezier(0.4,0,0.2,1)] hover:bg-black active:scale-[0.97] motion-reduce:transition-none"
            onClick={onClose}
            type="button"
          >
            <Monitor aria-hidden="true" className="h-4 w-4" />
            <span>Computer</span>
          </button>
        </BudTooltip>
      </div>
    </div>
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
        className="flex h-7 w-7 items-center justify-center rounded-full transition-colors hover:bg-[#f7f7f7] hover:text-[#1b1b1b]"
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
        className="flex h-7 w-7 items-center justify-center rounded-full transition-colors hover:bg-[#f7f7f7] hover:text-[#1b1b1b]"
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
