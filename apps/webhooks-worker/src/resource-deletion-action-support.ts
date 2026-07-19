import type { WorkflowStep } from "cloudflare:workers";
import {
  createDb,
  type Database,
  guardResourceDeletionJobProgress,
  type HyperdriveConnection,
  ResourceDeletionInvariantError,
  type ResourceDeletionJobGuard,
  type ResourceDeletionJobRecord,
  type ResourceDeletionScope,
  runResourceDeletionJobDatabaseAction,
  withUserContext,
} from "@cheatcode/db";
import type { WorkerSecret } from "@cheatcode/env";

const DB_STEP_OPTIONS = {
  retries: { limit: 3, delay: "20 seconds", backoff: "exponential" },
  timeout: "2 minutes",
} as const;
const EXTERNAL_STEP_OPTIONS = {
  retries: { limit: 5, delay: "30 seconds", backoff: "exponential" },
  timeout: "10 minutes",
} as const;

interface ResourceDeletionDatabaseEnv {
  DATABASE_CONTEXT_SIGNING_SECRET_WEBHOOKS: WorkerSecret;
  HYPERDRIVE: HyperdriveConnection;
}

export function exactJob(job: ResourceDeletionJobRecord): ResourceDeletionJobGuard {
  return {
    ...job,
    expectedCursor: job.cursor,
    expectedPhase: job.phase,
  };
}

export function deletionScope(job: ResourceDeletionJobRecord): ResourceDeletionScope {
  return job.kind === "project-deletion"
    ? { ...projectGeneration(job), kind: job.kind }
    : { ...threadGeneration(job), kind: job.kind };
}

export function projectGeneration(job: ResourceDeletionJobRecord) {
  return {
    deletedAt: job.generation,
    projectId: requiredProjectId(job),
    userId: job.userId,
  };
}

export function threadGeneration(job: ResourceDeletionJobRecord) {
  return {
    deletedAt: job.generation,
    threadId: requiredThreadId(job),
    userId: job.userId,
  };
}

export function requiredProjectId(job: ResourceDeletionJobRecord) {
  if (!job.projectId) {
    throw deletionInvariant("Deletion job has no project identity");
  }
  return job.projectId;
}

export function requiredThreadId(job: ResourceDeletionJobRecord) {
  if (!job.threadId) {
    throw deletionInvariant("Deletion job has no thread identity");
  }
  return job.threadId;
}

export function requiredCursor(value: string | undefined, label: string): string {
  if (!value) {
    throw deletionInvariant(`${label} deletion cursor did not advance`);
  }
  return value;
}

export function deletionInvariant(message: string): ResourceDeletionInvariantError {
  return new ResourceDeletionInvariantError(message);
}

export async function dbStep<Result extends Rpc.Serializable<Result>>(
  step: WorkflowStep,
  name: string,
  operation: () => Promise<Result>,
): Promise<Result> {
  return step.do(name, DB_STEP_OPTIONS, operation);
}

export async function guardedExternalStep<Result extends Rpc.Serializable<Result>>(
  env: ResourceDeletionDatabaseEnv,
  step: WorkflowStep,
  job: ResourceDeletionJobRecord,
  name: string,
  operation: () => Promise<Result>,
): Promise<Result | null> {
  return step.do(name, EXTERNAL_STEP_OPTIONS, async () => {
    const current = await withUserDatabase(env, job.userId, (db) =>
      guardResourceDeletionJobProgress(db, exactJob(job)),
    );
    return current ? operation() : null;
  });
}

export async function guardedDatabaseAction<Result extends Rpc.Serializable<Result>>(
  env: ResourceDeletionDatabaseEnv,
  job: ResourceDeletionJobRecord,
  operation: (db: Database) => Promise<Result>,
): Promise<Result | null> {
  return withUserDatabase(env, job.userId, (db) =>
    runResourceDeletionJobDatabaseAction(db, exactJob(job), operation),
  );
}

export async function withDatabase<Result>(
  env: ResourceDeletionDatabaseEnv,
  operation: (db: Database) => Promise<Result>,
): Promise<Result> {
  const { db, close } = createDb(env.HYPERDRIVE, {
    audience: "app_webhooks",
    signingSecret: env.DATABASE_CONTEXT_SIGNING_SECRET_WEBHOOKS,
  });
  try {
    return await operation(db);
  } finally {
    await close();
  }
}

export async function withUserDatabase<Result>(
  env: ResourceDeletionDatabaseEnv,
  userId: ResourceDeletionJobRecord["userId"],
  operation: (db: Database) => Promise<Result>,
): Promise<Result> {
  return withDatabase(env, (db) => withUserContext(db, userId, operation));
}
