'use client';

import React, { useRef, useState, useCallback, useMemo } from 'react';
import { ArrowDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Markdown } from '@/components/ui/markdown';
import { FileAttachmentGrid } from '@/components/thread/file-attachment';
import { Project } from '@/lib/api';
import {
  extractPrimaryParam,
  getToolIcon,
  getUserFriendlyToolName,
} from '@/components/thread/utils';
import {
  parseXmlToolCalls,
  isNewXmlFormat,
} from '@/components/thread/tool-parsing-utils';
import { CheatcodeLogo } from '@/components/sidebar/cheatcode-logo';
import { AgentLoader } from './loader';
import { useMessageGrouping } from './useMessageGrouping';
import { MessageGroup } from './MessageGroup';
import { StreamingContent } from './StreamingContent';

// Import our focused contexts
import { useThreadState } from '@/app/(home)/projects/[projectId]/thread/_contexts/ThreadStateContext';
import { useThreadActions } from '@/app/(home)/projects/[projectId]/thread/_contexts/ThreadActionsContext';
import { useLayout } from '@/app/(home)/projects/[projectId]/thread/_contexts/LayoutContext';

// Helper function to render attachments
export function renderAttachments(attachments: string[], sandboxId?: string, project?: Project) {
  if (!attachments || attachments.length === 0) return null;

  return (
    <FileAttachmentGrid
      attachments={attachments}
      showPreviews={true}
      sandboxId={sandboxId}
      project={project}
    />
  );
}

// Render Markdown content while preserving XML tags that should be displayed as tool calls
export function renderMarkdownContent(
  content: string,
  handleToolClick: (assistantMessageId: string | null, toolName: string) => void,
  messageId: string | null,
  sandboxId?: string,
  project?: Project,
  debugMode?: boolean
) {
  // If in debug mode, just display raw content in a pre tag
  if (debugMode) {
    return (
      <pre className="text-xs font-mono whitespace-pre-wrap overflow-x-auto p-2 border border-border rounded-md bg-muted/30 text-foreground">
        {content}
      </pre>
    );
  }

  // Check if content contains the new Cursor-style format
  if (isNewXmlFormat(content)) {
    return renderNewXmlFormat(content, handleToolClick, messageId, sandboxId, project);
  }

  // Fall back to old XML format handling
  return renderOldXmlFormat(content, handleToolClick, messageId, sandboxId, project);
}

// Render new XML format (function_calls)
function renderNewXmlFormat(
  content: string,
  handleToolClick: (assistantMessageId: string | null, toolName: string) => void,
  messageId: string | null,
  sandboxId?: string,
  project?: Project
) {
  const contentParts: React.ReactNode[] = [];
  let lastIndex = 0;

  const functionCallsRegex = /<function_calls>([\s\S]*?)<\/function_calls>/gi;
  let regexMatch: RegExpExecArray | null;

  while ((regexMatch = functionCallsRegex.exec(content)) !== null) {
    // Add text before the function_calls block
    if (regexMatch.index > lastIndex) {
      const textBeforeBlock = content.substring(lastIndex, regexMatch.index);
      if (textBeforeBlock.trim()) {
        contentParts.push(
          <Markdown key={`md-${lastIndex}`} className="text-sm prose prose-sm dark:prose-invert chat-markdown max-w-none break-words">
            {textBeforeBlock}
          </Markdown>
        );
      }
    }

    // Parse the tool calls in this block
    const toolCalls = parseXmlToolCalls(regexMatch[0]);
    const currentMatchIndex = regexMatch.index;

    toolCalls.forEach((toolCall, index) => {
      const toolName = toolCall.functionName.replace(/_/g, '-');

      if (toolName === 'ask') {
        const askText = toolCall.parameters.text || '';
        const attachments = toolCall.parameters.attachments || [];
        const attachmentArray = Array.isArray(attachments)
          ? attachments
          : typeof attachments === 'string'
            ? attachments.split(',').map((a: string) => a.trim())
            : [];

        contentParts.push(
          <div key={`ask-${currentMatchIndex}-${index}`} className="space-y-3">
            <Markdown className="text-sm prose prose-sm dark:prose-invert chat-markdown max-w-none break-words [&>:first-child]:mt-0 prose-headings:mt-3">
              {askText}
            </Markdown>
            {renderAttachments(attachmentArray, sandboxId, project)}
          </div>
        );
      } else {
        contentParts.push(
          <ToolCallButton
            key={`tool-${currentMatchIndex}-${index}`}
            toolName={toolName}
            toolCall={toolCall}
            handleToolClick={handleToolClick}
            messageId={messageId}
          />
        );
      }
    });

    lastIndex = regexMatch.index + regexMatch[0].length;
  }

  // Add any remaining text after the last function_calls block
  if (lastIndex < content.length) {
    const remainingText = content.substring(lastIndex);
    if (remainingText.trim()) {
      contentParts.push(
        <Markdown key={`md-${lastIndex}`} className="text-sm prose prose-sm dark:prose-invert chat-markdown max-w-none break-words">
          {remainingText}
        </Markdown>
      );
    }
  }

  return contentParts.length > 0 ? contentParts : (
    <Markdown className="text-sm prose prose-sm dark:prose-invert chat-markdown max-w-none break-words">
      {content}
    </Markdown>
  );
}

