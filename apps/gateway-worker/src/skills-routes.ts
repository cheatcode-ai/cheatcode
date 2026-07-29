import { listUserSkillSummaries, type UserSkillSummaryRecord, withUserDb } from "@cheatcode/db";
import type { UserId } from "@cheatcode/types";
import { MAX_USER_SKILLS, UserSkillSchema, UserSkillsResponseSchema } from "@cheatcode/types/api";
import type { GatewayEnv } from "./gateway-env";
import type { WaitUntilContext } from "./wait-until-context";

function skillSummary(record: UserSkillSummaryRecord): unknown {
  return UserSkillSchema.parse({
    category: record.category,
    createdAt: record.createdAt.toISOString(),
    description: record.description,
    id: record.id,
    name: record.name,
    tags: record.tags,
    updatedAt: record.updatedAt.toISOString(),
  });
}

/** `GET /v1/skills` — the caller's custom skills (body-less summaries). */
export async function listUserSkillsRoute(
  env: GatewayEnv,
  _ctx: WaitUntilContext,
  userId: UserId,
): Promise<Response> {
  return withUserDb(env, userId, async ({ transaction }) => {
    const rows = await transaction((tx) => listUserSkillSummaries(tx, userId, MAX_USER_SKILLS));
    return Response.json(UserSkillsResponseSchema.parse({ skills: rows.map(skillSummary) }));
  });
}
