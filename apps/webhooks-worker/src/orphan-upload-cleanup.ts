import type { WorkflowStep } from "cloudflare:workers";
import {
  createDb,
  type DailyMaintenanceJobLease,
  type DailyMaintenanceJobProgress,
  type DailyMaintenanceJobRecord,
  type Database,
  deleteQuiescedArtifactIntentsAndAdvanceDailyMaintenanceJob,
  guardDailyMaintenanceJobProgress,
  type HyperdriveConnection,
  listQuiescedArtifactUploadIntents,
  type QuiescedArtifactUploadIntentRecord,
} from "@cheatcode/db";
import type { WorkerSecret } from "@cheatcode/env";
import { z } from "zod";

const ARTIFACT_INTENT_PAGE_SIZE = 500;
const ARTIFACT_INTENT_PAGES_PER_GENERATION = 2;
const DB_STEP_OPTIONS = {
  retries: { limit: 2, delay: "15 seconds", backoff: "exponential" },
  timeout: "90 seconds",
} as const;
const R2_STEP_OPTIONS = {
  retries: { limit: 3, delay: "15 seconds", backoff: "exponential" },
  timeout: "3 minutes",
} as const;

const ArtifactIntentPageSchema = z
  .array(
    z
      .object({
        cleanupNotBefore: z.string().datetime({ offset: true }),
        id: z.string().uuid(),
        quiescedAt: z.string().datetime({ offset: true }),
        r2Key: z.string().min(1),
      })
      .strict(),
  )
  .max(ARTIFACT_INTENT_PAGE_SIZE);

type ArtifactIntentWireRecord = z.infer<typeof ArtifactIntentPageSchema>[number];

export interface OrphanUploadCleanupEnv {
  DATABASE_CONTEXT_SIGNING_SECRET_WEBHOOKS: WorkerSecret;
  HYPERDRIVE: HyperdriveConnection;
  R2_OUTPUTS: R2Bucket;
}

export type OrphanUploadCleanupGenerationOutcome =
  | { job: DailyMaintenanceJobRecord; state: "continue" }
  | { state: "done" }
  | { state: "ready" };

export async function processOrphanUploadCleanupGeneration(
  env: OrphanUploadCleanupEnv,
  step: WorkflowStep,
  job: DailyMaintenanceJobRecord,
): Promise<OrphanUploadCleanupGenerationOutcome> {
  if (job.phase !== "orphan-upload-cleanup") {
    throw new Error("Abandoned-upload cleanup requires the orphan-upload-cleanup phase");
  }
  for (let action = 1; action <= ARTIFACT_INTENT_PAGES_PER_GENERATION; action += 1) {
    const page = await listIntentPage(env, step, job, action);
    if (page.length === 0) {
      return { state: "ready" };
    }
    if (!(await deleteIntentObjects(env, step, job, page, action))) {
      return { state: "done" };
    }
    if (!(await deleteIntentRows(env, step, job, page, action))) {
      return { state: "done" };
    }
  }
  return { job, state: "continue" };
}

async function listIntentPage(
  env: OrphanUploadCleanupEnv,
  step: WorkflowStep,
  job: DailyMaintenanceJobRecord,
  action: number,
): Promise<ArtifactIntentWireRecord[]> {
  const value = await step.do(`list quiesced artifact intents ${action}`, DB_STEP_OPTIONS, () =>
    withDatabase(env, async (db) => {
      const rows = await listQuiescedArtifactUploadIntents(db, {
        before: job.scheduledAt,
        limit: ARTIFACT_INTENT_PAGE_SIZE,
      });
      return ArtifactIntentPageSchema.parse(rows.map(intentToWire));
    }),
  );
  const page = ArtifactIntentPageSchema.parse(value);
  assertIntentPage(page, job.scheduledAt);
  return page;
}

async function deleteIntentObjects(
  env: OrphanUploadCleanupEnv,
  step: WorkflowStep,
  job: DailyMaintenanceJobRecord,
  page: ArtifactIntentWireRecord[],
  action: number,
): Promise<boolean> {
  return step.do(
    `guard and delete quiesced artifact objects ${action}`,
    R2_STEP_OPTIONS,
    async () => {
      const current = await withDatabase(env, (db) =>
        guardDailyMaintenanceJobProgress(db, {
          ...jobLease(job),
          expected: jobProgress(job),
        }),
      );
      if (!current) {
        return false;
      }
      await env.R2_OUTPUTS.delete([...new Set(page.map(({ r2Key }) => r2Key))]);
      return true;
    },
  );
}

async function deleteIntentRows(
  env: OrphanUploadCleanupEnv,
  step: WorkflowStep,
  job: DailyMaintenanceJobRecord,
  page: ArtifactIntentWireRecord[],
  action: number,
): Promise<boolean> {
  const value = await step.do(`delete quiesced artifact intents ${action}`, DB_STEP_OPTIONS, () =>
    withDatabase(env, (db) =>
      deleteQuiescedArtifactIntentsAndAdvanceDailyMaintenanceJob(db, {
        ...jobLease(job),
        before: job.scheduledAt,
        expected: jobProgress(job),
        intents: page.map(intentFromWire),
        next: jobProgress(job),
      }),
    ),
  );
  return z.object({ state: z.enum(["advanced", "lost"]) }).parse(value).state === "advanced";
}

function intentToWire(intent: QuiescedArtifactUploadIntentRecord): ArtifactIntentWireRecord {
  return {
    ...intent,
    cleanupNotBefore: intent.cleanupNotBefore.toISOString(),
    quiescedAt: intent.quiescedAt.toISOString(),
  };
}

function intentFromWire(intent: ArtifactIntentWireRecord): QuiescedArtifactUploadIntentRecord {
  return {
    ...intent,
    cleanupNotBefore: new Date(intent.cleanupNotBefore),
    quiescedAt: new Date(intent.quiescedAt),
  };
}

function assertIntentPage(page: ArtifactIntentWireRecord[], cutoff: Date): void {
  let previous: ArtifactIntentWireRecord | undefined;
  for (const intent of page) {
    const cleanupNotBefore = Date.parse(intent.cleanupNotBefore);
    const quiescedAt = Date.parse(intent.quiescedAt);
    if (cleanupNotBefore > cutoff.getTime() || quiescedAt > cutoff.getTime()) {
      throw new Error("Artifact-intent cleanup page crossed its fixed safety cutoff");
    }
    if (previous && compareIntents(intent, previous) <= 0) {
      throw new Error("Artifact-intent cleanup page is not in database key order");
    }
    previous = intent;
  }
}

function compareIntents(left: ArtifactIntentWireRecord, right: ArtifactIntentWireRecord): number {
  const cleanupOrder = Date.parse(left.cleanupNotBefore) - Date.parse(right.cleanupNotBefore);
  if (cleanupOrder !== 0) {
    return cleanupOrder;
  }
  const quiescenceOrder = Date.parse(left.quiescedAt) - Date.parse(right.quiescedAt);
  return quiescenceOrder === 0 ? left.id.localeCompare(right.id) : quiescenceOrder;
}

function jobLease(job: DailyMaintenanceJobRecord): DailyMaintenanceJobLease {
  return {
    continuation: job.continuation,
    day: job.day,
    leaseToken: job.leaseToken,
    releaseVersionId: job.releaseVersionId,
  };
}

function jobProgress(job: DailyMaintenanceJobRecord): DailyMaintenanceJobProgress {
  return {
    activationCursor: job.activationCursor,
    phase: job.phase,
  };
}

async function withDatabase<T>(
  env: OrphanUploadCleanupEnv,
  operation: (db: Database) => Promise<T>,
): Promise<T> {
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