// Render old XML format
function renderOldXmlFormat(
  content: string,
  handleToolClick: (assistantMessageId: string | null, toolName: string) => void,
  messageId: string | null,
  sandboxId?: string,
  project?: Project
) {
  const xmlRegex = /<(?!inform\b)([a-zA-Z\-_]+)(?:\s+[^>]*)?>(?:[\s\S]*?)<\/\1>|<(?!inform\b)([a-zA-Z\-_]+)(?:\s+[^>]*)?\/>/g;
  let lastIndex = 0;
  const contentParts: React.ReactNode[] = [];
  let match;

  // If no XML tags found, just return the full content as markdown
  if (!content.match(xmlRegex)) {
    return (
      <Markdown className="text-sm prose prose-sm dark:prose-invert chat-markdown max-w-none break-words">
        {content}
      </Markdown>
    );
  }

  while ((match = xmlRegex.exec(content)) !== null) {
    // Add text before the tag as markdown
    if (match.index > lastIndex) {
      const textBeforeTag = content.substring(lastIndex, match.index);
      contentParts.push(
        <Markdown key={`md-${lastIndex}`} className="text-sm prose prose-sm dark:prose-invert chat-markdown max-w-none inline-block mr-1 break-words">
          {textBeforeTag}
        </Markdown>
      );
    }

    const rawXml = match[0];
    const toolName = match[1] || match[2];
    const toolCallKey = `tool-${match.index}`;

    if (toolName === 'ask') {
      const attachmentsMatch = rawXml.match(/attachments=["']([^"']*)["']/i);
      const attachments = attachmentsMatch
        ? attachmentsMatch[1].split(',').map((a) => a.trim())
        : [];

      const contentMatch = rawXml.match(/<ask[^>]*>([\s\S]*?)<\/ask>/i);
      const askContent = contentMatch ? contentMatch[1] : '';

      contentParts.push(
        <div key={`ask-${match.index}`} className="space-y-3">
          <Markdown className="text-sm prose prose-sm dark:prose-invert chat-markdown max-w-none break-words [&>:first-child]:mt-0 prose-headings:mt-3">
            {askContent}
          </Markdown>
          {renderAttachments(attachments, sandboxId, project)}
        </div>
      );
    } else {
      const IconComponent = getToolIcon(toolName);
      const paramDisplay = extractPrimaryParam(toolName, rawXml);

      contentParts.push(
        <div key={toolCallKey} className="my-1">
          <button
            onClick={() => handleToolClick?.(messageId, toolName)}
            className="inline-flex flex-nowrap items-center gap-2.5 py-1 px-3 text-[13px] rounded-full transition-all cursor-pointer bg-transparent hover:bg-zinc-800/50 group font-sans tracking-wide text-zinc-300"
            disabled={!handleToolClick}
          >
            <IconComponent className="h-3.5 w-3.5 flex-shrink-0 text-zinc-400 group-hover:text-zinc-300 transition-colors" />
            <span className="font-medium whitespace-nowrap flex-shrink-0">
              {getUserFriendlyToolName(toolName)}
            </span>
            {paramDisplay && (
              <span className="text-zinc-500 group-hover:text-zinc-400 truncate max-w-[180px] transition-colors bg-zinc-800/50 px-2 py-0.5 rounded-md font-mono text-[11px]" title={paramDisplay}>
                {paramDisplay}
              </span>
            )}
          </button>
        </div>
      );
    }
    lastIndex = xmlRegex.lastIndex;
  }

  // Add text after the last tag
  if (lastIndex < content.length) {
    contentParts.push(
      <Markdown key={`md-${lastIndex}`} className="text-sm prose prose-sm dark:prose-invert chat-markdown max-w-none break-words">
        {content.substring(lastIndex)}
      </Markdown>
    );
  }

  return contentParts;
}

// Tool call button component
interface ToolCallButtonProps {
  toolName: string;
  toolCall: { parameters: Record<string, string> };
  handleToolClick: (assistantMessageId: string | null, toolName: string) => void;
  messageId: string | null;
}

