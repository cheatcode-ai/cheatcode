import type { CodeRuntimeContext } from "@cheatcode/sandbox-contracts";
import type { RunIntent } from "@cheatcode/types";
import { RequestContext } from "@mastra/core/request-context";
import {
  COMPOSIO_API_KEY_CONTEXT_KEY,
  COMPOSIO_CONNECTED_ACCOUNTS_CONTEXT_KEY,
  COMPOSIO_QUOTA_METER_CONTEXT_KEY,
  COMPOSIO_USER_ID_CONTEXT_KEY,
  type ComposioConnectedAccounts,
  type ComposioQuotaMeter,
} from "../composio-context";
import {
  ANTHROPIC_API_KEY_CONTEXT_KEY,
  DEEPSEEK_API_KEY_CONTEXT_KEY,
  GOOGLE_API_KEY_CONTEXT_KEY,
  LLM_MODEL_ID_CONTEXT_KEY,
  LLM_PROVIDER_CONTEXT_KEY,
  type LlmProvider,
  OPENAI_API_KEY_CONTEXT_KEY,
  OPENROUTER_API_KEY_CONTEXT_KEY,
} from "../llm-context";
import { EXA_API_KEY_CONTEXT_KEY, FIRECRAWL_API_KEY_CONTEXT_KEY } from "../research-context";
import {
  AGENT_DISPLAY_NAME_CONTEXT_KEY,
  GLOBAL_MEMORY_CONTEXT_KEY,
  PROMPT_PROJECT_MODE_CONTEXT_KEY,
  PROMPT_TASK_MESSAGE_CONTEXT_KEY,
  PROMPT_WORKSPACE_DIR_CONTEXT_KEY,
  RUN_INTENT_CONTEXT_KEY,
  USER_SKILL_LOADER_CONTEXT_KEY,
  USER_SKILLS_CONTEXT_KEY,
  type UserSkillLoader,
  type UserSkillRuntime,
} from "../system-prompt";
import { BROWSER_RUN_ID_CONTEXT_KEY } from "./browser-runtime";

export interface CodeRequestContextOptions {
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
  userSkillLoader?: UserSkillLoader | undefined;
}

export function createCodeRequestContext(
  runtimeContext: CodeRuntimeContext,
  options: CodeRequestContextOptions = {},
): RequestContext {
  const requestContext = new RequestContext();
  requestContext.set("codeRuntime", runtimeContext);
  setOptionalContextValue(
    requestContext,
    PROMPT_WORKSPACE_DIR_CONTEXT_KEY,
    runtimeContext.workspaceDir,
  );
  for (const [key, value] of contextEntries(options)) {
    setOptionalContextValue(requestContext, key, value);
  }
  return requestContext;
}

function contextEntries(
  options: CodeRequestContextOptions,
): ReadonlyArray<readonly [string, unknown]> {
  return [
    [LLM_PROVIDER_CONTEXT_KEY, options.llmProvider],
    [LLM_MODEL_ID_CONTEXT_KEY, options.modelId],
    [AGENT_DISPLAY_NAME_CONTEXT_KEY, options.agentDisplayName],
    [GLOBAL_MEMORY_CONTEXT_KEY, options.globalMemory],
    [PROMPT_PROJECT_MODE_CONTEXT_KEY, options.projectMode],
    [RUN_INTENT_CONTEXT_KEY, options.runIntent],
    [PROMPT_TASK_MESSAGE_CONTEXT_KEY, options.taskMessage],
    [ANTHROPIC_API_KEY_CONTEXT_KEY, options.anthropicApiKey],
    [COMPOSIO_API_KEY_CONTEXT_KEY, options.composioApiKey],
    [COMPOSIO_CONNECTED_ACCOUNTS_CONTEXT_KEY, options.composioConnectedAccounts],
    [COMPOSIO_QUOTA_METER_CONTEXT_KEY, options.composioQuotaMeter],
    [COMPOSIO_USER_ID_CONTEXT_KEY, options.composioUserId],
    [OPENAI_API_KEY_CONTEXT_KEY, options.openaiApiKey],
    [GOOGLE_API_KEY_CONTEXT_KEY, options.googleApiKey],
    [OPENROUTER_API_KEY_CONTEXT_KEY, options.openrouterApiKey],
    [DEEPSEEK_API_KEY_CONTEXT_KEY, options.deepseekApiKey],
    [EXA_API_KEY_CONTEXT_KEY, options.exaApiKey],
    [FIRECRAWL_API_KEY_CONTEXT_KEY, options.firecrawlApiKey],
    [BROWSER_RUN_ID_CONTEXT_KEY, options.runId],
    [USER_SKILLS_CONTEXT_KEY, options.userSkills],
    [USER_SKILL_LOADER_CONTEXT_KEY, options.userSkillLoader],
  ];
}

function setOptionalContextValue(
  requestContext: RequestContext,
  key: string,
  value: unknown,
): void {
  if (typeof value === "string" && value.length === 0) {
    return;
  }
  if (value !== undefined) {
    requestContext.set(key, value);
  }
}
