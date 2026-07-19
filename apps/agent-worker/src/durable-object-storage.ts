import { APIError, readBoundedRequestText } from "@cheatcode/observability";
import {
  INTERNAL_DURABLE_OBJECT_STORAGE_PATH,
  InternalDurableObjectStorageRequestSchema,
  InternalDurableObjectStorageResponseSchema,
} from "@cheatcode/types";
import type { Context, Hono } from "hono";
import type { AgentEnv } from "./agent-env";
import {
  assertAgentDurableObjectStorageCapability,
  assertAgentInternalHostname,
  parseInternalMaintenanceJson,
  verifyAgentDurableObjectStorageRequest,
} from "./internal-maintenance";

const MAX_STORAGE_BODY_BYTES = 4 * 1024;
type AgentContext = Context<{ Bindings: AgentEnv }>;

export function registerAgentDurableObjectStorageRoute(app: Hono<{ Bindings: AgentEnv }>): void {
  app.post(INTERNAL_DURABLE_OBJECT_STORAGE_PATH, handleDurableObjectStorage);
}

async function handleDurableObjectStorage(c: AgentContext): Promise<Response> {
  assertClosedRelease(c.env);
  assertAgentInternalHostname(c.req.raw);
  assertAgentDurableObjectStorageCapability(c.req.raw);
  const rawBody = await readBoundedRequestText(
    c.req.raw,
    MAX_STORAGE_BODY_BYTES,
    "Durable Object storage request",
  );
  await verifyAgentDurableObjectStorageRequest({
    expectedPathname: INTERNAL_DURABLE_OBJECT_STORAGE_PATH,
    rawBody,
    request: c.req.raw,
    secrets: c.env,
  });
  const input = InternalDurableObjectStorageRequestSchema.parse(
    parseInternalMaintenanceJson(rawBody),
  );
  if (input.releaseSha !== c.env.CHEATCODE_RELEASE_SHA) {
    throw releaseMismatch("Durable Object request does not match the agent release");
  }
  if (input.className === "AgentRun") {
    const id = c.env.AGENT_RUN.idFromString(input.objectId);
    return c.json(
      InternalDurableObjectStorageResponseSchema.parse(
        await c.env.AGENT_RUN.get(id).reconcileStorageSchema(input),
      ),
    );
  }
  if (input.className === "ProjectSandbox") {
    const id = c.env.PROJECT_SANDBOX.idFromString(input.objectId);
    return c.json(
      InternalDurableObjectStorageResponseSchema.parse(
        await c.env.PROJECT_SANDBOX.get(id).reconcileStorageSchema(input),
      ),
    );
  }
  throw releaseMismatch("Durable Object class is not owned by the agent Worker");
}

function assertClosedRelease(env: AgentEnv): void {
  if (env.CHEATCODE_RELEASE_GATE !== "closed") {
    throw releaseMismatch("Durable Object reconciliation requires the closed release gate");
  }
}

function releaseMismatch(message: string): APIError {
  return new APIError(409, "conflict_state_invalid", message, { retriable: false });
}
