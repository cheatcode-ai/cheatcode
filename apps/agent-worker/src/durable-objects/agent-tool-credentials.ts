import type { createLogger } from "@cheatcode/observability";
import type { AgentRunEnv } from "./agent-run-env";
import type { StartRunInput } from "./agent-run-schemas";
import type { ComposioRuntimeCredentials } from "./composio-provider";
import { resolveComposioRuntimeCredentials } from "./composio-provider";
import { createGoogleToolApiKeyResolver, type GoogleToolApiKeyResolver } from "./media-provider";
import type { ResearchCredentials } from "./research-provider";
import { resolveResearchCredentials } from "./research-provider";

export type AgentToolCredentials = ComposioRuntimeCredentials &
  ResearchCredentials & { googleToolApiKeyResolver: GoogleToolApiKeyResolver };

export async function resolveAgentToolCredentials(input: {
  env: AgentRunEnv;
  logger: ReturnType<typeof createLogger>;
  run: StartRunInput;
  setRunStage(stage: string): Promise<void>;
  toolName?: string | undefined;
}): Promise<AgentToolCredentials> {
  const researchCredentials = await resolveResearchCredentialsForTool(input);
  const composioCredentials = await resolveComposioCredentialsForTool(input);
  const googleToolApiKeyResolver = createGoogleToolApiKeyResolver(
    input.env,
    input.run,
    input.logger,
  );
  return {
    ...composioCredentials,
    ...researchCredentials,
    googleToolApiKeyResolver,
  };
}

const RESEARCH_TOOL_NAMES = new Set([
  "research_deep",
  "research_fanout",
  "search_company",
  "search_extract",
  "search_scrape",
  "search_web",
  "search_web_advanced",
  "search_web_content",
]);

async function resolveResearchCredentialsForTool(
  input: Parameters<typeof resolveAgentToolCredentials>[0],
): Promise<ResearchCredentials> {
  if (!input.toolName || !RESEARCH_TOOL_NAMES.has(input.toolName)) {
    return {};
  }
  await input.setRunStage("Resolving research providers.");
  return resolveResearchCredentials(input.env, input.run, input.logger);
}

async function resolveComposioCredentialsForTool(
  input: Parameters<typeof resolveAgentToolCredentials>[0],
): Promise<ComposioRuntimeCredentials> {
  if (input.toolName !== "composio_execute" && input.toolName !== "composio_list_tools") {
    return {};
  }
  await input.setRunStage("Resolving connected apps.");
  return resolveComposioRuntimeCredentials(input.env, input.run, input.logger);
}
