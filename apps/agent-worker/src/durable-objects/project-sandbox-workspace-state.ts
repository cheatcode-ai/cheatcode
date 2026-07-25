import {
  assertExactSqliteSchema,
  type ExpectedSqliteObject,
  setCurrentSqliteStorageVersion,
} from "@cheatcode/durable-storage";
import { APIError } from "@cheatcode/observability";
import type { ParsedProjectCleanupWorkspaceInput } from "./project-sandbox-runtime";

const CREATE_WORKSPACE_TOMBSTONE_TABLE = `CREATE TABLE IF NOT EXISTS project_workspace_tombstone (
  workspace_slug TEXT PRIMARY KEY CHECK (
    length(workspace_slug) BETWEEN 38 AND 64
    AND workspace_slug = lower(workspace_slug)
    AND workspace_slug NOT GLOB '*[^a-z0-9-]*'
    AND substr(workspace_slug, 1, 1) <> '-'
    AND instr(workspace_slug, '--') = 0
  ),
  project_id TEXT NOT NULL UNIQUE CHECK (
    length(project_id) = 36
    AND project_id = lower(project_id)
    AND substr(project_id, 9, 1) = '-'
    AND substr(project_id, 14, 1) = '-'
    AND substr(project_id, 19, 1) = '-'
    AND substr(project_id, 24, 1) = '-'
    AND length(replace(project_id, '-', '')) = 32
    AND replace(project_id, '-', '') NOT GLOB '*[^0-9a-f]*'
    AND substr(workspace_slug, -37) = '-' || project_id
  ),
  deleted_at INTEGER NOT NULL CHECK (deleted_at BETWEEN 1000000000000 AND 9999999999999),
  completed_at INTEGER CHECK (
    completed_at IS NULL
    OR (
      completed_at BETWEEN 1000000000000 AND 9999999999999
      AND completed_at >= deleted_at
    )
  )
) STRICT`;
const PROJECT_SANDBOX_STORAGE_SCHEMA: readonly ExpectedSqliteObject[] = [
  {
    name: "project_workspace_tombstone",
    sql: CREATE_WORKSPACE_TOMBSTONE_TABLE,
    tableName: "project_workspace_tombstone",
    type: "table",
  },
];

export function initializeProjectSandboxStorage(ctx: DurableObjectState): void {
  ctx.storage.sql.exec(CREATE_WORKSPACE_TOMBSTONE_TABLE);
  setCurrentSqliteStorageVersion(ctx);
  assertProjectSandboxStorage(ctx);
}

function assertProjectSandboxStorage(ctx: DurableObjectState): void {
  assertExactSqliteSchema(ctx, PROJECT_SANDBOX_STORAGE_SCHEMA);
}

/** Opens only an already-materialized workspace store; empty activations stay storage-free. */
export function openProjectSandboxWorkspaceState(
  ctx: DurableObjectState,
): ProjectSandboxWorkspaceState | undefined {
  const tableCount = ctx.storage.sql
    .exec(
      `SELECT count(*) AS table_count
       FROM sqlite_schema
       WHERE type = 'table'
         AND name = 'project_workspace_tombstone'`,
    )
    .one()["table_count"];
  if (tableCount === 0) {
    return undefined;
  }
  return new ProjectSandboxWorkspaceState(ctx);
}

/**
 * Owns the synchronous fence and in-memory drain state for project workspaces.
 * Project tombstones intentionally outlive cleanup while the owning account is active.
 */
export class ProjectSandboxWorkspaceState {
  private readonly activeCounts = new Map<string, number>();
  private activeSharedMutationCount = 0;
  private activeUnscopedOperationCount = 0;
  private readonly cleanupPromises = new Map<string, Promise<void>>();
  private cleanupTail: Promise<void> = Promise.resolve();
  private cleanupInProgressCount = 0;
  private readonly sharedDrainWaiters = new Set<() => void>();
  private readonly unscopedDrainWaiters = new Set<() => void>();
  private readonly workspaceDrainWaiters = new Set<() => void>();
  private pendingDeletionCount: number;

  constructor(private readonly ctx: DurableObjectState) {
    assertProjectSandboxStorage(ctx);
    const pending = ctx.storage.sql
      .exec(
        `SELECT count(*) AS pending_count
         FROM project_workspace_tombstone
         WHERE completed_at IS NULL`,
      )
      .one()["pending_count"];
    if (typeof pending !== "number" || !Number.isSafeInteger(pending) || pending < 0) {
      throw new Error("Project workspace tombstone state is corrupt.");
    }
    this.pendingDeletionCount = pending;
  }

