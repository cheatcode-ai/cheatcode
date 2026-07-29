import type { WorkflowStep } from "cloudflare:workers";
import {
  type Database,
  guardResourceDeletionJobProgress,
  ResourceDeletionInvariantError,
  type ResourceDeletionJobGuard,
  type ResourceDeletionJobRecord,
  type ResourceDeletionScope,
  runResourceDeletionJobDatabaseAction,
} from "@cheatcode/db";
import { dbStep, type withDatabase, withUserDatabase } from "./deletion-job-runner";

export { dbStep, withUserDatabase };

const EXTERNAL_STEP_OPTIONS = {
  retries: { limit: 5, delay: "30 seconds", backoff: "exponential" },
  timeout: "10 minutes",
} as const;

type ResourceDeletionDatabaseEnv = Parameters<typeof withDatabase>[0];

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