function ToolCallButton({ toolName, toolCall, handleToolClick, messageId }: ToolCallButtonProps) {
  const IconComponent = getToolIcon(toolName);

  let paramDisplay = '';
  if (toolCall.parameters.file_path) {
    paramDisplay = toolCall.parameters.file_path;
  } else if (toolCall.parameters.target_file) {
    paramDisplay = toolCall.parameters.target_file;
  } else if (toolCall.parameters.command) {
    paramDisplay = toolCall.parameters.command;
  } else if (toolCall.parameters.query) {
    paramDisplay = toolCall.parameters.query;
  } else if (toolCall.parameters.url) {
    paramDisplay = toolCall.parameters.url;
  }

  return (
    <div className="my-1">
      <button
        onClick={() => handleToolClick?.(messageId, toolName)}
        className="inline-flex flex-nowrap items-center gap-2.5 py-1 px-3 text-[13px] rounded-full transition-all cursor-pointer bg-transparent hover:bg-zinc-800/50 group font-sans tracking-wide text-zinc-300"
        disabled={!handleToolClick}
      >
        <IconComponent className="h-3.5 w-3.5 flex-shrink-0 text-zinc-400 group-hover:text-zinc-300 transition-colors" />
        <span className="font-medium whitespace-nowrap flex-shrink-0">
          {getUserFriendlyToolName(toolName)}
        </span>
        {paramDisplay && (
          <span className="text-zinc-500 group-hover:text-zinc-400 truncate max-w-[180px] transition-colors bg-zinc-800/50 px-2 py-0.5 rounded-md font-mono text-[11px]" title={paramDisplay}>
            {paramDisplay}
          </span>
        )}
      </button>
    </div>
  );
}

// Empty state component
function EmptyState() {
  return (
    <div className="flex-1 min-h-[60vh] flex items-center justify-center bg-thread-panel font-mono">
      <div className="text-center">
        <div className="mb-6 flex justify-center">
          <div className="h-12 w-12 flex items-center justify-center rounded-sm bg-zinc-900 border border-zinc-800">
            <CheatcodeLogo size={24} className="text-white" />
          </div>
        </div>
        <h3 className="text-sm font-medium text-white mb-2">Ready to Build</h3>
        <p className="text-xs text-zinc-500 max-w-sm mx-auto">
          What would you like to create today?
        </p>
      </div>
    </div>
  );
}

// Main ThreadContent component - now context-aware with extracted components
export const ThreadContent: React.FC = () => {
  const { messages, sandboxId, project } = useThreadState();
  const {
    streamingTextContent = '',
    streamingToolCall,
    agentState,
    streamHookStatus = 'idle',
  } = useThreadActions();
  const { debugMode = false } = useLayout();

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const latestMessageRef = useRef<HTMLDivElement>(null);
  const [showScrollButton, setShowScrollButton] = useState(false);

  // Use memoized message grouping
  const groupedMessages = useMessageGrouping({
    messages,
    streamingTextContent,
  });

  const handleScroll = useCallback(() => {
    if (!messagesContainerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = messagesContainerRef.current;
    const isScrolledUp = scrollHeight - scrollTop - clientHeight > 100;
    setShowScrollButton(isScrolledUp);
  }, []);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'smooth') => {
    messagesEndRef.current?.scrollIntoView({ behavior });
  }, []);

  const handleToolClick = useCallback((_assistantMessageId: string | null, _toolName: string) => {
    // Tool click handler - can be extended to show tool details
  }, []);

  // Memoize streaming content component
  const streamingContentElement = useMemo(() => {
    if (streamHookStatus !== 'streaming' && streamHookStatus !== 'connecting') {
      return null;
    }
    return (
      <StreamingContent
        streamingTextContent={streamingTextContent}
        streamHookStatus={streamHookStatus}
        debugMode={debugMode}
      />
    );
  }, [streamingTextContent, streamHookStatus, debugMode]);

  const containerClassName = 'flex-1 overflow-y-auto scrollbar-hide px-6 py-6 pb-40 bg-thread-panel font-mono';
  const isEmpty = messages.length === 0 && !streamingTextContent && !streamingToolCall && agentState.status === 'idle';
  const showLoader = (agentState.status === 'running' || agentState.status === 'connecting') &&
    !streamingTextContent &&
    (messages.length === 0 || messages[messages.length - 1].type === 'user');

  return (
    <>
      {isEmpty ? (
        <EmptyState />
      ) : (
        <div
          ref={messagesContainerRef}
          className={containerClassName}
          onScroll={handleScroll}
        >
          <div className="mx-auto max-w-3xl min-w-0">
            <div className="space-y-6 min-w-0">
              {groupedMessages.map((group, groupIndex) => (
                <MessageGroup
                  key={group.key}
                  group={group}
                  groupIndex={groupIndex}
                  totalGroups={groupedMessages.length}
                  handleToolClick={handleToolClick}
                  sandboxId={sandboxId ?? undefined}
                  project={project ?? undefined}
                  debugMode={debugMode}
                  latestMessageRef={latestMessageRef as React.RefObject<HTMLDivElement>}
                  streamingContent={streamingContentElement}
                />
              ))}
              {showLoader && (
                <div ref={latestMessageRef} className="w-full h-12 px-2">
                  <div className="flex flex-col gap-2">
                    <div className="space-y-2 w-full h-12">
                      <AgentLoader />
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
          <div ref={messagesEndRef} className="h-1" />
        </div>
      )}

      {showScrollButton && (
        <Button
          variant="outline"
          size="icon"
          className="fixed bottom-20 right-6 z-10 h-8 w-8 rounded-full shadow-md"
          onClick={() => scrollToBottom('smooth')}
        >
          <ArrowDown className="h-4 w-4" />
        </Button>
      )}
    </>
  );
};

export default ThreadContent;