  public acquire(workspaceSlugs: readonly string[]): () => void {
    if (
      this.cleanupInProgressCount > 0 ||
      this.pendingDeletionCount > 0 ||
      this.activeSharedMutationCount > 0
    ) {
      throw cleanupInProgressError();
    }
    const uniqueSlugs = [...new Set(workspaceSlugs)];
    for (const workspaceSlug of uniqueSlugs) {
      this.assertWorkspaceAvailable(workspaceSlug);
    }
    for (const workspaceSlug of uniqueSlugs) {
      this.activeCounts.set(workspaceSlug, (this.activeCounts.get(workspaceSlug) ?? 0) + 1);
    }
    let isReleased = false;
    return () => {
      if (isReleased) {
        return;
      }
      isReleased = true;
      for (const workspaceSlug of uniqueSlugs) {
        this.release(workspaceSlug);
      }
    };
  }

  public acquireSharedMutation(): () => void {
    if (
      this.cleanupInProgressCount > 0 ||
      this.pendingDeletionCount > 0 ||
      this.activeSharedMutationCount > 0
    ) {
      throw cleanupInProgressError();
    }
    return this.acquireSharedMutationLease();
  }

  public acquireUnscoped(): () => void {
    if (
      this.cleanupInProgressCount > 0 ||
      this.pendingDeletionCount > 0 ||
      this.activeSharedMutationCount > 0
    ) {
      throw cleanupInProgressError();
    }
    this.activeUnscopedOperationCount += 1;
    let isReleased = false;
    return () => {
      if (isReleased) {
        return;
      }
      isReleased = true;
      this.activeUnscopedOperationCount -= 1;
      if (this.activeUnscopedOperationCount === 0) {
        for (const resolve of this.unscopedDrainWaiters) {
          resolve();
        }
        this.unscopedDrainWaiters.clear();
      }
    };
  }

  public assertOperationAllowed(allowWorkspaceCleanup = false): void {
    if (
      !allowWorkspaceCleanup &&
      (this.cleanupInProgressCount > 0 || this.pendingDeletionCount > 0)
    ) {
      throw cleanupInProgressError();
    }
  }

  private acquireSharedMutationLease(): () => void {
    this.activeSharedMutationCount += 1;
    let isReleased = false;
    return () => {
      if (isReleased) {
        return;
      }
      isReleased = true;
      this.activeSharedMutationCount -= 1;
      if (this.activeSharedMutationCount === 0) {
        for (const resolve of this.sharedDrainWaiters) {
          resolve();
        }
        this.sharedDrainWaiters.clear();
      }
    };
  }

  public deleteWorkspace(
    input: ParsedProjectCleanupWorkspaceInput,
    cleanup: () => Promise<void>,
  ): Promise<void> {
    if (this.claimDeletion(input)) {
      return Promise.resolve();
    }
    const existing = this.cleanupPromises.get(input.workspaceSlug);
    if (existing) {
      return existing;
    }
    this.cleanupInProgressCount += 1;
    const deletion = this.cleanupTail
      .catch(() => undefined)
      .then(() => this.performDeletion(input, cleanup));
    this.cleanupTail = deletion.catch(() => undefined);
    const tracked = deletion.finally(() => {
      this.cleanupInProgressCount -= 1;
      if (this.cleanupPromises.get(input.workspaceSlug) === tracked) {
        this.cleanupPromises.delete(input.workspaceSlug);
      }
    });
    this.cleanupPromises.set(input.workspaceSlug, tracked);
    return tracked;
  }

  public async waitForWorkspaceDrain(): Promise<void> {
    await Promise.all([this.waitForScopedWorkspaceDrain(), this.waitForUnscopedDrain()]);
  }

  private claimDeletion(input: ParsedProjectCleanupWorkspaceInput): boolean {
    let isNewClaim = false;
    const isCompleted = this.ctx.storage.transactionSync(() => {
      const rows = this.ctx.storage.sql
        .exec(
          `SELECT project_id, workspace_slug, completed_at
           FROM project_workspace_tombstone
           WHERE workspace_slug = ? OR project_id = ?`,
          input.workspaceSlug,
          input.projectId,
        )
        .toArray();
      if (rows.length > 0) {
        return parseExistingClaim(rows, input);
      }
      this.ctx.storage.sql.exec(
        `INSERT INTO project_workspace_tombstone
          (workspace_slug, project_id, deleted_at, completed_at)
         VALUES (?, ?, ?, NULL)`,
        input.workspaceSlug,
        input.projectId,
        Date.now(),
      );
      isNewClaim = true;
      return false;
    });
    if (isNewClaim) {
      this.pendingDeletionCount += 1;
    }
    return isCompleted;
  }

