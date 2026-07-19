"use client";

import {
  type CheatcodeUIMessage,
  type ModelFallbackData,
  reconstructedTranscriptUIMessage,
} from "@cheatcode/types";
import { Check, FileText, Loader2, Puzzle } from "@cheatcode/ui";
import { useAuth } from "@clerk/nextjs";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { toast } from "sonner";
import { Response as MarkdownResponse } from "@/components/ai-elements/response";
import {
  ActivityDisclosure,
  isToolPart,
  ProjectCreatedActivity,
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
  formatUnknown,
  isHiddenTranscriptPart,
} from "@/components/chat/message-timeline";
import { confirmSkillProposal, openUserSkill, USER_SKILLS_QUERY } from "@/lib/api/skills";
import { useAppStore } from "@/lib/store/app-store";

export function MessageParts({
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
  const visibleMessage = reconstructedTranscriptUIMessage(message);
  if (visibleMessage.role === "user") {
    return <UserMessageParts message={visibleMessage} />;
  }
  const items = buildMessageTimeline(visibleMessage.id, visibleMessage.parts, streaming);
  const deliverables = collectDeliverables(visibleMessage.parts);
  return (
    <div className="space-y-3">
      {items.map((item) =>
        item.kind === "activity" ? (
          <ActivityDisclosure key={item.key} parts={item.parts} streaming={streaming} />
        ) : (
          <MessagePartView
            completedSkillProposalIds={completedSkillProposalIds}
            key={item.key}
            message={visibleMessage}
            onContinue={onContinue}
            onMessageAppend={onMessageAppend}
            part={item.part}
            threadId={threadId}
          />
        ),
      )}
      {deliverables.length > 0 ? <DeliverablesBlock items={deliverables} /> : null}
    </div>
  );
}

function UserMessageParts({ message }: { message: CheatcodeUIMessage }) {
  const intent = message.parts.find((part) => part.type === "data-run-intent");
  const text = message.parts
    .filter((part): part is Extract<MessagePart, { type: "text" }> => part.type === "text")
    .map((part) => part.text)
    .join("\n");
  return (
    <div className="flex flex-wrap items-start gap-x-1.5 gap-y-1 text-[14px] leading-6">
      {intent?.type === "data-run-intent" && intent.data.intent === "skill-creator" ? (
        <span className="mt-0.5 inline-flex h-5 shrink-0 items-center gap-1 rounded-full border border-border bg-background px-1.5 font-medium text-[11px] text-foreground leading-none">
          <Puzzle aria-hidden="true" className="size-3" />
          Skill Creator
        </span>
      ) : null}
      <div className="chat-markdown min-w-0 flex-1 text-foreground">
        <MarkdownResponse>{text}</MarkdownResponse>
      </div>
    </div>
  );
}

interface MessagePartViewProps {
  completedSkillProposalIds: ReadonlySet<string>;
  message: CheatcodeUIMessage;
  onContinue?: (() => void) | undefined;
  onMessageAppend: (message: CheatcodeUIMessage) => void;
  part: MessagePart;
  threadId: string;
}

function MessagePartView({
  completedSkillProposalIds,
  message,
  onContinue,
  onMessageAppend,
  part,
  threadId,
}: MessagePartViewProps) {
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
  if (isHiddenTranscriptPart(part)) return null;
  return (
    <MessagePartFallback
      completedSkillProposalIds={completedSkillProposalIds}
      message={message}
      onMessageAppend={onMessageAppend}
      part={part}
      threadId={threadId}
    />
  );
}

function MessagePartFallback({
  completedSkillProposalIds,
  message,
  onMessageAppend,
  part,
  threadId,
}: Pick<
  MessagePartViewProps,
  "completedSkillProposalIds" | "message" | "onMessageAppend" | "part" | "threadId"
>) {
  if (part.type === "data-model-fallback") return <ModelFallbackBlock data={part.data} />;
  if (part.type === "data-project-created") return <ProjectCreatedActivity part={part} />;
  if (part.type === "data-skill-proposed") {
    if (completedSkillProposalIds.has(part.data.proposalId)) return null;
    return (
      <SkillProposalBlock
        data={part.data}
        message={message}
        onMessageAppend={onMessageAppend}
        threadId={threadId}
      />
    );
  }
  if (part.type === "data-skill-created") {
    return <SkillCreatedBlock data={part.data} threadId={threadId} />;
  }
  if (isToolPart(part)) return <ToolGroup parts={[part]} />;
  return <DataBlock title={part.type} value={formatUnknown(part)} />;
}

type SkillProposedData = Extract<MessagePart, { type: "data-skill-proposed" }>["data"];
type SkillCreatedData = Extract<MessagePart, { type: "data-skill-created" }>["data"];

function SkillProposalBlock({
  data,
  message,
  onMessageAppend,
  threadId,
}: {
  data: SkillProposedData;
  message: CheatcodeUIMessage;
  onMessageAppend: (message: CheatcodeUIMessage) => void;
  threadId: string;
}) {
  const { getToken } = useAuth();
  const queryClient = useQueryClient();
  const runId =
    message.metadata?.runId ?? message.metadata?.transcriptSegment?.agentRunId ?? message.id;
  const mutation = useMutation({
    mutationFn: () => confirmSkillProposal(getToken, threadId, runId, data.proposalId),
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "That skill could not be created."),
    onSuccess: ({ message: confirmation }) => {
      onMessageAppend(confirmation);
      void queryClient.invalidateQueries({ queryKey: ["threads", threadId, "messages"] });
      void queryClient.invalidateQueries({ queryKey: USER_SKILLS_QUERY });
    },
  });
  return (
    <div className="cc-fade-in rounded-[18px] border-2 border-border p-0.5">
      <div className="flex w-full items-center gap-3 rounded-[14px] border border-border bg-secondary p-2.5 text-left">
        <div className="min-w-0 flex-1">
          <div className="truncate font-medium text-[13px] text-foreground">
            Create {data.slug} skill
          </div>
          <div className="truncate text-[12px] text-fg-secondary">{data.description}</div>
        </div>
        <div className="shrink-0 rounded-full bg-background p-1">
          <button
            className="flex h-8 items-center gap-1.5 rounded-full bg-foreground px-3 font-medium text-[12px] text-background transition-opacity hover:opacity-85 disabled:opacity-55"
            disabled={mutation.isPending}
            onClick={() => mutation.mutate()}
            type="button"
          >
            {mutation.isPending ? (
              <Loader2 aria-hidden="true" className="size-3.5 animate-spin" />
            ) : (
              <Check aria-hidden="true" className="size-3.5" />
            )}
            Create
          </button>
        </div>
      </div>
    </div>
  );
}

