"use client";

import {
  type CreateUserSkill,
  type UserSkill,
  UserSkillSchema,
  UserSkillsResponseSchema,
} from "@cheatcode/types";
import { authorizedFetch } from "@/lib/api/authorized-fetch";

export const USER_SKILLS_QUERY = ["user-skills"] as const;

/** The caller's custom skills (body-less summaries). */
export async function listUserSkills(getToken: () => Promise<null | string>): Promise<UserSkill[]> {
  const response = await authorizedFetch(getToken, "/v1/skills");
  return UserSkillsResponseSchema.parse(await response.json()).skills;
}

/** Create or update (by name) a custom skill. */
export async function createUserSkill(
  getToken: () => Promise<null | string>,
  input: CreateUserSkill,
): Promise<UserSkill> {
  const response = await authorizedFetch(getToken, "/v1/skills", {
    body: JSON.stringify(input),
    method: "POST",
  });
  return UserSkillSchema.parse(await response.json());
}

/** Delete a custom skill the caller owns. */
export async function deleteUserSkill(
  getToken: () => Promise<null | string>,
  id: string,
): Promise<void> {
  await authorizedFetch(getToken, `/v1/skills/${encodeURIComponent(id)}`, { method: "DELETE" });
}
