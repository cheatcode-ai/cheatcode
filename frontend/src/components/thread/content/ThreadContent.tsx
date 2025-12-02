import React, { useRef, useState, useCallback } from 'react';
import { ArrowDown, CircleDashed, CheckCircle, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Markdown } from '@/components/ui/markdown';
import { UnifiedMessage, ParsedContent, ParsedMetadata } from '@/components/thread/types';
import { FileAttachmentGrid } from '@/components/thread/file-attachment';
import { Project } from '@/lib/api';
import {
    extractPrimaryParam,
    getToolIcon,
    getUserFriendlyToolName,
    safeJsonParse,
} from '@/components/thread/utils';
import { 
    formatMCPToolDisplayName,
    parseXmlToolCalls, 
    isNewXmlFormat, 
    extractToolNameFromStream,
    parseToolResult 
} from '@/components/thread/tool-parsing-utils';
import { CheatcodeLogo } from '@/components/sidebar/cheatcode-logo';
import { AgentLoader } from './loader';

// Import our focused contexts
import { useThreadState } from '@/app/(home)/projects/[projectId]/thread/_contexts/ThreadStateContext';
import { useThreadActions } from '@/app/(home)/projects/[projectId]/thread/_contexts/ThreadActionsContext';
import { useLayout } from '@/app/(home)/projects/[projectId]/thread/_contexts/LayoutContext';
import { useMessageScroll } from '@/app/(home)/projects/[projectId]/thread/_hooks/useMessageScroll';

// Define the set of  tags whose raw XML should be hidden during streaming
const HIDE_STREAMING_XML_TAGS = new Set([
    'execute-command',
    'create-file',
    'delete-file',
    'full-file-rewrite',
    'edit-file',
    'deploy',
    'ask',
    'complete',
    'crawl-webpage',
    'web-search',
    'see-image',
    'call-mcp-tool',

    'execute_data_provider_call',
    'execute_data_provider_endpoint',

    'execute-data-provider-call',
    'execute-data-provider-endpoint',
]);

function getEnhancedToolDisplayName(toolName: string, rawXml?: string): string {
    if (toolName === 'call-mcp-tool' && rawXml) {
        const toolNameMatch = rawXml.match(/tool_name="([^"]+)"/);
        if (toolNameMatch) {
            const fullToolName = toolNameMatch[1];
            const parts = fullToolName.split('_');
            if (parts.length >= 3 && fullToolName.startsWith('mcp_')) {
                const serverName = parts[1];
                const toolNamePart = parts.slice(2).join('_');
                return formatMCPToolDisplayName(serverName, toolNamePart);
            }
        }
    }
    return getUserFriendlyToolName(toolName);
}

