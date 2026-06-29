import { AGENT_MODEL_CATALOG } from "@cheatcode/types";
import {
  arrayOf,
  type JsonValue,
  jsonBody,
  jsonResponse,
  nullableStringSchema,
  type OpenApiRoute,
  schemaRef,
  stringSchema,
} from "./openapi-builder";

const CATALOG_MODEL_IDS: string[] = AGENT_MODEL_CATALOG.map((model) => model.id);
const ONBOARDING_STEP_IDS = ["intro", "name", "tools", "basics", "plan"];
const ONBOARDING_STEP_STATUSES = ["done", "skipped"];

const catalogModelSchema = (): JsonValue => ({ enum: [...CATALOG_MODEL_IDS], type: "string" });
const disabledModelsSchema = (): JsonValue => ({
  items: catalogModelSchema(),
  // One fewer than the catalog so ≥1 model always stays enabled (mirrors the zod schema).
  maxItems: AGENT_MODEL_CATALOG.length - 1,
  type: "array",
});
const onboardingStateSchema: JsonValue = {
  additionalProperties: false,
  properties: {
    steps: {
      additionalProperties: { enum: ONBOARDING_STEP_STATUSES, type: "string" },
      propertyNames: { enum: ONBOARDING_STEP_IDS },
      type: "object",
    },
  },
  required: ["steps"],
  type: "object",
};
const onboardingStepSchema: JsonValue = {
  additionalProperties: false,
  properties: {
    status: { enum: ONBOARDING_STEP_STATUSES, type: "string" },
    step: { enum: ONBOARDING_STEP_IDS, type: "string" },
  },
  required: ["status", "step"],
  type: "object",
};
const freeDeepseekSchema: JsonValue = {
  additionalProperties: false,
  properties: {
    limit: { minimum: 1, type: "integer" },
    used: { minimum: 0, type: "integer" },
  },
  required: ["limit", "used"],
  type: "object",
};

export const accountSchemas: Record<string, JsonValue> = {
  UpdateUserProfile: {
    additionalProperties: false,
    minProperties: 1,
    properties: {
      agentDisplayName: nullableStringSchema({ maxLength: 80, minLength: 1 }),
      disabledModels: disabledModelsSchema(),
      globalMemory: nullableStringSchema({ maxLength: 8_000 }),
      onboardingCompleted: { const: true, type: "boolean" },
      onboardingStep: onboardingStepSchema,
    },
    type: "object",
  },
  UserProfile: {
    additionalProperties: false,
    properties: {
      agentDisplayName: nullableStringSchema({ maxLength: 80, minLength: 1 }),
      disabledModels: disabledModelsSchema(),
      freeDeepseek: freeDeepseekSchema,
      globalMemory: nullableStringSchema({ maxLength: 8_000 }),
      onboardingCompletedAt: nullableStringSchema({ format: "date-time" }),
      onboardingState: onboardingStateSchema,
      updatedAt: nullableStringSchema({ format: "date-time" }),
    },
    required: [
      "agentDisplayName",
      "disabledModels",
      "globalMemory",
      "onboardingCompletedAt",
      "onboardingState",
      "updatedAt",
    ],
    type: "object",
  },
};

const UsageDailyTotalSchema: JsonValue = {
  additionalProperties: false,
  properties: {
    agentRunCount: { minimum: 0, type: "integer" },
    day: stringSchema({ format: "date" }),
    totalCachedTokens: { minimum: 0, type: "integer" },
    totalCostUsd: { minimum: 0, type: "number" },
    totalInputTokens: { minimum: 0, type: "integer" },
    totalOutputTokens: { minimum: 0, type: "integer" },
  },
  required: [
    "agentRunCount",
    "day",
    "totalCachedTokens",
    "totalCostUsd",
    "totalInputTokens",
    "totalOutputTokens",
  ],
  type: "object",
};

const UsageRunPointSchema: JsonValue = {
  additionalProperties: false,
  properties: {
    runId: stringSchema({ format: "uuid" }),
    startedAt: stringSchema({ format: "date-time" }),
    status: stringSchema(),
  },
  required: ["runId", "startedAt", "status"],
  type: "object",
};

const UsageDailyTotalsSchema: JsonValue = {
  additionalProperties: false,
  properties: {
    days: { minimum: 1, type: "integer" },
    runs: arrayOf(UsageRunPointSchema),
    totals: arrayOf(UsageDailyTotalSchema),
    truncated: { type: "boolean" },
  },
  required: ["days", "runs", "totals", "truncated"],
  type: "object",
};

const usageDaysParameter: JsonValue = {
  in: "query",
  name: "days",
  schema: { default: 30, maximum: 90, minimum: 1, type: "integer" },
};

export const accountRoutes: OpenApiRoute[] = [
  {
    method: "get",
    operationId: "getMe",
    path: "/v1/me",
    responses: { "200": jsonResponse("Current user", schemaRef("User")) },
    security: [{ bearerAuth: [] }],
    summary: "Get current user",
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
    responses: { "200": jsonResponse("Limits snapshot", schemaRef("LimitsSnapshot")) },
    security: [{ bearerAuth: [] }],
    summary: "Get rate limits and quotas",
    tags: ["account"],
  },
  {
    method: "get",
    operationId: "listUsageDaily",
    parameters: [usageDaysParameter],
    path: "/v1/usage/daily",
    responses: { "200": jsonResponse("Daily usage totals", UsageDailyTotalsSchema) },
    security: [{ bearerAuth: [] }],
    summary: "List daily usage totals",
    tags: ["account"],
  },
];
