"use client";

import type { ProjectSummary } from "@cheatcode/types";
import { Clock3, Loader2, Plus, X } from "@cheatcode/ui";
import type { ChatContextController } from "@/components/chat/chat-context-controller";
import { FolderChatsSearch } from "@/components/chat/folder-chats-search";
import { CheatcodeTooltip } from "@/components/ui/cheatcode-tooltip";
import type { ChatWorkspaceTab } from "@/lib/store/chat-tabs-store";
import { cn } from "@/lib/ui/cn";

export function ChatContextView({
  controller,
  isRunning,
  project,
  threadId,
}: {
  controller: ChatContextController;
  isRunning: boolean;
  project: ProjectSummary | null;
  threadId: string;
}) {
  return (
    <div className="relative z-30 h-20 shrink-0 md:h-12" ref={controller.meta.contextRef}>
      <MobileChatTitle
        activeThreadId={threadId}
        isRunning={isRunning}
        tabs={controller.state.tabs}
      />
      <header className="mx-auto flex h-10 w-full max-w-[720px] items-center px-3 text-foreground md:h-12 md:px-1">
        <ChatTabStrip activeThreadId={threadId} controller={controller} isRunning={isRunning} />
        <ChatHeaderActions controller={controller} project={project} />
      </header>
      {controller.state.folderChatsOpen && project ? (
        <FolderChatsSearch
          activeThreadId={threadId}
          onSelect={controller.actions.selectFolderChat}
          project={project}
        />
      ) : null}
    </div>
  );
}

function MobileChatTitle({
  activeThreadId,
  isRunning,
  tabs,
}: {
  activeThreadId: string;
  isRunning: boolean;
  tabs: readonly ChatWorkspaceTab[];
}) {
  const activeTitle = tabs.find((tab) => tab.id === activeThreadId)?.title ?? "New chat";
  return (
    <div className="flex h-10 items-center justify-center px-16 md:hidden">
      <p className="flex max-w-full items-center gap-1 truncate font-medium text-fg-secondary text-sm">
        <span className="truncate">{activeTitle}</span>
        {isRunning ? <ChatTabSpinner /> : null}
      </p>
    </div>
  );
}

function ChatHeaderActions({
  controller,
  project,
}: {
  controller: ChatContextController;
  project: ProjectSummary | null;
}) {
  const newChatLabel = project ? `New chat in ${project.name}` : "New chat";
  return (
    <div className="flex shrink-0 items-center gap-0.5 pr-1">
      <CheatcodeTooltip label={newChatLabel} side="bottom">
        <button
          aria-label={newChatLabel}
          className="flex size-7 items-center justify-center rounded-full text-foreground transition-colors hover:bg-secondary disabled:cursor-default disabled:opacity-50"
          disabled={!project || controller.state.isCreatingChat}
          onClick={controller.actions.startNewChat}
          type="button"
        >
          <Plus aria-hidden="true" className="size-3.5" />
        </button>
      </CheatcodeTooltip>
      <FolderChatsButton controller={controller} disabled={!project} />
    </div>
  );
}

function FolderChatsButton({
  controller,
  disabled,
}: {
  controller: ChatContextController;
  disabled: boolean;
}) {
  return (
    <CheatcodeTooltip label="Folder chats" side="bottom">
      <button
        aria-label="Folder chats"
        aria-expanded={controller.state.folderChatsOpen}
        className={cn(
          "flex size-7 items-center justify-center rounded-full text-foreground transition-colors hover:bg-secondary disabled:cursor-default disabled:opacity-50",
          controller.state.folderChatsOpen ? "bg-secondary" : null,
        )}
        disabled={disabled}
        onClick={controller.actions.toggleFolderChats}
        type="button"
      >
        <Clock3 aria-hidden="true" className="size-3.5" />
      </button>
    </CheatcodeTooltip>
  );
}

function ChatTabStrip({
  activeThreadId,
  controller,
  isRunning,
}: {
  activeThreadId: string;
  controller: ChatContextController;
  isRunning: boolean;
}) {
  return (
    <div className="min-w-0 flex-1">
      <div className="flex min-w-0 items-center gap-0.5 overflow-x-auto overscroll-x-none pr-2 pl-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {controller.state.tabs.map((tab) => (
          <ChatTabPill
            isActive={tab.id === activeThreadId}
            isRunning={isRunning && tab.id === activeThreadId}
            key={tab.id}
            onClose={controller.actions.closeActiveTab}
            onSelect={() => controller.actions.selectTab(tab)}
            showClose={controller.state.tabs.length > 1}
            tab={tab}
          />
        ))}
      </div>
    </div>
  );
}

function ChatTabPill({
  isActive,
  isRunning,
  onClose,
  onSelect,
  showClose,
  tab,
}: {
  isActive: boolean;
  isRunning: boolean;
  onClose: () => void;
  onSelect: () => void;
  showClose: boolean;
  tab: ChatWorkspaceTab;
}) {
  return (
    <div className={chatTabPillClassName(isActive, isRunning || (isActive && showClose))}>
      <button
        className="min-w-0 flex-1 truncate text-left"
        onClick={onSelect}
        title={tab.title}
        type="button"
      >
        {tab.title}
      </button>
      {isRunning ? (
        <ChatTabSpinner />
      ) : isActive && showClose ? (
        <button
          aria-label={`Close ${tab.title}`}
          className="flex size-6 shrink-0 items-center justify-center rounded-full text-placeholder transition-colors hover:bg-secondary hover:text-foreground"
          onClick={onClose}
          type="button"
        >
          <X aria-hidden="true" className="size-3" />
        </button>
      ) : null}
    </div>
  );
}

function ChatTabSpinner() {
  return (
    <span
      aria-label="Working"
      className="flex size-4 shrink-0 items-center justify-center"
      role="status"
    >
      <Loader2
        aria-hidden="true"
        className="size-3.5 animate-spin text-placeholder motion-reduce:animate-none"
      />
    </span>
  );
}

function chatTabPillClassName(isActive: boolean, hasTrailingControl: boolean): string {
  return cn(
    "flex h-8 max-w-[190px] shrink-0 cursor-pointer select-none items-center gap-1 rounded-full border bg-background py-[5px] pl-3 font-medium text-sm",
    isActive
      ? cn("border-border text-foreground/80", hasTrailingControl ? "pr-1.5" : "pr-3")
      : "border-transparent pr-3 text-foreground/40 hover:text-foreground/60",
  );
}
