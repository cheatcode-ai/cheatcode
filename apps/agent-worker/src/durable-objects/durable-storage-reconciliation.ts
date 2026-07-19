import {
  assertStorageReconciliationRequest,
  reconcileExactSqliteStorage,
  storageSchemaEvidence,
} from "@cheatcode/durable-storage";
import type {
  InternalDurableObjectStorageRequest,
  InternalDurableObjectStorageResponse,
} from "@cheatcode/types";
import type { AgentRunEnv } from "./agent-run-env";
import { assertAgentRunStorage, reconcileAgentRunStorage } from "./agent-run-storage";
import type { ProjectSandboxEnv } from "./project-sandbox-lifecycle-support";
import {
  assertProjectSandboxStorage,
  reconcileProjectSandboxStorage,
} from "./project-sandbox-workspace-state";

export function reconcileAgentRunStorageRequest(
  ctx: DurableObjectState,
  env: AgentRunEnv,
  value: InternalDurableObjectStorageRequest,
): InternalDurableObjectStorageResponse {
  const input = assertStorageReconciliationRequest(ctx, env, value, "AgentRun");
  reconcileExactSqliteStorage(
    input.mode,
    () => assertAgentRunStorage(ctx),
    () => reconcileAgentRunStorage(ctx),
  );
  return storageSchemaEvidence(input);
}

export function reconcileProjectSandboxStorageRequest(
  ctx: DurableObjectState,
  env: ProjectSandboxEnv,
  value: InternalDurableObjectStorageRequest,
): InternalDurableObjectStorageResponse {
  const input = assertStorageReconciliationRequest(ctx, env, value, "ProjectSandbox");
  reconcileExactSqliteStorage(
    input.mode,
    () => assertProjectSandboxStorage(ctx),
    () => reconcileProjectSandboxStorage(ctx),
  );
  return storageSchemaEvidence(input);
}
