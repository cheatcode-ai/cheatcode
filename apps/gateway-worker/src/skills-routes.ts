import {
  type DatabaseHandle,
  listUserSkillSummaries,
  type UserSkillSummary,
  withUserDb,
} from "@cheatcode/db";
import type { UserId } from "@cheatcode/types";
import { MAX_USER_SKILLS, UserSkillSchema, UserSkillsResponseSchema } from "@cheatcode/types/api";

function skillSummary(record: UserSkillSummary): unknown {
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
  database: DatabaseHandle,
  userId: UserId,
): Promise<Response> {
  return withUserDb(database, userId, async ({ transaction }) => {
    const rows = await transaction((tx) => listUserSkillSummaries(tx, userId, MAX_USER_SKILLS));
    return Response.json(UserSkillsResponseSchema.parse({ skills: rows.map(skillSummary) }));
  });
}
