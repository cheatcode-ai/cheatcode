import {
  cancelSubscriptionAtPeriodEnd,
  createCheckoutUrl,
  createCustomerPortalUrl,
  ensurePolarCustomer,
  PLAN_CATALOG,
  type PolarServer,
  reactivateSubscription,
} from "@cheatcode/billing";
import {
  findBillingUserById,
  findEntitlementByUserId,
  type UserDatabaseSession,
  updateEntitlementSubscriptionState,
  updateUserPolarCustomerId,
  withUserDb,
} from "@cheatcode/db";
import { PRODUCTION_APP_ORIGIN, type WorkerSecret } from "@cheatcode/env";
import { APIError, readJsonRequest } from "@cheatcode/observability";
import {
  BILLING_TIERS,
  BillingCancelSchema,
  type BillingCatalogResponse,
  BillingCatalogResponseSchema,
  BillingCheckoutSchema,
  BillingStateResponseSchema,
  BillingSubscriptionActionResponseSchema,
  type BillingTier,
  BillingUrlResponseSchema,
  type PaidBillingTier,
  type PlanSummary,
  SandboxUsageSummaryResponseSchema,
  type UserId,
} from "@cheatcode/types";
import { resolveCorsOrigin } from "./cors";
import { type GatewayContext, type GatewayEnv, requestDatabase } from "./gateway-env";
import { resolveEntitlement } from "./limits";
import { rateLimit } from "./rate-limit";
import { buildSandboxUsageSummary } from "./usage-summary";

const POLAR_PRODUCT_ID_ENV = {
  premium: "POLAR_PRODUCT_ID_PREMIUM",
  pro: "POLAR_PRODUCT_ID_PRO",
} as const satisfies Record<PaidBillingTier, keyof GatewayEnv>;

const BILLING_REQUEST_MAX_BYTES = 8 * 1024;
const LOCAL_WEB_ORIGIN = "http://localhost:3001";

type BillingContext = GatewayContext;

export interface BillingRouteDeps {
  authenticate: (c: GatewayContext) => Promise<UserId>;
  readRequiredSecret: (secret: WorkerSecret | undefined, name: string) => Promise<string>;
}

export async function billingStateRoute(
  c: BillingContext,
  deps: BillingRouteDeps,
): Promise<Response> {
  const userId = await deps.authenticate(c);
  await rateLimit(c, userId);
  return withUserDb(requestDatabase(c), userId, async ({ transaction }) => {
    const entitlement = await transaction((tx) => findEntitlementByUserId(tx, userId));
    return c.json(BillingStateResponseSchema.parse(billingStateFromEntitlement(entitlement)));
  });
}

export async function billingCheckoutRoute(
  c: BillingContext,
  deps: BillingRouteDeps,
): Promise<Response> {
  const userId = await deps.authenticate(c);
  await rateLimit(c, userId);
  const parsedInput = BillingCheckoutSchema.safeParse(
    await readJsonRequest(c.req.raw, BILLING_REQUEST_MAX_BYTES, "Billing payload"),
  );
  if (!parsedInput.success) {
    throw new APIError(400, "request_body_invalid", "Invalid billing checkout payload", {
      details: { issues: parsedInput.error.issues.map((issue) => issue.message) },
      retriable: false,
    });
  }
  const accessToken = await deps.readRequiredSecret(c.env.POLAR_ACCESS_TOKEN, "POLAR_ACCESS_TOKEN");
  const productId = polarProductIdForTier(c.env, parsedInput.data.tier);
  return withUserDb(requestDatabase(c), userId, async ({ transaction }) => {
    const user = await requireBillingUser(transaction, userId);
    const redirect = checkoutRedirectUrls(c, parsedInput.data.returnPath);
    const url = await createCheckoutUrl({
      accessToken,
      customerEmail: user.email,
      productId,
      returnUrl: redirect.returnUrl,
      ...(c.env.POLAR_SERVER ? { server: c.env.POLAR_SERVER } : {}),
      successUrl: redirect.successUrl,
      userId,
    });
    return c.json(BillingUrlResponseSchema.parse({ url }));
  });
}

function checkoutRedirectUrls(
  c: BillingContext,
  returnPath = "/pricing",
): { returnUrl: string; successUrl: string } {
  const returnUrl = new URL(returnPath, billingWebOrigin(c));
  const successUrl = new URL(returnUrl);
  successUrl.searchParams.set("checkout", "success");
  return { returnUrl: returnUrl.toString(), successUrl: successUrl.toString() };
}

