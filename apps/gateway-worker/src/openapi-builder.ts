import {
  INTEGRATION_NAME_MAX_LENGTH,
  INTEGRATION_NAME_PATTERN,
} from "@cheatcode/types/integrations";

type JsonPrimitive = boolean | null | number | string;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export interface OpenApiRoute {
  method: "delete" | "get" | "patch" | "post";
  operationId: string;
  parameters?: JsonValue[];
  path: string;
  rateLimited?: boolean;
  requestBody?: JsonValue;
  responses: Record<string, JsonValue>;
  security?: JsonValue[];
  summary: string;
  tags: string[];
}

export const schemaRef = (name: string): JsonValue => ({ $ref: `#/components/schemas/${name}` });

export const jsonResponse = (description: string, schema: JsonValue): JsonValue => ({
  content: { "application/json": { schema } },
  description,
});

export const emptyResponse = (description: string): JsonValue => ({ description });

export function contentResponse(
  description: string,
  mediaType: string,
  schema: JsonValue,
): JsonValue {
  return { content: { [mediaType]: { schema } }, description };
}

export function jsonBody(schema: JsonValue, required = true): JsonValue {
  return {
    content: {
      "application/json": { schema },
    },
    required,
  };
}

function buildPaths(sourceRoutes: OpenApiRoute[]): { [path: string]: JsonValue } {
  assertUniqueRoutes(sourceRoutes);
  const paths: { [path: string]: { [method: string]: JsonValue } } = {};
  for (const route of sourceRoutes) {
    const current = paths[route.path] ?? {};
    const parameters = routeParameters(route);
    current[route.method] = {
      operationId: route.operationId,
      ...(parameters ? { parameters } : {}),
      ...(route.requestBody ? { requestBody: route.requestBody } : {}),
      responses: routeResponses(route),
      ...(route.security ? { security: route.security } : {}),
      summary: route.summary,
      tags: route.tags,
    };
    paths[route.path] = current;
  }
  return paths;
}

export function buildOpenApiDocument(options: {
  routes: OpenApiRoute[];
  schemas: { [name: string]: JsonValue };
}): JsonValue {
  const document: JsonValue = {
    components: {
      schemas: options.schemas,
      securitySchemes: {
        bearerAuth: { bearerFormat: "JWT", scheme: "bearer", type: "http" },
      },
    },
    info: {
      description: "Cheatcode V2 public product API. Webhooks are served separately.",
      title: "Cheatcode Gateway API",
      version: "1.0.0",
    },
    openapi: "3.1.0",
    paths: buildPaths(options.routes),
    servers: [{ url: "https://gateway.trycheatcode.com" }, { url: "http://localhost:8787" }],
    tags: [
      { name: "account" },
      { name: "discovery" },
      { name: "projects" },
      { name: "threads" },
      { name: "runs" },
      { name: "outputs" },
      { name: "metadata" },
      { name: "sandbox" },
      { name: "skills" },
      { name: "integrations" },
      { name: "byok" },
      { name: "billing" },
      { name: "telemetry" },
      { name: "system" },
    ],
  };
  assertComponentReferences(document, options.schemas);
  return document;
}

