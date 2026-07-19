import { createDb, updateAgentRunLogicalModelId, withUserContext } from "@cheatcode/db";
import type { Logger } from "@cheatcode/observability";
import { AgentRunId, type LogicalModelId, UserId } from "@cheatcode/types";
import type { AgentRunEnv } from "./agent-run-env";
import { updateRunRowLogicalModelId } from "./agent-run-storage";
import { closeDatabaseBestEffort } from "./db-close";

interface PersistAgentRunLogicalModelInput {
  ctx: DurableObjectState;
  env: AgentRunEnv;
  logger: Logger;
  logicalModelId: LogicalModelId;
  runId: string;
  userId: string;
}

/**
 * Establishes model attribution in both durable stores before any provider
 * request starts. A missing or terminal Postgres run fails closed.
 */
export async function persistAgentRunLogicalModel(
  input: PersistAgentRunLogicalModelInput,
): Promise<void> {
  const dbHandle = createDb(input.env.HYPERDRIVE, {
    audience: "app_agent",
    signingSecret: input.env.DATABASE_CONTEXT_SIGNING_SECRET_AGENT,
  });
  try {
    const updated = await withUserContext(dbHandle.db, UserId(input.userId), (db) =>
      updateAgentRunLogicalModelId(db, {
        logicalModelId: input.logicalModelId,
        runId: AgentRunId(input.runId),
        userId: UserId(input.userId),
      }),
    );
    if (!updated) {
      throw new Error("Active agent run was not available for model attribution");
    }
    if (!updateRunRowLogicalModelId(input.ctx, input.runId, input.logicalModelId)) {
      throw new Error("AgentRun durable row was not available for model attribution");
    }
  } finally {
    await closeDatabaseBestEffort({
      dbHandle,
      logger: input.logger,
      operation: "persist_agent_run_logical_model",
    });
  }
}
