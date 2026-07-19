import {
  createDb,
  createThreadMessage,
  deleteUserSkill,
  findSkillConfirmationMessage,
  getThreadAgentRunMessage,
  getUserSkillById,
  getUserSkillByName,
  lockSkillProposal,
  type MessageRecord,
  type UserSkillRecord,
  upsertUserSkill,
  withUserContext,
} from "@cheatcode/db";
import { APIError } from "@cheatcode/observability";
import {
  AgentRunId,
  CHEATCODE_DATA_SCHEMAS,
  SandboxIdeSessionSchema,
  SkillProposalConfirmResponseSchema,
  ThreadId,
  type UIMessagePart,
  UserId,
  UserSkillSchema,
} from "@cheatcode/types";
import type { Context, Hono } from "hono";
import { z } from "zod";
import type { AgentEnv } from "./agent-env";
import { sandboxForUser } from "./agent-routing";
import { terminalDisplayCwd } from "./sandbox-route-helpers";
import { parseRunRouteParam, parseThreadRouteParam, readGatewayUserId } from "./tenancy";
import {
  serializeUserSkillMarkdown,
  userSkillDirectoryPath,
  userSkillFilePath,
  writeUserSkillMirror,
} from "./user-skill-files";
import {
  collectUserSkillPackageFromSandbox,
  deleteUserSkillPackage,
  persistUserSkillPackage,
  readUserSkillPackage,
  writeUserSkillPackageMirror,
} from "./user-skill-packages";

const IdSchema = z.string().uuid();
type AgentContext = Context<{ Bindings: AgentEnv }>;
type SkillProposal = z.infer<(typeof CHEATCODE_DATA_SCHEMAS)["skill-proposed"]>;

export function registerSkillProposalHttpRoutes(app: Hono<{ Bindings: AgentEnv }>): void {
  app.post(
    "/v1/threads/:threadId/skill-proposals/:runId/:proposalId/confirm",
    confirmSkillProposal,
  );
  app.post("/v1/skills/:skillId/open", openUserSkill);
  app.delete("/v1/skills/:skillId", deleteSavedUserSkill);
}

async function deleteSavedUserSkill(c: AgentContext): Promise<Response> {
  const userId = UserId(readGatewayUserId(c.req.raw.headers));
  const skillId = parsedId(c.req.param("skillId"), "skill");
  const skill = await readSkill(c.env, userId, skillId);
  if (!skill) {
    throw new APIError(404, "not_found_skill", "Skill not found", { retriable: false });
  }
  await removeSkillPackageFiles(c.env, userId, skill);
  await deleteSkillRecord(c.env, userId, skillId);
  return new Response(null, { status: 204 });
}

async function confirmSkillProposal(c: AgentContext): Promise<Response> {
  const userId = UserId(readGatewayUserId(c.req.raw.headers));
  const threadId = ThreadId(parseThreadRouteParam(c.req.param("threadId") ?? ""));
  const runId = AgentRunId(parseRunRouteParam(c.req.param("runId") ?? ""));
  const proposalId = parsedId(c.req.param("proposalId"), "proposal");
  const confirmed = await persistProposal(c.env, { proposalId, runId, threadId, userId });
  await persistAndMirrorSkillPackage(c.env, userId, confirmed.skill);
  return c.json(
    SkillProposalConfirmResponseSchema.parse({
      message: messageResponse(confirmed.message),
      skill: skillResponse(confirmed.skill),
    }),
  );
}

async function openUserSkill(c: AgentContext): Promise<Response> {
  const userId = UserId(readGatewayUserId(c.req.raw.headers));
  const skillId = parsedId(c.req.param("skillId"), "skill");
  const skill = await readSkill(c.env, userId, skillId);
  if (!skill) {
    throw new APIError(404, "not_found_skill", "Skill not found", { retriable: false });
  }
  const filePath = await mirrorSkillFile(c.env, userId, skill);
  const sandbox = await sandboxForUser(c.env, userId);
  const session = await sandbox.exposeCodeServer({
    initialFilePath: filePath,
    workspacePath: userSkillDirectoryPath(skill.name),
  });
  return c.json(
    SandboxIdeSessionSchema.parse({
      ...session,
      displayWorkspacePath: terminalDisplayCwd(session.workspacePath),
    }),
  );
}

