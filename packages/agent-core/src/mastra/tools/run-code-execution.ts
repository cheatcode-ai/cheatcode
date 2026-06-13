import type { CodeRuntimeContext, RunCodeInput, RunCodeOutput } from "@cheatcode/tools-code";
import { RunCodeInputSchema, RunCodeOutputSchema } from "@cheatcode/tools-code";
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
  GOOGLE_API_KEY_CONTEXT_KEY,
  LLM_MODEL_ID_CONTEXT_KEY,
  LLM_PROVIDER_CONTEXT_KEY,
  type LlmProvider,
  OPENAI_API_KEY_CONTEXT_KEY,
  OPENROUTER_API_KEY_CONTEXT_KEY,
} from "../llm-context";
import { ELEVENLABS_API_KEY_CONTEXT_KEY, FAL_API_KEY_CONTEXT_KEY } from "../media-context";
import {
  EXA_API_KEY_CONTEXT_KEY,
  FIRECRAWL_API_KEY_CONTEXT_KEY,
  RESEARCH_FANOUT_SUBAGENT_LIMIT_CONTEXT_KEY,
} from "../research-context";
import {
  AGENT_DISPLAY_NAME_CONTEXT_KEY,
  GLOBAL_MEMORY_CONTEXT_KEY,
  MASTER_INSTRUCTIONS_CONTEXT_KEY,
} from "../system-prompt";
import { APPROVAL_BROKER_CONTEXT_KEY, type ApprovalBroker } from "./approval-context";
import { mastraRunCode } from "./registry";

export interface CodeRequestContextOptions {
  agentDisplayName?: string | undefined;
  anthropicApiKey?: string | undefined;
  approvalBroker?: ApprovalBroker | undefined;
  composioApiKey?: string | undefined;
  composioConnectedAccounts?: ComposioConnectedAccounts | undefined;
  composioQuotaMeter?: ComposioQuotaMeter | undefined;
  composioUserId?: string | undefined;
  elevenlabsApiKey?: string | undefined;
  exaApiKey?: string | undefined;
  falApiKey?: string | undefined;
  firecrawlApiKey?: string | undefined;
  globalMemory?: string | undefined;
  googleApiKey?: string | undefined;
  llmProvider?: LlmProvider | undefined;
  masterInstructions?: string | undefined;
  modelId?: string | undefined;
  openaiApiKey?: string | undefined;
  openrouterApiKey?: string | undefined;
  researchFanoutSubagentLimit?: number | undefined;
}

export function createCodeRequestContext(
  runtimeContext: CodeRuntimeContext,
  options: CodeRequestContextOptions = {},
): RequestContext {
  const requestContext = new RequestContext();
  requestContext.set("codeRuntime", runtimeContext);
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
    [MASTER_INSTRUCTIONS_CONTEXT_KEY, options.masterInstructions],
    [AGENT_DISPLAY_NAME_CONTEXT_KEY, options.agentDisplayName],
    [GLOBAL_MEMORY_CONTEXT_KEY, options.globalMemory],
    [ANTHROPIC_API_KEY_CONTEXT_KEY, options.anthropicApiKey],
    [COMPOSIO_API_KEY_CONTEXT_KEY, options.composioApiKey],
    [COMPOSIO_CONNECTED_ACCOUNTS_CONTEXT_KEY, options.composioConnectedAccounts],
    [COMPOSIO_QUOTA_METER_CONTEXT_KEY, options.composioQuotaMeter],
    [COMPOSIO_USER_ID_CONTEXT_KEY, options.composioUserId],
    [OPENAI_API_KEY_CONTEXT_KEY, options.openaiApiKey],
    [GOOGLE_API_KEY_CONTEXT_KEY, options.googleApiKey],
    [OPENROUTER_API_KEY_CONTEXT_KEY, options.openrouterApiKey],
    [EXA_API_KEY_CONTEXT_KEY, options.exaApiKey],
    [FIRECRAWL_API_KEY_CONTEXT_KEY, options.firecrawlApiKey],
    [RESEARCH_FANOUT_SUBAGENT_LIMIT_CONTEXT_KEY, options.researchFanoutSubagentLimit],
    [FAL_API_KEY_CONTEXT_KEY, options.falApiKey],
    [ELEVENLABS_API_KEY_CONTEXT_KEY, options.elevenlabsApiKey],
    [APPROVAL_BROKER_CONTEXT_KEY, options.approvalBroker],
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

export function createSandboxReadinessRunCodeInput(messageText: string): RunCodeInput {
  return RunCodeInputSchema.parse({
    language: "python",
    code: `print("Cheatcode sandbox online")\nprint("User request:", ${JSON.stringify(messageText)})`,
  });
}

export async function executeRunCodeTool(
  input: RunCodeInput,
  runtimeContext: CodeRuntimeContext,
): Promise<RunCodeOutput> {
  const execute = mastraRunCode.execute;
  if (!execute) {
    throw new Error("Mastra runCode tool is missing an execute handler.");
  }

  const output = await execute(RunCodeInputSchema.parse(input), {
    requestContext: createCodeRequestContext(runtimeContext),
  });
  return RunCodeOutputSchema.parse(output);
}
