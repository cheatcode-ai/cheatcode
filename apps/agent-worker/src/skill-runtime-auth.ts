import {
  SkillRuntimeCapabilityError,
  type SkillRuntimeScope,
  type VerifiedSkillRuntimeCapability,
  verifySkillRuntimeCapability,
} from "@cheatcode/auth";
import { createDb, findAgentRunForUser, withUserContext } from "@cheatcode/db";
import { resolveWorkerSecret } from "@cheatcode/env";
import { APIError } from "@cheatcode/observability";
import { AgentRunId, UserId } from "@cheatcode/types";
import type { AgentEnv } from "./agent-env";

export interface SkillRuntimePrincipal extends VerifiedSkillRuntimeCapability {
  userId: ReturnType<typeof UserId>;
}

/** Verifies the sandbox capability and binds it to a still-active persisted run. */
export async function requireSkillRuntimePrincipal(
  env: AgentEnv,
  headers: Headers,
  requiredScope: SkillRuntimeScope,
): Promise<SkillRuntimePrincipal> {
  const token = bearerToken(headers);
  const secret = await resolveWorkerSecret(env.SKILL_RUNTIME_TOKEN_SECRET);
  if (!secret) {
    throw new APIError(503, "unavailable_maintenance", "Skill runtime is unavailable", {
      retriable: true,
    });
  }
  const capability = await verifiedCapability(token, secret, requiredScope);
  const userId = UserId(capability.userId);
  await requireActiveRun(env, capability, userId);
  return { ...capability, userId };
}

async function verifiedCapability(
  token: string,
  secret: string,
  requiredScope: SkillRuntimeScope,
): Promise<VerifiedSkillRuntimeCapability> {
  try {
    return await verifySkillRuntimeCapability({ requiredScope, secret, token });
  } catch (error) {
    const expired = error instanceof SkillRuntimeCapabilityError && error.reason === "expired";
    throw new APIError(
      401,
      expired ? "auth_token_expired" : "auth_token_invalid",
      expired ? "Skill runtime session expired" : "Invalid skill runtime session",
      { retriable: expired },
    );
  }
}

async function requireActiveRun(
  env: AgentEnv,
  capability: VerifiedSkillRuntimeCapability,
  userId: ReturnType<typeof UserId>,
): Promise<void> {
  const { db, close } = createDb(env.HYPERDRIVE, {
    audience: "app_agent",
    signingSecret: env.DATABASE_CONTEXT_SIGNING_SECRET_AGENT,
  });
  try {
    const run = await withUserContext(db, userId, (tx) =>
      findAgentRunForUser(tx, { runId: AgentRunId(capability.runId), userId }),
    );
    if (!run || !["pending", "running"].includes(run.status)) {
      throw new APIError(409, "conflict_state_invalid", "Skill runtime run is not active", {
        retriable: false,
      });
    }
    if ((run.projectId ?? null) !== capability.projectId) {
      throw new APIError(403, "permission_denied", "Skill runtime project mismatch", {
        retriable: false,
      });
    }
  } finally {
    await close();
  }
}

function bearerToken(headers: Headers): string {
  const authorization = headers.get("Authorization") ?? "";
  const [scheme, token, ...extra] = authorization.trim().split(/\s+/u);
  if (scheme !== "Bearer" || !token || extra.length > 0) {
    throw new APIError(401, "auth_token_missing", "Missing skill runtime capability", {
      retriable: false,
    });
  }
  return token;
}
