import {
  arrayOf,
  type JsonValue,
  jsonResponse,
  nullableStringSchema,
  type OpenApiRoute,
  schemaRef,
  stringSchema,
} from "./openapi-builder";

const searchQueryParameter: JsonValue = {
  in: "query",
  name: "q",
  required: true,
  schema: { maxLength: 100, minLength: 1, type: "string" },
};

const searchLimitParameter: JsonValue = {
  in: "query",
  name: "limit",
  schema: { default: 10, maximum: 20, minimum: 1, type: "integer" },
};

const recentThreadsLimitParameter: JsonValue = {
  in: "query",
  name: "limit",
  schema: { default: 20, maximum: 50, minimum: 1, type: "integer" },
};

export const discoverySchemas: Record<string, JsonValue> = {
  GreetingResponse: {
    additionalProperties: false,
    properties: {
      city: nullableStringSchema(),
      timezone: nullableStringSchema(),
      weather: {
        oneOf: [
          {
            additionalProperties: false,
            properties: {
              tempC: { type: "number" },
              weatherCode: { type: "integer" },
            },
            required: ["tempC", "weatherCode"],
            type: "object",
          },
          { type: "null" },
        ],
      },
    },
    required: ["city", "timezone", "weather"],
    type: "object",
  },
  SearchResponse: {
    additionalProperties: false,
    properties: {
      query: stringSchema(),
      results: arrayOf({
        discriminator: { propertyName: "type" },
        oneOf: [schemaRef("SearchResultProject"), schemaRef("SearchResultThread")],
      }),
    },
    required: ["query", "results"],
    type: "object",
  },
  SearchResultProject: {
    additionalProperties: false,
    properties: {
      id: stringSchema({ format: "uuid" }),
      latestThreadId: nullableStringSchema({ format: "uuid" }),
      name: stringSchema(),
      type: { const: "project", type: "string" },
      updatedAt: stringSchema({ format: "date-time" }),
    },
    required: ["id", "latestThreadId", "name", "type", "updatedAt"],
    type: "object",
  },
  SearchResultThread: {
    additionalProperties: false,
    properties: {
      id: stringSchema({ format: "uuid" }),
      projectId: nullableStringSchema({ format: "uuid" }),
      projectName: nullableStringSchema(),
      title: stringSchema(),
      type: { const: "thread", type: "string" },
      updatedAt: stringSchema({ format: "date-time" }),
    },
    required: ["id", "projectId", "projectName", "title", "type", "updatedAt"],
    type: "object",
  },
  RecentThreadsResponse: {
    additionalProperties: false,
    properties: {
      threads: arrayOf(schemaRef("SearchResultThread")),
    },
    required: ["threads"],
    type: "object",
  },
};

export const discoveryRoutes: OpenApiRoute[] = [
  {
    method: "get",
    operationId: "searchWorkspace",
    parameters: [searchQueryParameter, searchLimitParameter],
    path: "/v1/search",
    responses: {
      "200": jsonResponse("Workspace search results", schemaRef("SearchResponse")),
      "400": jsonResponse("Invalid query", schemaRef("Error")),
    },
    security: [{ bearerAuth: [] }],
    summary: "Search projects and threads",
    tags: ["discovery"],
  },
  {
    method: "get",
    operationId: "listRecentThreads",
    parameters: [recentThreadsLimitParameter],
    path: "/v1/threads",
    responses: {
      "200": jsonResponse("Recent chats (threads)", schemaRef("RecentThreadsResponse")),
      "400": jsonResponse("Invalid query", schemaRef("Error")),
    },
    security: [{ bearerAuth: [] }],
    summary: "List recent chats across projects",
    tags: ["discovery"],
  },
  {
    method: "get",
    operationId: "getGreeting",
    path: "/v1/greeting",
    responses: { "200": jsonResponse("Greeting geo and weather", schemaRef("GreetingResponse")) },
    security: [{ bearerAuth: [] }],
    summary: "Get greeting geo and current weather",
    tags: ["discovery"],
  },
];
