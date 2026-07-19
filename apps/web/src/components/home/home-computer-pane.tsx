"use client";

import { Activity, useState } from "react";
import { ComputerPanelTabs } from "@/components/preview/computer-panel-tabs";
import { ComputerSurfaceFrame } from "@/components/preview/computer-surface-frame";
import { ComputerToggleButton } from "@/components/preview/computer-toggle-button";
import { ConsoleStrip } from "@/components/preview/console-strip";
import { PreviewUrlBar } from "@/components/preview/preview-url-bar";
import { SandboxIdeTab } from "@/components/preview/sandbox-ide-tab";
import { CheatcodeTooltip } from "@/components/ui/cheatcode-tooltip";
import type { PreviewTab } from "@/lib/store/app-store";
import { cn } from "@/lib/ui/cn";

/** The user-scoped Computer shown on home before a chat or project is selected. */
export function HomeComputerPane({
  computerOpen,
  onClose,
  onOpen,
}: {
  computerOpen: boolean;
  onClose: () => void;
  onOpen: () => void;
}) {
  const [activeTab, setActiveTab] = useState<PreviewTab>("files");

  return (
    <>
      <OpenComputerPill computerOpen={computerOpen} onOpen={onOpen} />
      <HomeComputerAside
        activeTab={activeTab}
        computerOpen={computerOpen}
        onClose={onClose}
        setActiveTab={setActiveTab}
      />
    </>
  );
}

function HomeComputerAside({
  activeTab,
  computerOpen,
  onClose,
  setActiveTab,
}: {
  activeTab: PreviewTab;
  computerOpen: boolean;
  onClose: () => void;
  setActiveTab: (tab: PreviewTab) => void;
}) {
  return (
    <aside
      aria-hidden={!computerOpen}
      aria-label="Computer"
      className={homeComputerClass(computerOpen)}
      inert={computerOpen ? undefined : true}
    >
      <HomeComputerBody activeTab={activeTab} onClose={onClose} setActiveTab={setActiveTab} />
    </aside>
  );
}

function HomeComputerBody({
  activeTab,
  onClose,
  setActiveTab,
}: {
  activeTab: PreviewTab;
  onClose: () => void;
  setActiveTab: (tab: PreviewTab) => void;
}) {
  return (
    <div className="flex h-full max-h-full w-full min-w-0 flex-col gap-2 overflow-hidden bg-background">
      <ComputerPanelTabs
        activePreviewTab={activeTab}
        deliverableCount={0}
        projectId={null}
        projectName={null}
        setActivePreviewTab={setActiveTab}
        setPreviewPanelOpen={(open) => {
          if (!open) onClose();
        }}
      />
      <ComputerSurfaceFrame
        consoleStrip={
          activeTab === "files" ? <ConsoleStrip sandboxAvailable threadId={null} /> : null
        }
      >
        <HomeComputerTabContent activeTab={activeTab} />
      </ComputerSurfaceFrame>
    </div>
  );
}

function HomeComputerTabContent({ activeTab }: { activeTab: PreviewTab }) {
  return (
    <div className="h-full min-h-0">
      <Activity mode={activeTab === "files" ? "visible" : "hidden"}>
        <SandboxIdeTab active previewReloadToken={0} threadId={null} />
      </Activity>
      <Activity mode={activeTab === "app" ? "visible" : "hidden"}>
        <HomeBrowserEmpty />
      </Activity>
    </div>
  );
}

function homeComputerClass(isOpen: boolean): string {
  return cn(
    "cc-agent-computer-pane relative hidden min-h-0 min-w-0 overflow-hidden bg-background transition-[opacity,transform,filter] duration-200 ease-[cubic-bezier(0.4,0,0.2,1)] motion-reduce:transform-none motion-reduce:transition-none md:flex",
    isOpen
      ? "translate-x-0 opacity-100 blur-0"
      : "pointer-events-none translate-x-3 opacity-0 blur-[1px]",
  );
}

function OpenComputerPill({ computerOpen, onOpen }: { computerOpen: boolean; onOpen: () => void }) {
  return (
    <CheatcodeTooltip
      className={cn(
        "max-md:hidden! fixed top-3.5 right-3.5 z-40 transition-[opacity,transform] duration-200 ease-[cubic-bezier(0.4,0,0.2,1)] motion-reduce:transition-none md:flex",
        computerOpen
          ? "pointer-events-none translate-y-0 scale-[0.98] opacity-0"
          : "translate-y-0 scale-100 opacity-100",
      )}
      label="Open computer"
      side="bottom"
    >
      <ComputerToggleButton
        active={false}
        aria-hidden={computerOpen}
        aria-label="Open computer"
        onClick={onOpen}
        tabIndex={computerOpen ? -1 : undefined}
      />
    </CheatcodeTooltip>
  );
}

function HomeBrowserEmpty() {
  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-background">
      <PreviewUrlBar previewUrl={null} />
      <div className="flex min-h-0 flex-1 items-center justify-center rounded-[20.5px] bg-background font-medium text-[14px] text-fg-secondary">
        All running apps and browser use activity will appear here.
      </div>
    </div>
  );
}
