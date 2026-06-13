import {
  createDb,
  recordAgentRunUsage,
  updateAgentRunStatus,
  withUserContext,
} from "@cheatcode/db";
import { createLogger } from "@cheatcode/observability";
import { AgentRunId, UserId } from "@cheatcode/types";

export type PersistableRunStatus = "running" | "completed" | "failed" | "canceled";

interface AgentRunStatusPersistenceEnv {
  HYPERDRIVE: Hyperdrive;
}

export interface PersistAgentRunStatusInput {
  error?: { message: string; type: string };
  runId: string;
  status: PersistableRunStatus;
  userId: string;
}

export interface PersistAgentRunUsageInput {
  costUsd: number;
  eventType: string;
  inputTokens: number;
  model?: string;
  outputTokens: number;
  provider?: string;
  runId: string;
  userId: string;
}

export async function persistAgentRunStatus(
  env: AgentRunStatusPersistenceEnv,
  input: PersistAgentRunStatusInput,
): Promise<void> {
  if (!isUuid(input.runId)) {
    return;
  }
  const { db, close } = createDb(env.HYPERDRIVE);
  try {
    await withUserContext(db, UserId(input.userId), (tx) =>
      updateAgentRunStatus(tx, {
        ...(input.error ? { error: input.error } : {}),
        runId: AgentRunId(input.runId),
        status: input.status,
        userId: UserId(input.userId),
      }),
    );
  } catch (error) {
    createLogger({ runId: input.runId, userId: input.userId }).warn(
      "agent_run_status_persist_failed",
      {
        error: error instanceof Error ? error.message : "Unknown database error",
        status: input.status,
      },
    );
  } finally {
    await close().catch((error: unknown) => {
      createLogger({ runId: input.runId, userId: input.userId }).warn("db_close_failed", {
        error: error instanceof Error ? error.message : "Unknown database close error",
      });
    });
  }
}

export async function persistAgentRunUsage(
  env: AgentRunStatusPersistenceEnv,
  input: PersistAgentRunUsageInput,
): Promise<void> {
  if (!isUuid(input.runId)) {
    return;
  }
  const { db, close } = createDb(env.HYPERDRIVE);
  try {
    await withUserContext(db, UserId(input.userId), (tx) =>
      recordAgentRunUsage(tx, {
        agentRunId: AgentRunId(input.runId),
        costUsd: input.costUsd,
        eventType: input.eventType,
        inputTokens: input.inputTokens,
        ...(input.model ? { model: input.model } : {}),
        outputTokens: input.outputTokens,
        ...(input.provider ? { provider: input.provider } : {}),
        userId: UserId(input.userId),
      }),
    );
  } catch (error) {
    createLogger({ runId: input.runId, userId: input.userId }).warn(
      "agent_run_usage_persist_failed",
      {
        error: error instanceof Error ? error.message : "Unknown database error",
        eventType: input.eventType,
      },
    );
  } finally {
    await close().catch((error: unknown) => {
      createLogger({ runId: input.runId, userId: input.userId }).warn("db_close_failed", {
        error: error instanceof Error ? error.message : "Unknown database close error",
      });
    });
  }
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value);
}
