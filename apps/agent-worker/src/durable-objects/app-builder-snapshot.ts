import {
  createDb,
  type DatabaseHandle,
  type DirectoryBackupHandle,
  ensureSandboxProject,
  getSandboxProjectById,
  saveProjectBackupById,
  saveSandboxProjectBackup,
  withUserContext,
} from "@cheatcode/db";
import type { AnalyticsBindings, createLogger } from "@cheatcode/observability";
import {
  type CodeRuntimeContext,
  executeCreateSnapshot,
  executeRestoreSnapshot,
} from "@cheatcode/tools-code";
import { ProjectId, UserId } from "@cheatcode/types";

const DEFAULT_PROJECT_MODE = "web";

export type ProjectSandboxStub = CodeRuntimeContext["sandbox"];
export type AgentRunLogger = ReturnType<typeof createLogger>;

export interface AgentRunAppBuilderEnv extends AnalyticsBindings {
  HYPERDRIVE: Hyperdrive;
  PREVIEW_HOSTNAME?: string;
}

export interface AgentRunAppBuilderInput {
  importRepoUrl?: string | undefined;
  isFirstRun?: boolean;
  messageText: string;
  projectId: string;
  projectMode?: "app-builder" | "app-builder-mobile" | "general";
  runId?: string | undefined;
  sandboxName: string;
  threadId: string;
  userId: string;
  /** Immutable /workspace subfolder for this project (per-user "computer" sandbox model). */
  workspaceSlug?: string | undefined;
}

export async function snapshotAppBuilderWorkspace({
  env,
  input,
  logger,
  sandbox,
}: {
  env: AgentRunAppBuilderEnv;
  input: AgentRunAppBuilderInput;
  logger: AgentRunLogger;
  sandbox: ProjectSandboxStub;
}): Promise<void> {
  await createBestEffortSnapshot({ env, input, logger, sandbox });
}

export async function restoreBestEffortSnapshot(
  input: AgentRunAppBuilderInput,
  sandbox: ProjectSandboxStub,
  env: AgentRunAppBuilderEnv,
  logger: AgentRunLogger,
): Promise<void> {
  const backup = await ensureProjectRecord(input, env, logger);
  if (!backup) {
    return;
  }

  try {
    await executeRestoreSnapshot({ backup }, { sandbox });
    logger.info("sandbox_snapshot_restored", { backupId: backup.id });
  } catch (error) {
    logger.warn("sandbox_snapshot_restore_failed", {
      backupId: backup.id,
      error: error instanceof Error ? error.message : "Unknown snapshot restore error",
    });
  }
}

async function createBestEffortSnapshot({
  env,
  input,
  logger,
  sandbox,
}: {
  env: AgentRunAppBuilderEnv;
  input: AgentRunAppBuilderInput;
  logger: AgentRunLogger;
  sandbox: ProjectSandboxStub;
}): Promise<void> {
  try {
    const backup = await executeCreateSnapshot(
      {
        dir: "/workspace",
        name: "app-preview",
      },
      { sandbox },
    );
    await persistBestEffortSnapshot(input, backup, env, logger);
    logger.info("sandbox_snapshot_created", { backupId: backup.id });
  } catch (error) {
    logger.warn("sandbox_snapshot_failed", {
      error: error instanceof Error ? error.message : "Unknown snapshot error",
    });
  }
}

async function ensureProjectRecord(
  input: AgentRunAppBuilderInput,
  env: AgentRunAppBuilderEnv,
  logger: AgentRunLogger,
): Promise<DirectoryBackupHandle | null> {
  const dbHandle = createDb(env.HYPERDRIVE);
  const userId = UserId(input.userId);
  try {
    if (isUuid(input.projectId)) {
      const project = await withUserContext(dbHandle.db, userId, (db) =>
        getSandboxProjectById(db, {
          projectId: ProjectId(input.projectId),
          userId,
        }),
      );
      logger.info("sandbox_project_resolved", {
        projectId: input.projectId,
        sandboxId: input.sandboxName,
      });
      return project?.containerBackup ?? null;
    }
    const project = await withUserContext(dbHandle.db, userId, (db) =>
      ensureSandboxProject(db, {
        mode: DEFAULT_PROJECT_MODE,
        name: projectNameFromThreadId(input.threadId),
        sandboxId: input.projectId,
        userId,
      }),
    );
    logger.info("sandbox_project_resolved", {
      projectId: project.id,
      sandboxId: input.projectId,
    });
    return project.containerBackup;
  } catch (error) {
    logger.warn("sandbox_project_resolve_failed", {
      error: error instanceof Error ? error.message : "Unknown project lookup error",
      sandboxId: input.projectId,
    });
    return null;
  } finally {
    await closeDatabase(dbHandle, logger);
  }
}

async function persistBestEffortSnapshot(
  input: AgentRunAppBuilderInput,
  backup: DirectoryBackupHandle,
  env: AgentRunAppBuilderEnv,
  logger: AgentRunLogger,
): Promise<void> {
  const dbHandle = createDb(env.HYPERDRIVE);
  const userId = UserId(input.userId);
  try {
    await withUserContext(dbHandle.db, userId, async (db) => {
      if (isUuid(input.projectId)) {
        await saveProjectBackupById(db, {
          backup,
          projectId: ProjectId(input.projectId),
          userId,
        });
        return;
      }
      await ensureSandboxProject(db, {
        mode: DEFAULT_PROJECT_MODE,
        name: projectNameFromThreadId(input.threadId),
        sandboxId: input.projectId,
        userId,
      });
      await saveSandboxProjectBackup(db, {
        backup,
        sandboxId: input.projectId,
        userId,
      });
    });
    logger.info("sandbox_snapshot_persisted", {
      backupId: backup.id,
      sandboxId: input.sandboxName,
    });
  } catch (error) {
    logger.warn("sandbox_snapshot_persist_failed", {
      backupId: backup.id,
      error: error instanceof Error ? error.message : "Unknown snapshot persistence error",
      sandboxId: input.sandboxName,
    });
  } finally {
    await closeDatabase(dbHandle, logger);
  }
}

async function closeDatabase(dbHandle: DatabaseHandle, logger: AgentRunLogger): Promise<void> {
  try {
    await dbHandle.close();
  } catch (error) {
    logger.warn("db_close_failed", {
      error: error instanceof Error ? error.message : "Unknown database close error",
    });
  }
}

function projectNameFromThreadId(threadId: string): string {
  return threadId.replaceAll("-", " ").slice(0, 60) || "Cheatcode Project";
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value);
}
