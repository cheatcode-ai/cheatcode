import { useMemo } from 'react';
import { UnifiedMessage } from '@/components/thread/types';

export type MessageGroup = {
  type: 'user' | 'assistant_group';
  messages: UnifiedMessage[];
  key: string;
};

interface UseMessageGroupingOptions {
  messages: UnifiedMessage[];
  streamingTextContent?: string;
}

export function useMessageGrouping({ messages, streamingTextContent }: UseMessageGroupingOptions): MessageGroup[] {
  return useMemo(() => {
    const groupedMessages: MessageGroup[] = [];
    let currentGroup: MessageGroup | null = null;
    let assistantGroupCounter = 0;

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
        // Check if we can add to existing assistant group
        const canAddToExistingGroup = currentGroup &&
          currentGroup.type === 'assistant_group';

        if (canAddToExistingGroup && currentGroup) {
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

    groupedMessages.forEach((group) => {
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

    // Handle streaming content
    if (streamingTextContent) {
      const lastGroup = mergedGroups.at(-1);
      if (!lastGroup || lastGroup.type === 'user') {
        // Create new assistant group for streaming content
        assistantGroupCounter++;
        mergedGroups.push({
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
        // Only add streaming content if not already represented
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

    return mergedGroups;
  }, [messages, streamingTextContent]);
}
