"use client";

import type { CheatcodeUIMessage } from "@cheatcode/types";
import { ArrowDown } from "@cheatcode/ui";
import type { ReactVirtualizer } from "@tanstack/react-virtual";
import { MessageParts } from "@/components/chat/message-parts";
import type { MessageTurn } from "@/components/chat/message-turns";
import { WorkingIndicator } from "@/components/chat/status-pill";
import type {
  MessageScrollController,
  MessageScrollState,
  OlderMessagesLoadResult,
} from "@/components/chat/use-message-list-scroll";
import { useElapsedSeconds } from "@/lib/hooks/use-elapsed-seconds";
import { cn } from "@/lib/ui/cn";

export function MessageListView({
  completedSkillProposalIds,
  computerOpen,
  hasOlderMessages,
  isLoadingOlderMessages,
  isStreaming,
  listTopPadding,
  loadOlderMessages,
  onContinue,
  onMessageAppend,
  scroll,
  scrollState,
  totalHeight,
  turns,
  threadId,
  virtualizer,
}: MessageListViewProps) {
  return (
    <div className="relative min-h-0 flex-1">
      <MessageViewport
        completedSkillProposalIds={completedSkillProposalIds}
        hasOlderMessages={hasOlderMessages}
        isLoadingOlderMessages={isLoadingOlderMessages}
        isStreaming={isStreaming}
        listTopPadding={listTopPadding}
        loadOlderMessages={loadOlderMessages}
        onContinue={onContinue}
        onMessageAppend={onMessageAppend}
        scroll={scroll}
        scrollState={scrollState}
        totalHeight={totalHeight}
        turns={turns}
        threadId={threadId}
        virtualizer={virtualizer}
      />
      {scrollState.isScrollToBottomVisible ? (
        <ScrollToBottomButton computerOpen={computerOpen} onClick={scroll.scrollToBottom} />
      ) : null}
    </div>
  );
}

interface MessageListViewProps {
  completedSkillProposalIds: ReadonlySet<string>;
  computerOpen: boolean;
  hasOlderMessages: boolean;
  isLoadingOlderMessages: boolean;
  isStreaming: boolean;
  listTopPadding: number;
  loadOlderMessages: () => Promise<OlderMessagesLoadResult>;
  onContinue: () => void;
  onMessageAppend: (message: CheatcodeUIMessage) => void;
  scroll: MessageScrollController;
  scrollState: MessageScrollState;
  totalHeight: number;
  turns: readonly MessageTurn[];
  threadId: string;
  virtualizer: ReactVirtualizer<HTMLDivElement, Element>;
}

function MessageViewport(props: Omit<MessageListViewProps, "computerOpen">) {
  return (
    <div
      className="chat-scrollbar h-full overflow-y-auto overscroll-contain px-4 [container-type:size]"
      onScroll={props.scroll.handleScroll}
      ref={props.scrollState.parentRef}
      role="log"
    >
      <VirtualMessageContent {...props} />
    </div>
  );
}

function VirtualMessageContent({
  completedSkillProposalIds,
  hasOlderMessages,
  isLoadingOlderMessages,
  isStreaming,
  listTopPadding,
  loadOlderMessages,
  onContinue,
  onMessageAppend,
  scrollState,
  totalHeight,
  turns,
  threadId,
  virtualizer,
}: Omit<MessageListViewProps, "computerOpen" | "scroll">) {
  return (
    <div
      className="relative mx-auto w-full max-w-[708px]"
      ref={scrollState.contentRef}
      style={{ height: totalHeight }}
    >
      {hasOlderMessages ? (
        <OlderMessagesButton isLoading={isLoadingOlderMessages} onLoad={loadOlderMessages} />
      ) : null}
      {virtualizer.getVirtualItems().map((virtualItem) => {
        const turn = turns[virtualItem.index];
        if (!turn) {
          return null;
        }
        const isLastTurn = virtualItem.index === turns.length - 1;
        return (
          <div
            className="absolute top-0 left-0 w-full pb-4"
            data-index={virtualItem.index}
            key={virtualItem.key}
            ref={virtualizer.measureElement}
            style={{ transform: `translateY(${virtualItem.start + listTopPadding}px)` }}
          >
            <MessageTurnContent
              completedSkillProposalIds={completedSkillProposalIds}
              isLastTurn={isLastTurn}
              isStreaming={isStreaming}
              onContinue={onContinue}
              onMessageAppend={onMessageAppend}
              threadId={threadId}
              turn={turn}
            />
          </div>
        );
      })}
    </div>
  );
}

