import {
  arrayOf,
  type JsonValue,
  jsonResponse,
  type OpenApiRoute,
  schemaRef,
  stringSchema,
} from "./openapi-builder";

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

const UsageDailyTotalsSchema: JsonValue = {
  additionalProperties: false,
  properties: {
    days: { minimum: 1, type: "integer" },
    totals: arrayOf(UsageDailyTotalSchema),
  },
  required: ["days", "totals"],
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
