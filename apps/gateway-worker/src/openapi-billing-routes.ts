import {
  arrayOf,
  type JsonValue,
  jsonBody,
  jsonResponse,
  nullableNumberSchema,
  nullableStringSchema,
  type OpenApiRoute,
  stringSchema,
} from "./openapi-builder";

const objectSchema = (name: string): JsonValue => ({ $ref: `#/components/schemas/${name}` });

const billingTierSchema: JsonValue = {
  enum: ["free", "pro", "premium", "ultra", "max"],
  type: "string",
};

const positiveIntegerSchema: JsonValue = { exclusiveMinimum: 0, type: "integer" };

const nullablePositiveIntegerSchema: JsonValue = {
  exclusiveMinimum: 0,
  type: ["integer", "null"],
};

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
  BillingCatalog: {
    additionalProperties: false,
    properties: {
      currentTier: billingTierSchema,
      plans: arrayOf(objectSchema("PlanSummary")),
    },
    required: ["currentTier", "plans"],
    type: "object",
  },
  BillingCheckout: {
    additionalProperties: false,
    properties: {
      returnUrl: stringSchema({ format: "uri", maxLength: 2_000 }),
      successUrl: stringSchema({ format: "uri", maxLength: 2_000 }),
      tier: { enum: ["pro", "premium", "ultra", "max"], type: "string" },
    },
    required: ["tier"],
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
      tier: billingTierSchema,
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
  PlanSummary: {
    additionalProperties: false,
    properties: {
      available: { type: "boolean" },
      current: { type: "boolean" },
      displayName: stringSchema(),
      id: billingTierSchema,
      limits: {
        additionalProperties: false,
        properties: {
          dailyCostCapUsd: nullableNumberSchema(),
          maxConcurrentSandboxes: positiveIntegerSchema,
          maxProjects: nullablePositiveIntegerSchema,
          quotaComposioCalls: nullablePositiveIntegerSchema,
          quotaDeployments: nullablePositiveIntegerSchema,
        },
        required: [
          "dailyCostCapUsd",
          "maxConcurrentSandboxes",
          "maxProjects",
          "quotaComposioCalls",
          "quotaDeployments",
        ],
        type: "object",
      },
      monthlyPriceUsd: { minimum: 0, type: "number" },
      sandboxHoursPerMonth: { exclusiveMinimum: 0, type: "number" },
    },
    required: [
      "available",
      "current",
      "displayName",
      "id",
      "limits",
      "monthlyPriceUsd",
      "sandboxHoursPerMonth",
    ],
    type: "object",
  },
  SandboxUsageSummary: {
    additionalProperties: false,
    properties: {
      resetAt: stringSchema({ format: "date-time" }),
      sandboxHoursTotal: { minimum: 0, type: "number" },
      sandboxHoursUsed: { minimum: 0, type: "number" },
      tier: billingTierSchema,
      warnLevel: { enum: ["none", "warn80", "warn95", "exhausted"], type: "string" },
    },
    required: ["resetAt", "sandboxHoursTotal", "sandboxHoursUsed", "tier", "warnLevel"],
    type: "object",
  },
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
