"use client";

import {
  Download,
  Inbox,
  Loader2,
  type LucideIcon,
  Monitor,
  MoreHorizontal,
  Play,
} from "@cheatcode/ui";
import { useAuth } from "@clerk/nextjs";
import { type CSSProperties, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { CheatcodeTooltip } from "@/components/ui/cheatcode-tooltip";
import { downloadProjectArchive } from "@/lib/api/project-thread";
import type { PreviewTab } from "@/lib/store/app-store";
import { cn } from "@/lib/ui/cn";
import { ComputerToggleButton } from "./computer-toggle-button";
import type { BrowserTakeoverController } from "./use-browser-takeover";

const TABS: ReadonlyArray<{ label: string; value: PreviewTab }> = [
  { label: "Files", value: "files" },
  { label: "Browser", value: "app" },
];

interface ComputerPanelTabsProps {
  activePreviewTab: PreviewTab;
  browserTakeover?: BrowserTakeoverController;
  deliverableCount: number;
  projectId: string | null;
  projectName: string | null;
  setActivePreviewTab: (tab: PreviewTab) => void;
  setPreviewPanelOpen: (open: boolean) => void;
}

export function ComputerPanelTabs({
  activePreviewTab,
  browserTakeover,
  deliverableCount,
  projectId,
  projectName,
  setActivePreviewTab,
  setPreviewPanelOpen,
}: ComputerPanelTabsProps) {
  return (
    <div className="relative z-20 hidden h-12 w-full shrink-0 items-center overflow-visible md:flex">
      <ComputerTabSelector activeTab={activePreviewTab} onSelect={setActivePreviewTab} />
      <ComputerPanelActions
        {...(browserTakeover ? { browserTakeover } : {})}
        deliverableCount={deliverableCount}
        onClose={() => setPreviewPanelOpen(false)}
        projectId={projectId}
        projectName={projectName}
      />
    </div>
  );
}

function ComputerTabSelector({
  activeTab,
  onSelect,
}: {
  activeTab: PreviewTab;
  onSelect: (tab: PreviewTab) => void;
}) {
  return (
    <div
      className="relative z-0 inline-flex items-center gap-0.5 rounded-full bg-secondary/60 p-[3px] dark:border dark:border-border dark:bg-background"
      style={computerTabStyle(activeTab)}
    >
      {TABS.map((tab) => (
        <CheatcodeTooltip key={tab.value} label={tab.label} side="bottom">
          <button
            aria-selected={activeTab === tab.value}
            className={cn(
              "flex h-7 items-center justify-center whitespace-nowrap rounded-full px-3 font-medium text-[14px] transition-colors duration-150",
              activeTab === tab.value
                ? "text-foreground"
                : "text-fg-secondary hover:text-foreground",
            )}
            onClick={() => onSelect(tab.value)}
            role="tab"
            type="button"
          >
            {tab.label}
          </button>
        </CheatcodeTooltip>
      ))}
      <span
        aria-hidden="true"
        className="absolute top-1/2 left-0 z-[-1] h-[calc(100%-6px)] w-[var(--active-tab-width)] translate-x-[var(--active-tab-left)] -translate-y-1/2 rounded-full bg-background shadow-[0_1px_3px_rgba(0,0,0,0.1),0_1px_2px_-1px_rgba(0,0,0,0.1)] transition-all duration-200 ease-[cubic-bezier(0.4,0,0.2,1)] motion-reduce:transition-none dark:bg-secondary"
      />
    </div>
  );
}

function ComputerPanelActions({
  browserTakeover,
  deliverableCount,
  onClose,
  projectId,
  projectName,
}: {
  browserTakeover?: BrowserTakeoverController;
  deliverableCount: number;
  onClose: () => void;
  projectId: string | null;
  projectName: string | null;
}) {
  return (
    <div className="absolute top-[9px] right-1 flex shrink-0 items-center gap-1.5">
      <BrowserTakeoverButton controller={browserTakeover} />
      <ComputerMoreActions projectId={projectId} projectName={projectName} />
      <CheatcodeTooltip label="Close computer" side="bottom">
        <ComputerToggleButton active aria-label="Close computer" onClick={onClose} />
      </CheatcodeTooltip>
      <DeliverablesButton count={deliverableCount} />
    </div>
  );
}

function BrowserTakeoverButton({
  controller,
}: {
  controller: BrowserTakeoverController | undefined;
}) {
  if (!controller) return null;
  if (!controller.canTakeOver && !controller.session) return null;
  const isActive = controller.session !== null;
  const Icon = controller.isPending ? Loader2 : isActive ? Play : Monitor;
  const label = isActive ? "Resume Cheatcode" : "Take over browser";
  return (
    <CheatcodeTooltip label={label} side="bottom">
      <button
        aria-label={label}
        className="flex h-7 items-center gap-1.5 rounded-full bg-secondary px-2.5 font-medium text-[12px] text-foreground transition-colors hover:bg-border disabled:opacity-50"
        disabled={controller.isPending}
        onClick={() => void (isActive ? controller.resume() : controller.start())}
        type="button"
      >
        <Icon
          aria-hidden="true"
          className={cn("h-3.5 w-3.5", controller.isPending && "animate-spin")}
        />
        <span>{isActive ? "Resume" : "Take over"}</span>
      </button>
    </CheatcodeTooltip>
  );
}

function ComputerMoreActions({
  projectId,
  projectName,
}: {
  projectId: string | null;
  projectName: string | null;
}) {
  const menuRef = useRef<HTMLSpanElement | null>(null);
  const [isOpen, setOpen] = useState(false);
  const download = useComputerDownload(projectId, projectName, () => setOpen(false));
  useCloseComputerMenu(menuRef, isOpen, setOpen);
  return (
    <span className="relative" ref={menuRef}>
      <CheatcodeTooltip disabled={isOpen} label="More actions" side="bottom">
        <button
          aria-expanded={isOpen}
          aria-label="More actions"
          className="flex h-7 w-7 items-center justify-center rounded-full p-[7px] text-fg-secondary transition-colors hover:bg-secondary hover:text-foreground"
          onClick={() => setOpen((open) => !open)}
          type="button"
        >
          <MoreHorizontal aria-hidden="true" className="h-3.5 w-3.5" />
        </button>
      </CheatcodeTooltip>
      {isOpen ? (
        <ComputerActionsMenu
          isDownloading={download.isDownloading}
          onDownload={() => void download.start()}
          projectAvailable={projectId !== null}
          projectName={projectName}
        />
      ) : null}
    </span>
  );
}

function useComputerDownload(
  projectId: string | null,
  projectName: string | null,
  closeMenu: () => void,
) {
  const { getToken } = useAuth();
  const [isDownloading, setIsDownloading] = useState(false);
  const start = async (): Promise<void> => {
    if (!projectId || isDownloading) return;
    setIsDownloading(true);
    try {
      const downloaded = await downloadProjectArchive(
        getToken,
        projectId,
        projectName ?? "cheatcode-project",
      );
      if (!downloaded) return;
      closeMenu();
      toast.success(`${projectName ?? "Project"} downloaded`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Project download failed");
    } finally {
      setIsDownloading(false);
    }
  };
  return { isDownloading, start };
}

function DeliverablesButton({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <CheatcodeTooltip label="View deliverables" side="bottom">
      <button
        aria-expanded={false}
        aria-label="View deliverables"
        className="flex h-7 cursor-pointer items-center gap-1 rounded-full px-1.5 text-foreground outline-none transition-colors hover:bg-secondary"
        onClick={scrollToDeliverables}
        type="button"
      >
        <Inbox aria-hidden="true" className="h-4 w-4" />
        <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-foreground px-1 font-semibold text-[11px] text-background leading-none">
          {count}
        </span>
      </button>
    </CheatcodeTooltip>
  );
}

function useCloseComputerMenu(
  menuRef: React.RefObject<HTMLSpanElement | null>,
  isOpen: boolean,
  setOpen: (open: boolean) => void,
): void {
  useEffect(() => {
    if (!isOpen) return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [isOpen, menuRef, setOpen]);
}

function computerTabStyle(activeTab: PreviewTab): CSSProperties {
  return {
    "--active-tab-left": activeTab === "files" ? "3px" : "57.664px",
    "--active-tab-width": activeTab === "files" ? "52.664px" : "75.383px",
  } as CSSProperties;
}

function scrollToDeliverables(): void {
  const blocks = document.querySelectorAll("[data-chat-deliverables]");
  blocks.item(blocks.length - 1)?.scrollIntoView({
    behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
    block: "center",
  });
}

function ComputerActionsMenu({
  isDownloading,
  onDownload,
  projectAvailable,
  projectName,
}: {
  isDownloading: boolean;
  onDownload: () => void;
  projectAvailable: boolean;
  projectName: string | null;
}) {
  const projectLabel = projectName ?? "project";
  return (
    <span
      className="absolute top-[32px] right-0 z-50 flex w-[244px] flex-col overflow-hidden rounded-[10px] border border-border bg-background p-1.5 text-foreground shadow-[0_4px_6px_-1px_rgba(0,0,0,0.1),0_2px_4px_-2px_rgba(0,0,0,0.1)]"
      role="menu"
    >
      <ComputerMenuButton
        disabled={!projectAvailable || isDownloading}
        icon={isDownloading ? Loader2 : Download}
        label={isDownloading ? `Preparing ${projectLabel}` : `Download ${projectLabel}`}
        loading={isDownloading}
        onClick={onDownload}
      />
    </span>
  );
}

function ComputerMenuButton({
  disabled = true,
  icon: Icon,
  label,
  loading = false,
  onClick,
}: {
  disabled?: boolean;
  icon: LucideIcon;
  label: string;
  loading?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      aria-busy={loading || undefined}
      className={cn(
        "flex h-[31.5px] w-full items-center gap-2 rounded-[10px] px-2 py-1.5 text-left font-medium text-[12px] transition-colors",
        disabled
          ? "cursor-not-allowed text-placeholder"
          : "cursor-pointer text-foreground hover:bg-secondary",
      )}
      disabled={disabled}
      onClick={onClick}
      role="menuitem"
      type="button"
    >
      <Icon
        aria-hidden="true"
        className={cn("h-4 w-4 shrink-0 text-placeholder", loading && "animate-spin")}
      />
      <span className="min-w-0 flex-1 truncate">{label}</span>
    </button>
  );
}