function SkillCreatedBlock({ data, threadId }: { data: SkillCreatedData; threadId: string }) {
  const { getToken } = useAuth();
  const queryClient = useQueryClient();
  const setActivePreviewTab = useAppStore((state) => state.setActivePreviewTab);
  const setPreviewPanelOpen = useAppStore((state) => state.setPreviewPanelOpen);
  const mutation = useMutation({
    mutationFn: async () => {
      if (!data.id) throw new Error("This saved skill has no file reference.");
      return openUserSkill(getToken, data.id);
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "The skill file could not be opened."),
    onSuccess: (session) => {
      queryClient.setQueryData(["sandbox-ide", threadId], session);
      setActivePreviewTab("files");
      setPreviewPanelOpen(true);
    },
  });
  const open = () => mutation.mutate();
  if (!data.id) {
    return <SkillCreatedSummaryBlock name={data.name} />;
  }
  return (
    <div className="cc-fade-in space-y-3">
      <button
        className="group flex w-full items-center gap-1 rounded-lg px-1 py-1 text-left text-[13px] text-foreground transition-colors hover:bg-secondary/60"
        disabled={mutation.isPending}
        onClick={open}
        type="button"
      >
        <FileText aria-hidden="true" className="size-3.5 shrink-0 text-blue-500" />
        <span className="truncate">SKILL.md</span>
        {mutation.isPending ? (
          <Loader2 aria-hidden="true" className="ml-auto size-3.5 animate-spin text-fg-secondary" />
        ) : null}
      </button>
      <div className="rounded-[18px] border-2 border-border p-0.5">
        <div className="flex items-center gap-3 rounded-[14px] border border-border bg-secondary p-2.5">
          <div className="min-w-0 flex-1">
            <div className="truncate font-medium text-[13px] text-foreground">{data.name}</div>
            <div className="truncate text-[12px] text-fg-secondary">
              {data.description ?? "Saved to your custom skills. Open it to review or edit."}
            </div>
          </div>
          <div className="shrink-0 rounded-full bg-background p-1">
            <button
              className="h-8 rounded-full bg-foreground px-3 font-medium text-[12px] text-background transition-opacity hover:opacity-85 disabled:opacity-55"
              disabled={mutation.isPending}
              onClick={open}
              type="button"
            >
              Open
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function SkillCreatedSummaryBlock({ name }: { name: string }) {
  return (
    <div className="cc-fade-in flex items-center justify-between gap-3 rounded-[18px] border-2 border-border bg-background p-0.5">
      <div className="flex min-w-0 flex-1 items-center justify-between gap-3 rounded-[14px] bg-secondary px-3.5 py-2.5">
        <span className="min-w-0 truncate text-[13px] text-fg-secondary">
          Saved <span className="font-medium text-foreground">{name}</span>
        </span>
        <Link
          className="shrink-0 rounded-full bg-foreground px-3 py-1.5 font-medium text-[12px] text-background transition-opacity hover:opacity-85"
          href="/skills#your-skills"
        >
          View skill
        </Link>
      </div>
    </div>
  );
}

function ModelFallbackBlock({ data }: { data: ModelFallbackData }) {
  return (
    <div className="cc-fade-in rounded-[14px] border border-thread-border bg-[var(--thread-code-bg)] p-3 text-[11px] text-thread-text-secondary">
      <div className="mb-1 text-[10px] text-thread-text-muted">model fallback</div>
      <div className="text-thread-text-primary">
        Switched from {data.fromModel} to {data.toModel}
      </div>
      <div className="mt-1 text-[10px] text-thread-text-muted">
        Reason: {fallbackReasonLabel(data.reason)}
      </div>
      <Link
        className="mt-2 inline-block text-[11px] text-thread-accent underline-offset-4 hover:underline"
        href="/models#api-keys"
      >
        Open Models &amp; Keys
      </Link>
    </div>
  );
}

function fallbackReasonLabel(reason: ModelFallbackData["reason"]): string {
  if (reason === "rate_limit") return "provider rate limit";
  if (reason === "provider_balance") return "provider balance or quota exhausted";
  return "provider error";
}
