import { parseSkillRuntimeCapability, verifySkillRuntimeCapabilityDigest } from "@cheatcode/auth";
import { authorizeSkillRuntimeCapability, withUserDb } from "@cheatcode/db";
import { APIError } from "@cheatcode/observability";
import { type SkillRuntimeScope, toAgentRunId, toUserId, type UserId } from "@cheatcode/types";
import type { AgentEnv } from "./agent-env";

export interface SkillRuntimePrincipal {
  expiresAt: number;
  projectId: string | null;
  runId: string;
  scope: SkillRuntimeScope;
  userId: UserId;
}

/** Resolves one opaque sandbox capability through shared, tenant-scoped run state. */
export async function requireSkillRuntimePrincipal(
  env: AgentEnv,
  headers: Headers,
  requiredScope: SkillRuntimeScope,
): Promise<SkillRuntimePrincipal> {
  const token = bearerToken(headers);
  const parsed = parseSkillRuntimeCapability(token);
  if (!parsed) {
    throw invalidCapability();
  }
  const userId = toUserId(parsed.userId);
  return withUserDb(env, userId, async ({ transaction }) => {
    const authorization = await transaction((tx) =>
      authorizeSkillRuntimeCapability(tx, {
        requiredScope,
        runId: toAgentRunId(parsed.runId),
        tokenId: parsed.tokenId,
        userId,
      }),
    );
    if (!authorization) {
      throw invalidCapability();
    }
    if (authorization.capability.expiresAt <= Date.now()) {
      throw new APIError(401, "auth_token_expired", "Skill runtime session expired", {
        retriable: true,
      });
    }
    if (!(await verifySkillRuntimeCapabilityDigest(token, authorization.capability.digest))) {
      throw invalidCapability();
    }
    return {
      expiresAt: authorization.capability.expiresAt,
      projectId: authorization.projectId,
      runId: parsed.runId,
      scope: authorization.capability.scope,
      userId,
    };
  });
}

function invalidCapability(): APIError {
  return new APIError(401, "auth_token_invalid", "Invalid skill runtime session", {
    retriable: false,
  });
}

function bearerToken(headers: Headers): string {
  const authorization = headers.get("Authorization") ?? "";
  const [scheme, token, ...extra] = authorization.trim().split(/\s+/u);
  if (scheme !== "Bearer" || !token || extra.length > 0 || token.length > 512) {
    throw new APIError(401, "auth_token_missing", "Missing skill runtime capability", {
      retriable: false,
    });
  }
  return token;
}
