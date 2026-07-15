import { ApprovalDecisionRequestSchema, ApprovalDecisionResponseSchema } from "@cheatcode/types";
import {
  type JsonValue,
  jsonBody,
  jsonResponse,
  type OpenApiRoute,
  schemaRef,
} from "./openapi-builder";
import { zodJsonSchema } from "./openapi-zod";

export const runControlSchemas: Record<string, JsonValue> = {
  ApprovalDecisionRequest: zodJsonSchema(ApprovalDecisionRequestSchema, "input"),
  ApprovalDecisionResponse: zodJsonSchema(ApprovalDecisionResponseSchema),
};

export const runControlRoutes: OpenApiRoute[] = [
  {
    method: "post",
    operationId: "decideRunApproval",
    path: "/v1/runs/{runId}/approvals/{approvalId}",
    requestBody: jsonBody(schemaRef("ApprovalDecisionRequest")),
    responses: {
      "200": jsonResponse("Approval resolution", schemaRef("ApprovalDecisionResponse")),
      "404": jsonResponse("Run not found", schemaRef("Error")),
      "409": jsonResponse("Approval unavailable or decision conflict", schemaRef("Error")),
    },
    security: [{ bearerAuth: [] }],
    summary: "Resolve a pending tool-approval or model-fallback request",
    tags: ["runs"],
  },
];
