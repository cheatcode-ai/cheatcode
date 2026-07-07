import type { AgentRunId, ProjectId, ThreadId, UIMessagePart, UserId } from "@cheatcode/types";
import { ProjectId as toProjectId, ThreadId as toThreadId } from "@cheatcode/types";
import { and, asc, desc, eq, isNotNull, isNull, sql } from "drizzle-orm";
import type { Database } from "./client";
import {
  type DirectoryBackupHandle,
  messages,
  type ProjectSettings,
  projects,
  type ThreadLaunchIntent,
  threads,
} from "./schema";

export interface CreateProjectInput {
  budgetCapUsd?: number;
  defaultModel?: string;
  importRepoUrl?: string;
  masterInstructions?: string;
  mode: string;
  name: string;
  userId: UserId;
}

export interface ProjectSummaryRecord {
  archiveAfter: Date | null;
  archivedPendingAction: boolean;
  budgetCapUsd: number | null;
  createdAt: Date;
  defaultModel: string | null;
  id: ProjectId;
  importRepoUrl: string | null;
  masterInstructions: string | null;
  mode: string;
  name: string;
  overQuota: boolean;
  readOnly: boolean;
  updatedAt: Date;
}

export interface UpdateProjectInput {
  budgetCapUsd?: null | number;
  defaultModel?: null | string;
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

export interface CreateMessageInput {
  agentRunId?: AgentRunId;
  parts: UIMessagePart[];
  role: "assistant" | "system" | "tool" | "user";
  threadId: ThreadId;
  userId: UserId;
}

export interface SandboxProjectInput {
  mode: string;
  name: string;
  sandboxId: string;
  userId: UserId;
}

export interface SandboxProjectRecord {
  containerBackup: DirectoryBackupHandle | null;
  id: ProjectId;
}

export interface SaveSandboxBackupInput {
  backup: DirectoryBackupHandle;
  sandboxId: string;
  userId: UserId;
}

export interface ProjectSandboxAttachInput {
  projectId: ProjectId;
  sandboxId: string;
  userId: UserId;
}

export interface ProjectSandboxAttachWithLimitInput extends ProjectSandboxAttachInput {
  maxConcurrentSandboxes: number;
}

export interface ProjectWriteState {
  archiveAfter: Date | null;
  archivedPendingAction: boolean;
  overQuota: boolean;
  readOnly: boolean;
}

export type ProjectSandboxAttachResult =
  | {
      sandboxCount: number;
      sandboxId: string;
      type: "attached" | "existing";
    }
  | {
      limit: number;
      sandboxCount: number;
      type: "limit-reached";
    }
  | {
      type: "project-not-found";
    };

export interface ProjectBackupInput {
  backup: DirectoryBackupHandle;
  projectId: ProjectId;
  userId: UserId;
}

export async function listProjects(db: Database, userId: UserId): Promise<ProjectSummaryRecord[]> {
  const rows = await db.query.projects.findMany({
    columns: {
      archiveAfter: true,
      archivedPendingAction: true,
      createdAt: true,
      id: true,
      masterInstructions: true,
      mode: true,
      name: true,
      overQuota: true,
      settings: true,
      updatedAt: true,
    },
    orderBy: [desc(projects.updatedAt)],
    where: and(eq(projects.userId, userId), isNull(projects.deletedAt)),
  });
  return rows.map(projectSummaryFromRow);
}

export async function countActiveProjects(db: Database, userId: UserId): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(projects)
    .where(and(eq(projects.userId, userId), isNull(projects.deletedAt)));
  return row?.count ?? 0;
}

export async function countActiveSandboxProjects(db: Database, userId: UserId): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(projects)
    .where(
      and(eq(projects.userId, userId), isNull(projects.deletedAt), isNotNull(projects.sandboxId)),
    );
  return row?.count ?? 0;
}

