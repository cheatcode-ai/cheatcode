import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import { NonRetryableError } from "cloudflare:workflows";
import type { HyperdriveConnection } from "@cheatcode/db";
import type { CloudflareVersionMetadata, WorkerSecret } from "@cheatcode/env";
import type { AnalyticsBindings } from "@cheatcode/observability";
import { z } from "zod";
import { runAnalyticsWatchdog } from "./analytics-watchdog";
import { processByokRevalidation } from "./byok-revalidation";
import {
  DailyMaintenancePayloadSchema,
  processDailyMaintenance,
} from "./daily-maintenance-workflow";
import type { LifecycleEnv } from "./lifecycle-adapters";
import { assertReleaseCanDrain, assertReleaseOpen, type ReleaseGateBindings } from "./release-gate";
import {
  isUserDeletionWorkflowIdentity,
  UserDeletionPayloadSchema,
} from "./user-deletion-admission";
import { processUserDeletionChunk } from "./user-deletion-workflow";
import { createDeterministicWorkflow } from "./workflow-instance";
import {
  reconcileCanonicalWorkspaces,
  type WorkspaceReconciliationChunk,
  type WorkspaceReconciliationPayload,
  WorkspaceReconciliationPayloadSchema,
  type WorkspaceReconciliationWorkflowResult,
  WorkspaceReconciliationWorkflowResultSchema,
  workspaceReconciliationInstanceId,
} from "./workspace-reconciliation";

const OpsMaintenancePayloadSchema = z.union([
  z.object({
    kind: z.literal("analytics-watchdog"),
    scheduledTime: z.number().int().nonnegative(),
  }),
  z.object({
    continuation: z.number().int().nonnegative(),
    kind: z.literal("byok-revalidation"),
    scheduledTime: z.number().int().nonnegative(),
  }),
  DailyMaintenancePayloadSchema,
  UserDeletionPayloadSchema,
  WorkspaceReconciliationPayloadSchema,
]);

export type OpsMaintenancePayload = z.infer<typeof OpsMaintenancePayloadSchema>;

export interface OpsWorkflowBindings extends ReleaseGateBindings {
  OPS_WORKFLOW: Workflow<OpsMaintenancePayload>;
}

interface OpsWorkflowEnv extends AnalyticsBindings, LifecycleEnv, OpsWorkflowBindings {
  CF_VERSION_METADATA?: CloudflareVersionMetadata;
  CHEATCODE_ENVIRONMENT: "development" | "production";
  CHEATCODE_RELEASE_SHA?: string;
  CLOUDFLARE_ACCOUNT_ID?: string;
  CLOUDFLARE_ANALYTICS_API_TOKEN?: WorkerSecret;
  DATABASE_CONTEXT_SIGNING_SECRET_WEBHOOKS: WorkerSecret;
  HYPERDRIVE: HyperdriveConnection;
  INTERNAL_ALERT_WEBHOOK_SECRET?: WorkerSecret;
  INTERNAL_ALERT_WEBHOOK_URL?: string;
}

export class OpsMaintenanceWorkflow extends WorkflowEntrypoint<
  OpsWorkflowEnv,
  OpsMaintenancePayload
> {
  public override async run(
    event: Readonly<WorkflowEvent<OpsMaintenancePayload>>,
    step: WorkflowStep,
  ): Promise<
    | WorkspaceReconciliationWorkflowResult
    | { kind: Exclude<OpsMaintenancePayload["kind"], "workspace-reconciliation">; ok: true }
  > {
    const payload = OpsMaintenancePayloadSchema.parse(event.payload);
    if (payload.kind === "workspace-reconciliation") {
      if (this.env.CHEATCODE_RELEASE_GATE !== "closed") {
        throw new NonRetryableError(
          "Workspace reconciliation requires the closed release gate",
          "WorkspaceReconciliationGateOpen",
        );
      }
      if (event.instanceId !== workspaceReconciliationInstanceId(payload)) {
        throw new NonRetryableError(
          "Workspace reconciliation instance identity is invalid",
          "WorkspaceReconciliationIdentityInvalid",
        );
      }
      const chunk = await reconcileCanonicalWorkspaces(this.env, payload, step);
      return completeOrContinueWorkspaceReconciliation(this.env, payload, chunk, step);
    }
    if (this.env.CHEATCODE_RELEASE_GATE === "closed") {
      throw new NonRetryableError(
        "Ops maintenance is fenced by a closed release",
        "OpsMaintenanceReleaseGateClosed",
      );
    }
    if (payload.kind === "user-deletion") {
      if (!isUserDeletionWorkflowIdentity(event.instanceId, payload)) {
        throw new NonRetryableError(
          "User deletion Workflow identity is invalid",
          "UserDeletionWorkflowIdentityInvalid",
        );
      }
      await processUserDeletionChunk(this.env, payload, step);
      return { kind: payload.kind, ok: true };
    }
    if (payload.kind === "daily-maintenance") {
      await processDailyMaintenance(this.env, event.instanceId, payload, step);
      return { kind: payload.kind, ok: true };
    }
    if (payload.kind === "byok-revalidation") {
      const result = await processByokRevalidation(this.env, step);
      if (result.hasMore) {
        await enqueueByokContinuation(this.env, payload, step);
      }
      return { kind: payload.kind, ok: true };
    }
    await step.do(
      "run analytics watchdog",
      {
        retries: { limit: 3, delay: "30 seconds", backoff: "exponential" },
        timeout: "10 minutes",
      },
      async () => {
        await runAnalyticsWatchdog(this.env, payload.scheduledTime);
        return { ok: true };
      },
    );
    return { kind: payload.kind, ok: true };
  }
}

