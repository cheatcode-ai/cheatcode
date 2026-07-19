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
  messages: readonly CheatcodeUIMessage[];
  onContinue: () => void;
  onLoadOlderMessages: () => Promise<OlderMessagesLoadResult>;
  onMessageAppend: (message: CheatcodeUIMessage) => void;
  threadId: string;
}

export function MessageList({
  hasOlderMessages,
  isLoadingOlderMessages,
  isStreaming,
  messages,
  onContinue,
  onLoadOlderMessages,
  onMessageAppend,
  threadId,
}: MessageListProps) {
  const scrollState = useMessageScrollState();
  const turns = groupMessagesIntoTurns(messages);
  const completedSkillProposalIds = collectCompletedSkillProposalIds(messages);
  const virtualizer = useVirtualizer({
    count: turns.length,
    estimateSize: () => scrollState.parentRef.current?.clientHeight ?? ESTIMATED_TURN_HEIGHT,
    getItemKey: (index) => turns[index]?.id ?? index,
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
      completedSkillProposalIds={completedSkillProposalIds}
      computerOpen={computerOpen}
      hasOlderMessages={hasOlderMessages}
      isLoadingOlderMessages={isLoadingOlderMessages}
      isStreaming={isStreaming}
      listTopPadding={listTopPadding}
      loadOlderMessages={loadOlderMessages}
      onContinue={onContinue}
      onMessageAppend={onMessageAppend}
      scroll={scroll}
      scrollState={scrollState}
      totalHeight={virtualizer.getTotalSize() + listTopPadding + LIST_BOTTOM_PADDING}
      turns={turns}
      threadId={threadId}
      virtualizer={virtualizer}
    />
  );
}

function collectCompletedSkillProposalIds(
  messages: readonly CheatcodeUIMessage[],
): ReadonlySet<string> {
  const proposalIds = new Set<string>();
  for (const message of messages) {
    for (const part of message.parts) {
      if (part.type === "data-skill-created" && part.data.proposalId) {
        proposalIds.add(part.data.proposalId);
      }
    }
  }
  return proposalIds;
}
