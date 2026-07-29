import { updateAgentRunLogicalModelId, withUserDb } from "@cheatcode/db";
import type { Logger } from "@cheatcode/observability";
import { type LogicalModelId, toAgentRunId, toUserId } from "@cheatcode/types";
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
  await withUserDb(
    input.env,
    toUserId(input.userId),
    async ({ transaction }) => {
      const updated = await transaction((db) =>
        updateAgentRunLogicalModelId(db, {
          logicalModelId: input.logicalModelId,
          runId: toAgentRunId(input.runId),
          userId: toUserId(input.userId),
        }),
      );
      if (!updated) {
        throw new Error("Active agent run was not available for model attribution");
      }
      if (!updateRunRowLogicalModelId(input.ctx, input.runId, input.logicalModelId)) {
        throw new Error("AgentRun durable row was not available for model attribution");
      }
    },
    (dbHandle) =>
      closeDatabaseBestEffort({
        dbHandle,
        logger: input.logger,
        operation: "persist_agent_run_logical_model",
      }),
  );
}
