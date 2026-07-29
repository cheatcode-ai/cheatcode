import { mintSkillRuntimeCapability } from "@cheatcode/auth";
import {
  rotateSkillRuntimeCapabilities,
  type StoredSkillRuntimeCapability,
  withUserDb,
} from "@cheatcode/db";
import type { SandboxLike } from "@cheatcode/sandbox-contracts";
import { type SkillRuntimeScope, toAgentRunId, toUserId } from "@cheatcode/types";
import type { AgentRunEnv } from "./agent-run-env";
import type { StartRunInput } from "./agent-run-schemas";

const SKILL_RUNTIME_CONFIG_PATH = "/workspace/.cheatcode/runtime/skill-runtime-config.json";
const SKILL_RUNTIME_PUBLIC_BASE_URL = "https://gateway.trycheatcode.com/skill-runtime";

export const SKILL_RUNTIME_CAPABILITY_ROTATION_MS = 10 * 60_000;

const RUN_SCOPES: readonly SkillRuntimeScope[] = [
  "events:write",
  "integrations:execute",
  "skills:read",
  "skills:write",
];

type SkillRuntimeAccessTokens = Record<SkillRuntimeScope, string>;

/** Projects independently scoped, rotating run capabilities into the project sandbox. */
export async function projectSkillRuntimeConfig(input: {
  env: AgentRunEnv;
  run: StartRunInput;
  sandbox: SandboxLike;
}): Promise<void> {
  if (!input.sandbox.writeFile) {
    throw new Error("Sandbox does not support the skill runtime config projection.");
  }
  const capabilities = await Promise.all(
    RUN_SCOPES.map(async (scope) => ({
      capability: await mintSkillRuntimeCapability({
        runId: input.run.runId,
        userId: input.run.userId,
      }),
      scope,
    })),
  );
  const storedCapabilities: StoredSkillRuntimeCapability[] = capabilities.map(
    ({ capability, scope }) => ({
      digest: capability.digest,
      expiresAt: capability.expiresAt,
      issuedAt: capability.issuedAt,
      projectId: input.run.projectId ?? null,
      scope,
      tokenId: capability.tokenId,
    }),
  );
  await persistCapabilities(input, storedCapabilities);
  const accessTokens = Object.fromEntries(
    capabilities.map(({ capability, scope }) => [scope, capability.token]),
  ) as SkillRuntimeAccessTokens;
  const expiresAt = Math.min(...capabilities.map(({ capability }) => capability.expiresAt));
  await input.sandbox.writeFile({
    content: `${JSON.stringify(
      {
        accessTokens,
        backendBaseUrl: SKILL_RUNTIME_PUBLIC_BASE_URL,
        deliveryChannel: "web",
        expiresAt,
        ...(input.run.projectId ? { projectId: input.run.projectId } : {}),
        runId: input.run.runId,
        sandboxContext: "project",
        v: 2,
      },
      null,
      2,
    )}\n`,
    encoding: "utf8",
    path: SKILL_RUNTIME_CONFIG_PATH,
  });
}

async function persistCapabilities(
  input: {
    env: AgentRunEnv;
    run: StartRunInput;
  },
  capabilities: StoredSkillRuntimeCapability[],
): Promise<void> {
  const userId = toUserId(input.run.userId);
  return withUserDb(input.env, userId, async ({ transaction }) => {
    const rotated = await transaction((tx) =>
      rotateSkillRuntimeCapabilities(tx, {
        capabilities,
        now: Date.now(),
        runId: toAgentRunId(input.run.runId),
        userId,
      }),
    );
    if (!rotated) {
      throw new Error("Cannot project skill runtime capabilities for an inactive run.");
    }
  });
}
