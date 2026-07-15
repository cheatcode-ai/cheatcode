"use client";

import { ChatContextRow } from "@/components/chat/chat-context-row";
import { MessageList } from "@/components/chat/message-list";
import { PromptComposer } from "@/components/chat/prompt-composer";
import { StreamReconnectBanner } from "@/components/chat/stream-reconnect-banner";
import {
  type ChatPanelProps,
  useChatPanelController,
} from "@/components/chat/use-chat-panel-controller";

export function ChatPanel(props: ChatPanelProps) {
  const controller = useChatPanelController(props);
  return (
    <div className="relative flex min-h-0 flex-1 flex-col bg-background">
      <ChatContextRow project={props.project} threadId={props.threadId} title={props.threadTitle} />
      <StreamReconnectBanner />
      <MessageList
        hasOlderMessages={props.hasOlderMessages}
        isLoadingOlderMessages={props.isLoadingOlderMessages}
        isStreaming={controller.state.isMessageListStreaming}
        messages={controller.state.messages}
        onContinue={controller.actions.continueRun}
        onLoadOlderMessages={controller.actions.loadOlderMessages}
      />
      <PromptComposer
        onChange={controller.actions.setDraft}
        onStop={controller.actions.stopRun}
        onSubmit={controller.actions.submitText}
        project={props.project}
        status={controller.state.composerStatus}
        threadId={props.threadId}
        value={controller.state.draft}
      />
    </div>
  );
}
