'use client';

import React from 'react';
import { Markdown } from '@/components/ui/markdown';
import { UnifiedMessage, ParsedContent } from '@/components/thread/types';
import { FileAttachmentGrid } from '@/components/thread/file-attachment';
import { Project } from '@/lib/api';
import { safeJsonParse } from '@/components/thread/utils';
import { renderMarkdownContent } from './ThreadContent';
import type { MessageGroup as MessageGroupType } from './useMessageGrouping';

interface MessageGroupProps {
  group: MessageGroupType;
  groupIndex: number;
  totalGroups: number;
  handleToolClick: (assistantMessageId: string | null, toolName: string) => void;
  sandboxId?: string;
  project?: Project;
  debugMode?: boolean;
  latestMessageRef?: React.RefObject<HTMLDivElement>;
  streamingContent?: React.ReactNode;
}

export function MessageGroup({
  group,
  groupIndex,
  totalGroups,
  handleToolClick,
  sandboxId,
  project,
  debugMode = false,
  latestMessageRef,
  streamingContent,
}: MessageGroupProps) {
  const isLastGroup = groupIndex === totalGroups - 1;

  if (group.type === 'user') {
    return <UserMessage group={group} sandboxId={sandboxId} project={project} debugMode={debugMode} />;
  }

  if (group.type === 'assistant_group') {
    return (
      <AssistantGroup
        group={group}
        handleToolClick={handleToolClick}
        sandboxId={sandboxId}
        project={project}
        debugMode={debugMode}
        latestMessageRef={isLastGroup ? latestMessageRef : undefined}
        streamingContent={isLastGroup ? streamingContent : undefined}
      />
    );
  }

  return null;
}

interface UserMessageProps {
  group: MessageGroupType;
  sandboxId?: string;
  project?: Project;
  debugMode?: boolean;
}

function UserMessage({ group, sandboxId, project, debugMode }: UserMessageProps) {
  const message = group.messages[0];
  const messageContent = (() => {
    try {
      const parsed = safeJsonParse<ParsedContent>(message.content, { content: message.content });
      return parsed.content || message.content;
    } catch {
      return message.content;
    }
  })();

  if (debugMode) {
    return (
      <div key={group.key} className="flex justify-end">
        <div className="flex max-w-[85%] rounded-2xl bg-card px-4 py-3 break-words overflow-hidden text-xs">
          <pre className="text-xs font-mono whitespace-pre-wrap overflow-x-auto min-w-0 flex-1">
            {message.content}
          </pre>
        </div>
      </div>
    );
  }

  // Extract attachments from the message content
  const attachmentsMatch = messageContent.match(/\[Uploaded File: (.*?)\]/g);
  const attachments = attachmentsMatch
    ? attachmentsMatch.map((m: string) => {
        const pathMatch = m.match(/\[Uploaded File: (.*?)\]/);
        return pathMatch ? pathMatch[1] : null;
      }).filter(Boolean) as string[]
    : [];

  // Remove attachment info from the message content
  const cleanContent = messageContent.replace(/\[Uploaded File: .*?\]/g, '').trim();

  return (
    <div key={group.key} className="flex flex-col mt-4 mb-2 relative group px-2">
      <div className="relative bg-[var(--thread-user-message-bg)] border border-zinc-800/50 rounded-lg p-4 backdrop-blur-sm">
        <div className="prose prose-sm dark:prose-invert chat-markdown max-w-none break-words overflow-wrap-anywhere text-zinc-300 font-mono tracking-wide leading-normal text-xs [&>p]:text-xs [&>pre]:text-xs [&>code]:text-xs">
          {cleanContent && <Markdown>{cleanContent}</Markdown>}
        </div>
      </div>
      {attachments.length > 0 && (
        <div className="mt-2 pl-1">
          <FileAttachmentGrid
            attachments={attachments}
            showPreviews={true}
            sandboxId={sandboxId}
            project={project}
          />
        </div>
      )}
    </div>
  );
}

interface AssistantGroupProps {
  group: MessageGroupType;
  handleToolClick: (assistantMessageId: string | null, toolName: string) => void;
  sandboxId?: string;
  project?: Project;
  debugMode?: boolean;
  latestMessageRef?: React.RefObject<HTMLDivElement>;
  streamingContent?: React.ReactNode;
}

