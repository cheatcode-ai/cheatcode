import {
  arrayOf,
  type JsonValue,
  jsonResponse,
  nullableStringSchema,
  type OpenApiRoute,
  schemaRef,
  stringSchema,
} from "./openapi-builder";

const ACCENT_KIND_ENUM = ["app", "deck", "research", "data", "landing", "social"];

export const replaySchemas: Record<string, JsonValue> = {
  FeaturedReplays: {
    additionalProperties: false,
    properties: {
      data: arrayOf({
        additionalProperties: false,
        properties: {
          accentKind: { enum: ACCENT_KIND_ENUM, type: "string" },
          id: stringSchema(),
          previewText: stringSchema(),
          title: stringSchema(),
        },
        required: ["id", "previewText", "title"],
        type: "object",
      }),
    },
    required: ["data"],
    type: "object",
  },
  PublicReplay: {
    additionalProperties: false,
    properties: {
      messages: arrayOf(schemaRef("PublicReplayMessage")),
      replay: {
        additionalProperties: false,
        properties: {
          authorName: stringSchema(),
          date: nullableStringSchema({ format: "date-time" }),
          id: stringSchema(),
          title: stringSchema(),
        },
        required: ["authorName", "date", "id", "title"],
        type: "object",
      },
    },
    required: ["messages", "replay"],
    type: "object",
  },
  PublicReplayMessage: {
    additionalProperties: false,
    properties: {
      createdAt: stringSchema({ format: "date-time" }),
      id: stringSchema({ format: "uuid" }),
      parts: arrayOf(schemaRef("MessagePart")),
      role: { enum: ["assistant", "user"], type: "string" },
    },
    required: ["createdAt", "id", "parts", "role"],
    type: "object",
  },
};

export const replayRoutes: OpenApiRoute[] = [
  {
    method: "get",
    operationId: "listFeaturedReplays",
    path: "/v1/replays/featured",
    responses: { "200": jsonResponse("Featured replays", schemaRef("FeaturedReplays")) },
    security: [],
    summary: "List operator-curated featured replays",
    tags: ["replays"],
  },
  {
    method: "get",
    operationId: "getReplay",
    path: "/v1/replays/{id}",
    responses: {
      "200": jsonResponse("Public replay transcript", schemaRef("PublicReplay")),
      "400": jsonResponse("Invalid replay id", schemaRef("Error")),
      "404": jsonResponse("Replay not found", schemaRef("Error")),
    },
    security: [],
    summary: "Get a public replay transcript",
    tags: ["replays"],
  },
];
