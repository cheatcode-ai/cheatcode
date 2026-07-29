import type { CodeRuntimeContext } from "@cheatcode/sandbox-contracts";
import type { RunIntent } from "@cheatcode/types/api";
import { RequestContext } from "@mastra/core/request-context";
import type { ComposioConnectedAccounts, ComposioQuotaMeter } from "../composio-context";
import { CONTEXT, type ContextKey } from "../context";
import type { LlmProvider } from "../llm-context";
import type { UserSkillCreator, UserSkillLoader, UserSkillRuntime } from "../user-skill-runtime";

interface CodeRequestContextOptions {
  agentDisplayName?: string | undefined;
  anthropicApiKey?: string | undefined;
  composioApiKey?: string | undefined;
  composioConnectedAccounts?: ComposioConnectedAccounts | undefined;
  composioQuotaMeter?: ComposioQuotaMeter | undefined;
  composioUserId?: string | undefined;
  deepseekApiKey?: string | undefined;
  exaApiKey?: string | undefined;
  firecrawlApiKey?: string | undefined;
  globalMemory?: string | undefined;
  googleApiKey?: string | undefined;
  llmProvider?: LlmProvider | undefined;
  modelId?: string | undefined;
  openaiApiKey?: string | undefined;
  openrouterApiKey?: string | undefined;
  projectMode?: string | undefined;
  runIntent?: RunIntent | undefined;
  runId?: string | undefined;
  taskMessage?: string | undefined;
  userSkills?: UserSkillRuntime[] | undefined;
  userSkillCreator?: UserSkillCreator | undefined;
  userSkillLoader?: UserSkillLoader | undefined;
}

export function createCodeRequestContext(
  runtimeContext: CodeRuntimeContext,
  options: CodeRequestContextOptions = {},
): RequestContext {
  const requestContext = new RequestContext();
  requestContext.set(CONTEXT.codeRuntime, runtimeContext);
  setOptionalContextValue(requestContext, CONTEXT.promptWorkspaceDir, runtimeContext.workspaceDir);
  for (const [key, value] of contextEntries(options)) {
    setOptionalContextValue(requestContext, key, value);
  }
  return requestContext;
}

function contextEntries(
  options: CodeRequestContextOptions,
): ReadonlyArray<readonly [ContextKey, unknown]> {
  return [
    [CONTEXT.llmProvider, options.llmProvider],
    [CONTEXT.llmModelId, options.modelId],
    [CONTEXT.agentDisplayName, options.agentDisplayName],
    [CONTEXT.globalMemory, options.globalMemory],
    [CONTEXT.promptProjectMode, options.projectMode],
    [CONTEXT.runIntent, options.runIntent],
    [CONTEXT.promptTaskMessage, options.taskMessage],
    [CONTEXT.anthropicApiKey, options.anthropicApiKey],
    [CONTEXT.composioApiKey, options.composioApiKey],
    [CONTEXT.composioConnectedAccounts, options.composioConnectedAccounts],
    [CONTEXT.composioQuotaMeter, options.composioQuotaMeter],
    [CONTEXT.composioUserId, options.composioUserId],
    [CONTEXT.openaiApiKey, options.openaiApiKey],
    [CONTEXT.googleApiKey, options.googleApiKey],
    [CONTEXT.openrouterApiKey, options.openrouterApiKey],
    [CONTEXT.deepseekApiKey, options.deepseekApiKey],
    [CONTEXT.exaApiKey, options.exaApiKey],
    [CONTEXT.firecrawlApiKey, options.firecrawlApiKey],
    [CONTEXT.browserRunId, options.runId],
    [CONTEXT.userSkills, options.userSkills],
    [CONTEXT.userSkillCreator, options.userSkillCreator],
    [CONTEXT.userSkillLoader, options.userSkillLoader],
  ];
}

function setOptionalContextValue(
  requestContext: RequestContext,
  key: ContextKey,
  value: unknown,
): void {
  if (typeof value === "string" && value.length === 0) {
    return;
  }
  if (value !== undefined) {
    requestContext.set(key, value);
  }
}
