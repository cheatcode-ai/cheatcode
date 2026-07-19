"use client";

import {
  type CheatcodeUIMessage,
  type SandboxIdeSession,
  SandboxIdeSessionSchema,
  SkillProposalConfirmResponseSchema,
  type UserSkill,
  UserSkillsResponseSchema,
} from "@cheatcode/types";
import {
  API_REQUEST_TIMEOUT_MS,
  API_RESPONSE_LIMIT_BYTES,
  authorizedFetch,
  readBoundedJsonResponse,
} from "@/lib/api/authorized-fetch";
import { messageRecordToUiMessage } from "@/lib/api/project-thread";

export const USER_SKILLS_QUERY = ["user-skills"] as const;

/** The caller's custom skills (body-less summaries). */
export async function listUserSkills(
  getToken: () => Promise<null | string>,
  signal?: AbortSignal,
): Promise<UserSkill[]> {
  const response = await authorizedFetch(getToken, "/v1/skills", signal ? { signal } : {});
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

/** Commit a trusted, persisted Skill Creator proposal. */
export async function confirmSkillProposal(
  getToken: () => Promise<null | string>,
  threadId: string,
  runId: string,
  proposalId: string,
): Promise<{ message: CheatcodeUIMessage; skill: UserSkill }> {
  const response = await authorizedFetch(
    getToken,
    `/v1/threads/${encodeURIComponent(threadId)}/skill-proposals/${encodeURIComponent(runId)}/${encodeURIComponent(proposalId)}/confirm`,
    { method: "POST" },
    { timeoutMs: API_REQUEST_TIMEOUT_MS.provisioning },
  );
  const parsed = SkillProposalConfirmResponseSchema.parse(
    await readBoundedJsonResponse(response, API_RESPONSE_LIMIT_BYTES.messages),
  );
  const message = await messageRecordToUiMessage(parsed.message);
  if (!message) {
    throw new Error("The saved skill confirmation could not be displayed.");
  }
  return { message, skill: parsed.skill };
}

/** Mirror and open a custom skill's `SKILL.md` in the Computer. */
export async function openUserSkill(
  getToken: () => Promise<null | string>,
  skillId: string,
): Promise<SandboxIdeSession> {
  const response = await authorizedFetch(
    getToken,
    `/v1/skills/${encodeURIComponent(skillId)}/open`,
    { method: "POST" },
    { timeoutMs: API_REQUEST_TIMEOUT_MS.provisioning },
  );
  return SandboxIdeSessionSchema.parse(
    await readBoundedJsonResponse(response, API_RESPONSE_LIMIT_BYTES.sandboxMetadata),
  );
}