async function persistProposal(
  env: AgentEnv,
  input: { proposalId: string; runId: AgentRunId; threadId: ThreadId; userId: UserId },
): Promise<{ message: MessageRecord; skill: UserSkillRecord }> {
  const { db, close } = createDb(env.HYPERDRIVE, {
    audience: "app_agent",
    signingSecret: env.DATABASE_CONTEXT_SIGNING_SECRET_AGENT,
  });
  try {
    return await withUserContext(db, input.userId, async (tx) => {
      await lockSkillProposal(tx, input.proposalId);
      const proposalMessage = await getThreadAgentRunMessage(tx, input);
      const proposal = proposalFromMessage(proposalMessage, input.proposalId);
      const existing = await findSkillConfirmationMessage(tx, input);
      if (existing) {
        const skill = await skillForExistingConfirmation(tx, input.userId, existing, proposal.name);
        if (!skill) {
          throw new APIError(
            409,
            "conflict_state_invalid",
            "This skill proposal was already created and later removed.",
            { retriable: false },
          );
        }
        return { message: existing, skill };
      }
      const skill = await upsertUserSkill(tx, {
        body: proposal.body,
        category: proposal.category,
        description: proposal.description,
        name: proposal.name,
        tags: proposal.tags,
        userId: input.userId,
      });
      const message = await createThreadMessage(tx, {
        parts: confirmationParts(proposal, skill),
        role: "assistant",
        threadId: input.threadId,
        userId: input.userId,
      });
      return { message, skill };
    });
  } finally {
    await close();
  }
}

function proposalFromMessage(message: MessageRecord | null, proposalId: string): SkillProposal {
  if (!message) {
    throw new APIError(404, "not_found_skill", "Skill proposal not found", {
      retriable: false,
    });
  }
  for (const part of message.parts) {
    if (part.type !== "data-skill-proposed" || part.data.proposalId !== proposalId) {
      continue;
    }
    return CHEATCODE_DATA_SCHEMAS["skill-proposed"].parse(part.data);
  }
  throw new APIError(404, "not_found_skill", "Skill proposal not found", {
    retriable: false,
  });
}

async function skillForExistingConfirmation(
  db: Parameters<typeof getUserSkillById>[0],
  userId: UserId,
  message: MessageRecord,
  proposalName: string,
): Promise<UserSkillRecord | null> {
  const created = message.parts.find((part) => part.type === "data-skill-created");
  return created?.type === "data-skill-created" && created.data.id
    ? getUserSkillById(db, userId, created.data.id)
    : getUserSkillByName(db, userId, proposalName);
}

function confirmationParts(proposal: SkillProposal, skill: UserSkillRecord): UIMessagePart[] {
  const filePath = userSkillFilePath(skill.name);
  return [
    {
      state: "done",
      text: [
        `Created and saved the new custom Cheatcode skill: **${proposal.name}**.`,
        "",
        "### What It Does",
        proposal.description,
        "",
        "### Validation",
        "- Confirmed the skill instructions are valid markdown.",
        "- Persisted it to your custom skill registry.",
        "- Mirrored it to the Cheatcode computer as `SKILL.md` for review and editing.",
      ].join("\n"),
      type: "text",
    },
    {
      data: {
        v: 1,
        description: proposal.description,
        filePath,
        id: skill.id,
        name: proposal.name,
        proposalId: proposal.proposalId,
        slug: proposal.slug,
      },
      type: "data-skill-created",
    },
  ];
}

