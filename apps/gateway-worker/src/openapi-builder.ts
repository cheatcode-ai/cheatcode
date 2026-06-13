export type JsonPrimitive = boolean | null | number | string;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export interface OpenApiRoute {
  method: "delete" | "get" | "patch" | "post";
  operationId: string;
  parameters?: JsonValue[];
  path: string;
  requestBody?: JsonValue;
  responses: Record<string, JsonValue>;
  security?: JsonValue[];
  summary: string;
  tags: string[];
}

export const stringSchema = (
  options: { format?: string; maxLength?: number; minLength?: number } = {},
) => ({
  type: "string",
  ...options,
});

export const nullableStringSchema = (
  options: { format?: string; maxLength?: number; minLength?: number } = {},
) => ({
  type: ["string", "null"],
  ...options,
});

export const nullableNumberSchema = (
  options: { exclusiveMinimum?: number; maximum?: number } = {},
) => ({
  type: ["number", "null"],
  ...options,
});

export const arrayOf = (items: JsonValue): JsonValue => ({ items, type: "array" });

export const recordOf = (additionalProperties: JsonValue): JsonValue => ({
  additionalProperties,
  type: "object",
});

export const schemaRef = (name: string): JsonValue => ({ $ref: `#/components/schemas/${name}` });

export const jsonResponse = (description: string, schema: JsonValue): JsonValue => ({
  content: { "application/json": { schema } },
  description,
});

export const emptyResponse = (description: string): JsonValue => ({ description });

export function jsonBody(schema: JsonValue): JsonValue {
  return {
    content: {
      "application/json": { schema },
    },
    required: true,
  };
}

export function buildPaths(sourceRoutes: OpenApiRoute[]): { [path: string]: JsonValue } {
  const paths: { [path: string]: { [method: string]: JsonValue } } = {};
  for (const route of sourceRoutes) {
    const current = paths[route.path] ?? {};
    const parameters = routeParameters(route);
    current[route.method] = {
      operationId: route.operationId,
      ...(parameters ? { parameters } : {}),
      ...(route.requestBody ? { requestBody: route.requestBody } : {}),
      responses: route.responses,
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
  return {
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
      { name: "integrations" },
      { name: "byok" },
      { name: "billing" },
      { name: "telemetry" },
      { name: "system" },
    ],
  };
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
    schema: { type: "string" },
  }));
}
