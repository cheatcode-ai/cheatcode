import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import { NonRetryableError } from "cloudflare:workflows";
import {
  deleteQuiescedArtifactUploadIntents,
  type HyperdriveConnection,
  listQuiescedArtifactUploadIntents,
  type QuiescedArtifactUploadIntentRecord,
} from "@cheatcode/db";
import type { WorkerSecret } from "@cheatcode/env";
import {
  type AnalyticsBindings,
  createLogger,
  emitErrorEvent,
  safeErrorTelemetry,
} from "@cheatcode/observability";
import { z } from "zod";
import { withDatabase } from "./deletion-job-runner";
import { createDeterministicWorkflow, type DeterministicWorkflowResult } from "./workflow-instance";

const ARTIFACT_INTENT_PAGE_SIZE = 500;
const DB_STEP_OPTIONS = {
  retries: { limit: 2, delay: "15 seconds", backoff: "exponential" },
  timeout: "90 seconds",
} as const;
const R2_STEP_OPTIONS = {
  retries: { limit: 3, delay: "15 seconds", backoff: "exponential" },
  timeout: "3 minutes",
} as const;
const DailyMaintenanceDaySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u);
const ScheduledTimeSchema = z.number().int().nonnegative().max(8_640_000_000_000_000);
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

const DailyMaintenancePayloadSchema = z
  .object({
    cleanupCutoff: z.string().datetime({ offset: true }),
    day: DailyMaintenanceDaySchema,
    kind: z.literal("daily-maintenance"),
  })
  .strict()
  .superRefine((payload, ctx) => {
    if (new Date(payload.cleanupCutoff).toISOString().slice(0, 10) !== payload.day) {
      ctx.addIssue({
        code: "custom",
        message: "Daily maintenance cutoff must belong to its UTC instance day",
        path: ["cleanupCutoff"],
      });
    }
  });

export type DailyMaintenancePayload = z.infer<typeof DailyMaintenancePayloadSchema>;
type ArtifactIntentWireRecord = z.infer<typeof ArtifactIntentPageSchema>[number];

export interface DailyMaintenanceWorkflowBindings {
  DAILY_MAINTENANCE_WORKFLOW: Workflow<DailyMaintenancePayload>;
}

export interface DailyMaintenanceEnv extends AnalyticsBindings, DailyMaintenanceWorkflowBindings {
  DATABASE_CONTEXT_SIGNING_SECRET_WEBHOOKS: WorkerSecret;
  HYPERDRIVE: HyperdriveConnection;
  R2_OUTPUTS: R2Bucket;
}

export class DailyMaintenanceWorkflow extends WorkflowEntrypoint<
  DailyMaintenanceEnv,
  DailyMaintenancePayload
> {
  public override async run(
    event: Readonly<WorkflowEvent<DailyMaintenancePayload>>,
    step: WorkflowStep,
  ): Promise<{ deleted: number; ok: true }> {
    try {
      const payload = DailyMaintenancePayloadSchema.parse(event.payload);
      assertDailyMaintenanceWorkflowIdentity(event.instanceId, payload);
      const deleted = await processDailyMaintenance(this.env, payload, step);
      return { deleted, ok: true };
    } catch (error) {
      const telemetry = safeErrorTelemetry(error);
      createLogger().error("daily_maintenance_failed", {
        errorCode: "daily_maintenance_failed",
        instanceId: event.instanceId,
        ...telemetry,
      });
      emitErrorEvent(this.env, {
        errorCategory: "workflow",
        errorCode: "daily_maintenance_failed",
        route: "daily-maintenance",
        runId: event.instanceId,
        workerName: "webhooks",
        ...telemetry,
      });
      throw error;
    }
  }
}

