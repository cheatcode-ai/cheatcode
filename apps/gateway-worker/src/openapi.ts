import {
  AgentSummarySchema,
  ClientErrorBodySchema,
  ClientUserEventBodySchema,
  CreateRunSchema,
  ErrorResponseSchema,
  RunStatusSnapshotSchema,
  ToolDomainSchema,
  ToolSummarySchema,
  WebVitalsBodySchema,
} from "@cheatcode/types";
import { accountRoutes, accountSchemas } from "./openapi-account-routes";
import { billingRoutes, billingSchemas } from "./openapi-billing-routes";
import {
  buildOpenApiDocument,
  contentResponse,
  emptyResponse,
  type JsonValue,
  jsonBody,
  jsonResponse,
  type OpenApiRoute,
  renderOpenApiDocsHtml,
  schemaRef,
} from "./openapi-builder";
import { discoveryRoutes, discoverySchemas } from "./openapi-discovery-routes";
import { integrationSchemas } from "./openapi-integration-schemas";
import { projectRoutes, projectSchemas } from "./openapi-project-routes";
import { runControlRoutes, runControlSchemas } from "./openapi-run-control-routes";
import { sandboxRoutes, sandboxSchemas } from "./openapi-sandbox-routes";
import { arraySchemaFor, idempotencyKeyParameter, objectSchemaFor } from "./openapi-schema-utils";
import { skillRoutes, skillSchemas } from "./openapi-skill-routes";
import { zodJsonSchema } from "./openapi-zod";

const COMPONENT_SCHEMAS: Record<string, JsonValue> = {
  ...integrationSchemas,
  Agent: zodJsonSchema(AgentSummarySchema),
  ClientError: zodJsonSchema(ClientErrorBodySchema, "input"),
  ClientUserEvent: zodJsonSchema(ClientUserEventBodySchema, "input"),
  CreateRun: zodJsonSchema(CreateRunSchema, "input"),
  Error: zodJsonSchema(ErrorResponseSchema),
  Health: {
    additionalProperties: false,
    properties: {
      agent: {
        additionalProperties: false,
        properties: {
          ok: { const: true, type: "boolean" },
          releaseSha: { type: "string" },
          versionId: { type: ["string", "null"] },
          worker: { const: "agent", type: "string" },
        },
        required: ["ok", "releaseSha", "versionId", "worker"],
        type: "object",
      },
      ok: { const: true, type: "boolean" },
      releaseSha: { type: "string" },
      versionId: { type: ["string", "null"] },
    },
    required: ["agent", "ok", "releaseSha", "versionId"],
    type: "object",
  },
  Ok: {
    additionalProperties: false,
    properties: { ok: { const: true, type: "boolean" } },
    required: ["ok"],
    type: "object",
  },
  OpenApiDocument: {
    additionalProperties: true,
    properties: { openapi: { type: "string" } },
    required: ["openapi"],
    type: "object",
  },
  RunStatus: zodJsonSchema(RunStatusSnapshotSchema),
  Tool: zodJsonSchema(ToolSummarySchema),
  WebVitals: zodJsonSchema(WebVitalsBodySchema, "input"),
};

const objectSchema = (name: string): JsonValue => objectSchemaFor(COMPONENT_SCHEMAS, name);
const arraySchema = (name: string): JsonValue => arraySchemaFor(COMPONENT_SCHEMAS, name);

const runStreamCursorParameter: JsonValue = {
  in: "query",
  name: "lastSeq",
  schema: { default: 0, minimum: 0, type: "integer" },
};
const toolDomainParameter: JsonValue = {
  in: "query",
  name: "domain",
  schema: zodJsonSchema(ToolDomainSchema),
};
const outputDownloadParameters: JsonValue[] = [
  {
    in: "query",
    name: "expires",
    required: true,
    schema: { minimum: 1, type: "integer" },
  },
  {
    in: "query",
    name: "sig",
    required: true,
    schema: { maxLength: 256, minLength: 32, type: "string" },
  },
];

