import {
  cancelSubscriptionAtPeriodEnd,
  createCheckoutUrl,
  createCustomerPortalUrl,
  reactivateSubscription,
} from "@cheatcode/billing";
import {
  createDb,
  type Database,
  findBillingUserById,
  findEntitlementByUserId,
  updateEntitlementSubscriptionState,
  withUserContext,
} from "@cheatcode/db";
import type { WorkerSecret } from "@cheatcode/env";
import { APIError } from "@cheatcode/observability";
import {
  BillingCancelSchema,
  BillingCheckoutSchema,
  BillingStateResponseSchema,
  BillingSubscriptionActionResponseSchema,
  BillingUrlResponseSchema,
  type UserId,
} from "@cheatcode/types";
import type { Context } from "hono";
import type { GatewayEnv } from "./index";
import { rateLimit } from "./rate-limit";

type BillingContext = Context<{ Bindings: GatewayEnv }>;

export interface BillingRouteDeps {
  authenticate: (request: Request, env: GatewayEnv, ctx: ExecutionContext) => Promise<UserId>;
  readRequiredSecret: (secret: WorkerSecret | undefined, name: string) => Promise<string>;
}

export async function billingStateRoute(
  c: BillingContext,
  deps: BillingRouteDeps,
): Promise<Response> {
  const userId = await deps.authenticate(c.req.raw, c.env, c.executionCtx);
  await rateLimit(c, userId, "GET /v1/billing/state");
  const { db, close } = createDb(c.env.HYPERDRIVE);
  try {
    const entitlement = await withUserContext(db, userId, (tx) =>
      findEntitlementByUserId(tx, userId),
    );
    return c.json(BillingStateResponseSchema.parse(billingStateFromEntitlement(entitlement)));
  } finally {
    c.executionCtx.waitUntil(close());
  }
}

export async function billingCheckoutRoute(
  c: BillingContext,
  deps: BillingRouteDeps,
): Promise<Response> {
  const userId = await deps.authenticate(c.req.raw, c.env, c.executionCtx);
  await rateLimit(c, userId, "POST /v1/billing/checkout");
  const parsedInput = BillingCheckoutSchema.safeParse(await readJsonBody(c));
  if (!parsedInput.success) {
    throw new APIError(400, "invalid_request_body", "Invalid billing checkout payload", {
      details: { issues: parsedInput.error.issues.map((issue) => issue.message) },
      retriable: false,
    });
  }
  const accessToken = await deps.readRequiredSecret(c.env.POLAR_ACCESS_TOKEN, "POLAR_ACCESS_TOKEN");
  const { db, close } = createDb(c.env.HYPERDRIVE);
  try {
    const user = await requireBillingUser(db, userId);
    const url = await createCheckoutUrl({
      accessToken,
      customerEmail: user.email,
      productId: parsedInput.data.productId,
      ...(parsedInput.data.returnUrl ? { returnUrl: parsedInput.data.returnUrl } : {}),
      ...(parsedInput.data.successUrl ? { successUrl: parsedInput.data.successUrl } : {}),
      userId,
    });
    return c.json(BillingUrlResponseSchema.parse({ url }));
  } finally {
    c.executionCtx.waitUntil(close());
  }
}

export async function billingPortalRoute(
  c: BillingContext,
  deps: BillingRouteDeps,
): Promise<Response> {
  const userId = await deps.authenticate(c.req.raw, c.env, c.executionCtx);
  await rateLimit(c, userId, "POST /v1/billing/portal");
  const accessToken = await deps.readRequiredSecret(c.env.POLAR_ACCESS_TOKEN, "POLAR_ACCESS_TOKEN");
  const { db, close } = createDb(c.env.HYPERDRIVE);
  try {
    const user = await requireBillingUser(db, userId);
    const url = await createCustomerPortalUrl({
      accessToken,
      ...(user.polarCustomerId ? { customerId: user.polarCustomerId } : {}),
      externalCustomerId: user.id,
    });
    return c.json(BillingUrlResponseSchema.parse({ url }));
  } finally {
    c.executionCtx.waitUntil(close());
  }
}

