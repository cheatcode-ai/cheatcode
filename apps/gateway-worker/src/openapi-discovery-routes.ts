import {
  GreetingResponseSchema,
  RecentThreadsResponseSchema,
  SearchResponseSchema,
} from "@cheatcode/types";
import { type JsonValue, jsonResponse, type OpenApiRoute, schemaRef } from "./openapi-builder";
import { zodJsonSchema } from "./openapi-zod";

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
  GreetingResponse: zodJsonSchema(GreetingResponseSchema),
  RecentThreadsResponse: zodJsonSchema(RecentThreadsResponseSchema),
  SearchResponse: zodJsonSchema(SearchResponseSchema),
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
