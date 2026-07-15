"use client";

import { type UserSkill, UserSkillsResponseSchema } from "@cheatcode/types";
import {
  API_RESPONSE_LIMIT_BYTES,
  authorizedFetch,
  readBoundedJsonResponse,
} from "@/lib/api/authorized-fetch";

export const USER_SKILLS_QUERY = ["user-skills"] as const;

/** The caller's custom skills (body-less summaries). */
export async function listUserSkills(getToken: () => Promise<null | string>): Promise<UserSkill[]> {
  const response = await authorizedFetch(getToken, "/v1/skills");
  return UserSkillsResponseSchema.parse(
    await readBoundedJsonResponse(response, API_RESPONSE_LIMIT_BYTES.metadata),
  ).skills;
}

/** Delete a custom skill the caller owns. */
export async function deleteUserSkill(
  getToken: () => Promise<null | string>,
  id: string,
): Promise<void> {
  await authorizedFetch(getToken, `/v1/skills/${encodeURIComponent(id)}`, { method: "DELETE" });
}