export async function billingCancelRoute(
  c: BillingContext,
  deps: BillingRouteDeps,
): Promise<Response> {
  const userId = await deps.authenticate(c.req.raw, c.env, c.executionCtx);
  await rateLimit(c, userId, "POST /v1/billing/cancel");
  const parsedInput = BillingCancelSchema.safeParse(await readJsonBody(c));
  if (!parsedInput.success) {
    throw new APIError(400, "invalid_request_body", "Invalid billing cancellation payload", {
      details: { issues: parsedInput.error.issues.map((issue) => issue.message) },
      retriable: false,
    });
  }
  const accessToken = await deps.readRequiredSecret(c.env.POLAR_ACCESS_TOKEN, "POLAR_ACCESS_TOKEN");
  const { db, close } = createDb(c.env.HYPERDRIVE);
  try {
    const entitlement = await loadSubscriptionEntitlement(db, userId);
    const result = await cancelSubscriptionAtPeriodEnd({
      accessToken,
      ...(parsedInput.data.comment ? { comment: parsedInput.data.comment } : {}),
      ...(parsedInput.data.reason ? { reason: parsedInput.data.reason } : {}),
      subscriptionId: entitlement.polarSubscriptionId,
    });
    await syncSubscriptionState(c, db, userId, result);
    return c.json(BillingSubscriptionActionResponseSchema.parse(result));
  } finally {
    c.executionCtx.waitUntil(close());
  }
}

export async function billingReactivateRoute(
  c: BillingContext,
  deps: BillingRouteDeps,
): Promise<Response> {
  const userId = await deps.authenticate(c.req.raw, c.env, c.executionCtx);
  await rateLimit(c, userId, "POST /v1/billing/reactivate");
  const accessToken = await deps.readRequiredSecret(c.env.POLAR_ACCESS_TOKEN, "POLAR_ACCESS_TOKEN");
  const { db, close } = createDb(c.env.HYPERDRIVE);
  try {
    const entitlement = await loadSubscriptionEntitlement(db, userId);
    const result = await reactivateSubscription({
      accessToken,
      subscriptionId: entitlement.polarSubscriptionId,
    });
    await syncSubscriptionState(c, db, userId, result);
    return c.json(BillingSubscriptionActionResponseSchema.parse(result));
  } finally {
    c.executionCtx.waitUntil(close());
  }
}

async function requireBillingUser(db: Database, userId: UserId) {
  const user = await withUserContext(db, userId, (tx) => findBillingUserById(tx, userId));
  if (!user) {
    throw new APIError(404, "not_found_user", "Billing user is not synced", {
      hint: "Sign out and sign back in so Clerk can resync your account.",
      retriable: true,
    });
  }
  return user;
}

async function loadSubscriptionEntitlement(db: Database, userId: UserId) {
  const entitlement = await withUserContext(db, userId, (tx) =>
    findEntitlementByUserId(tx, userId),
  );
  if (!entitlement?.polarSubscriptionId || entitlement.tier === "free") {
    throw new APIError(409, "conflict_state_invalid", "No active Polar subscription is linked", {
      hint: "Start checkout before managing subscription cancellation.",
      retriable: false,
    });
  }
  return { ...entitlement, polarSubscriptionId: entitlement.polarSubscriptionId };
}

async function syncSubscriptionState(
  c: BillingContext,
  db: Database,
  userId: UserId,
  result: {
    cancelAtPeriodEnd: boolean;
    currentPeriodEnd: string | null;
    currentPeriodStart: string | null;
    id: string;
    status: string;
  },
): Promise<void> {
  await withUserContext(db, userId, (tx) =>
    updateEntitlementSubscriptionState(tx, {
      cancelAtPeriodEnd: result.cancelAtPeriodEnd,
      currentPeriodEnd: dateFromIso(result.currentPeriodEnd),
      currentPeriodStart: dateFromIso(result.currentPeriodStart),
      polarSubscriptionId: result.id,
      source: "polar",
      subscriptionStatus: result.status,
      userId,
    }),
  );
  c.executionCtx.waitUntil(c.env.ENTITLEMENTS_CACHE.delete(`entitlement:${userId}`));
}

function billingStateFromEntitlement(
  entitlement: Awaited<ReturnType<typeof findEntitlementByUserId>>,
) {
  const hasSubscription = Boolean(entitlement?.polarSubscriptionId && entitlement.tier !== "free");
  const cancelAtPeriodEnd = entitlement?.cancelAtPeriodEnd ?? false;
  return {
    cancelAtPeriodEnd,
    canCancel: hasSubscription && !cancelAtPeriodEnd,
    canReactivate: hasSubscription && cancelAtPeriodEnd,
    currentPeriodEnd: isoDateOrNull(entitlement?.currentPeriodEnd ?? null),
    currentPeriodStart: isoDateOrNull(entitlement?.currentPeriodStart ?? null),
    subscriptionStatus: entitlement?.subscriptionStatus ?? "none",
    tier: entitlement?.tier ?? "free",
  };
}

async function readJsonBody(c: BillingContext): Promise<unknown> {
  try {
    return await c.req.json();
  } catch {
    return {};
  }
}

function dateFromIso(value: string | null): Date | null {
  return value ? new Date(value) : null;
}

function isoDateOrNull(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}