export async function getProject(
  db: Database,
  input: { projectId: ProjectId; userId: UserId },
): Promise<ProjectSummaryRecord | null> {
  const row = await db.query.projects.findFirst({
    columns: {
      archiveAfter: true,
      archivedPendingAction: true,
      createdAt: true,
      id: true,
      masterInstructions: true,
      mode: true,
      name: true,
      overQuota: true,
      settings: true,
      updatedAt: true,
    },
    where: and(
      eq(projects.id, input.projectId),
      eq(projects.userId, input.userId),
      isNull(projects.deletedAt),
    ),
  });
  return row ? projectSummaryFromRow(row) : null;
}

export async function createProject(
  db: Database,
  input: CreateProjectInput,
): Promise<ProjectSummaryRecord> {
  const settings = initialProjectSettings(input);
  const rows = await db
    .insert(projects)
    .values({
      masterInstructions: input.masterInstructions,
      mode: input.mode,
      name: input.name,
      ...(settings ? { settings } : {}),
      userId: input.userId,
    })
    .returning({
      archiveAfter: projects.archiveAfter,
      archivedPendingAction: projects.archivedPendingAction,
      createdAt: projects.createdAt,
      id: projects.id,
      masterInstructions: projects.masterInstructions,
      mode: projects.mode,
      name: projects.name,
      overQuota: projects.overQuota,
      settings: projects.settings,
      updatedAt: projects.updatedAt,
    });
  const row = rows[0];
  if (!row) {
    throw new Error("Failed to create project");
  }
  return projectSummaryFromRow(row);
}

export async function updateProject(
  db: Database,
  input: UpdateProjectInput,
): Promise<ProjectSummaryRecord | null> {
  const settings = await updatedProjectSettings(db, input);
  const rows = await db
    .update(projects)
    .set({
      ...(input.masterInstructions !== undefined
        ? { masterInstructions: input.masterInstructions }
        : {}),
      ...(input.name ? { name: input.name } : {}),
      ...(settings ? { settings } : {}),
      updatedAt: sql`now()`,
    })
    .where(
      and(
        eq(projects.id, input.projectId),
        eq(projects.userId, input.userId),
        isNull(projects.deletedAt),
      ),
    )
    .returning({
      archiveAfter: projects.archiveAfter,
      archivedPendingAction: projects.archivedPendingAction,
      createdAt: projects.createdAt,
      id: projects.id,
      masterInstructions: projects.masterInstructions,
      mode: projects.mode,
      name: projects.name,
      overQuota: projects.overQuota,
      settings: projects.settings,
      updatedAt: projects.updatedAt,
    });
  const row = rows[0];
  return row ? projectSummaryFromRow(row) : null;
}

export async function softDeleteProject(
  db: Database,
  input: { projectId: ProjectId; userId: UserId },
): Promise<boolean> {
  const rows = await db
    .update(projects)
    .set({ deletedAt: sql`now()`, updatedAt: sql`now()` })
    .where(
      and(
        eq(projects.id, input.projectId),
        eq(projects.userId, input.userId),
        isNull(projects.deletedAt),
      ),
    )
    .returning({ id: projects.id });
  return rows.length > 0;
}

export async function listProjectThreads(
  db: Database,
  input: { limit?: number; projectId: ProjectId; userId: UserId },
): Promise<ThreadRecord[]> {
  const rows = await db.query.threads.findMany({
    columns: {
      activeRunId: true,
      createdAt: true,
      id: true,
      launchIntent: true,
      projectId: true,
      title: true,
      updatedAt: true,
    },
    orderBy: [desc(threads.updatedAt)],
    where: and(
      eq(threads.projectId, input.projectId),
      eq(threads.userId, input.userId),
      isNull(threads.deletedAt),
    ),
    ...(input.limit === undefined ? {} : { limit: input.limit }),
  });
  return rows.map(threadFromRow);
}