async function mirrorSkillFile(
  env: AgentEnv,
  userId: UserId,
  skill: UserSkillRecord,
): Promise<string> {
  const sandbox = await sandboxForUser(env, userId);
  const packageValue = await readUserSkillPackage(env.R2_OUTPUTS, userId, skill.id);
  return packageValue
    ? writeUserSkillPackageMirror(sandbox, skill, packageValue)
    : writeUserSkillMirror(sandbox, skill);
}

async function persistAndMirrorSkillPackage(
  env: AgentEnv,
  userId: UserId,
  skill: UserSkillRecord,
): Promise<string> {
  const sandbox = await sandboxForUser(env, userId);
  const collected = await collectUserSkillPackageFromSandbox(sandbox, skill);
  const skillMarkdown = await serializeUserSkillMarkdown(skill);
  const files = collected.some((file) => file.path === "SKILL.md")
    ? collected.map((file) =>
        file.path === "SKILL.md" ? { content: skillMarkdown, path: file.path } : file,
      )
    : [{ content: skillMarkdown, path: "SKILL.md" }, ...collected];
  const packageValue = await persistUserSkillPackage(env.R2_OUTPUTS, userId, skill.id, files);
  return writeUserSkillPackageMirror(sandbox, skill, packageValue);
}

async function readSkill(
  env: AgentEnv,
  userId: UserId,
  skillId: string,
): Promise<UserSkillRecord | null> {
  const { db, close } = createDb(env.HYPERDRIVE, {
    audience: "app_agent",
    signingSecret: env.DATABASE_CONTEXT_SIGNING_SECRET_AGENT,
  });
  try {
    return await withUserContext(db, userId, (tx) => getUserSkillById(tx, userId, skillId));
  } finally {
    await close();
  }
}

async function removeSkillPackageFiles(
  env: AgentEnv,
  userId: UserId,
  skill: UserSkillRecord,
): Promise<void> {
  const sandbox = await sandboxForUser(env, userId);
  if (!sandbox.deleteFile) {
    throw new APIError(
      503,
      "unavailable_maintenance",
      "The skill workspace cannot be cleaned up right now",
      { retriable: true },
    );
  }
  await Promise.all([
    deleteUserSkillPackage(env.R2_OUTPUTS, userId, skill.id),
    sandbox.deleteFile({ path: userSkillDirectoryPath(skill.name), recursive: true }),
  ]);
}

async function deleteSkillRecord(env: AgentEnv, userId: UserId, skillId: string): Promise<void> {
  const { db, close } = createDb(env.HYPERDRIVE, {
    audience: "app_agent",
    signingSecret: env.DATABASE_CONTEXT_SIGNING_SECRET_AGENT,
  });
  try {
    const deleted = await withUserContext(db, userId, (tx) => deleteUserSkill(tx, userId, skillId));
    if (!deleted) {
      throw new APIError(404, "not_found_skill", "Skill not found", { retriable: false });
    }
  } finally {
    await close();
  }
}

function parsedId(value: string | undefined, label: string): string {
  const parsed = IdSchema.safeParse(value);
  if (!parsed.success) {
    throw new APIError(400, "invalid_path_param", `Invalid ${label} id`, { retriable: false });
  }
  return parsed.data;
}

function skillResponse(skill: UserSkillRecord): unknown {
  return UserSkillSchema.parse({
    category: skill.category,
    createdAt: skill.createdAt.toISOString(),
    description: skill.description,
    id: skill.id,
    name: skill.name,
    tags: skill.tags,
    updatedAt: skill.updatedAt.toISOString(),
  });
}

function messageResponse(message: MessageRecord): unknown {
  return {
    agentRunId: message.agentRunId,
    agentRunSegment: message.agentRunSegment,
    agentRunSegmentFinal: message.agentRunSegmentFinal,
    createdAt: message.createdAt.toISOString(),
    id: message.id,
    parts: message.parts,
    role: message.role,
    threadId: message.threadId,
  };
}