function billingWebOrigin(c: BillingContext): string {
  if (c.env.CHEATCODE_ENVIRONMENT === "production") {
    return PRODUCTION_APP_ORIGIN;
  }
  const requestOrigin = c.req.header("Origin");
  return resolveCorsOrigin(requestOrigin, "development") ?? LOCAL_WEB_ORIGIN;
}

export async function billingCatalogRoute(
  c: BillingContext,
  deps: BillingRouteDeps,
): Promise<Response> {
  const userId = await deps.authenticate(c);
  await rateLimit(c, userId);
  return withUserDb(requestDatabase(c), userId, async ({ transaction }) => {
    const entitlement = await resolveEntitlement(c.env, transaction, userId);
    return c.json(BillingCatalogResponseSchema.parse(buildBillingCatalog(c.env, entitlement.tier)));
  });
}

export async function myUsageRoute(c: BillingContext, deps: BillingRouteDeps): Promise<Response> {
  const userId = await deps.authenticate(c);
  await rateLimit(c, userId);
  return withUserDb(requestDatabase(c), userId, async ({ transaction }) => {
    const summary = await buildSandboxUsageSummary(c.env, transaction, userId);
    return c.json(SandboxUsageSummaryResponseSchema.parse(summary));
  });
}

export async function billingPortalRoute(
  c: BillingContext,
  deps: BillingRouteDeps,
): Promise<Response> {
  const userId = await deps.authenticate(c);
  await rateLimit(c, userId);
  const accessToken = await deps.readRequiredSecret(c.env.POLAR_ACCESS_TOKEN, "POLAR_ACCESS_TOKEN");
  return withUserDb(requestDatabase(c), userId, async ({ transaction }) => {
    const user = await requireBillingUser(transaction, userId);
    const customerId =
      user.polarCustomerId ??
      (await ensureAndStorePolarCustomer(transaction, accessToken, user, c.env.POLAR_SERVER));
    const url = await createCustomerPortalUrl({
      accessToken,
      customerId,
      externalCustomerId: user.id,
      ...(c.env.POLAR_SERVER ? { server: c.env.POLAR_SERVER } : {}),
    });
    return c.json(BillingUrlResponseSchema.parse({ url }));
  });
}

async function ensureAndStorePolarCustomer(
  transaction: UserDatabaseSession["transaction"],
  accessToken: string,
  user: Awaited<ReturnType<typeof requireBillingUser>>,
  server?: PolarServer,
): Promise<string> {
  const polarCustomerId = await ensurePolarCustomer({
    accessToken,
    email: user.email,
    externalCustomerId: user.id,
    ...(server ? { server } : {}),
  });
  await transaction((tx) => updateUserPolarCustomerId(tx, { polarCustomerId, userId: user.id }));
  return polarCustomerId;
}

export async function billingCancelRoute(
  c: BillingContext,
  deps: BillingRouteDeps,
): Promise<Response> {
  const userId = await deps.authenticate(c);
  await rateLimit(c, userId);
  const parsedInput = BillingCancelSchema.safeParse(
    await readJsonRequest(c.req.raw, BILLING_REQUEST_MAX_BYTES, "Billing payload"),
  );
  if (!parsedInput.success) {
    throw new APIError(400, "request_body_invalid", "Invalid billing cancellation payload", {
      details: { issues: parsedInput.error.issues.map((issue) => issue.message) },
      retriable: false,
    });
  }
  const accessToken = await deps.readRequiredSecret(c.env.POLAR_ACCESS_TOKEN, "POLAR_ACCESS_TOKEN");
  return withUserDb(requestDatabase(c), userId, async ({ transaction }) => {
    const entitlement = await loadSubscriptionEntitlement(transaction, userId);
    const result = await cancelSubscriptionAtPeriodEnd({
      accessToken,
      ...(parsedInput.data.comment ? { comment: parsedInput.data.comment } : {}),
      ...(parsedInput.data.reason ? { reason: parsedInput.data.reason } : {}),
      ...(c.env.POLAR_SERVER ? { server: c.env.POLAR_SERVER } : {}),
      subscriptionId: entitlement.polarSubscriptionId,
    });
    await syncSubscriptionState(c, transaction, userId, result);
    return c.json(
      BillingSubscriptionActionResponseSchema.parse(subscriptionActionResponse(result)),
    );
  });
}