export function renderOpenApiDocsHtml(routes: OpenApiRoute[]): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Cheatcode API Docs</title>
    <style>
      :root { color-scheme: dark; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
      body { margin: 0; background: #050505; color: #e5e7eb; }
      main { max-width: 960px; margin: 0 auto; padding: 48px 24px; }
      a { color: #a78bfa; }
      table { width: 100%; border-collapse: collapse; margin-top: 24px; }
      th, td { border-bottom: 1px solid #27272a; padding: 12px; text-align: left; }
      th { color: #a1a1aa; font-size: 11px; text-transform: uppercase; letter-spacing: .16em; }
      td { font-size: 13px; }
      code { color: #f8fafc; }
    </style>
  </head>
  <body>
    <main>
      <h1>Cheatcode Gateway API</h1>
      <p>OpenAPI JSON is available at <a href="/openapi.json">/openapi.json</a>.</p>
      <table>
        <thead><tr><th>Method</th><th>Path</th><th>Operation</th></tr></thead>
        <tbody>${routes
          .map(
            (route) =>
              `<tr><td>${route.method.toUpperCase()}</td><td><code>${route.path}</code></td><td>${route.operationId}</td></tr>`,
          )
          .join("")}</tbody>
      </table>
    </main>
  </body>
</html>`;
}

function routeParameters(route: OpenApiRoute): JsonValue[] | undefined {
  const parameters = [...pathParameters(route.path), ...(route.parameters ?? [])];
  return parameters.length > 0 ? parameters : undefined;
}

function pathParameters(path: string): JsonValue[] {
  const names = new Set<string>();
  for (const match of path.matchAll(/\{([A-Za-z][A-Za-z0-9_]*)\}/g)) {
    const name = match[1];
    if (name) {
      names.add(name);
    }
  }
  return [...names].map((name) => ({
    in: "path",
    name,
    required: true,
    schema: pathParameterSchema(name),
  }));
}

function routeResponses(route: OpenApiRoute): Record<string, JsonValue> {
  return {
    ...(route.security?.length
      ? { "401": jsonResponse("Authentication required", schemaRef("Error")) }
      : {}),
    ...(route.security?.length || route.rateLimited ? { "429": rateLimitErrorResponse() } : {}),
    ...route.responses,
  };
}

function rateLimitErrorResponse(): JsonValue {
  return {
    content: { "application/json": { schema: schemaRef("Error") } },
    description: "Rate limit exceeded",
    headers: {
      "RateLimit-Limit": { schema: { minimum: 0, type: "integer" } },
      "RateLimit-Remaining": { schema: { minimum: 0, type: "integer" } },
      "RateLimit-Reset": { schema: { minimum: 0, type: "integer" } },
      "Retry-After": { schema: { minimum: 1, type: "integer" } },
    },
  };
}

function assertUniqueRoutes(routes: OpenApiRoute[]): void {
  const routeKeys = new Set<string>();
  const operationIds = new Set<string>();
  for (const route of routes) {
    const routeKey = `${route.method.toUpperCase()} ${route.path}`;
    if (routeKeys.has(routeKey)) {
      throw new Error(`Duplicate OpenAPI route: ${routeKey}`);
    }
    routeKeys.add(routeKey);
    if (operationIds.has(route.operationId)) {
      throw new Error(`Duplicate OpenAPI operationId: ${route.operationId}`);
    }
    operationIds.add(route.operationId);
  }
}

function assertComponentReferences(
  value: JsonValue,
  componentSchemas: { [name: string]: JsonValue },
): void {
  if (Array.isArray(value)) {
    for (const item of value) {
      assertComponentReferences(item, componentSchemas);
    }
    return;
  }
  if (typeof value !== "object" || value === null) {
    return;
  }
  const reference = value["$ref"];
  if (typeof reference === "string" && reference.startsWith(COMPONENT_SCHEMA_PREFIX)) {
    const componentName = reference.slice(COMPONENT_SCHEMA_PREFIX.length);
    if (!Object.hasOwn(componentSchemas, componentName)) {
      throw new Error(`Missing OpenAPI component schema: ${componentName}`);
    }
  }
  for (const child of Object.values(value)) {
    assertComponentReferences(child, componentSchemas);
  }
}

function pathParameterSchema(name: string): JsonValue {
  if (UUID_PATH_PARAMETERS.has(name)) {
    return { format: "uuid", type: "string" };
  }
  if (name === "name") {
    return {
      maxLength: INTEGRATION_NAME_MAX_LENGTH,
      minLength: 1,
      pattern: INTEGRATION_NAME_PATTERN.source,
      type: "string",
    };
  }
  if (name === "connectionId") {
    return { maxLength: 256, minLength: 1, type: "string" };
  }
  if (name === "provider") {
    return {
      enum: [
        "anthropic",
        "openai",
        "google",
        "openrouter",
        "deepseek",
        "exa",
        "firecrawl",
        "llamaparse",
      ],
      type: "string",
    };
  }
  return { type: "string" };
}

const UUID_PATH_PARAMETERS = new Set([
  "approvalId",
  "outputId",
  "projectId",
  "runId",
  "skillId",
  "threadId",
]);

const COMPONENT_SCHEMA_PREFIX = "#/components/schemas/";