function MessageTurnContent({
  completedSkillProposalIds,
  isLastTurn,
  isStreaming,
  onContinue,
  onMessageAppend,
  threadId,
  turn,
}: {
  completedSkillProposalIds: ReadonlySet<string>;
  isLastTurn: boolean;
  isStreaming: boolean;
  onContinue: () => void;
  onMessageAppend: (message: CheatcodeUIMessage) => void;
  threadId: string;
  turn: MessageTurn;
}) {
  return (
    <div
      className={cn(
        "flex flex-col gap-3 transition-opacity duration-200 motion-reduce:transition-none",
        isLastTurn ? "pb-[240px] md:pb-[210px]" : "pb-1",
      )}
    >
      {turn.messages.map((message, index) => {
        const isLastMessage = index === turn.messages.length - 1;
        return (
          <MessageBubble
            completedSkillProposalIds={completedSkillProposalIds}
            key={message.id}
            message={message}
            onContinue={!isStreaming && isLastTurn && isLastMessage ? onContinue : undefined}
            onMessageAppend={onMessageAppend}
            streaming={isStreaming && isLastTurn && isLastMessage}
            threadId={threadId}
          />
        );
      })}
    </div>
  );
}

function OlderMessagesButton({
  isLoading,
  onLoad,
}: {
  isLoading: boolean;
  onLoad: () => Promise<OlderMessagesLoadResult>;
}) {
  return (
    <div className="absolute top-3 right-0 left-0 flex justify-center">
      <button
        className="h-8 rounded-full bg-secondary px-4 font-medium text-fg-secondary text-sm transition-colors hover:bg-bg-elevated hover:text-foreground disabled:opacity-50"
        disabled={isLoading}
        onClick={() => void onLoad()}
        type="button"
      >
        {isLoading ? "Loading..." : "Load older messages"}
      </button>
    </div>
  );
}

function ScrollToBottomButton({
  computerOpen,
  onClick,
}: {
  computerOpen: boolean;
  onClick: () => void;
}) {
  return (
    <button
      aria-label="Scroll to bottom"
      className={cn(
        "absolute left-1/2 z-20 flex size-6 -translate-x-1/2 items-center justify-center rounded-full border border-border bg-background text-fg-secondary shadow-[0_1px_3px_rgba(0,0,0,0.1),0_1px_2px_-1px_rgba(0,0,0,0.1)] transition-colors duration-200 hover:bg-secondary hover:text-foreground",
        computerOpen ? "bottom-[202px]" : "bottom-[234px]",
      )}
      onClick={onClick}
      type="button"
    >
      <ArrowDown aria-hidden="true" className="size-3.5 stroke-[2.25]" />
    </button>
  );
}

function MessageBubble({
  completedSkillProposalIds,
  message,
  onContinue,
  onMessageAppend,
  streaming,
  threadId,
}: {
  completedSkillProposalIds: ReadonlySet<string>;
  message: CheatcodeUIMessage;
  onContinue?: (() => void) | undefined;
  onMessageAppend: (message: CheatcodeUIMessage) => void;
  streaming: boolean;
  threadId: string;
}) {
  const isUser = message.role === "user";
  const elapsed = useElapsedSeconds(streaming);
  return (
    <article className="cc-fade-in group relative w-full max-w-full px-2">
      <div
        className={cn(
          isUser &&
            "min-h-8 rounded-[16px] bg-[var(--thread-user-message-bg)] px-3.5 py-1 text-foreground transition-colors duration-150 hover:bg-[var(--thread-surface-hover)]",
          !isUser && "py-1",
        )}
      >
        {isUser ? null : <AssistantHeader elapsedSeconds={elapsed} streaming={streaming} />}
        <MessageParts
          completedSkillProposalIds={completedSkillProposalIds}
          message={message}
          onContinue={onContinue}
          onMessageAppend={onMessageAppend}
          streaming={streaming}
          threadId={threadId}
        />
      </div>
    </article>
  );
}

// Completed assistant messages intentionally have no static header; only live work is labelled.
function AssistantHeader({
  elapsedSeconds,
  streaming,
}: {
  elapsedSeconds: number;
  streaming: boolean;
}) {
  if (!streaming) {
    return null;
  }
  return (
    <WorkingIndicator
      className="mb-3 flex items-center gap-2 text-[13px] text-placeholder"
      elapsedSeconds={elapsedSeconds}
    />
  );
}
