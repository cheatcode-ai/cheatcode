import {
  ActivityHistoryResponseSchema,
  LimitsSnapshotSchema,
  MeResponseSchema,
  UpdateMeSchema,
  UpdateUserProfileSchema,
  UserProfileSchema,
} from "@cheatcode/types";
import {
  type JsonValue,
  jsonBody,
  jsonResponse,
  type OpenApiRoute,
  schemaRef,
} from "./openapi-builder";
import { withJsonSchemaConstraints, zodJsonSchema } from "./openapi-zod";

export const accountSchemas: Record<string, JsonValue> = {
  ActivityHistory: zodJsonSchema(ActivityHistoryResponseSchema),
  LimitsSnapshot: zodJsonSchema(LimitsSnapshotSchema),
  MeResponse: zodJsonSchema(MeResponseSchema),
  UpdateMe: withJsonSchemaConstraints(zodJsonSchema(UpdateMeSchema, "input"), {
    minProperties: 1,
  }),
  UpdateUserProfile: withJsonSchemaConstraints(zodJsonSchema(UpdateUserProfileSchema, "input"), {
    minProperties: 1,
  }),
  UserProfile: zodJsonSchema(UserProfileSchema),
};

const activityDaysParameter: JsonValue = {
  in: "query",
  name: "days",
  schema: { default: 30, maximum: 90, minimum: 1, type: "integer" },
};

export const accountRoutes: OpenApiRoute[] = [
  {
    method: "get",
    operationId: "getMe",
    path: "/v1/me",
    responses: { "200": jsonResponse("Current user", schemaRef("MeResponse")) },
    security: [{ bearerAuth: [] }],
    summary: "Get current user",
    tags: ["account"],
  },
  {
    method: "patch",
    operationId: "updateMe",
    path: "/v1/me",
    requestBody: jsonBody(schemaRef("UpdateMe")),
    responses: { "200": jsonResponse("Updated user", schemaRef("MeResponse")) },
    security: [{ bearerAuth: [] }],
    summary: "Update the current user",
    tags: ["account"],
  },
  {
    method: "get",
    operationId: "getMyProfile",
    path: "/v1/me/profile",
    responses: { "200": jsonResponse("User profile", schemaRef("UserProfile")) },
    security: [{ bearerAuth: [] }],
    summary: "Get current user profile",
    tags: ["account"],
  },
  {
    method: "patch",
    operationId: "updateMyProfile",
    path: "/v1/me/profile",
    requestBody: jsonBody(schemaRef("UpdateUserProfile")),
    responses: {
      "200": jsonResponse("Updated user profile", schemaRef("UserProfile")),
      "400": jsonResponse("Invalid request body", schemaRef("Error")),
    },
    security: [{ bearerAuth: [] }],
    summary: "Update current user profile",
    tags: ["account"],
  },
  {
    method: "get",
    operationId: "getLimits",
    path: "/v1/limits",
    responses: { "200": jsonResponse("Quota snapshot", schemaRef("LimitsSnapshot")) },
    security: [{ bearerAuth: [] }],
    summary: "Get current plan quotas",
    tags: ["account"],
  },
  {
    method: "get",
    operationId: "getActivityHistory",
    parameters: [activityDaysParameter],
    path: "/v1/activity",
    responses: { "200": jsonResponse("Recent activity", schemaRef("ActivityHistory")) },
    security: [{ bearerAuth: [] }],
    summary: "Get recent run and sandbox activity",
    tags: ["account"],
  },
];
