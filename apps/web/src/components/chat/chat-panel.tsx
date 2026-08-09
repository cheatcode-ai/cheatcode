"use client";

import { ChatContextRow } from "@/components/chat/chat-context-row";
import {
  type ChatPanelProps,
  useChatPanelController,
} from "@/components/chat/chat-panel-controller";
import { MessageList } from "@/components/chat/message-list";
import { usePromptComposerController } from "@/components/chat/prompt-composer-controller";
import { PromptComposerView } from "@/components/chat/prompt-composer-view";
import { StreamReconnectBanner } from "@/components/chat/stream-reconnect-banner";

export function ChatPanel(props: ChatPanelProps) {
  const controller = useChatPanelController(props);
  const promptComposerController = usePromptComposerController({
    onChange: controller.actions.setDraft,
    onStop: controller.actions.stopRun,
    onSubmit: controller.actions.submitText,
    project: props.project,
    resolvedModelId: props.latestModelId,
    status: controller.state.composerStatus,
    threadId: props.threadId,
    value: controller.state.draft,
  });
  return (
    <div className="relative flex min-h-0 flex-1 flex-col bg-background">
      <ChatContextRow
        isRunning={controller.state.isMessageListStreaming}
        project={props.project}
        threadId={props.threadId}
        title={props.threadTitle}
      />
      <StreamReconnectBanner />
      <MessageList
        hasOlderMessages={props.hasOlderMessages}
        isLoadingOlderMessages={props.isLoadingOlderMessages}
        isStreaming={controller.state.isMessageListStreaming}
        isWaitingForFirstResponse={controller.state.isWaitingForFirstResponse}
        messages={controller.state.messages}
        onContinue={controller.actions.continueRun}
        onLoadOlderMessages={controller.actions.loadOlderMessages}
        runStartedAt={controller.state.runStartedAt}
        threadId={props.threadId}
      />
      <PromptComposerView controller={promptComposerController} />
    </div>
  );
}
