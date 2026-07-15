import type {
  AgentRunId,
  LogicalModelId,
  ProjectId,
  ProjectMode,
  ThreadId,
  UIMessagePart,
  UserId,
} from "@cheatcode/types";
import type { ThreadLaunchIntent } from "./schema";

export interface CreateProjectInput {
  defaultModel?: LogicalModelId;
  importRepoUrl?: string;
  masterInstructions?: string;
  mode: ProjectMode;
  name: string;
  userId: UserId;
}

export interface ProjectSummaryRecord {
  archiveAfter: Date | null;
  archivedPendingAction: boolean;
  createdAt: Date;
  defaultModel: LogicalModelId | null;
  id: ProjectId;
  importRepoUrl: string | null;
  masterInstructions: string | null;
  mode: ProjectMode;
  name: string;
  overQuota: boolean;
  readOnly: boolean;
  updatedAt: Date;
  workspaceSlug: string;
}

export interface TimestampPageCursor {
  at: string;
  id: string;
}

export type TimestampPageRecord<T> = T & { pageCursorAt: string };

export type BeginProjectDeletionResult =
  | { type: "active-run" }
  | { type: "not-found" }
  | { type: "cleanup-completed" }
  | { type: "cleanup-required"; workspaceSlug: string };

export type SoftDeleteThreadResult = "active-run" | "deleted" | "not-found";

export interface UpdateProjectInput {
  defaultModel?: LogicalModelId | null;
  importRepoUrl?: null | string;
  masterInstructions?: string | null;
  name?: string;
  projectId: ProjectId;
  userId: UserId;
}

export interface ThreadRecord {
  activeRunId: string | null;
  createdAt: Date;
  id: ThreadId;
  launchIntent: ThreadLaunchIntent | null;
  projectId: ProjectId | null;
  title: string | null;
  updatedAt: Date;
}

export interface MessageRecord {
  agentRunId: string | null;
  createdAt: Date;
  id: string;
  parts: UIMessagePart[];
  role: string;
  threadId: ThreadId;
}

export interface ThreadContextMessageRecord extends MessageRecord {
  serializedBytes: number;
}

export interface CreateMessageInput {
  agentRunId?: AgentRunId;
  parts: UIMessagePart[];
  role: "assistant" | "system" | "tool" | "user";
  threadId: ThreadId;
  userId: UserId;
}

export interface ProjectWriteState {
  archiveAfter: Date | null;
  archivedPendingAction: boolean;
  overQuota: boolean;
  readOnly: boolean;
}