export async function billingReactivateRoute(
  c: BillingContext,
  deps: BillingRouteDeps,
): Promise<Response> {
  const userId = await deps.authenticate(c);
  await rateLimit(c, userId);
  const accessToken = await deps.readRequiredSecret(c.env.POLAR_ACCESS_TOKEN, "POLAR_ACCESS_TOKEN");
  return withUserDb(requestDatabase(c), userId, async ({ transaction }) => {
    const entitlement = await loadSubscriptionEntitlement(transaction, userId);
    const result = await reactivateSubscription({
      accessToken,
      ...(c.env.POLAR_SERVER ? { server: c.env.POLAR_SERVER } : {}),
      subscriptionId: entitlement.polarSubscriptionId,
    });
    await syncSubscriptionState(c, transaction, userId, result);
    return c.json(
      BillingSubscriptionActionResponseSchema.parse(subscriptionActionResponse(result)),
    );
  });
}

async function requireBillingUser(transaction: UserDatabaseSession["transaction"], userId: UserId) {
  const user = await transaction((tx) => findBillingUserById(tx, userId));
  if (!user) {
    throw new APIError(404, "resource_user_not_found", "Billing user is not synced", {
      hint: "Sign out and sign back in so Clerk can resync your account.",
      retriable: true,
    });
  }
  return user;
}

async function loadSubscriptionEntitlement(
  transaction: UserDatabaseSession["transaction"],
  userId: UserId,
) {
  const entitlement = await transaction((tx) => findEntitlementByUserId(tx, userId));
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
  transaction: UserDatabaseSession["transaction"],
  userId: UserId,
  result: {
    cancelAtPeriodEnd: boolean;
    currentPeriodEnd: string | null;
    currentPeriodStart: string | null;
    id: string;
    status: string;
  },
): Promise<void> {
  await transaction((tx) =>
    updateEntitlementSubscriptionState(tx, {
      cancelAtPeriodEnd: result.cancelAtPeriodEnd,
      currentPeriodEnd: dateFromIso(result.currentPeriodEnd),
      currentPeriodStart: dateFromIso(result.currentPeriodStart),
      polarSubscriptionId: result.id,
      subscriptionStatus: result.status,
      userId,
    }),
  );
  c.executionCtx.waitUntil(c.env.ENTITLEMENTS_CACHE.delete(`entitlement:${userId}`));
}

function subscriptionActionResponse(result: {
  cancelAtPeriodEnd: boolean;
  currentPeriodEnd: string | null;
  currentPeriodStart: string | null;
  status: string;
}) {
  return {
    cancelAtPeriodEnd: result.cancelAtPeriodEnd,
    currentPeriodEnd: result.currentPeriodEnd,
    currentPeriodStart: result.currentPeriodStart,
    status: result.status,
  };
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

function buildBillingCatalog(env: GatewayEnv, currentTier: BillingTier): BillingCatalogResponse {
  return {
    currentTier,
    plans: BILLING_TIERS.map((tier) => planSummaryForTier(env, tier, currentTier)),
  };
}

function planSummaryForTier(
  env: GatewayEnv,
  tier: BillingTier,
  currentTier: BillingTier,
): PlanSummary {
  const entry = PLAN_CATALOG[tier];
  return {
    available: tier === "free" ? true : Boolean(polarProductIdEnv(env, tier)),
    current: tier === currentTier,
    displayName: entry.displayName,
    id: tier,
    limits: {
      maxProjects: entry.maxProjects,
      quotaComposioCalls: entry.quotaComposioCalls,
    },
    monthlyPriceUsd: entry.priceUsdMonthly,
    sandboxHoursPerMonth: entry.sandboxHours,
  };
}

function polarProductIdForTier(env: GatewayEnv, tier: PaidBillingTier): string {
  const productId = polarProductIdEnv(env, tier);
  if (!productId) {
    throw new APIError(
      503,
      "service_maintenance_unavailable",
      `Polar product for the ${tier} tier is not configured`,
      {
        hint: `Set ${POLAR_PRODUCT_ID_ENV[tier]} in the gateway Worker environment.`,
        retriable: false,
      },
    );
  }
  return productId;
}

function polarProductIdEnv(env: GatewayEnv, tier: PaidBillingTier): string | undefined {
  const value = env[POLAR_PRODUCT_ID_ENV[tier]];
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function dateFromIso(value: string | null): Date | null {
  return value ? new Date(value) : null;
}

function isoDateOrNull(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}
