import { createCodeRequestContext } from "@cheatcode/agent-core";
import { workspacePathForSlug } from "@cheatcode/db";
import type { createLogger } from "@cheatcode/observability";
import type {
  ArtifactRuntime,
  CodeRuntimeContext,
  WorkspaceResolver,
} from "@cheatcode/sandbox-contracts";
import type { AgentRunEnv } from "./agent-run-env";
import type { StartRunInput } from "./agent-run-schemas";
import { resolveUserSkillContext } from "./agent-run-user-skills";
import { resolveAgentToolCredentials } from "./agent-tool-credentials";
import type { LlmCredential } from "./llm-provider";
import { createMorphApplyResolver } from "./morph-provider";

type ProjectSandboxStub = CodeRuntimeContext["sandbox"];
type ResolvedToolCredentials = Awaited<ReturnType<typeof resolveAgentToolCredentials>>;
type ResolvedUserSkillContext = Awaited<ReturnType<typeof resolveUserSkillContext>>;

export interface PreparedMastraContext extends ResolvedUserSkillContext {
  toolCredentials: ResolvedToolCredentials;
}

export interface MastraContextOptions {
  artifactRuntime: ArtifactRuntime;
  credential: LlmCredential;
  env: AgentRunEnv;
  input: StartRunInput;
  logger: ReturnType<typeof createLogger>;
  sandbox: ProjectSandboxStub;
  setRunStage: (stage: string) => Promise<void>;
  workspaceResolver: WorkspaceResolver;
}

/** Resolves request-scoped credentials and user skills inside the active Workflow step. */
export async function prepareMastraContext(
  options: MastraContextOptions,
): Promise<PreparedMastraContext> {
  const toolCredentials = await resolveAgentToolCredentials({
    env: options.env,
    logger: options.logger,
    run: options.input,
    setRunStage: options.setRunStage,
  });
  const userSkillContext = await resolveUserSkillContext(
    options.env,
    options.input.userId,
    options.sandbox,
  );
  options.logger.info("agent_tool_credentials_resolved", {
    composioConfigured: Boolean(toolCredentials.composioApiKey),
    exaConfigured: Boolean(toolCredentials.exaApiKey),
    firecrawlConfigured: Boolean(toolCredentials.firecrawlApiKey),
  });
  return { ...userSkillContext, toolCredentials };
}

/** Builds the Mastra request context without retaining plaintext credentials between steps. */
export function createAgentRequestContext(
  options: MastraContextOptions,
  prepared: PreparedMastraContext,
): ReturnType<typeof createCodeRequestContext> {
  const { credential, input } = options;
  const { toolCredentials, userSkillCreator, userSkillLoader, userSkills } = prepared;
  const isSkillCreator = input.runIntent === "skill-creator";
  const codeRuntime: CodeRuntimeContext = {
    artifacts: options.artifactRuntime,
    ensureWorkspace: async () => {
      const workspace = await options.workspaceResolver();
      codeRuntime.workspaceDir = workspace.workspaceDir;
      codeRuntime.workspaceSlug = workspace.workspaceSlug;
      return workspace;
    },
    sandbox: options.sandbox,
    ...(isSkillCreator
      ? { workspaceDir: "/workspace" }
      : input.workspaceSlug
        ? {
            workspaceDir: workspacePathForSlug(input.workspaceSlug),
            workspaceSlug: input.workspaceSlug,
          }
        : {}),
  };
  return createCodeRequestContext(codeRuntime, {
    agentDisplayName: input.agentDisplayName,
    anthropicApiKey: credential.transportProvider === "anthropic" ? credential.apiKey : undefined,
    composioApiKey: toolCredentials.composioApiKey,
    composioConnectedAccounts: toolCredentials.composioConnectedAccounts,
    composioQuotaMeter: toolCredentials.composioQuotaMeter,
    composioUserId: toolCredentials.composioUserId,
    deepseekApiKey: credential.transportProvider === "deepseek" ? credential.apiKey : undefined,
    exaApiKey: toolCredentials.exaApiKey,
    firecrawlApiKey: toolCredentials.firecrawlApiKey,
    globalMemory: input.globalMemory,
    googleToolApiKeyResolver: toolCredentials.googleToolApiKeyResolver,
    llmProvider: credential.transportProvider,
    modelId: credential.transportModelId,
    morphApplyResolver: createMorphApplyResolver(options.env),
    openaiApiKey: credential.transportProvider === "openai" ? credential.apiKey : undefined,
    openrouterApiKey: credential.transportProvider === "openrouter" ? credential.apiKey : undefined,
    projectMode: input.projectMode,
    runIntent: input.runIntent,
    runId: input.runId,
    taskMessage: input.messageText,
    ...(isSkillCreator ? { userSkillCreator } : {}),
    userSkillLoader,
    userSkills,
  });
}
