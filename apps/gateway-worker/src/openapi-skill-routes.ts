import { CreateUserSkillSchema, UserSkillSchema, UserSkillsResponseSchema } from "@cheatcode/types";
import {
  emptyResponse,
  type JsonValue,
  jsonBody,
  jsonResponse,
  type OpenApiRoute,
  schemaRef,
} from "./openapi-builder";
import { zodJsonSchema } from "./openapi-zod";

export const skillSchemas: Record<string, JsonValue> = {
  CreateUserSkill: zodJsonSchema(CreateUserSkillSchema, "input"),
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
    operationId: "createUserSkill",
    path: "/v1/skills",
    requestBody: jsonBody(schemaRef("CreateUserSkill")),
    responses: { "201": jsonResponse("Created user skill", schemaRef("UserSkill")) },
    security: [{ bearerAuth: [] }],
    summary: "Create or update a user skill by name",
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