// Helper function to render attachments (keeping original implementation for now)
export function renderAttachments(attachments: string[], sandboxId?: string, project?: Project) {
    if (!attachments || attachments.length === 0) return null;

    // Note: Preloading is now handled by React Query in the main ThreadContent component
    // to avoid duplicate requests with different content types

    return <FileAttachmentGrid
        attachments={attachments}
        showPreviews={true}
        sandboxId={sandboxId}
        project={project}
    />;
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
        const contentParts: React.ReactNode[] = [];
        let lastIndex = 0;

        // Find all function_calls blocks
        const functionCallsRegex = /<function_calls>([\s\S]*?)<\/function_calls>/gi;
        let match;

        while ((match = functionCallsRegex.exec(content)) !== null) {
            // Add text before the function_calls block
            if (match.index > lastIndex) {
                const textBeforeBlock = content.substring(lastIndex, match.index);
                if (textBeforeBlock.trim()) {
                    contentParts.push(
                        <Markdown key={`md-${lastIndex}`} className="text-sm prose prose-sm dark:prose-invert chat-markdown max-w-none break-words">
                            {textBeforeBlock}
                        </Markdown>
                    );
                }
            }

            // Parse the tool calls in this block
            const toolCalls = parseXmlToolCalls(match[0]);

            toolCalls.forEach((toolCall, index) => {
                const toolName = toolCall.functionName.replace(/_/g, '-');

                if (toolName === 'ask') {
                    // Handle ask tool specially - extract text and attachments
                    const askText = toolCall.parameters.text || '';
                    const attachments = toolCall.parameters.attachments || [];

                    // Convert single attachment to array for consistent handling
                    const attachmentArray = Array.isArray(attachments) ? attachments :
                        (typeof attachments === 'string' ? attachments.split(',').map(a => a.trim()) : []);

                    // Render ask tool content with attachment UI
                    contentParts.push(
                        <div key={`ask-${match.index}-${index}`} className="space-y-3">
                            <Markdown className="text-sm prose prose-sm dark:prose-invert chat-markdown max-w-none break-words [&>:first-child]:mt-0 prose-headings:mt-3">{askText}</Markdown>
                            {renderAttachments(attachmentArray, sandboxId, project)}
                        </div>
                    );
                } else {
                    const IconComponent = getToolIcon(toolName);

                    // Extract primary parameter for display
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

                    contentParts.push(
                        <div key={`tool-${match.index}-${index}`} className="my-1">
                            <button
                                onClick={() => handleToolClick?.(messageId, toolName)}
                                className="inline-flex items-center gap-1.5 py-1 px-1 pr-1.5 text-xs text-muted-foreground bg-muted hover:bg-muted/80 rounded-lg transition-colors cursor-pointer border border-neutral-200 dark:border-neutral-700/50"
                                disabled={!handleToolClick}
                            >
                                <div className='border-2 bg-gradient-to-br from-neutral-200 to-neutral-300 dark:from-neutral-700 dark:to-neutral-800 flex items-center justify-center p-0.5 rounded-sm border-neutral-400/20 dark:border-neutral-600'>
                                    <IconComponent className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                                </div>
                                <span className="font-mono text-xs text-foreground">{getUserFriendlyToolName(toolName)}</span>
                                {paramDisplay && <span className="ml-1 text-muted-foreground truncate max-w-[200px]" title={paramDisplay}>{paramDisplay}</span>}
                            </button>
                        </div>
                    );
                }
            });

            lastIndex = match.index + match[0].length;
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

        return contentParts.length > 0 ? contentParts : <Markdown className="text-sm prose prose-sm dark:prose-invert chat-markdown max-w-none break-words">{content}</Markdown>;
    }

    // Fall back to old XML format handling
    const xmlRegex = /<(?!inform\b)([a-zA-Z\-_]+)(?:\s+[^>]*)?>(?:[\s\S]*?)<\/\1>|<(?!inform\b)([a-zA-Z\-_]+)(?:\s+[^>]*)?\/>/g;
    let lastIndex = 0;
    const contentParts: React.ReactNode[] = [];
    let match;

    // If no XML tags found, just return the full content as markdown
    if (!content.match(xmlRegex)) {
        return <Markdown className="text-sm prose prose-sm dark:prose-invert chat-markdown max-w-none break-words">{content}</Markdown>;
    }

    while ((match = xmlRegex.exec(content)) !== null) {
        // Add text before the tag as markdown
        if (match.index > lastIndex) {
            const textBeforeTag = content.substring(lastIndex, match.index);
            contentParts.push(
                <Markdown key={`md-${lastIndex}`} className="text-sm prose prose-sm dark:prose-invert chat-markdown max-w-none inline-block mr-1 break-words">{textBeforeTag}</Markdown>
            );
        }

        const rawXml = match[0];
        const toolName = match[1] || match[2];
        const toolCallKey = `tool-${match.index}`;

        if (toolName === 'ask') {
            // Extract attachments from the XML attributes
            const attachmentsMatch = rawXml.match(/attachments=["']([^"']*)["']/i);
            const attachments = attachmentsMatch
                ? attachmentsMatch[1].split(',').map(a => a.trim())
                : [];

            // Extract content from the ask tag
            const contentMatch = rawXml.match(/<ask[^>]*>([\s\S]*?)<\/ask>/i);
            const askContent = contentMatch ? contentMatch[1] : '';

            // Render <ask> tag content with attachment UI (using the helper)
            contentParts.push(
                <div key={`ask-${match.index}`} className="space-y-3">
                    <Markdown className="text-sm prose prose-sm dark:prose-invert chat-markdown max-w-none break-words [&>:first-child]:mt-0 prose-headings:mt-3">{askContent}</Markdown>
                    {renderAttachments(attachments, sandboxId, project)}
                </div>
            );
        } else {
            const IconComponent = getToolIcon(toolName);
            const paramDisplay = extractPrimaryParam(toolName, rawXml);

            // Render tool button as a clickable element
            contentParts.push(
                <div key={toolCallKey} className="my-1">
                    <button
                        onClick={() => handleToolClick?.(messageId, toolName)}
                        className="inline-flex items-center gap-1.5 py-1 px-1 pr-1.5 text-xs text-muted-foreground bg-muted hover:bg-muted/80 rounded-lg transition-colors cursor-pointer border border-neutral-200 dark:border-neutral-700/50"
                        disabled={!handleToolClick}
                    >
                        <div className='border-2 bg-gradient-to-br from-neutral-200 to-neutral-300 dark:from-neutral-700 dark:to-neutral-800 flex items-center justify-center p-0.5 rounded-sm border-neutral-400/20 dark:border-neutral-600'>
                            <IconComponent className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                        </div>
                        <span className="font-mono text-xs text-foreground">{getUserFriendlyToolName(toolName)}</span>
                        {paramDisplay && <span className="ml-1 text-muted-foreground truncate max-w-[200px]" title={paramDisplay}>{paramDisplay}</span>}
                    </button>
                </div>
            );
        }
        lastIndex = xmlRegex.lastIndex;
    }

    // Add text after the last tag
    if (lastIndex < content.length) {
        contentParts.push(
            <Markdown key={`md-${lastIndex}`} className="text-sm prose prose-sm dark:prose-invert chat-markdown max-w-none break-words">{content.substring(lastIndex)}</Markdown>
        );
    }

    return contentParts;
}

