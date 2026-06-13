import { type JsonValue, schemaRef } from "./openapi-builder";

type ComponentSchemas = { [name: string]: JsonValue };

export const paginationParameters: JsonValue[] = [
  {
    in: "query",
    name: "cursor",
    schema: { type: "string" },
  },
  {
    in: "query",
    name: "limit",
    schema: { default: 25, maximum: 100, minimum: 1, type: "integer" },
  },
];

export const idempotencyKeyParameter: JsonValue = {
  in: "header",
  name: "Idempotency-Key",
  required: true,
  schema: { maxLength: 255, minLength: 1, type: "string" },
};

export function objectSchemaFor(componentSchemas: ComponentSchemas, name: string): JsonValue {
  return name in componentSchemas
    ? schemaRef(name)
    : {
        additionalProperties: true,
        title: name,
        type: "object",
      };
}

export function arraySchemaFor(componentSchemas: ComponentSchemas, name: string): JsonValue {
  return {
    items: objectSchemaFor(componentSchemas, name),
    type: "array",
  };
}

export function paginatedSchemaFor(componentSchemas: ComponentSchemas, name: string): JsonValue {
  return {
    properties: {
      data: arraySchemaFor(componentSchemas, name),
      has_more: { type: "boolean" },
      next_cursor: { type: ["string", "null"] },
    },
    required: ["data", "next_cursor", "has_more"],
    type: "object",
  };
}
