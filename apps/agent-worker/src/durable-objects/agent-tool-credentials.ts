import type { createLogger } from "@cheatcode/observability";
import type { AgentRunEnv } from "./agent-run-env";
import type { StartRunInput } from "./agent-run-schemas";
import type { ComposioRuntimeCredentials } from "./composio-provider";
import { resolveComposioRuntimeCredentials } from "./composio-provider";
import type { ResearchCredentials } from "./research-provider";
import { resolveResearchCredentials } from "./research-provider";

export type AgentToolCredentials = ComposioRuntimeCredentials & ResearchCredentials;

export async function resolveAgentToolCredentials(input: {
  env: AgentRunEnv;
  logger: ReturnType<typeof createLogger>;
  run: StartRunInput;
  setRunStage(stage: string): void;
}): Promise<AgentToolCredentials> {
  input.setRunStage("Resolving research providers.");
  const researchCredentials = await resolveResearchCredentials(input.env, input.run, input.logger);
  input.setRunStage("Resolving Composio providers.");
  const composioCredentials = await resolveComposioRuntimeCredentials(
    input.env,
    input.run,
    input.logger,
  );
  return {
    ...composioCredentials,
    ...researchCredentials,
  };
}
