'use client';

import { Markdown } from '@/components/ui/markdown';
import { getUserFriendlyToolName } from '@/components/thread/utils';
import { extractToolNameFromStream } from '@/components/thread/tool-parsing-utils';

// Tags whose raw XML should be hidden during streaming
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

interface StreamingContentProps {
  streamingTextContent: string;
  streamHookStatus: string;
  debugMode?: boolean;
}

export function StreamingContent({
  streamingTextContent,
  streamHookStatus,
  debugMode = false,
}: StreamingContentProps) {
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
    const functionCallsIndex = streamingTextContent.indexOf('<function_calls>');
    if (functionCallsIndex !== -1) {
      detectedTag = 'function_calls';
      tagStartIndex = functionCallsIndex;
    } else {
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

  return (
    <>
      {textBeforeTag && (
        <Markdown className="text-sm prose prose-sm dark:prose-invert chat-markdown max-w-none [&>:first-child]:mt-0 prose-headings:mt-3 break-words overflow-wrap-anywhere text-zinc-300 leading-relaxed tracking-wide font-light">
          {textBeforeTag}
        </Markdown>
      )}
      {showCursor && (
        <span className="inline-block h-4 w-1.5 bg-white ml-0.5 -mb-1 animate-pulse" />
      )}
      {detectedTag && (
        <div className="mt-4 mb-2">
          <div className="inline-flex items-center gap-2 text-zinc-500">
            <span className="font-mono text-[10px] uppercase tracking-widest">
              {detectedTag === 'function_calls'
                ? (extractToolNameFromStream(streamingTextContent) || 'PROCESSING...')
                : getUserFriendlyToolName(detectedTag)}...
            </span>
          </div>
        </div>
      )}
    </>
  );
}