export async function createThread(
  db: Database,
  input: {
    launchIntent?: ThreadLaunchIntent;
    projectId?: ProjectId | null;
    title?: string;
    userId: UserId;
  },
): Promise<ThreadRecord> {
  const rows = await db
    .insert(threads)
    .values({
      ...(input.projectId ? { projectId: input.projectId } : {}),
      ...(input.launchIntent ? { launchIntent: input.launchIntent } : {}),
      ...(input.title ? { title: input.title } : {}),
      userId: input.userId,
    })
    .returning(threadReturningColumns());
  const row = rows[0];
  if (!row) {
    throw new Error("Failed to create thread");
  }
  return threadFromRow(row);
}

export async function updateThread(
  db: Database,
  input: { threadId: ThreadId; title: string; userId: UserId },
): Promise<ThreadRecord | null> {
  const rows = await db
    .update(threads)
    .set({ title: input.title, updatedAt: sql`now()` })
    .where(
      and(
        eq(threads.id, input.threadId),
        eq(threads.userId, input.userId),
        isNull(threads.deletedAt),
      ),
    )
    .returning(threadReturningColumns());
  const row = rows[0];
  return row ? threadFromRow(row) : null;
}

export async function softDeleteThread(
  db: Database,
  input: { threadId: ThreadId; userId: UserId },
): Promise<boolean> {
  const rows = await db
    .update(threads)
    .set({ deletedAt: sql`now()`, updatedAt: sql`now()` })
    .where(
      and(
        eq(threads.id, input.threadId),
        eq(threads.userId, input.userId),
        isNull(threads.deletedAt),
      ),
    )
    .returning({ id: threads.id });
  return rows.length > 0;
}

export async function getThread(
  db: Database,
  input: { threadId: ThreadId; userId: UserId },
): Promise<ThreadRecord | null> {
  const row = await db.query.threads.findFirst({
    columns: {
      activeRunId: true,
      createdAt: true,
      id: true,
      launchIntent: true,
      projectId: true,
      title: true,
      updatedAt: true,
    },
    where: and(
      eq(threads.id, input.threadId),
      eq(threads.userId, input.userId),
      isNull(threads.deletedAt),
    ),
  });
  return row ? threadFromRow(row) : null;
}

export async function listThreadMessages(
  db: Database,
  input: { threadId: ThreadId; userId: UserId },
): Promise<MessageRecord[]> {
  const rows = await db.query.messages.findMany({
    columns: {
      agentRunId: true,
      createdAt: true,
      id: true,
      parts: true,
      role: true,
      threadId: true,
    },
    orderBy: [asc(messages.createdAt)],
    where: and(eq(messages.threadId, input.threadId), eq(messages.userId, input.userId)),
  });
  return rows.map(messageFromRow);
}

export async function createThreadMessage(
  db: Database,
  input: CreateMessageInput,
): Promise<MessageRecord> {
  return db.transaction(async (tx) => {
    const rows = await tx
      .insert(messages)
      .values({
        ...(input.agentRunId ? { agentRunId: input.agentRunId } : {}),
        parts: input.parts,
        role: input.role,
        threadId: input.threadId,
        userId: input.userId,
      })
      .returning(messageReturningColumns());
    const row = rows[0];
    if (!row) {
      throw new Error("Failed to create thread message");
    }
    await tx
      .update(threads)
      .set({ updatedAt: sql`now()` })
      .where(and(eq(threads.id, input.threadId), eq(threads.userId, input.userId)));
    return messageFromRow(row);
  });
}

export async function hasProjectAccess(
  db: Database,
  input: { projectId: ProjectId; userId: UserId },
): Promise<boolean> {
  const row = await db.query.projects.findFirst({
    columns: { id: true },
    where: and(
      eq(projects.id, input.projectId),
      eq(projects.userId, input.userId),
      isNull(projects.deletedAt),
    ),
  });
  return row !== undefined;
}

export async function getProjectWriteState(
  db: Database,
  input: { projectId: ProjectId; userId: UserId },
): Promise<ProjectWriteState | null> {
  const row = await db.query.projects.findFirst({
    columns: {
      archiveAfter: true,
      archivedPendingAction: true,
      overQuota: true,
    },
    where: and(
      eq(projects.id, input.projectId),
      eq(projects.userId, input.userId),
      isNull(projects.deletedAt),
    ),
  });
  return row
    ? {
        archiveAfter: row.archiveAfter,
        archivedPendingAction: row.archivedPendingAction,
        overQuota: row.overQuota,
        readOnly: row.archivedPendingAction || row.overQuota,
      }
    : null;
}