const routes: OpenApiRoute[] = [
  ...accountRoutes,
  ...discoveryRoutes,
  ...projectRoutes,
  {
    method: "post",
    operationId: "createThreadRun",
    parameters: [idempotencyKeyParameter],
    path: "/v1/threads/{threadId}/runs",
    requestBody: jsonBody(schemaRef("CreateRun")),
    responses: {
      "202": {
        content: { "text/event-stream": { schema: { type: "string" } } },
        description: "UIMessage SSE stream",
        headers: { Location: { schema: { type: "string" } } },
      },
      "400": jsonResponse("Invalid run request", schemaRef("Error")),
      "402": jsonResponse("Plan or quota required", schemaRef("Error")),
      "403": jsonResponse("Verified email or provider key required", schemaRef("Error")),
      "404": jsonResponse("Thread not found", schemaRef("Error")),
      "409": jsonResponse("Another run is active", schemaRef("Error")),
      "422": jsonResponse("Run could not be prepared", schemaRef("Error")),
      "503": jsonResponse("Run service unavailable", schemaRef("Error")),
    },
    security: [{ bearerAuth: [] }],
    summary: "Start an agent run",
    tags: ["runs"],
  },
  {
    method: "get",
    operationId: "resumeThreadRunStream",
    parameters: [runStreamCursorParameter],
    path: "/v1/threads/{threadId}/runs/stream",
    responses: {
      "200": contentResponse("UIMessage SSE stream", "text/event-stream", { type: "string" }),
      "204": emptyResponse("No active stream"),
    },
    security: [{ bearerAuth: [] }],
    summary: "Resume an agent run stream",
    tags: ["runs"],
  },
  {
    method: "get",
    operationId: "getThreadRunStatus",
    path: "/v1/threads/{threadId}/runs/status",
    responses: {
      "200": jsonResponse("Run status", schemaRef("RunStatus")),
      "204": emptyResponse("No active run"),
    },
    security: [{ bearerAuth: [] }],
    summary: "Get active run status for a thread",
    tags: ["runs"],
  },
  {
    method: "post",
    operationId: "cancelRun",
    path: "/v1/runs/{runId}/cancel",
    responses: { "200": jsonResponse("Cancellation accepted", schemaRef("Ok")) },
    security: [{ bearerAuth: [] }],
    summary: "Cancel an agent run",
    tags: ["runs"],
  },
  ...runControlRoutes,
  {
    method: "get",
    operationId: "downloadOutput",
    parameters: outputDownloadParameters,
    path: "/v1/outputs/{outputId}/download",
    rateLimited: true,
    responses: {
      "200": contentResponse("Generated output", "*/*", {
        format: "binary",
        type: "string",
      }),
      "400": jsonResponse("Invalid output id or signature query", schemaRef("Error")),
      "403": jsonResponse("Invalid signature", schemaRef("Error")),
      "404": jsonResponse("Not found", schemaRef("Error")),
      "410": jsonResponse("Expired", schemaRef("Error")),
    },
    summary: "Download a signed generated output",
    tags: ["outputs"],
  },
  {
    method: "get",
    operationId: "listTools",
    parameters: [toolDomainParameter],
    path: "/v1/tools",
    responses: { "200": jsonResponse("Tools", arraySchema("Tool")) },
    security: [{ bearerAuth: [] }],
    summary: "List tools",
    tags: ["metadata"],
  },
  {
    method: "get",
    operationId: "listAgents",
    path: "/v1/agents",
    responses: { "200": jsonResponse("Agents", arraySchema("Agent")) },
    security: [{ bearerAuth: [] }],
    summary: "List agents",
    tags: ["metadata"],
  },
  ...sandboxRoutes,
  ...skillRoutes,
  {
    method: "get",
    operationId: "listIntegrations",
    path: "/v1/integrations",
    responses: { "200": jsonResponse("Integrations", arraySchema("Integration")) },
    security: [{ bearerAuth: [] }],
    summary: "List Composio integrations",
    tags: ["integrations"],
  },
  {
    method: "get",
    operationId: "getIntegrationCatalog",
    path: "/v1/integrations/catalog",
    responses: { "200": jsonResponse("Catalog", objectSchema("IntegrationCatalog")) },
    security: [{ bearerAuth: [] }],
    summary: "Browse the Composio toolkit catalog with per-user connection status",
    tags: ["integrations"],
  },
  {
    method: "get",
    operationId: "listToolkitActions",
    path: "/v1/integrations/{name}/tools",
    responses: { "200": jsonResponse("Toolkit actions", objectSchema("ToolkitActionsResponse")) },
    security: [{ bearerAuth: [] }],
    summary: "List a toolkit's available actions",
    tags: ["integrations"],
  },
  {
    method: "post",
    operationId: "connectIntegration",
    path: "/v1/integrations/{name}/connect",
    responses: { "200": jsonResponse("OAuth URL", objectSchema("IntegrationConnect")) },
    security: [{ bearerAuth: [] }],
    summary: "Start integration OAuth",
    tags: ["integrations"],
  },
  {
    method: "delete",
    operationId: "deleteIntegrationAccount",
    path: "/v1/integrations/{name}/accounts/{connectionId}",
    responses: { "204": emptyResponse("Connected account deleted") },
    security: [{ bearerAuth: [] }],
    summary: "Disconnect one integration account",
    tags: ["integrations"],
  },
  {
    method: "post",
    operationId: "makeIntegrationAccountDefault",
    path: "/v1/integrations/{name}/accounts/{connectionId}/default",
    responses: { "204": emptyResponse("Default connected account updated") },
    security: [{ bearerAuth: [] }],
    summary: "Choose the default account for an integration",
    tags: ["integrations"],
  },
  {
    method: "get",
    operationId: "listProviderKeys",
    path: "/v1/provider-keys",
    responses: { "200": jsonResponse("Provider keys", arraySchema("ProviderKeySummary")) },
    security: [{ bearerAuth: [] }],
    summary: "List BYOK provider keys",
    tags: ["byok"],
  },
  {
    method: "post",
    operationId: "upsertProviderKey",
    path: "/v1/provider-keys",
    requestBody: jsonBody(objectSchema("UpsertProviderKey")),
    responses: { "201": jsonResponse("Provider key summary", objectSchema("ProviderKeySummary")) },
    security: [{ bearerAuth: [] }],
    summary: "Store BYOK provider key",
    tags: ["byok"],
  },
  {
    method: "delete",
    operationId: "deleteProviderKey",
    path: "/v1/provider-keys/{provider}",
    responses: { "204": emptyResponse("Provider key deleted") },
    security: [{ bearerAuth: [] }],
    summary: "Delete BYOK provider key",
    tags: ["byok"],
  },
  ...billingRoutes,
  {
    method: "post",
    operationId: "recordClientError",
    path: "/v1/client-error",
    rateLimited: true,
    requestBody: jsonBody(objectSchema("ClientError")),
    responses: { "200": jsonResponse("Accepted", objectSchema("Ok")) },
    summary: "Record client error",
    tags: ["telemetry"],
  },
  {
    method: "post",
    operationId: "recordVitals",
    path: "/v1/vitals",
    rateLimited: true,
    requestBody: jsonBody(objectSchema("WebVitals")),
    responses: { "200": jsonResponse("Accepted", objectSchema("Ok")) },
    summary: "Record web vitals",
    tags: ["telemetry"],
  },
  {
    method: "post",
    operationId: "recordClientUserEvent",
    path: "/v1/user-events",
    requestBody: jsonBody(objectSchema("ClientUserEvent")),
    responses: { "200": jsonResponse("Accepted", objectSchema("Ok")) },
    security: [{ bearerAuth: [] }],
    summary: "Record authenticated UI activation event",
    tags: ["telemetry"],
  },
  {
    method: "get",
    operationId: "getOpenApiDocument",
    path: "/openapi.json",
    rateLimited: true,
    responses: { "200": jsonResponse("OpenAPI document", objectSchema("OpenApiDocument")) },
    summary: "Get OpenAPI document",
    tags: ["system"],
  },
  {
    method: "get",
    operationId: "getApiDocs",
    path: "/docs",
    rateLimited: true,
    responses: {
      "200": contentResponse("HTML API documentation", "text/html", { type: "string" }),
    },
    summary: "Get API docs",
    tags: ["system"],
  },
  {
    method: "get",
    operationId: "health",
    path: "/health",
    rateLimited: true,
    responses: {
      "200": jsonResponse("Health", objectSchema("Health")),
      "503": jsonResponse("Release is converging or a dependency is unhealthy", schemaRef("Error")),
    },
    summary: "Health check",
    tags: ["system"],
  },
];

export const OPENAPI_ROUTE_KEYS = routes.map(
  (route) => `${route.method.toUpperCase()} ${route.path}`,
);

export const OPENAPI_ROUTE_IDENTITIES = routes.map((route) => ({
  method: route.method.toUpperCase(),
  operationId: route.operationId,
  path: route.path,
}));

export const OPENAPI_DOCUMENT = buildOpenApiDocument({
  routes,
  schemas: {
    ...COMPONENT_SCHEMAS,
    ...accountSchemas,
    ...billingSchemas,
    ...discoverySchemas,
    ...projectSchemas,
    ...runControlSchemas,
    ...sandboxSchemas,
    ...skillSchemas,
  },
});

export const openApiDocsHtml = (): string => renderOpenApiDocsHtml(routes);
