import {
  type JsonValue,
  jsonBody,
  jsonResponse,
  nullableStringSchema,
  type OpenApiRoute,
  stringSchema,
} from "./openapi-builder";

const objectSchema = (name: string): JsonValue => ({ $ref: `#/components/schemas/${name}` });

export const billingSchemas: Record<string, JsonValue> = {
  BillingCancel: {
    additionalProperties: false,
    properties: {
      comment: stringSchema({ maxLength: 1_000 }),
      reason: {
        enum: [
          "too_expensive",
          "missing_features",
          "switched_service",
          "unused",
          "customer_service",
          "low_quality",
          "too_complex",
          "other",
        ],
        type: "string",
      },
    },
    type: "object",
  },
  BillingCheckout: {
    additionalProperties: false,
    properties: {
      productId: stringSchema({ maxLength: 200, minLength: 1 }),
      returnUrl: stringSchema({ format: "uri", maxLength: 2_000 }),
      successUrl: stringSchema({ format: "uri", maxLength: 2_000 }),
    },
    required: ["productId"],
    type: "object",
  },
  BillingState: {
    additionalProperties: false,
    properties: {
      cancelAtPeriodEnd: { type: "boolean" },
      canCancel: { type: "boolean" },
      canReactivate: { type: "boolean" },
      currentPeriodEnd: nullableStringSchema({ format: "date-time" }),
      currentPeriodStart: nullableStringSchema({ format: "date-time" }),
      subscriptionStatus: stringSchema(),
      tier: { enum: ["free", "pro", "team", "enterprise"], type: "string" },
    },
    required: [
      "cancelAtPeriodEnd",
      "canCancel",
      "canReactivate",
      "currentPeriodEnd",
      "currentPeriodStart",
      "subscriptionStatus",
      "tier",
    ],
    type: "object",
  },
  BillingSubscriptionAction: {
    additionalProperties: false,
    properties: {
      cancelAtPeriodEnd: { type: "boolean" },
      currentPeriodEnd: nullableStringSchema({ format: "date-time" }),
      currentPeriodStart: nullableStringSchema({ format: "date-time" }),
      status: stringSchema(),
    },
    required: ["cancelAtPeriodEnd", "currentPeriodEnd", "currentPeriodStart", "status"],
    type: "object",
  },
  BillingUrl: {
    additionalProperties: false,
    properties: {
      url: stringSchema({ format: "uri" }),
    },
    required: ["url"],
    type: "object",
  },
};

export const billingRoutes: OpenApiRoute[] = [
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
    requestBody: jsonBody(objectSchema("BillingCancel")),
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
