import { mintSkillRuntimeCapability, type SkillRuntimeScope } from "@cheatcode/auth";
import { resolveWorkerSecret } from "@cheatcode/env";
import type { SandboxLike } from "@cheatcode/sandbox-contracts";
import type { AgentRunEnv } from "./agent-run-env";
import type { StartRunInput } from "./agent-run-schemas";

const SKILL_RUNTIME_CONFIG_PATH = "/workspace/.cheatcode/runtime/skill-runtime-config.json";
const RUN_SCOPES: readonly SkillRuntimeScope[] = [
  "events:write",
  "integrations:execute",
  "skills:read",
  "skills:write",
];

/** Projects the run-bound capability consumed by copied skill package scripts. */
export async function projectSkillRuntimeConfig(input: {
  env: AgentRunEnv;
  run: StartRunInput;
  sandbox: SandboxLike;
}): Promise<void> {
  if (!input.sandbox.writeFile) {
    throw new Error("Sandbox does not support the skill runtime config projection.");
  }
  const secret = await resolveWorkerSecret(input.env.SKILL_RUNTIME_TOKEN_SECRET);
  if (!secret) {
    throw new Error("SKILL_RUNTIME_TOKEN_SECRET is not configured.");
  }
  const capability = await mintSkillRuntimeCapability({
    ...(input.run.projectId ? { projectId: input.run.projectId } : {}),
    runId: input.run.runId,
    scopes: RUN_SCOPES,
    secret,
    userId: input.run.userId,
  });
  await input.sandbox.writeFile({
    content: `${JSON.stringify(
      {
        accessToken: capability.token,
        backendBaseUrl: input.env.SKILL_RUNTIME_BASE_URL.replace(/\/+$/u, ""),
        deliveryChannel: "web",
        expiresAt: capability.expiresAt,
        ...(input.run.projectId ? { projectId: input.run.projectId } : {}),
        runId: input.run.runId,
        sandboxContext: "project",
        v: 1,
      },
      null,
      2,
    )}\n`,
    encoding: "utf8",
    path: SKILL_RUNTIME_CONFIG_PATH,
  });
}
