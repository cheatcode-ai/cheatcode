import {
  parseSkillRuntimeCapability,
  type SkillRuntimeScope,
  verifySkillRuntimeCapabilityDigest,
} from "@cheatcode/auth";
import { authorizeSkillRuntimeCapability, createDb, withUserContext } from "@cheatcode/db";
import { APIError } from "@cheatcode/observability";
import { AgentRunId, UserId } from "@cheatcode/types";
import type { AgentEnv } from "./agent-env";

export interface SkillRuntimePrincipal {
  expiresAt: number;
  projectId: string | null;
  runId: string;
  scope: SkillRuntimeScope;
  userId: ReturnType<typeof UserId>;
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
  const userId = UserId(parsed.userId);
  const { db, close } = createDb(env.HYPERDRIVE, {
    audience: "app_agent",
    signingSecret: env.DATABASE_CONTEXT_SIGNING_SECRET_AGENT,
  });
  try {
    const authorization = await withUserContext(db, userId, (tx) =>
      authorizeSkillRuntimeCapability(tx, {
        requiredScope,
        runId: AgentRunId(parsed.runId),
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
  } finally {
    await close();
  }
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
