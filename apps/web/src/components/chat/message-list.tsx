"use client";

import type { CheatcodeUIMessage } from "@cheatcode/types";
import { useVirtualizer } from "@tanstack/react-virtual";
import { MessageListView } from "@/components/chat/message-list-view";
import { groupMessagesIntoTurns } from "@/components/chat/message-turns";
import {
  type OlderMessagesLoadResult,
  useMessageScrollController,
  useMessageScrollState,
  useOlderMessagesAnchor,
} from "@/components/chat/use-message-list-scroll";
import { useAppStore } from "@/lib/store/app-store";

const LIST_TOP_PADDING = 24;
const LIST_BOTTOM_PADDING = 0;
const ESTIMATED_TURN_HEIGHT = 640;

interface MessageListProps {
  hasOlderMessages: boolean;
  isLoadingOlderMessages: boolean;
  isStreaming: boolean;
  isWaitingForFirstResponse: boolean;
  messages: readonly CheatcodeUIMessage[];
  onContinue: () => void;
  onLoadOlderMessages: () => Promise<OlderMessagesLoadResult>;
  provisionalText: string;
  runStartedAt: null | number;
  threadId: string;
}

export function MessageList({
  hasOlderMessages,
  isLoadingOlderMessages,
  isStreaming,
  isWaitingForFirstResponse,
  messages,
  onContinue,
  onLoadOlderMessages,
  provisionalText,
  runStartedAt,
  threadId,
}: MessageListProps) {
  const scrollState = useMessageScrollState();
  const displayMessages = withLiveAssistant(
    messages,
    isWaitingForFirstResponse,
    provisionalText,
    threadId,
  );
  const turns = groupMessagesIntoTurns(displayMessages);
  const virtualizer = useVirtualizer({
    count: turns.length,
    estimateSize: () => scrollState.parentRef.current?.clientHeight ?? ESTIMATED_TURN_HEIGHT,
    getItemKey: (index) => turns[index]?.id ?? index,
    getScrollElement: () => scrollState.parentRef.current,
    overscan: 6,
  });
  const latestMessageId = displayMessages.at(-1)?.id ?? "";
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
      onContinue={onContinue}
      runStartedAt={runStartedAt}
      scroll={scroll}
      scrollState={scrollState}
      totalHeight={virtualizer.getTotalSize() + listTopPadding + LIST_BOTTOM_PADDING}
      turns={turns}
      threadId={threadId}
      virtualizer={virtualizer}
    />
  );
}

function withLiveAssistant(
  messages: readonly CheatcodeUIMessage[],
  isWaitingForFirstResponse: boolean,
  provisionalText: string,
  threadId: string,
): readonly CheatcodeUIMessage[] {
  if (provisionalText.length > 0) {
    return withProvisionalText(messages, provisionalText, threadId);
  }
  if (!isWaitingForFirstResponse) {
    return messages;
  }
  return [
    ...messages,
    {
      id: `pending-assistant-${threadId}`,
      parts: [],
      role: "assistant",
    },
  ];
}

function withProvisionalText(
  messages: readonly CheatcodeUIMessage[],
  text: string,
  threadId: string,
): readonly CheatcodeUIMessage[] {
  const last = messages.at(-1);
  const part = { state: "streaming" as const, text, type: "text" as const };
  if (last?.role === "assistant") {
    return [...messages.slice(0, -1), { ...last, parts: [...last.parts, part] }];
  }
  return [
    ...messages,
    { id: `provisional-assistant-${threadId}`, parts: [part], role: "assistant" },
  ];
}