export function enqueueDailyMaintenance(
  env: DailyMaintenanceWorkflowBindings,
  scheduledTimeInput: number,
): Promise<DeterministicWorkflowResult> {
  const scheduledAt = new Date(ScheduledTimeSchema.parse(scheduledTimeInput));
  const payload = DailyMaintenancePayloadSchema.parse({
    cleanupCutoff: scheduledAt.toISOString(),
    day: scheduledAt.toISOString().slice(0, 10),
    kind: "daily-maintenance",
  });
  return createDeterministicWorkflow(env.DAILY_MAINTENANCE_WORKFLOW, {
    id: dailyMaintenanceWorkflowIdentity(payload),
    params: payload,
    retention: { errorRetention: "30 days", successRetention: "7 days" },
  });
}

async function processDailyMaintenance(
  env: DailyMaintenanceEnv,
  payload: DailyMaintenancePayload,
  step: WorkflowStep,
): Promise<number> {
  const cutoff = new Date(payload.cleanupCutoff);
  let deleted = 0;
  for (let pageNumber = 1; ; pageNumber += 1) {
    const page = await listIntentPage(env, step, cutoff, pageNumber);
    if (page.length === 0) {
      createLogger().info("daily_maintenance_completed", {
        cleanupCutoff: payload.cleanupCutoff,
        day: payload.day,
        deleted,
        pages: pageNumber - 1,
      });
      return deleted;
    }
    await deleteIntentObjects(env, step, page, pageNumber);
    const deletedRows = await deleteIntentRows(env, step, cutoff, page, pageNumber);
    if (deletedRows === 0) {
      throw new Error("Daily maintenance page returned rows but deleted zero intent rows");
    }
    deleted += deletedRows;
  }
}

async function listIntentPage(
  env: DailyMaintenanceEnv,
  step: WorkflowStep,
  cutoff: Date,
  pageNumber: number,
): Promise<ArtifactIntentWireRecord[]> {
  const value = await step.do(
    `list quiesced artifact intents page ${pageNumber}`,
    DB_STEP_OPTIONS,
    () =>
      withDatabase(env, async (db) => {
        const rows = await listQuiescedArtifactUploadIntents(db, {
          before: cutoff,
          limit: ARTIFACT_INTENT_PAGE_SIZE,
        });
        return ArtifactIntentPageSchema.parse(rows.map(intentToWire));
      }),
  );
  const page = ArtifactIntentPageSchema.parse(value);
  assertIntentPage(page, cutoff);
  return page;
}

async function deleteIntentObjects(
  env: DailyMaintenanceEnv,
  step: WorkflowStep,
  page: ArtifactIntentWireRecord[],
  pageNumber: number,
): Promise<void> {
  await step.do(
    `delete quiesced artifact objects page ${pageNumber}`,
    R2_STEP_OPTIONS,
    async () => {
      await env.R2_OUTPUTS.delete([...new Set(page.map(({ r2Key }) => r2Key))]);
      return { deleted: page.length };
    },
  );
}

async function deleteIntentRows(
  env: DailyMaintenanceEnv,
  step: WorkflowStep,
  cutoff: Date,
  page: ArtifactIntentWireRecord[],
  pageNumber: number,
): Promise<number> {
  const value = await step.do(
    `delete quiesced artifact intents page ${pageNumber}`,
    DB_STEP_OPTIONS,
    () =>
      withDatabase(env, (db) =>
        deleteQuiescedArtifactUploadIntents(db, {
          before: cutoff,
          intents: page.map(intentFromWire),
        }),
      ),
  );
  return z.number().int().min(0).max(page.length).parse(value);
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

function dailyMaintenanceWorkflowIdentity(payloadInput: DailyMaintenancePayload): string {
  const payload = DailyMaintenancePayloadSchema.parse(payloadInput);
  return `daily-maintenance-${payload.day}`;
}

function assertDailyMaintenanceWorkflowIdentity(
  instanceId: string,
  payload: DailyMaintenancePayload,
): void {
  if (instanceId !== dailyMaintenanceWorkflowIdentity(payload)) {
    throw new NonRetryableError(
      "Daily maintenance Workflow identity does not match its immutable payload",
      "DailyMaintenanceWorkflowIdentityInvalid",
    );
  }
}
