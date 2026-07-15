"use client";

import type { CheatcodeUIMessage } from "@cheatcode/types";
import { useVirtualizer } from "@tanstack/react-virtual";
import { MessageListView } from "@/components/chat/message-list-view";
import {
  type OlderMessagesLoadResult,
  useMessageScrollController,
  useMessageScrollState,
  useOlderMessagesAnchor,
} from "@/components/chat/use-message-list-scroll";
import { useAppStore } from "@/lib/store/app-store";

const LIST_TOP_PADDING = 24;
const LIST_BOTTOM_PADDING = 160;
const ESTIMATED_MESSAGE_HEIGHT = 180;

interface MessageListProps {
  hasOlderMessages: boolean;
  isLoadingOlderMessages: boolean;
  isStreaming: boolean;
  messages: readonly CheatcodeUIMessage[];
  onContinue: () => void;
  onLoadOlderMessages: () => Promise<OlderMessagesLoadResult>;
}

export function MessageList({
  hasOlderMessages,
  isLoadingOlderMessages,
  isStreaming,
  messages,
  onContinue,
  onLoadOlderMessages,
}: MessageListProps) {
  const scrollState = useMessageScrollState();
  const virtualizer = useVirtualizer({
    count: messages.length,
    estimateSize: () => ESTIMATED_MESSAGE_HEIGHT,
    getItemKey: (index) => messages[index]?.id ?? index,
    getScrollElement: () => scrollState.parentRef.current,
    overscan: 6,
  });
  const latestMessageId = messages.at(-1)?.id ?? "";
  const scroll = useMessageScrollController({ latestMessageId, scrollState });
  const loadOlderMessages = useOlderMessagesAnchor({
    isLoading: isLoadingOlderMessages,
    messages,
    onLoad: onLoadOlderMessages,
    scrollState,
    updateScrollState: scroll.updateScrollState,
  });
  const listTopPadding = hasOlderMessages ? 64 : LIST_TOP_PADDING;
  const computerOpen = useAppStore((state) => state.previewPanelOpen);
  if (messages.length === 0 && !hasOlderMessages) {
    return <div aria-hidden="true" className="min-h-0 flex-1" />;
  }
  return (
    <MessageListView
      computerOpen={computerOpen}
      hasOlderMessages={hasOlderMessages}
      isLoadingOlderMessages={isLoadingOlderMessages}
      isStreaming={isStreaming}
      listTopPadding={listTopPadding}
      loadOlderMessages={loadOlderMessages}
      messages={messages}
      onContinue={onContinue}
      scroll={scroll}
      scrollState={scrollState}
      totalHeight={virtualizer.getTotalSize() + listTopPadding + LIST_BOTTOM_PADDING}
      virtualizer={virtualizer}
    />
  );
}
