import {
  BillingCancelSchema,
  BillingCatalogResponseSchema,
  BillingCheckoutSchema,
  BillingStateResponseSchema,
  BillingSubscriptionActionResponseSchema,
  BillingUrlResponseSchema,
  SandboxUsageSummaryResponseSchema,
} from "@cheatcode/types";
import { type JsonValue, jsonBody, jsonResponse, type OpenApiRoute } from "./openapi-builder";
import { zodJsonSchema } from "./openapi-zod";

const objectSchema = (name: string): JsonValue => ({ $ref: `#/components/schemas/${name}` });

export const billingSchemas: Record<string, JsonValue> = {
  BillingCancel: zodJsonSchema(BillingCancelSchema, "input"),
  BillingCatalog: zodJsonSchema(BillingCatalogResponseSchema),
  BillingCheckout: zodJsonSchema(BillingCheckoutSchema, "input"),
  BillingState: zodJsonSchema(BillingStateResponseSchema),
  BillingSubscriptionAction: zodJsonSchema(BillingSubscriptionActionResponseSchema),
  BillingUrl: zodJsonSchema(BillingUrlResponseSchema),
  SandboxUsageSummary: zodJsonSchema(SandboxUsageSummaryResponseSchema),
};

export const billingRoutes: OpenApiRoute[] = [
  {
    method: "get",
    operationId: "getMyUsage",
    path: "/v1/me/usage",
    responses: {
      "200": jsonResponse("Sandbox-hours usage summary", objectSchema("SandboxUsageSummary")),
    },
    security: [{ bearerAuth: [] }],
    summary: "Get sandbox-hours usage summary",
    tags: ["billing"],
  },
  {
    method: "get",
    operationId: "getBillingCatalog",
    path: "/v1/billing/catalog",
    responses: { "200": jsonResponse("Plan catalog", objectSchema("BillingCatalog")) },
    security: [{ bearerAuth: [] }],
    summary: "Get plan catalog",
    tags: ["billing"],
  },
  {
    method: "post",
    operationId: "createBillingPortal",
    path: "/v1/billing/portal",
    responses: { "200": jsonResponse("Portal URL", objectSchema("BillingUrl")) },
    security: [{ bearerAuth: [] }],
    summary: "Create Polar portal URL",
    tags: ["billing"],
  },
  {
    method: "get",
    operationId: "getBillingState",
    path: "/v1/billing/state",
    responses: { "200": jsonResponse("Billing state", objectSchema("BillingState")) },
    security: [{ bearerAuth: [] }],
    summary: "Get billing subscription state",
    tags: ["billing"],
  },
  {
    method: "post",
    operationId: "createBillingCheckout",
    path: "/v1/billing/checkout",
    requestBody: jsonBody(objectSchema("BillingCheckout")),
    responses: { "200": jsonResponse("Checkout URL", objectSchema("BillingUrl")) },
    security: [{ bearerAuth: [] }],
    summary: "Create Polar checkout URL",
    tags: ["billing"],
  },
  {
    method: "post",
    operationId: "cancelBillingSubscription",
    path: "/v1/billing/cancel",
    requestBody: jsonBody(objectSchema("BillingCancel"), false),
    responses: {
      "200": jsonResponse(
        "Subscription cancellation state",
        objectSchema("BillingSubscriptionAction"),
      ),
    },
    security: [{ bearerAuth: [] }],
    summary: "Cancel Polar subscription at period end",
    tags: ["billing"],
  },
  {
    method: "post",
    operationId: "reactivateBillingSubscription",
    path: "/v1/billing/reactivate",
    responses: {
      "200": jsonResponse(
        "Subscription reactivation state",
        objectSchema("BillingSubscriptionAction"),
      ),
    },
    security: [{ bearerAuth: [] }],
    summary: "Reactivate a pending-cancel subscription",
    tags: ["billing"],
  },
];
