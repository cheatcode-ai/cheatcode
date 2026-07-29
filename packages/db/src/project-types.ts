import type {
  AgentRunId,
  LogicalModelId,
  ProjectId,
  ThreadId,
  UIMessagePart,
  UserId,
} from "@cheatcode/types";
import type { ProjectMode } from "@cheatcode/types/api";
import type { ThreadLaunchIntent } from "./schema";

export interface CreateProjectInput {
  defaultModel?: LogicalModelId;
  importRepoUrl?: string;
  mode: ProjectMode;
  name: string;
  userId: UserId;
}

export interface ProjectRecord {
  archiveAfter: Date | null;
  createdAt: Date;
  defaultModel: LogicalModelId | null;
  id: ProjectId;
  importRepoUrl: string | null;
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
  segment?: number;
}

export type TimestampPageItem<T> = T & { pageCursorAt: string };

export type BeginProjectDeletionResult =
  | { kind: "active-run" }
  | { kind: "not-found" }
  | { deletedAt: Date; kind: "cleanup-required"; workspaceSlug: string };

export type BeginThreadDeletionResult =
  | { kind: "active-run" }
  | { kind: "not-found" }
  | { deletedAt: Date; projectId: ProjectId | null; kind: "cleanup-required" };

export interface UpdateProjectInput {
  defaultModel?: LogicalModelId | null;
  importRepoUrl?: null | string;
  name?: string;
  projectId: ProjectId;
  userId: UserId;
}

export interface ThreadRecord {
  activeRunId: string | null;
  createdAt: Date;
  id: ThreadId;
  latestModelId: LogicalModelId | null;
  launchIntent: ThreadLaunchIntent | null;
  projectId: ProjectId | null;
  title: string | null;
  updatedAt: Date;
}

export interface MessageRecord {
  agentRunId: string | null;
  agentRunSegment: number;
  agentRunSegmentFinal: boolean;
  createdAt: Date;
  id: string;
  parts: UIMessagePart[];
  role: "assistant" | "user";
  threadId: ThreadId;
}

export interface ThreadContextMessageRecord extends MessageRecord {
  serializedBytes: number;
}

export interface CreateMessageInput {
  agentRunId?: AgentRunId;
  agentRunSegment?: number;
  agentRunSegmentFinal?: boolean;
  createdAt?: Date;
  parts: UIMessagePart[];
  role: "assistant" | "user";
  threadId: ThreadId;
  userId: UserId;
}

export interface ProjectWriteState {
  archiveAfter: Date | null;
  overQuota: boolean;
  readOnly: boolean;
}
