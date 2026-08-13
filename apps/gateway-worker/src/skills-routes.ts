import {
  type DatabaseHandle,
  listActiveUserIntegrationNames,
  listUserSkillSummaries,
  type UserSkillSummary,
  withUserDb,
} from "@cheatcode/db";
import { IntegrationNameSchema, integrationDisplayName, type UserId } from "@cheatcode/types";
import {
  ComposerSkillsResponseSchema,
  MAX_CONNECTED_APP_SKILLS,
  MAX_USER_SKILLS,
  UserSkillSchema,
  UserSkillsResponseSchema,
} from "@cheatcode/types/api";

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

/** `GET /v1/composer/skills` — custom skills plus active connected-app capabilities. */
export async function listComposerSkillsRoute(
  database: DatabaseHandle,
  userId: UserId,
): Promise<Response> {
  return withUserDb(database, userId, async ({ transaction }) => {
    const catalog = await transaction(async (tx) => {
      const skillRows = await listUserSkillSummaries(tx, userId, MAX_USER_SKILLS);
      const integrationNames = await listActiveUserIntegrationNames(
        tx,
        userId,
        MAX_CONNECTED_APP_SKILLS,
      );
      return {
        connectedApps: integrationNames.flatMap(connectedAppSummary),
        skills: skillRows.map(skillSummary),
      };
    });
    return Response.json(ComposerSkillsResponseSchema.parse(catalog));
  });
}

function connectedAppSummary(name: string): Array<{ displayName: string; name: string }> {
  const parsed = IntegrationNameSchema.safeParse(name);
  return parsed.success
    ? [{ displayName: integrationDisplayName(parsed.data), name: parsed.data }]
    : [];
}
