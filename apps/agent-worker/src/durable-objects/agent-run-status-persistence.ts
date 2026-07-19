import { createDb, updateAgentRunStatus, withUserContext } from "@cheatcode/db";
import type { WorkerSecret } from "@cheatcode/env";
import { createLogger } from "@cheatcode/observability";
import { AgentRunId, UserId } from "@cheatcode/types";
import { z } from "zod";
import type { AgentRunEnv } from "./agent-run-env";
import { pendingAssistantMessageRetryAt } from "./agent-run-message-persistence";
import { emitStoredAgentRunMetric } from "./agent-run-metrics";
import {
  deleteRunStateValues,
  getRunStateValue,
  isAgentRunDeleted,
  setRunStateValue,
} from "./agent-run-storage";

export type PersistableRunStatus = "running" | "completed" | "failed" | "canceled";

interface AgentRunStatusPersistenceEnv {
  DATABASE_CONTEXT_SIGNING_SECRET_AGENT: WorkerSecret;
  HYPERDRIVE: Hyperdrive;
}

export interface PersistAgentRunStatusInput {
  artifactsQuiesced: boolean;
  runId: string;
  status: PersistableRunStatus;
  userId: string;
}

export function isTerminalPersistableRunStatus(
  status: PersistableRunStatus,
): status is Extract<PersistableRunStatus, "canceled" | "completed" | "failed"> {
  return status === "canceled" || status === "completed" || status === "failed";
}

export async function persistSerializedAgentRunStatus(
  ctx: DurableObjectState,
  env: AgentRunEnv,
  input: PersistAgentRunStatusInput,
  serialize: (operation: () => Promise<void>) => Promise<void>,
  armAlarm: () => Promise<void>,
): Promise<void> {
  if (isAgentRunDeleted(ctx)) {
    return;
  }
  await serialize(async () => {
    if (isAgentRunDeleted(ctx)) {
      return;
    }
    emitStoredAgentRunMetric(ctx, env, input);
    if (
      isTerminalPersistableRunStatus(input.status) &&
      pendingAssistantMessageRetryAt(ctx) !== Number.POSITIVE_INFINITY
    ) {
      deferAgentRunStatus(ctx, input);
      return;
    }
    await persistOrQueueAgentRunStatus(ctx, env, input);
  });
  await armAlarm();
}

const PENDING_STATUS_KEY = "pending_db_status";
const PENDING_STATUS_RETRY_AT_KEY = "pending_db_status_retry_at";
const MIN_STATUS_RETRY_MS = 5_000;
const MAX_STATUS_RETRY_MS = 5 * 60 * 1000;

const PendingStatusSchema = z
  .object({
    attempt: z.number().int().nonnegative(),
    artifactsQuiesced: z.boolean(),
    runId: z.string().uuid(),
    status: z.enum(["running", "completed", "failed", "canceled"]),
    userId: z.string().uuid(),
  })
  .strict();

type PendingStatus = z.infer<typeof PendingStatusSchema>;

async function persistAgentRunStatus(
  env: AgentRunStatusPersistenceEnv,
  input: PersistAgentRunStatusInput,
): Promise<boolean> {
  const { db, close } = createDb(env.HYPERDRIVE, {
    audience: "app_agent",
    signingSecret: env.DATABASE_CONTEXT_SIGNING_SECRET_AGENT,
  });
  try {
    const updated = await withUserContext(db, UserId(input.userId), (tx) =>
      updateAgentRunStatus(tx, {
        artifactsQuiesced: input.artifactsQuiesced,
        runId: AgentRunId(input.runId),
        status: input.status,
        userId: UserId(input.userId),
      }),
    );
    if (!updated) {
      createLogger({ runId: input.runId, userId: input.userId }).warn(
        "agent_run_status_not_updated",
        { status: input.status },
      );
    }
    return true;
  } catch (error) {
    createLogger({ runId: input.runId, userId: input.userId }).warn(
      "agent_run_status_persist_failed",
      {
        error,
        status: input.status,
      },
    );
    return false;
  } finally {
    await close().catch((error: unknown) => {
      createLogger({ runId: input.runId, userId: input.userId }).warn("db_close_failed", {
        error,
      });
    });
  }
}

async function persistOrQueueAgentRunStatus(
  ctx: DurableObjectState,
  env: AgentRunStatusPersistenceEnv,
  input: PersistAgentRunStatusInput,
): Promise<void> {
  if (await persistAgentRunStatus(env, input)) {
    clearPendingStatus(ctx);
    return;
  }
  deferAgentRunStatus(ctx, input);
}

/** Keep Postgres nonterminal until an earlier durable transcript outbox has flushed. */
function deferAgentRunStatus(ctx: DurableObjectState, input: PersistAgentRunStatusInput): void {
  const previous = readPendingStatus(ctx);
  queuePendingStatus(ctx, input, (previous?.attempt ?? -1) + 1);
}

export async function retryPendingAgentRunStatus(
  ctx: DurableObjectState,
  env: AgentRunStatusPersistenceEnv,
): Promise<void> {
  const pending = readPendingStatus(ctx);
  if (!pending || pendingStatusRetryAt(ctx) > Date.now()) {
    return;
  }
  const input = statusInputFromPending(pending);
  if (await persistAgentRunStatus(env, input)) {
    clearPendingStatus(ctx);
    return;
  }
  queuePendingStatus(ctx, input, pending.attempt + 1);
}

export function pendingStatusRetryAt(ctx: DurableObjectState): number {
  if (!getRunStateValue(ctx, PENDING_STATUS_KEY)) {
    return Number.POSITIVE_INFINITY;
  }
  const value = Number(getRunStateValue(ctx, PENDING_STATUS_RETRY_AT_KEY));
  return Number.isFinite(value) && value > 0 ? value : Number.POSITIVE_INFINITY;
}

function readPendingStatus(ctx: DurableObjectState): PendingStatus | null {
  const raw = getRunStateValue(ctx, PENDING_STATUS_KEY);
  if (!raw) {
    return null;
  }
  try {
    const parsed = PendingStatusSchema.safeParse(JSON.parse(raw) as unknown);
    if (parsed.success) {
      return parsed.data;
    }
  } catch {
    // The durable retry record is an internal cache; malformed state must not
    // leave a past-due alarm spinning forever.
  }
  clearPendingStatus(ctx);
  return null;
}

function statusInputFromPending(pending: PendingStatus): PersistAgentRunStatusInput {
  return {
    artifactsQuiesced: pending.artifactsQuiesced,
    runId: pending.runId,
    status: pending.status,
    userId: pending.userId,
  };
}

function queuePendingStatus(
  ctx: DurableObjectState,
  input: PersistAgentRunStatusInput,
  attempt: number,
): void {
  const pending = PendingStatusSchema.parse({ ...input, attempt });
  setRunStateValue(ctx, PENDING_STATUS_KEY, JSON.stringify(pending));
  setRunStateValue(
    ctx,
    PENDING_STATUS_RETRY_AT_KEY,
    String(Date.now() + statusRetryDelay(attempt)),
  );
}

function clearPendingStatus(ctx: DurableObjectState): void {
  deleteRunStateValues(ctx, [PENDING_STATUS_KEY, PENDING_STATUS_RETRY_AT_KEY]);
}

function statusRetryDelay(attempt: number): number {
  return Math.min(MAX_STATUS_RETRY_MS, MIN_STATUS_RETRY_MS * 2 ** Math.min(attempt, 6));
}