// Main ThreadContent component - now context-aware
export const ThreadContent: React.FC = () => {
    // Get data from contexts instead of props
    const { messages, sandboxId, project } = useThreadState();
    

    const { 
        streamingTextContent = "", 
        streamingToolCall, 
        agentState, 
        streamHookStatus = "idle"
    } = useThreadActions();
    const { debugMode = false } = useLayout();

    const messagesEndRef = useRef<HTMLDivElement>(null);
    const messagesContainerRef = useRef<HTMLDivElement>(null);
    const latestMessageRef = useRef<HTMLDivElement>(null);
    const [showScrollButton, setShowScrollButton] = useState(false);
    const [userHasScrolled, setUserHasScrolled] = useState(false);

    const containerClassName = "flex-1 overflow-y-auto scrollbar-hide px-6 py-4 pb-72 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60";

    const handleScroll = () => {
        if (!messagesContainerRef.current) return;
        const { scrollTop, scrollHeight, clientHeight } = messagesContainerRef.current;
        const isScrolledUp = scrollHeight - scrollTop - clientHeight > 100;
        setShowScrollButton(isScrolledUp);
        setUserHasScrolled(isScrolledUp);
    };

    const scrollToBottom = useCallback((behavior: ScrollBehavior = 'smooth') => {
        messagesEndRef.current?.scrollIntoView({ behavior });
    }, []);

    const handleToolClick = useCallback((assistantMessageId: string | null, toolName: string) => {
        console.log('Tool clicked:', { assistantMessageId, toolName });
    }, []);

    return (
        <>
            {messages.length === 0 && !streamingTextContent && !streamingToolCall && agentState.status === 'idle' ? (
                // Render empty state outside scrollable container
                <div className="flex-1 min-h-[60vh] flex items-center justify-center">
                    <div className="text-center text-muted-foreground">
                        Send a message to start.
                    </div>
                </div>
            ) : (
                // Render scrollable content container
                <div
                    ref={messagesContainerRef}
                    className={containerClassName}
                    onScroll={handleScroll}
                >
                    <div className="mx-auto max-w-3xl md:px-8 min-w-0">
                        <div className="space-y-8 min-w-0">
                            {(() => {

                                type MessageGroup = {
                                    type: 'user' | 'assistant_group';
                                    messages: UnifiedMessage[];
                                    key: string;
                                };
                                const groupedMessages: MessageGroup[] = [];
                                let currentGroup: MessageGroup | null = null;
                                let assistantGroupCounter = 0; // Counter for assistant groups

                                messages.forEach((message, index) => {
                                    const messageType = message.type;
                                    const key = message.message_id || `msg-${index}`;

                                    if (messageType === 'user') {
                                        // Finalize any existing assistant group
                                        if (currentGroup) {
                                            groupedMessages.push(currentGroup);
                                            currentGroup = null;
                                        }
                                        // Create a new user message group
                                        groupedMessages.push({ type: 'user', messages: [message], key });
                                    } else if (messageType === 'assistant' || messageType === 'tool') {
                                        // Check if we can add to existing assistant group (same agent)
                                        const canAddToExistingGroup = currentGroup &&
                                            currentGroup.type === 'assistant_group' &&
                                            (() => {
                                                // For assistant messages, always allow adding to current group
                                                // (Previously compared agent_id, but agents table was removed)
                                                if (messageType === 'assistant') {
                                                    return true;
                                                }
                                                // For tool messages, always add to current group
                                                return true;
                                            })();

                                        if (canAddToExistingGroup) {
                                            // Add to existing assistant group
                                            currentGroup.messages.push(message);
                                        } else {
                                            // Finalize any existing group
                                            if (currentGroup) {
                                                groupedMessages.push(currentGroup);
                                            }
                                            // Create a new assistant group with a group-level key
                                            assistantGroupCounter++;
                                            currentGroup = {
                                                type: 'assistant_group',
                                                messages: [message],
                                                key: `assistant-group-${assistantGroupCounter}`
                                            };
                                        }
                                    } else if (messageType !== 'status') {
                                        // For any other message types, finalize current group
                                        if (currentGroup) {
                                            groupedMessages.push(currentGroup);
                                            currentGroup = null;
                                        }
                                    }
                                });

                                // Finalize any remaining group
                                if (currentGroup) {
                                    groupedMessages.push(currentGroup);
                                }

                                // Merge consecutive assistant groups
                                const mergedGroups: MessageGroup[] = [];
                                let currentMergedGroup: MessageGroup | null = null;

                                groupedMessages.forEach((group, index) => {
                                    if (group.type === 'assistant_group') {
                                        if (currentMergedGroup && currentMergedGroup.type === 'assistant_group') {
                                            // Merge with the current group
                                            currentMergedGroup.messages.push(...group.messages);
                                        } else {
                                            // Finalize previous group if it exists
                                            if (currentMergedGroup) {
                                                mergedGroups.push(currentMergedGroup);
                                            }
                                            // Start new merged group
                                            currentMergedGroup = { ...group };
                                        }
                                    } else {
                                        // Finalize current merged group if it exists
                                        if (currentMergedGroup) {
                                            mergedGroups.push(currentMergedGroup);
                                            currentMergedGroup = null;
                                        }
                                        // Add non-assistant group as-is
                                        mergedGroups.push(group);
                                    }
                                });

                                // Finalize any remaining merged group
                                if (currentMergedGroup) {
                                    mergedGroups.push(currentMergedGroup);
                                }

                                // Use merged groups instead of original grouped messages
                                const finalGroupedMessages = mergedGroups;

                                // Handle streaming content - only add to existing group or create new one if needed
                                if (streamingTextContent) {
                                    const lastGroup = finalGroupedMessages.at(-1);
                                    if (!lastGroup || lastGroup.type === 'user') {
                                        // Create new assistant group for streaming content
                                        assistantGroupCounter++;
                                        finalGroupedMessages.push({
                                            type: 'assistant_group',
                                            messages: [{
                                                content: streamingTextContent,
                                                type: 'assistant',
                                                message_id: 'streamingTextContent',
                                                metadata: 'streamingTextContent',
                                                created_at: new Date().toISOString(),
                                                updated_at: new Date().toISOString(),
                                                is_llm_message: true,
                                                thread_id: 'streamingTextContent',
                                                sequence: Infinity,
                                            }],
                                            key: `assistant-group-${assistantGroupCounter}-streaming`
                                        });
                                    } else if (lastGroup.type === 'assistant_group') {
                                        // Only add streaming content if it's not already represented in the last message
                                        const lastMessage = lastGroup.messages[lastGroup.messages.length - 1];
                                        if (lastMessage.message_id !== 'streamingTextContent') {
                                            lastGroup.messages.push({
                                                content: streamingTextContent,
                                                type: 'assistant',
                                                message_id: 'streamingTextContent',
                                                metadata: 'streamingTextContent',
                                                created_at: new Date().toISOString(),
                                                updated_at: new Date().toISOString(),
                                                is_llm_message: true,
                                                thread_id: 'streamingTextContent',
                                                sequence: Infinity,
                                            });
                                        }
                                    }
                                }

                                return finalGroupedMessages.map((group, groupIndex) => {
                                    if (group.type === 'user') {
                                        const message = group.messages[0];
                                        const messageContent = (() => {
                                            try {
                                                const parsed = safeJsonParse<ParsedContent>(message.content, { content: message.content });
                                                return parsed.content || message.content;
                                            } catch {
                                                return message.content;
                                            }
                                        })();

                                        // In debug mode, display raw message content
                                        if (debugMode) {
                                            return (
                                                <div key={group.key} className="flex justify-end">
                                                    <div className="flex max-w-[85%] rounded-2xl bg-card px-4 py-3 break-words overflow-hidden">
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
                                            ? attachmentsMatch.map(match => {
                                                const pathMatch = match.match(/\[Uploaded File: (.*?)\]/);
                                                return pathMatch ? pathMatch[1] : null;
                                            }).filter(Boolean)
                                            : [];

                                        // Remove attachment info from the message content
                                        const cleanContent = messageContent.replace(/\[Uploaded File: .*?\]/g, '').trim();

                                        return (
                                            <div key={group.key} className="flex justify-end">
                                                <div className="flex max-w-[85%] rounded-3xl rounded-br-lg bg-muted border px-4 py-3 break-words overflow-hidden">
                                                    <div className="space-y-3 min-w-0 flex-1">
                                                        {cleanContent && (
                                                            <Markdown className="text-sm prose prose-sm dark:prose-invert chat-markdown max-w-none [&>:first-child]:mt-0 prose-headings:mt-3 break-words overflow-wrap-anywhere">{cleanContent}</Markdown>
                                                        )}

                                                        {/* Use the helper function to render user attachments */}
                                                        {renderAttachments(attachments as string[], sandboxId, project)}
                                                    </div>
                                                </div>
                                            </div>
                                        );
                                    } else if (group.type === 'assistant_group') {
                                        return (
                                            <div key={group.key} ref={groupIndex === groupedMessages.length - 1 ? latestMessageRef : null}>
                                                <div className="flex flex-col gap-2">
                                                    <div className="flex items-center">
                                                        <div className="rounded-md flex items-center justify-center">
                                                            <CheatcodeLogo size={16} />
                                                        </div>
                                                        <p className='ml-2 text-sm text-muted-foreground'>
                                                            cheatcode
                                                        </p>
                                                    </div>

                                                    {/* Message content - ALL messages in the group */}
                                                    <div className="flex max-w-[90%] text-sm break-words overflow-hidden">
                                                        <div className="space-y-2 min-w-0 flex-1">
                                                            {(() => {
                                                                // In debug mode, just show raw messages content
                                                                if (debugMode) {
                                                                    return group.messages.map((message, msgIndex) => {
                                                                        const msgKey = message.message_id || `raw-msg-${msgIndex}`;
                                                                        return (
                                                                            <div key={msgKey} className="mb-4">
                                                                                <div className="text-xs font-medium text-muted-foreground mb-1">
                                                                                    Type: {message.type} | ID: {message.message_id || 'no-id'}
                                                                                </div>
                                                                                <pre className="text-xs font-mono whitespace-pre-wrap overflow-x-auto p-2 border border-border rounded-md bg-muted/30">
                                                                                    {message.content}
                                                                                </pre>
                                                                                {message.metadata && message.metadata !== '{}' && (
                                                                                    <div className="mt-2">
                                                                                        <div className="text-xs font-medium text-muted-foreground mb-1">
                                                                                            Metadata:
                                                                                        </div>
                                                                                        <pre className="text-xs font-mono whitespace-pre-wrap overflow-x-auto p-2 border border-border rounded-md bg-muted/30">
                                                                                            {message.metadata}
                                                                                        </pre>
                                                                                    </div>
                                                                                )}
                                                                            </div>
                                                                        );
                                                                    });
                                                                }

                                                                const toolResultsMap = new Map<string | null, UnifiedMessage[]>();
                                                                group.messages.forEach(msg => {
                                                                    if (msg.type === 'tool') {
                                                                        const meta = safeJsonParse<ParsedMetadata>(msg.metadata, {});
                                                                        const assistantId = meta.assistant_message_id || null;
                                                                        if (!toolResultsMap.has(assistantId)) {
                                                                            toolResultsMap.set(assistantId, []);
                                                                        }
                                                                        toolResultsMap.get(assistantId)?.push(msg);
                                                                    }
                                                                });

                                                                const renderedToolResultIds = new Set<string>();
                                                                const elements: React.ReactNode[] = [];
                                                                let assistantMessageCount = 0; // Move this outside the loop

                                                                group.messages.forEach((message, msgIndex) => {
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
                                                                            <div key={msgKey} className={assistantMessageCount > 0 ? "mt-4" : ""}>
                                                                                <div className="prose prose-sm dark:prose-invert chat-markdown max-w-none [&>:first-child]:mt-0 prose-headings:mt-3 break-words overflow-hidden">
                                                                                    {renderedContent}
                                                                                </div>
                                                                            </div>
                                                                        );

                                                                        assistantMessageCount++;
                                                                    } else if (message.type === 'user') {
                                                                        // Render user messages
                                                                        const parsedContent = safeJsonParse<ParsedContent>(message.content, {});
                                                                        const content = parsedContent.content || message.content;
                                                                        
                                                                        if (!content) return;

                                                                        elements.push(
                                                                            <div key={msgKey} className="mt-4">
                                                                                <div className="flex items-start gap-3">
                                                                                    <div className="flex-shrink-0">
                                                                                        <div className="h-6 w-6 rounded-full bg-primary flex items-center justify-center text-primary-foreground text-xs font-medium">
                                                                                            U
                                                                                        </div>
                                                                                    </div>
                                                                                    <div className="prose prose-sm dark:prose-invert chat-markdown max-w-none [&>:first-child]:mt-0 prose-headings:mt-3 break-words overflow-hidden">
                                                                                        <Markdown>{typeof content === 'string' ? content : JSON.stringify(content)}</Markdown>
                                                                                    </div>
                                                                                </div>
                                                                            </div>
                                                                        );
                                                                    } else if (message.type === 'tool') {
                                                                        // Only show successful tool results that might be useful to users
                                                                        const content = message.content;
                                                                        if (!content) return;

                                                                        let toolData;
                                                                        try {
                                                                            toolData = typeof content === 'string' ? JSON.parse(content) : content;
                                                                        } catch {
                                                                            return; // Skip malformed tool results
                                                                        }

                                                                        // Skip failed tool executions - they're not useful to users
                                                                        if (toolData?.tool_execution?.result?.success === false) {
                                                                            return;
                                                                        }

                                                                        // Only show if there's meaningful output for users
                                                                        const output = toolData?.tool_execution?.result?.output;
                                                                        if (!output || output.includes('Failed to generate embedding')) {
                                                                            return;
                                                                        }

                                                                        elements.push(
                                                                            <div key={msgKey} className="mt-2">
                                                                                <div className="text-xs font-medium text-muted-foreground mb-1 flex items-center gap-2">
                                                                                    <div className="h-1.5 w-1.5 rounded-full bg-green-500"></div>
                                                                                    Tool Result
                                                                                </div>
                                                                                <div className="text-sm bg-green-50 dark:bg-green-950/20 rounded-md p-2 border border-green-200 dark:border-green-800">
                                                                                    {output}
                                                                                </div>
                                                                            </div>
                                                                        );
                                                                    } else if (message.type === 'status') {
                                                                        // Only show user-friendly status messages
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

                                                                        // Only show completion status messages
                                                                        if (statusType === 'tool_completed' && statusMessage) {
                                                                            elements.push(
                                                                                <div key={msgKey} className="mt-2">
                                                                                    <div className="text-xs font-medium text-muted-foreground mb-1 flex items-center gap-2">
                                                                                        <div className="h-1.5 w-1.5 rounded-full bg-blue-500"></div>
                                                                                        {statusMessage}
                                                                                    </div>
                                                                                </div>
                                                                            );
                                                                        }
                                                                    }
                                                                });

                                                                return elements;
                                                            })()}

                                                            {groupIndex === finalGroupedMessages.length - 1 && (streamHookStatus === 'streaming' || streamHookStatus === 'connecting') && (
                                                                <div className="mt-2">
                                                                    {(() => {
                                                                        // In debug mode, show raw streaming content
                                                                        if (debugMode && streamingTextContent) {
                                                                            return (
                                                                                <pre className="text-xs font-mono whitespace-pre-wrap overflow-x-auto p-2 border border-border rounded-md bg-muted/30">
                                                                                    {streamingTextContent}
                                                                                </pre>
                                                                            );
                                                                        }

                                                                        let detectedTag: string | null = null;
                                                                        let tagStartIndex = -1;
                                                                        if (streamingTextContent) {
                                                                            // First check for new format
                                                                            const functionCallsIndex = streamingTextContent.indexOf('<function_calls>');
                                                                            if (functionCallsIndex !== -1) {
                                                                                detectedTag = 'function_calls';
                                                                                tagStartIndex = functionCallsIndex;
                                                                            } else {
                                                                                // Fall back to old format detection
                                                                                for (const tag of HIDE_STREAMING_XML_TAGS) {
                                                                                    const openingTagPattern = `<${tag}`;
                                                                                    const index = streamingTextContent.indexOf(openingTagPattern);
                                                                                    if (index !== -1) {
                                                                                        detectedTag = tag;
                                                                                        tagStartIndex = index;
                                                                                        break;
                                                                                    }
                                                                                }
                                                                            }
                                                                        }


                                                                        const textToRender = streamingTextContent || '';
                                                                        const textBeforeTag = detectedTag ? textToRender.substring(0, tagStartIndex) : textToRender;
                                                                        const showCursor = (streamHookStatus === 'streaming' || streamHookStatus === 'connecting') && !detectedTag;
                                                                        const IconComponent = detectedTag && detectedTag !== 'function_calls' ? getToolIcon(detectedTag) : null;

                                                                        return (
                                                                            <>
                                                                                {textBeforeTag && (
                                                                                    <Markdown className="text-sm prose prose-sm dark:prose-invert chat-markdown max-w-none [&>:first-child]:mt-0 prose-headings:mt-3 break-words overflow-wrap-anywhere">{textBeforeTag}</Markdown>
                                                                                )}
                                                                                {showCursor && (
                                                                                    <span className="inline-block h-4 w-0.5 bg-primary ml-0.5 -mb-1 animate-pulse" />
                                                                                )}

                                                                                {detectedTag && detectedTag !== 'function_calls' && (
                                                                                    <div className="mt-2 mb-1">
                                                                                        <button
                                                                                            className="animate-shimmer inline-flex items-center gap-1.5 py-1 px-1 pr-1.5 text-xs font-medium text-primary bg-muted hover:bg-muted/80 rounded-md transition-colors cursor-pointer border border-primary/20"
                                                                                        >
                                                                                            <div className='border-2 bg-gradient-to-br from-neutral-200 to-neutral-300 dark:from-neutral-700 dark:to-neutral-800 flex items-center justify-center p-0.5 rounded-sm border-neutral-400/20 dark:border-neutral-600'>
                                                                                                <CircleDashed className="h-3.5 w-3.5 text-primary flex-shrink-0 animate-spin animation-duration-2000" />
                                                                                            </div>
                                                                                            <span className="font-mono text-xs text-primary">{getUserFriendlyToolName(detectedTag)}</span>
                                                                                        </button>
                                                                                    </div>
                                                                                )}

                                                                                {detectedTag === 'function_calls' && (
                                                                                    <div className="mt-2 mb-1">
                                                                                        <button
                                                                                            className="animate-shimmer inline-flex items-center gap-1.5 py-1 px-1 pr-1.5 text-xs font-medium text-primary bg-muted hover:bg-muted/80 rounded-md transition-colors cursor-pointer border border-primary/20"
                                                                                        >
                                                                                            <div className='border-2 bg-gradient-to-br from-neutral-200 to-neutral-300 dark:from-neutral-700 dark:to-neutral-800 flex items-center justify-center p-0.5 rounded-sm border-neutral-400/20 dark:border-neutral-600'>
                                                                                                <CircleDashed className="h-3.5 w-3.5 text-primary flex-shrink-0 animate-spin animation-duration-2000" />
                                                                                            </div>
                                                                                            <span className="font-mono text-xs text-primary">
                                                                                                {(() => {
                                                                                                    const extractedToolName = extractToolNameFromStream(streamingTextContent);
                                                                                                    return extractedToolName ? getUserFriendlyToolName(extractedToolName) : 'Using Tool...';
                                                                                                })()}
                                                                                            </span>
                                                                                        </button>
                                                                                    </div>
                                                                                )}

                                                                                {streamingToolCall && !detectedTag && (
                                                                                    <div className="mt-2 mb-1">
                                                                                        {(() => {
                                                                                            const toolName = streamingToolCall.name || streamingToolCall.xml_tag_name || 'Tool';
                                                                                            const IconComponent = getToolIcon(toolName);
                                                                                            const paramDisplay = extractPrimaryParam(toolName, streamingToolCall.arguments || '');
                                                                                            return (
                                                                                                <button
                                                                                                    className="animate-shimmer inline-flex items-center gap-1.5 py-1 px-1 pr-1.5 text-xs font-medium text-primary bg-muted hover:bg-muted/80 rounded-md transition-colors cursor-pointer border border-primary/20"
                                                                                                >
                                                                                                    <div className='border-2 bg-gradient-to-br from-neutral-200 to-neutral-300 dark:from-neutral-700 dark:to-neutral-800 flex items-center justify-center p-0.5 rounded-sm border-neutral-400/20 dark:border-neutral-600'>
                                                                                                        <CircleDashed className="h-3.5 w-3.5 text-primary flex-shrink-0 animate-spin animation-duration-2000" />
                                                                                                    </div>
                                                                                                    <span className="font-mono text-xs text-primary">{toolName}</span>
                                                                                                    {paramDisplay && <span className="ml-1 text-primary/70 truncate max-w-[200px]" title={paramDisplay}>{paramDisplay}</span>}
                                                                                                </button>
                                                                                            );
                                                                                        })()}
                                                                                    </div>
                                                                                )}
                                                                            </>
                                                                        );
                                                                    })()}
                                                                </div>
                                                            )}


                                                                                            </div>
                                                    </div>
                                                </div>
                                            </div>
                                        );
                                    }
                                    return null;
                                });
                            })()}
                            {((agentState.status === 'running' || agentState.status === 'connecting') && !streamingTextContent &&
                                (messages.length === 0 || messages[messages.length - 1].type === 'user')) && (
                                    <div ref={latestMessageRef} className='w-full h-22 rounded'>
                                        <div className="flex flex-col gap-2">
                                            {/* Logo positioned above the loader */}
                                            <div className="flex items-center">
                                                <div className="rounded-md flex items-center justify-center">
                                                    <CheatcodeLogo size={16} />
                                                </div>
                                                <p className='ml-2 text-sm text-muted-foreground'>cheatcode</p>
                                            </div>

                                            {/* Loader content */}
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

            {/* Scroll to bottom button */}
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