async function completeOrContinueWorkspaceReconciliation(
  env: OpsWorkflowEnv,
  payload: WorkspaceReconciliationPayload,
  chunk: WorkspaceReconciliationChunk,
  step: WorkflowStep,
): Promise<WorkspaceReconciliationWorkflowResult> {
  if (chunk.evidence) {
    return WorkspaceReconciliationWorkflowResultSchema.parse({
      continuationInstanceId: null,
      evidence: chunk.evidence,
      kind: "workspace-reconciliation",
      ok: true,
    });
  }
  if (!chunk.continuation) {
    throw new Error("Workspace reconciliation returned no evidence or continuation.");
  }
  const continuation = WorkspaceReconciliationPayloadSchema.parse(chunk.continuation);
  if (
    continuation.releaseSha !== payload.releaseSha ||
    continuation.generation !== payload.generation + 1
  ) {
    throw new Error("Workspace reconciliation continuation did not advance exactly once.");
  }
  const expectedId = workspaceReconciliationInstanceId(continuation);
  const created = await step.do(
    "enqueue workspace reconciliation continuation",
    {
      retries: { limit: 5, delay: "30 seconds", backoff: "exponential" },
      timeout: "2 minutes",
    },
    () =>
      createDeterministicWorkflow(env.OPS_WORKFLOW, {
        id: expectedId,
        params: continuation,
        retention: { errorRetention: "30 days", successRetention: "30 days" },
      }),
  );
  if (created.id !== expectedId) {
    throw new Error("Workspace reconciliation continuation identity changed during creation.");
  }
  return WorkspaceReconciliationWorkflowResultSchema.parse({
    continuationInstanceId: created.id,
    evidence: null,
    kind: "workspace-reconciliation",
    ok: true,
  });
}

export async function enqueueAnalyticsWatchdog(
  env: OpsWorkflowBindings,
  scheduledTime: number,
): Promise<string> {
  assertReleaseOpen(env);
  const instance = await createDeterministicWorkflow(env.OPS_WORKFLOW, {
    id: `analytics-watchdog-${scheduledTime}`,
    params: { kind: "analytics-watchdog", scheduledTime },
    retention: {
      errorRetention: "30 days",
      successRetention: "7 days",
    },
  });
  return instance.id;
}

export async function enqueueByokRevalidation(
  env: OpsWorkflowBindings,
  scheduledTime: number,
): Promise<string> {
  assertReleaseOpen(env);
  const instance = await createDeterministicWorkflow(env.OPS_WORKFLOW, {
    id: `byok-revalidation-${scheduledTime}-0`,
    params: { continuation: 0, kind: "byok-revalidation", scheduledTime },
    retention: {
      errorRetention: "30 days",
      successRetention: "7 days",
    },
  });
  return instance.id;
}

async function enqueueByokContinuation(
  env: OpsWorkflowBindings,
  payload: Extract<OpsMaintenancePayload, { kind: "byok-revalidation" }>,
  step: WorkflowStep,
): Promise<void> {
  assertReleaseCanDrain(env);
  const continuation = payload.continuation + 1;
  await step.do(
    "enqueue BYOK revalidation continuation",
    {
      retries: { limit: 5, delay: "30 seconds", backoff: "exponential" },
      timeout: "2 minutes",
    },
    () =>
      createDeterministicWorkflow(env.OPS_WORKFLOW, {
        id: `byok-revalidation-${payload.scheduledTime}-${continuation}`,
        params: {
          continuation,
          kind: "byok-revalidation",
          scheduledTime: payload.scheduledTime,
        },
        retention: {
          errorRetention: "30 days",
          successRetention: "7 days",
        },
      }),
  );
}