  private assertWorkspaceAvailable(workspaceSlug: string): void {
    const tombstone = this.ctx.storage.sql
      .exec(
        "SELECT 1 FROM project_workspace_tombstone WHERE workspace_slug = ? LIMIT 1",
        workspaceSlug,
      )
      .toArray();
    if (tombstone.length > 0) {
      throw deletedWorkspaceError(workspaceSlug);
    }
  }

  private async performDeletion(
    input: ParsedProjectCleanupWorkspaceInput,
    cleanup: () => Promise<void>,
  ): Promise<void> {
    await Promise.all([
      this.waitForScopedWorkspaceDrain(),
      this.waitForSharedDrain(),
      this.waitForUnscopedDrain(),
    ]);
    await cleanup();
    this.markCompleted(input);
  }

  private waitForScopedWorkspaceDrain(): Promise<void> {
    if (this.activeCounts.size === 0) {
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      this.workspaceDrainWaiters.add(resolve);
    });
  }

  private markCompleted(input: ParsedProjectCleanupWorkspaceInput): void {
    this.ctx.storage.transactionSync(() => {
      this.ctx.storage.sql.exec(
        `UPDATE project_workspace_tombstone
         SET completed_at = COALESCE(completed_at, max(?, deleted_at))
         WHERE workspace_slug = ? AND project_id = ?`,
        Date.now(),
        input.workspaceSlug,
        input.projectId,
      );
      const rows = this.ctx.storage.sql
        .exec(
          `SELECT completed_at FROM project_workspace_tombstone
           WHERE workspace_slug = ? AND project_id = ?`,
          input.workspaceSlug,
          input.projectId,
        )
        .toArray();
      if (rows.length !== 1 || typeof rows[0]?.["completed_at"] !== "number") {
        throw new Error("Project workspace cleanup completion could not be persisted.");
      }
    });
    if (this.pendingDeletionCount < 1) {
      throw new Error("Project workspace tombstone drain state is corrupt.");
    }
    this.pendingDeletionCount -= 1;
  }

  private waitForSharedDrain(): Promise<void> {
    if (this.activeSharedMutationCount === 0) {
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      this.sharedDrainWaiters.add(resolve);
    });
  }

  private waitForUnscopedDrain(): Promise<void> {
    if (this.activeUnscopedOperationCount === 0) {
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      this.unscopedDrainWaiters.add(resolve);
    });
  }

  private release(workspaceSlug: string): void {
    const remaining = (this.activeCounts.get(workspaceSlug) ?? 1) - 1;
    if (remaining > 0) {
      this.activeCounts.set(workspaceSlug, remaining);
      return;
    }
    this.activeCounts.delete(workspaceSlug);
    if (this.activeCounts.size === 0) {
      for (const resolve of this.workspaceDrainWaiters) {
        resolve();
      }
      this.workspaceDrainWaiters.clear();
    }
  }
}

function parseExistingClaim(
  rows: Record<string, SqlStorageValue>[],
  input: ParsedProjectCleanupWorkspaceInput,
): boolean {
  const row = rows.length === 1 ? rows[0] : undefined;
  if (row?.["project_id"] !== input.projectId || row["workspace_slug"] !== input.workspaceSlug) {
    throw workspaceIdentityConflictError(input);
  }
  return typeof row["completed_at"] === "number";
}

function deletedWorkspaceError(workspaceSlug: string): APIError {
  return new APIError(410, "conflict_state_invalid", "Project workspace has been deleted", {
    details: { workspaceSlug },
    retriable: false,
  });
}

function cleanupInProgressError(): APIError {
  return new APIError(409, "conflict_state_invalid", "Project workspace cleanup is in progress", {
    retriable: true,
  });
}

function workspaceIdentityConflictError(input: ParsedProjectCleanupWorkspaceInput): APIError {
  return new APIError(409, "conflict_state_invalid", "Project workspace identity mismatch", {
    details: { projectId: input.projectId, workspaceSlug: input.workspaceSlug },
    hint: "Refuse the stale cleanup request and inspect the project deletion record.",
    retriable: false,
  });
}
