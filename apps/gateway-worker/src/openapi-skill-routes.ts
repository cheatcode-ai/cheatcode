import {
  SkillProposalConfirmResponseSchema,
  UserSkillSchema,
  UserSkillsResponseSchema,
} from "@cheatcode/types";
import {
  emptyResponse,
  type JsonValue,
  jsonResponse,
  type OpenApiRoute,
  schemaRef,
} from "./openapi-builder";
import { zodJsonSchema } from "./openapi-zod";

export const skillSchemas: Record<string, JsonValue> = {
  SkillProposalConfirmResponse: zodJsonSchema(SkillProposalConfirmResponseSchema),
  UserSkill: zodJsonSchema(UserSkillSchema),
  UserSkillsResponse: zodJsonSchema(UserSkillsResponseSchema),
};

export const skillRoutes: OpenApiRoute[] = [
  {
    method: "get",
    operationId: "listUserSkills",
    path: "/v1/skills",
    responses: { "200": jsonResponse("User skills", schemaRef("UserSkillsResponse")) },
    security: [{ bearerAuth: [] }],
    summary: "List the current user's skills",
    tags: ["skills"],
  },
  {
    method: "post",
    operationId: "confirmSkillProposal",
    path: "/v1/threads/{threadId}/skill-proposals/{runId}/{proposalId}/confirm",
    responses: {
      "200": jsonResponse("Confirmed skill proposal", schemaRef("SkillProposalConfirmResponse")),
    },
    security: [{ bearerAuth: [] }],
    summary: "Create a skill from a persisted agent proposal",
    tags: ["skills"],
  },
  {
    method: "post",
    operationId: "openUserSkill",
    path: "/v1/skills/{skillId}/open",
    responses: {
      "200": jsonResponse("Skill file IDE session", schemaRef("SandboxIdeSession")),
    },
    security: [{ bearerAuth: [] }],
    summary: "Open a custom skill file in the Computer",
    tags: ["skills"],
  },
  {
    method: "delete",
    operationId: "deleteUserSkill",
    path: "/v1/skills/{skillId}",
    responses: { "204": emptyResponse("User skill deleted") },
    security: [{ bearerAuth: [] }],
    summary: "Delete a user skill",
    tags: ["skills"],
  },
];
