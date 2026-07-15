"use client";

import type { CheatcodeUIMessage } from "@cheatcode/types";
import type { ReactNode } from "react";
import { Response as MarkdownResponse } from "@/components/ai-elements/response";
import {
  ApprovalDecisionBlock,
  ApprovalRequestBlock,
  ModelFallbackBlock,
} from "@/components/chat/approval-parts";
import {
  ActivityDisclosure,
  isToolPart,
  ThinkingBlock,
  ToolGroup,
} from "@/components/chat/message-activity";
import { collectDeliverables } from "@/components/chat/message-deliverable-model";
import { DeliverablesBlock } from "@/components/chat/message-deliverables";
import {
  DataBlock,
  ErrorRecoveryBlock,
  errorRecoveryMessage,
} from "@/components/chat/message-part-blocks";
import type { MessagePart } from "@/components/chat/message-parts.types";
import {
  buildMessageTimeline,
  collectResolvedApprovals,
  formatUnknown,
  isHiddenTranscriptPart,
} from "@/components/chat/message-timeline";

export function MessageParts({
  message,
  onContinue,
  streaming,
}: {
  message: CheatcodeUIMessage;
  onContinue?: (() => void) | undefined;
  streaming: boolean;
}) {
  const resolvedApprovalIds = collectResolvedApprovals(message.parts);
  const items = buildMessageTimeline(message.id, message.parts, streaming);
  const deliverables = collectDeliverables(message.parts);
  return (
    <div className="space-y-3">
      {items.map((item) =>
        item.kind === "activity" ? (
          <ActivityDisclosure key={item.key} parts={item.parts} streaming={streaming} />
        ) : (
          <MessagePartView
            key={item.key}
            onContinue={onContinue}
            part={item.part}
            resolvedApprovalIds={resolvedApprovalIds}
          />
        ),
      )}
      {deliverables.length > 0 ? <DeliverablesBlock items={deliverables} /> : null}
    </div>
  );
}

interface MessagePartViewProps {
  onContinue?: (() => void) | undefined;
  part: MessagePart;
  resolvedApprovalIds: ReadonlySet<string>;
}

function MessagePartView({ onContinue, part, resolvedApprovalIds }: MessagePartViewProps) {
  if (part.type === "text") {
    return (
      <div className="chat-markdown max-w-none text-[14px] text-foreground leading-6">
        <MarkdownResponse>{part.text}</MarkdownResponse>
      </div>
    );
  }
  if (part.type === "data-error") {
    return (
      <ErrorRecoveryBlock
        message={errorRecoveryMessage(part.data.code, part.data.message)}
        onContinue={part.data.retriable ? onContinue : undefined}
      />
    );
  }
  if (part.type === "data-thinking") return <ThinkingBlock data={part.data} />;
  if (isHiddenTranscriptPart(part)) return null;
  return <MessagePartFallback part={part} resolvedApprovalIds={resolvedApprovalIds} />;
}

function MessagePartFallback({
  part,
  resolvedApprovalIds,
}: Pick<MessagePartViewProps, "part" | "resolvedApprovalIds">) {
  const approvalView = renderApprovalPart(part, resolvedApprovalIds);
  if (approvalView !== null) return approvalView;
  if (isToolPart(part)) return <ToolGroup parts={[part]} />;
  return <DataBlock title={part.type} value={formatUnknown(part)} />;
}

function renderApprovalPart(
  part: MessagePart,
  resolvedApprovalIds: ReadonlySet<string>,
): ReactNode {
  if (part.type === "data-approval-request") {
    return (
      <ApprovalRequestBlock
        data={part.data}
        resolved={resolvedApprovalIds.has(part.data.approvalId)}
      />
    );
  }
  if (part.type === "data-approval-decision") {
    return <ApprovalDecisionBlock data={part.data} />;
  }
  if (part.type === "data-model-fallback") return <ModelFallbackBlock data={part.data} />;
  return null;
}
