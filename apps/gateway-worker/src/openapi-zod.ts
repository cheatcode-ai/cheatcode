import { type ZodType, z } from "zod";
import type { JsonValue } from "./openapi-builder";

type SchemaIo = "input" | "output";

/** Converts the shared runtime contract into the JSON Schema embedded in OpenAPI. */
export function zodJsonSchema(schema: ZodType, io: SchemaIo = "output"): JsonValue {
  const generated: unknown = z.toJSONSchema(schema, {
    io,
    target: "draft-2020-12",
    unrepresentable: "any",
  });
  if (!isJsonObject(generated)) {
    throw new TypeError("Zod generated a non-object JSON Schema");
  }
  return Object.fromEntries(Object.entries(generated).filter(([key]) => key !== "$schema"));
}

export function withJsonSchemaConstraints(
  schema: JsonValue,
  constraints: Record<string, JsonValue>,
): JsonValue {
  if (typeof schema !== "object" || schema === null || Array.isArray(schema)) {
    throw new TypeError("JSON Schema constraints require an object schema");
  }
  return { ...schema, ...constraints };
}

function isJsonObject(value: unknown): value is Record<string, JsonValue> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.values(value).every(isJsonValue)
  );
}

function isJsonValue(value: unknown): value is JsonValue {
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "number" ||
    typeof value === "string"
  ) {
    return true;
  }
  if (Array.isArray(value)) {
    return value.every(isJsonValue);
  }
  return isJsonObject(value);
}
