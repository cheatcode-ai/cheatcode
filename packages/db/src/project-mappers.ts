import type { LogicalModelId, ProjectMode, UIMessagePart } from "@cheatcode/types";
import {
  LogicalModelIdSchema,
  ProjectId as toProjectId,
  ThreadId as toThreadId,
} from "@cheatcode/types";
import { and, eq, isNull } from "drizzle-orm";
import type { Database } from "./client";
import type {
  CreateProjectInput,
  MessageRecord,
  ProjectSummaryRecord,
  ThreadRecord,
  UpdateProjectInput,
} from "./project-types";
import {
  messages,
  type ProjectSettings,
  projects,
  type ThreadLaunchIntent,
  threads,
} from "./schema";

export async function updatedProjectSettings(
  db: Database,
  input: UpdateProjectInput,
): Promise<ProjectSettings | null> {
  if (input.defaultModel === undefined && input.importRepoUrl === undefined) {
    return null;
  }
  const row = await db.query.projects.findFirst({
    columns: { settings: true },
    where: and(
      eq(projects.id, input.projectId),
      eq(projects.userId, input.userId),
      isNull(projects.deletedAt),
    ),
  });
  if (!row) {
    return {};
  }
  return nextProjectSettings(row.settings, input);
}

function nextProjectSettings(
  current: ProjectSettings,
  input: Pick<UpdateProjectInput, "defaultModel" | "importRepoUrl">,
): ProjectSettings {
  let settings = { ...current };
  if (input.defaultModel !== undefined) {
    if (input.defaultModel === null) {
      const { defaultModel: _defaultModel, ...settingsWithoutModel } = settings;
      settings = settingsWithoutModel;
    } else {
      settings.defaultModel = input.defaultModel;
    }
  }
  if (input.importRepoUrl !== undefined) {
    if (input.importRepoUrl === null) {
      const { importRepoUrl: _importRepoUrl, ...settingsWithoutRepo } = settings;
      settings = settingsWithoutRepo;
    } else {
      settings.importRepoUrl = input.importRepoUrl;
    }
  }
  return settings;
}

export function initialProjectSettings(
  input: Pick<CreateProjectInput, "defaultModel" | "importRepoUrl">,
): ProjectSettings | null {
  const settings: ProjectSettings = {};
  if (input.defaultModel !== undefined) {
    settings.defaultModel = input.defaultModel;
  }
  if (input.importRepoUrl !== undefined) {
    settings.importRepoUrl = input.importRepoUrl;
  }
  return Object.keys(settings).length > 0 ? settings : null;
}

export function threadReturningColumns() {
  return {
    activeRunId: threads.activeRunId,
    createdAt: threads.createdAt,
    id: threads.id,
    latestModelId: threads.latestModelId,
    launchIntent: threads.launchIntent,
    projectId: threads.projectId,
    title: threads.title,
    updatedAt: threads.updatedAt,
  };
}

export function messageReturningColumns() {
  return {
    agentRunId: messages.agentRunId,
    agentRunSegment: messages.agentRunSegment,
    agentRunSegmentFinal: messages.agentRunSegmentFinal,
    createdAt: messages.createdAt,
    id: messages.id,
    parts: messages.parts,
    role: messages.role,
    threadId: messages.threadId,
  };
}

export function projectSummaryFromRow(row: {
  archiveAfter: Date | null;
  createdAt: Date;
  id: string;
  mode: ProjectMode;
  name: string;
  overQuota: boolean;
  settings: ProjectSettings;
  updatedAt: Date;
  workspaceSlug: string;
}): ProjectSummaryRecord {
  return {
    archiveAfter: row.archiveAfter,
    createdAt: row.createdAt,
    defaultModel: row.settings.defaultModel ?? null,
    id: toProjectId(row.id),
    importRepoUrl: row.settings.importRepoUrl ?? null,
    mode: row.mode,
    name: row.name,
    overQuota: row.overQuota,
    readOnly: row.overQuota,
    updatedAt: row.updatedAt,
    workspaceSlug: row.workspaceSlug,
  };
}

export function threadFromRow(row: {
  activeRunId: string | null;
  createdAt: Date;
  id: string;
  latestModelId: string | null;
  launchIntent: ThreadLaunchIntent | null;
  projectId: string | null;
  title: string | null;
  updatedAt: Date;
}): ThreadRecord {
  return {
    activeRunId: row.activeRunId,
    createdAt: row.createdAt,
    id: toThreadId(row.id),
    latestModelId: parseLogicalModelId(row.latestModelId),
    launchIntent: row.launchIntent,
    projectId: row.projectId ? toProjectId(row.projectId) : null,
    title: row.title,
    updatedAt: row.updatedAt,
  };
}

function parseLogicalModelId(value: string | null): LogicalModelId | null {
  const parsed = LogicalModelIdSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function messageFromRow(row: {
  agentRunId: string | null;
  agentRunSegment: number;
  agentRunSegmentFinal: boolean;
  createdAt: Date;
  id: string;
  parts: UIMessagePart[];
  role: "assistant" | "user";
  threadId: string;
}): MessageRecord {
  return {
    agentRunId: row.agentRunId,
    agentRunSegment: row.agentRunSegment,
    agentRunSegmentFinal: row.agentRunSegmentFinal,
    createdAt: row.createdAt,
    id: row.id,
    parts: row.parts,
    role: row.role,
    threadId: toThreadId(row.threadId),
  };
}