function AssistantGroup({
  group,
  handleToolClick,
  sandboxId,
  project,
  debugMode = false,
  latestMessageRef,
  streamingContent,
}: AssistantGroupProps) {
  return (
    <div
      key={group.key}
      ref={latestMessageRef}
      className="group mt-4 mb-4 px-2 relative"
    >
      <div className="flex flex-col gap-4">
        <div className="flex max-w-full text-sm break-words overflow-hidden min-w-0 flex-1">
          <div className="space-y-6 min-w-0 flex-1">
            <AssistantMessages
              messages={group.messages}
              handleToolClick={handleToolClick}
              sandboxId={sandboxId}
              project={project}
              debugMode={debugMode}
            />
            {streamingContent && <div className="mt-4">{streamingContent}</div>}
          </div>
        </div>
      </div>
    </div>
  );
}

interface AssistantMessagesProps {
  messages: UnifiedMessage[];
  handleToolClick: (assistantMessageId: string | null, toolName: string) => void;
  sandboxId?: string;
  project?: Project;
  debugMode?: boolean;
}

function AssistantMessages({
  messages,
  handleToolClick,
  sandboxId,
  project,
  debugMode = false,
}: AssistantMessagesProps) {
  if (debugMode) {
    return (
      <>
        {messages.map((message, msgIndex) => {
          const msgKey = message.message_id || `raw-msg-${msgIndex}`;
          return (
            <div key={msgKey} className="mb-4">
              <div className="text-xs font-medium text-muted-foreground mb-1">
                Type: {message.type} | ID: {message.message_id || 'no-id'}
              </div>
              <pre className="text-xs font-mono whitespace-pre-wrap overflow-x-auto p-2 border border-border rounded-md bg-muted/30">
                {message.content}
              </pre>
            </div>
          );
        })}
      </>
    );
  }

  const elements: React.ReactNode[] = [];
  let assistantMessageCount = 0;

  messages.forEach((message, msgIndex) => {
    const msgKey = message.message_id || `submsg-${message.type}-${msgIndex}`;

    if (message.type === 'assistant') {
      const parsedContent = safeJsonParse<ParsedContent>(message.content, {});

      if (!parsedContent.content) return;

      const renderedContent = renderMarkdownContent(
        parsedContent.content,
        handleToolClick,
        message.message_id,
        sandboxId,
        project,
        debugMode
      );

      elements.push(
        <div key={msgKey} className={assistantMessageCount > 0 ? 'mt-8' : ''}>
          <div className="prose prose-sm dark:prose-invert chat-markdown max-w-none [&>:first-child]:mt-0 prose-headings:mt-4 break-words overflow-hidden text-zinc-100/90 leading-relaxed tracking-wide">
            {renderedContent}
          </div>
        </div>
      );

      assistantMessageCount++;
    } else if (message.type === 'tool') {
      const content = message.content;
      if (!content) return;

      let toolData;
      try {
        toolData = typeof content === 'string' ? JSON.parse(content) : content;
      } catch {
        return;
      }

      if (toolData?.tool_execution?.result?.success === false) {
        return;
      }

      const output = toolData?.tool_execution?.result?.output;
      if (!output || output.includes('Failed to generate embedding')) {
        return;
      }

      elements.push(
        <div key={msgKey} className="mt-3 group">
          <div className="flex items-center gap-2 mb-1.5 opacity-40">
            <div className="h-px w-4 bg-zinc-600"></div>
            <span className="text-[8px] font-mono text-zinc-500 uppercase tracking-[0.2em]">
              Output
            </span>
          </div>
          <div className="text-[12px] text-zinc-500 font-mono overflow-x-auto bg-white/[0.01] border-l border-zinc-800 pl-4 py-2 leading-relaxed">
            {output}
          </div>
        </div>
      );
    } else if (message.type === 'status') {
      const content = message.content;
      if (!content) return;

      let statusData;
      try {
        statusData = typeof content === 'object' ? content : JSON.parse(content);
      } catch {
        return;
      }

      const statusType = statusData?.status_type;
      const statusMessage = statusData?.message;

      if (statusType === 'tool_completed' && statusMessage) {
        elements.push(
          <div key={msgKey} className="mt-3">
            <div className="flex items-center gap-2 text-zinc-600/60">
              <div className="h-1 w-1 rounded-full bg-zinc-700"></div>
              <span className="text-[9px] font-mono uppercase tracking-[0.15em]">
                {statusMessage}
              </span>
            </div>
          </div>
        );
      }
    }
  });

  return <>{elements}</>;
}
