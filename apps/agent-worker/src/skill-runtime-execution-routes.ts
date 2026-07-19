import { ComposioClient } from "@cheatcode/composio";
import { createLogger, readJsonRequest } from "@cheatcode/observability";
import { IntegrationNameSchema } from "@cheatcode/types/integrations";
import type { Context, Hono } from "hono";
import { z } from "zod";
import type { AgentEnv } from "./agent-env";
import { agentRunForRunId } from "./agent-routing";
import { resolveComposioRuntimeCredentials } from "./durable-objects/composio-provider";
import { requireSkillRuntimePrincipal } from "./skill-runtime-auth";

type AgentContext = Context<{ Bindings: AgentEnv }>;
const MAX_EXECUTION_REQUEST_BYTES = 256 * 1024;
const COMPOSIO_TIMEOUT_MS = 30_000;
const ToolRequestSchema = z
  .object({
    arguments: z.record(z.string(), z.unknown()).default({}),
    projectId: z.string().uuid().optional(),
    toolkitSlug: IntegrationNameSchema,
    toolSlug: z.string().trim().min(1).max(200),
  })
  .strict();
const ProxyRequestSchema = z
  .object({
    body: z.unknown().optional(),
    endpoint: z.string().trim().min(1).max(500),
    method: z.enum(["GET", "POST", "PATCH", "DELETE"]).default("POST"),
    projectId: z.string().uuid().optional(),
    toolkitSlug: IntegrationNameSchema,
  })
  .strict();
const FrontendEventSchema = z.object({ event: z.unknown() }).passthrough();

export function registerSkillRuntimeExecutionRoutes(app: Hono<{ Bindings: AgentEnv }>): void {
  app.post("/skill-runtime/composio/tool", executeComposioTool);
  app.post("/skill-runtime/composio/proxy", rejectUnsafeComposioProxy);
  app.post("/skill-runtime/skill-frontend-events", acceptFrontendEvent);
  app.post("/skill-runtime/browser/live-preview", startBrowserTakeover);
  app.post("/skill-runtime/browser/request-user-control", startBrowserTakeover);
}

async function executeComposioTool(c: AgentContext): Promise<Response> {
  const principal = await requireSkillRuntimePrincipal(
    c.env,
    c.req.raw.headers,
    "integrations:execute",
  );
  const input = ToolRequestSchema.parse(
    await readJsonRequest(c.req.raw, MAX_EXECUTION_REQUEST_BYTES, "Composio tool request"),
  );
  requireMatchingProject(principal.projectId, input.projectId);
  const logger = createLogger({ runId: principal.runId, userId: principal.userId });
  const runtime = await resolveComposioRuntimeCredentials(
    c.env,
    { userId: principal.userId },
    logger,
  );
  const connectionId = runtime.composioConnectedAccounts?.[input.toolkitSlug];
  if (!runtime.composioApiKey || !runtime.composioUserId || !connectionId) {
    return c.json(failedTool(`Connect ${input.toolkitSlug} in Skills first.`));
  }
  const version = await resolveToolVersion(
    runtime.composioApiKey,
    input.toolkitSlug,
    input.toolSlug,
  );
  const quota = await runtime.composioQuotaMeter?.consumeCall(
    `skill:${principal.runId}:${crypto.randomUUID()}`,
  );
  if (quota && !quota.allowed) {
    return c.json(failedTool("Composio monthly call quota exhausted."));
  }
  try {
    const result = await new ComposioClient(runtime.composioApiKey).executeTool(
      input.toolSlug,
      {
        arguments: input.arguments,
        connectedAccountId: connectionId,
        userId: runtime.composioUserId,
        version,
      },
      COMPOSIO_TIMEOUT_MS,
    );
    return c.json(result);
  } catch (error) {
    logger.warn("skill_runtime_composio_execution_failed", { error, toolSlug: input.toolSlug });
    return c.json(failedTool("Composio tool execution failed."));
  }
}

async function resolveToolVersion(
  apiKey: string,
  toolkitSlug: string,
  toolSlug: string,
): Promise<string> {
  const page = await new ComposioClient(apiKey).listTools(
    { limit: 100, search: toolSlug, toolkit: toolkitSlug },
    COMPOSIO_TIMEOUT_MS,
  );
  const tool = page.items.find((item) => item.slug.toLowerCase() === toolSlug.toLowerCase());
  return tool?.version ?? "latest";
}

async function rejectUnsafeComposioProxy(c: AgentContext): Promise<Response> {
  const principal = await requireSkillRuntimePrincipal(
    c.env,
    c.req.raw.headers,
    "integrations:execute",
  );
  const input = ProxyRequestSchema.parse(
    await readJsonRequest(c.req.raw, MAX_EXECUTION_REQUEST_BYTES, "Composio proxy request"),
  );
  requireMatchingProject(principal.projectId, input.projectId);
  return c.json(
    {
      error:
        "This provider endpoint is not in Cheatcode's validated Composio tool catalog. Use /composio/tool with a catalog tool slug.",
    },
    400,
  );
}

async function acceptFrontendEvent(c: AgentContext): Promise<Response> {
  await requireSkillRuntimePrincipal(c.env, c.req.raw.headers, "events:write");
  FrontendEventSchema.parse(await readJsonRequest(c.req.raw, 64 * 1024, "Skill frontend event"));
  return c.json({ delivered: false });
}

async function startBrowserTakeover(c: AgentContext): Promise<Response> {
  const principal = await requireSkillRuntimePrincipal(c.env, c.req.raw.headers, "events:write");
  return agentRunForRunId(c.env, principal.runId).fetch(
    "https://agent-run.internal/browser-takeover/start",
    {
      headers: { "X-Cheatcode-User-Id": principal.userId },
      method: "POST",
    },
  );
}

function failedTool(error: string) {
  return { data: null, error, successful: false };
}

function requireMatchingProject(
  capabilityProjectId: string | null,
  requestedProjectId: string | undefined,
): void {
  if (requestedProjectId && requestedProjectId !== capabilityProjectId) {
    throw new Error("Skill runtime project mismatch");
  }
}