export async function ensureSandboxProject(
  db: Database,
  input: SandboxProjectInput,
): Promise<SandboxProjectRecord> {
  const existing = await db.query.projects.findFirst({
    columns: { containerBackup: true, id: true },
    where: and(
      eq(projects.userId, input.userId),
      eq(projects.sandboxId, input.sandboxId),
      isNull(projects.deletedAt),
    ),
  });

  if (existing) {
    return {
      containerBackup: existing.containerBackup,
      id: toProjectId(existing.id),
    };
  }

  const rows = await db
    .insert(projects)
    .values({
      mode: input.mode,
      name: input.name,
      sandboxId: input.sandboxId,
      userId: input.userId,
    })
    .returning({ containerBackup: projects.containerBackup, id: projects.id });

  const row = rows[0];
  if (!row) {
    throw new Error("Failed to create sandbox project");
  }

  return {
    containerBackup: row.containerBackup,
    id: toProjectId(row.id),
  };
}

export async function saveSandboxProjectBackup(
  db: Database,
  input: SaveSandboxBackupInput,
): Promise<void> {
  await db
    .update(projects)
    .set({
      containerBackup: input.backup,
      updatedAt: sql`now()`,
    })
    .where(
      and(
        eq(projects.userId, input.userId),
        eq(projects.sandboxId, input.sandboxId),
        isNull(projects.deletedAt),
      ),
    );
}

export async function attachProjectSandbox(
  db: Database,
  input: ProjectSandboxAttachInput,
): Promise<void> {
  await db
    .update(projects)
    .set({
      sandboxId: input.sandboxId,
      updatedAt: sql`now()`,
    })
    .where(
      and(
        eq(projects.id, input.projectId),
        eq(projects.userId, input.userId),
        isNull(projects.deletedAt),
      ),
    );
}

export async function attachProjectSandboxWithLimit(
  db: Database,
  input: ProjectSandboxAttachWithLimitInput,
): Promise<ProjectSandboxAttachResult> {
  const project = await db.query.projects.findFirst({
    columns: { sandboxId: true },
    where: and(
      eq(projects.id, input.projectId),
      eq(projects.userId, input.userId),
      isNull(projects.deletedAt),
    ),
  });
  if (!project) {
    return { type: "project-not-found" };
  }

  if (project.sandboxId) {
    return {
      sandboxCount: await countActiveSandboxProjects(db, input.userId),
      sandboxId: project.sandboxId,
      type: "existing",
    };
  }

  const sandboxCount = await countActiveSandboxProjects(db, input.userId);
  if (sandboxCount >= input.maxConcurrentSandboxes) {
    return {
      limit: input.maxConcurrentSandboxes,
      sandboxCount,
      type: "limit-reached",
    };
  }

  await attachProjectSandbox(db, input);
  return {
    sandboxCount: sandboxCount + 1,
    sandboxId: input.sandboxId,
    type: "attached",
  };
}

export async function getSandboxProjectById(
  db: Database,
  input: { projectId: ProjectId; userId: UserId },
): Promise<SandboxProjectRecord | null> {
  const row = await db.query.projects.findFirst({
    columns: { containerBackup: true, id: true },
    where: and(
      eq(projects.id, input.projectId),
      eq(projects.userId, input.userId),
      isNull(projects.deletedAt),
    ),
  });
  return row
    ? {
        containerBackup: row.containerBackup,
        id: toProjectId(row.id),
      }
    : null;
}

export async function saveProjectBackupById(
  db: Database,
  input: ProjectBackupInput,
): Promise<void> {
  await db
    .update(projects)
    .set({
      containerBackup: input.backup,
      updatedAt: sql`now()`,
    })
    .where(
      and(
        eq(projects.id, input.projectId),
        eq(projects.userId, input.userId),
        isNull(projects.deletedAt),
      ),
    );
}

