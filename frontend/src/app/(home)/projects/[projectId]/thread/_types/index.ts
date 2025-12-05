// Re-export types from the shared thread types
export type {
  UnifiedMessage,
  ParsedMetadata,
  ThreadParams,
  ParsedContent,
  ApiMessageType,
} from '@/components/thread/types';

// Re-export other needed types
export type { Project } from '@/lib/api';

export interface StreamingToolCall {
  id?: string;
  name?: string;
  arguments?: string;
  index?: number;
  xml_tag_name?: string;
}

export interface BillingData {
  currentUsage?: number;
  limit?: number;
  message?: string;
  accountId?: string | null;
}

export type { AgentStatus } from '@/hooks/useAgentStateMachine'; 