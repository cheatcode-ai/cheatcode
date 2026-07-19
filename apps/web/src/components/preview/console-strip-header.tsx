"use client";

import { ChevronDown, Plus, X } from "@cheatcode/ui";
import { CheatcodeTooltip } from "@/components/ui/cheatcode-tooltip";
import type { ConsoleTab } from "@/lib/preview/console-terminal.types";
import { consoleTabLabel } from "@/lib/preview/console-terminal-state";
import { cn } from "@/lib/ui/cn";

interface ConsoleStripHeaderProps {
  activeConsoleId: string | undefined;
  isOpen: boolean;
  onAddTab: () => void;
  onCloseTab: (tabId: string) => void;
  onSelectTab: (tabId: string) => void;
  onToggle: () => void;
  tabs: ConsoleTab[];
}

export function ConsoleStripHeader({
  activeConsoleId,
  isOpen,
  onAddTab,
  onCloseTab,
  onSelectTab,
  onToggle,
  tabs,
}: ConsoleStripHeaderProps) {
  return (
    <div className="flex h-[34px] shrink-0 items-center gap-0.5 bg-background px-2 py-[5px]">
      <ConsoleToggle isOpen={isOpen} onToggle={onToggle} />
      <ConsoleTabs
        activeConsoleId={activeConsoleId}
        onCloseTab={onCloseTab}
        onSelectTab={onSelectTab}
        tabs={tabs}
      />
      <CheatcodeTooltip label="New terminal" side="top">
        <button
          aria-label="New terminal"
          className="flex size-6 shrink-0 items-center justify-center rounded-full p-1 text-fg-secondary transition-colors hover:bg-secondary hover:text-foreground"
          onClick={onAddTab}
          type="button"
        >
          <Plus aria-hidden="true" className="h-3.5 w-3.5" />
        </button>
      </CheatcodeTooltip>
    </div>
  );
}

function ConsoleToggle({ isOpen, onToggle }: { isOpen: boolean; onToggle: () => void }) {
  return (
    <button
      aria-expanded={isOpen}
      aria-label={isOpen ? "Collapse console" : "Expand console"}
      className="flex size-6 shrink-0 items-center justify-center rounded-full p-1 text-fg-secondary transition-colors hover:bg-secondary hover:text-foreground"
      onClick={onToggle}
      type="button"
    >
      <ChevronDown
        aria-hidden="true"
        className={cn("h-3.5 w-3.5 transition-transform", isOpen ? "" : "rotate-180")}
      />
    </button>
  );
}

function ConsoleTabs({
  activeConsoleId,
  onCloseTab,
  onSelectTab,
  tabs,
}: Pick<ConsoleStripHeaderProps, "activeConsoleId" | "onCloseTab" | "onSelectTab" | "tabs">) {
  return (
    <div
      aria-label="Console tabs"
      className="chat-scrollbar flex min-w-0 max-w-[calc(100%-4rem)] shrink items-center gap-1 overflow-x-auto"
      role="tablist"
    >
      {tabs.map((tab) => (
        <ConsoleTabItem
          isActive={tab.id === activeConsoleId}
          key={tab.id}
          onClose={() => onCloseTab(tab.id)}
          onSelect={() => onSelectTab(tab.id)}
          tab={tab}
          tabCount={tabs.length}
        />
      ))}
    </div>
  );
}

interface ConsoleTabItemProps {
  isActive: boolean;
  onClose: () => void;
  onSelect: () => void;
  tab: ConsoleTab;
  tabCount: number;
}

function ConsoleTabItem({ isActive, onClose, onSelect, tab, tabCount }: ConsoleTabItemProps) {
  const label = consoleTabLabel(tab, tabCount);
  return (
    <div
      className={cn(
        "group flex h-6 shrink-0 items-center rounded-full transition-colors",
        isActive ? "text-foreground" : "text-fg-secondary hover:bg-secondary hover:text-foreground",
      )}
    >
      <button
        aria-selected={isActive}
        className="flex h-6 items-center whitespace-nowrap rounded-full px-1 font-medium text-[14px]"
        onClick={onSelect}
        role="tab"
        type="button"
      >
        {label}
      </button>
      {tabCount > 1 ? <CloseConsoleTabButton label={label} onClose={onClose} /> : null}
    </div>
  );
}

function CloseConsoleTabButton({ label, onClose }: { label: string; onClose: () => void }) {
  return (
    <CheatcodeTooltip label={`Close ${label}`} side="top">
      <button
        aria-label={`Close ${label}`}
        className="mr-0.5 flex size-6 items-center justify-center rounded-full text-placeholder opacity-80 transition-colors hover:bg-bg-secondary hover:text-foreground group-hover:opacity-100"
        onClick={(event) => {
          event.stopPropagation();
          onClose();
        }}
        type="button"
      >
        <X aria-hidden="true" className="h-3 w-3" />
      </button>
    </CheatcodeTooltip>
  );
}
