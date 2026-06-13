import {
  type JsonValue,
  jsonBody,
  jsonResponse,
  type OpenApiRoute,
  schemaRef,
  stringSchema,
} from "./openapi-builder";

export const runControlSchemas: Record<string, JsonValue> = {
  ApprovalDecisionRequest: {
    additionalProperties: false,
    properties: {
      decision: { enum: ["allow", "deny"], type: "string" },
      reason: stringSchema({ maxLength: 500, minLength: 1 }),
    },
    required: ["decision"],
    type: "object",
  },
  ApprovalDecisionResponse: {
    additionalProperties: false,
    properties: {
      approvalId: stringSchema({ format: "uuid" }),
      decidedBy: { enum: ["user", "timeout", "cancel"], type: "string" },
      decision: { enum: ["allow", "deny"], type: "string" },
      ok: { const: true, type: "boolean" },
      runStatus: {
        enum: ["running", "paused", "completed", "failed", "canceled"],
        type: "string",
      },
    },
    required: ["approvalId", "decidedBy", "decision", "ok", "runStatus"],
    type: "object",
  },
};

export const runControlRoutes: OpenApiRoute[] = [
  {
    method: "post",
    operationId: "decideRunApproval",
    path: "/v1/runs/{runId}/approvals/{approvalId}",
    requestBody: jsonBody(schemaRef("ApprovalDecisionRequest")),
    responses: {
      "200": jsonResponse("Approval resolution", schemaRef("ApprovalDecisionResponse")),
      "404": jsonResponse("Run or approval not found", schemaRef("Error")),
      "409": jsonResponse("Run no longer live or decision conflict", schemaRef("Error")),
      "410": jsonResponse("Approval expired", schemaRef("Error")),
    },
    security: [{ bearerAuth: [] }],
    summary: "Resolve a pending tool-approval or model-fallback request",
    tags: ["runs"],
  },
];