async function updatedProjectSettings(
  db: Database,
  input: UpdateProjectInput,
): Promise<ProjectSettings | null> {
  if (
    input.defaultModel === undefined &&
    input.budgetCapUsd === undefined &&
    input.importRepoUrl === undefined
  ) {
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

export function nextProjectSettings(
  current: ProjectSettings,
  input: Pick<UpdateProjectInput, "budgetCapUsd" | "defaultModel" | "importRepoUrl">,
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
  if (input.budgetCapUsd !== undefined) {
    if (input.budgetCapUsd === null) {
      const { budgetCapUsd: _budgetCapUsd, ...settingsWithoutBudget } = settings;
      settings = settingsWithoutBudget;
    } else {
      settings.budgetCapUsd = input.budgetCapUsd;
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

function initialProjectSettings(
  input: Pick<CreateProjectInput, "budgetCapUsd" | "defaultModel" | "importRepoUrl">,
) {
  const settings: ProjectSettings = {};
  if (input.budgetCapUsd !== undefined) {
    settings.budgetCapUsd = input.budgetCapUsd;
  }
  if (input.defaultModel !== undefined) {
    settings.defaultModel = input.defaultModel;
  }
  if (input.importRepoUrl !== undefined) {
    settings.importRepoUrl = input.importRepoUrl;
  }
  return Object.keys(settings).length > 0 ? settings : null;
}

function threadReturningColumns() {
  return {
    activeRunId: threads.activeRunId,
    createdAt: threads.createdAt,
    id: threads.id,
    launchIntent: threads.launchIntent,
    projectId: threads.projectId,
    title: threads.title,
    updatedAt: threads.updatedAt,
  };
}

function messageReturningColumns() {
  return {
    agentRunId: messages.agentRunId,
    createdAt: messages.createdAt,
    id: messages.id,
    parts: messages.parts,
    role: messages.role,
    threadId: messages.threadId,
  };
}

function projectSummaryFromRow(row: {
  archiveAfter: Date | null;
  archivedPendingAction: boolean;
  masterInstructions: string | null;
  createdAt: Date;
  id: string;
  mode: string;
  name: string;
  overQuota: boolean;
  settings: ProjectSettings;
  updatedAt: Date;
}): ProjectSummaryRecord {
  return {
    archiveAfter: row.archiveAfter,
    archivedPendingAction: row.archivedPendingAction,
    budgetCapUsd: row.settings.budgetCapUsd ?? null,
    createdAt: row.createdAt,
    defaultModel: row.settings.defaultModel ?? null,
    id: toProjectId(row.id),
    importRepoUrl: row.settings.importRepoUrl ?? null,
    masterInstructions: row.masterInstructions,
    mode: row.mode,
    name: row.name,
    overQuota: row.overQuota,
    readOnly: row.archivedPendingAction || row.overQuota,
    updatedAt: row.updatedAt,
  };
}

function threadFromRow(row: {
  activeRunId: string | null;
  createdAt: Date;
  id: string;
  launchIntent: ThreadLaunchIntent | null;
  projectId: string | null;
  title: string | null;
  updatedAt: Date;
}): ThreadRecord {
  return {
    activeRunId: row.activeRunId,
    createdAt: row.createdAt,
    id: toThreadId(row.id),
    launchIntent: row.launchIntent,
    projectId: row.projectId ? toProjectId(row.projectId) : null,
    title: row.title,
    updatedAt: row.updatedAt,
  };
}

export function messageFromRow(row: {
  agentRunId: string | null;
  createdAt: Date;
  id: string;
  parts: UIMessagePart[];
  role: string;
  threadId: string;
}): MessageRecord {
  return {
    agentRunId: row.agentRunId,
    createdAt: row.createdAt,
    id: row.id,
    parts: row.parts,
    role: row.role,
    threadId: toThreadId(row.threadId),
  };
}
