"use client";

import type { CheatcodeUIMessage } from "@cheatcode/types";
import type { ReactVirtualizer } from "@tanstack/react-virtual";
import { MessageParts } from "@/components/chat/message-parts";
import { WorkingIndicator } from "@/components/chat/status-pill";
import type {
  MessageScrollController,
  MessageScrollState,
  OlderMessagesLoadResult,
} from "@/components/chat/use-message-list-scroll";
import { ArrowDown } from "@/components/ui/icons";
import { useElapsedSeconds } from "@/lib/hooks/use-elapsed-seconds";
import { cn } from "@/lib/ui/cn";

export function MessageListView({
  computerOpen,
  hasOlderMessages,
  isLoadingOlderMessages,
  isStreaming,
  listTopPadding,
  loadOlderMessages,
  messages,
  onContinue,
  scroll,
  scrollState,
  totalHeight,
  virtualizer,
}: MessageListViewProps) {
  return (
    <div className="relative min-h-0 flex-1">
      <MessageViewport
        hasOlderMessages={hasOlderMessages}
        isLoadingOlderMessages={isLoadingOlderMessages}
        isStreaming={isStreaming}
        listTopPadding={listTopPadding}
        loadOlderMessages={loadOlderMessages}
        messages={messages}
        onContinue={onContinue}
        scroll={scroll}
        scrollState={scrollState}
        totalHeight={totalHeight}
        virtualizer={virtualizer}
      />
      {scrollState.isScrollToBottomVisible ? (
        <ScrollToBottomButton computerOpen={computerOpen} onClick={scroll.scrollToBottom} />
      ) : null}
    </div>
  );
}

interface MessageListViewProps {
  computerOpen: boolean;
  hasOlderMessages: boolean;
  isLoadingOlderMessages: boolean;
  isStreaming: boolean;
  listTopPadding: number;
  loadOlderMessages: () => Promise<OlderMessagesLoadResult>;
  messages: readonly CheatcodeUIMessage[];
  onContinue: () => void;
  scroll: MessageScrollController;
  scrollState: MessageScrollState;
  totalHeight: number;
  virtualizer: ReactVirtualizer<HTMLDivElement, Element>;
}

function MessageViewport(props: Omit<MessageListViewProps, "computerOpen">) {
  return (
    <div
      className="chat-scrollbar h-full overflow-y-auto px-4"
      onScroll={props.scroll.handleScroll}
      ref={props.scrollState.parentRef}
      role="log"
    >
      <VirtualMessageContent {...props} />
    </div>
  );
}

function VirtualMessageContent({
  hasOlderMessages,
  isLoadingOlderMessages,
  isStreaming,
  listTopPadding,
  loadOlderMessages,
  messages,
  onContinue,
  scrollState,
  totalHeight,
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
        const message = messages[virtualItem.index];
        if (!message) {
          return null;
        }
        const isLastMessage = virtualItem.index === messages.length - 1;
        return (
          <div
            className="absolute top-0 left-0 w-full pb-4"
            data-index={virtualItem.index}
            key={virtualItem.key}
            ref={virtualizer.measureElement}
            style={{ transform: `translateY(${virtualItem.start + listTopPadding}px)` }}
          >
            <MessageBubble
              message={message}
              onContinue={!isStreaming && isLastMessage ? onContinue : undefined}
              streaming={isStreaming && isLastMessage}
            />
          </div>
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
  message,
  onContinue,
  streaming,
}: {
  message: CheatcodeUIMessage;
  onContinue?: (() => void) | undefined;
  streaming: boolean;
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
        <MessageParts message={message} onContinue={onContinue} streaming={streaming} />
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
