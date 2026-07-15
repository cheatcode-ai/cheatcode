import { APIError, withBoundedResponseBody } from "@cheatcode/observability";
import { type BillingTier, BillingTierSchema } from "@cheatcode/types/billing";
import type { Polar } from "@polar-sh/sdk";
import { z } from "zod";
import { PLAN_CATALOG, type PlanCatalogEntry } from "./catalog";

const PolarServerSchema = z.enum(["production", "sandbox"]);
export type PolarServer = z.infer<typeof PolarServerSchema>;

const POLAR_REQUEST_TIMEOUT_MS = 30_000;
const POLAR_RESPONSE_MAX_BYTES = 1024 * 1024;

export {
  PLAN_CATALOG,
  quotaPeriodEndFor,
  sandboxHoursWarnLevel,
} from "./catalog";

const CancellationReasonSchema = z.enum([
  "too_expensive",
  "missing_features",
  "switched_service",
  "unused",
  "customer_service",
  "low_quality",
  "too_complex",
  "other",
]);
type CancellationReason = z.infer<typeof CancellationReasonSchema>;

export interface TierLimits {
  byokProviderSlots: number | null;
  maxProjects: number | null;
  quotaComposioCalls: number | null;
  quotaSandboxHours: number | null;
}

export interface EntitlementValues {
  maxProjects: number;
  quotaComposioCalls: number;
  quotaSandboxHours: string;
  tier: BillingTier;
}

export const EntitlementCacheSchema = z
  .object({
    currentPeriodEnd: z.string().datetime().nullable(),
    currentPeriodStart: z.string().datetime().nullable(),
    maxProjects: z.number().int().positive(),
    quotaComposioCalls: z.number().int().nonnegative(),
    quotaSandboxHours: z.number().nonnegative(),
    subscriptionStatus: z.string(),
    tier: BillingTierSchema,
    updatedAt: z.string().datetime(),
  })
  .strict();

export type EntitlementCache = z.infer<typeof EntitlementCacheSchema>;

export interface EntitlementCacheInput {
  currentPeriodEnd?: Date | null;
  currentPeriodStart?: Date | null;
  maxProjects?: number;
  quotaComposioCalls?: number;
  quotaSandboxHours?: number | string;
  subscriptionStatus?: string;
  tier?: string;
  updatedAt?: Date | null;
}

function tierLimitsFromCatalog(entry: PlanCatalogEntry): TierLimits {
  return {
    byokProviderSlots: entry.byokProviderSlots,
    maxProjects: entry.maxProjects,
    quotaComposioCalls: entry.quotaComposioCalls,
    quotaSandboxHours: entry.sandboxHours,
  };
}

const TIER_LIMITS: Record<BillingTier, TierLimits> = {
  free: tierLimitsFromCatalog(PLAN_CATALOG.free),
  pro: tierLimitsFromCatalog(PLAN_CATALOG.pro),
  premium: tierLimitsFromCatalog(PLAN_CATALOG.premium),
  ultra: tierLimitsFromCatalog(PLAN_CATALOG.ultra),
  max: tierLimitsFromCatalog(PLAN_CATALOG.max),
};

const CheckoutResponseSchema = z
  .object({
    url: z.string().url().max(2_048),
  })
  .strip();

const CustomerSessionResponseSchema = z
  .object({
    customerPortalUrl: z.string().url().max(2_048).optional(),
    url: z.string().url().max(2_048).optional(),
  })
  .strip();

const SubscriptionActionResponseSchema = z
  .object({
    cancelAtPeriodEnd: z.boolean(),
    currentPeriodEnd: z.date().nullable(),
    currentPeriodStart: z.date().nullable(),
    id: z.string().min(1).max(500),
    status: z.string().min(1).max(100),
  })
  .strip();

const PolarCustomerResponseSchema = z.object({ id: z.string().min(1).max(500) }).strip();

const PolarCustomerStateResponseSchema = z
  .object({
    activeSubscriptions: z
      .array(
        z
          .object({
            cancelAtPeriodEnd: z.boolean(),
            currentPeriodEnd: z.date(),
            currentPeriodStart: z.date(),
            id: z.string().min(1).max(500),
            productId: z.string().min(1).max(500),
            status: z.string().min(1).max(100),
          })
          .strip(),
      )
      .max(100),
    id: z.string().min(1).max(500),
  })
  .strip();

export interface CreateCheckoutUrlInput {
  accessToken: string;
  customerEmail?: string;
  productId: string;
  returnUrl?: string;
  server?: PolarServer;
  successUrl?: string;
  userId: string;
}

export interface CreateCustomerPortalUrlInput {
  accessToken: string;
  customerId?: string;
  externalCustomerId: string;
  returnUrl?: string;
  server?: PolarServer;
}

export interface EnsurePolarCustomerInput {
  accessToken: string;
  email: string;
  externalCustomerId: string;
  server?: PolarServer;
}

export interface CancelSubscriptionAtPeriodEndInput {
  accessToken: string;
  comment?: string;
  reason?: CancellationReason;
  server?: PolarServer;
  subscriptionId: string;
}

export interface ReactivateSubscriptionInput {
  accessToken: string;
  server?: PolarServer;
  subscriptionId: string;
}

export interface UpdateCustomerProfileInput {
  accessToken: string;
  customerId: string;
  email: string;
  name?: string | null;
  server?: PolarServer;
}

export interface GetPolarCustomerStateInput {
  accessToken: string;
  externalCustomerId: string;
  server?: PolarServer;
}

export interface PolarCustomerStateSubscription {
  cancelAtPeriodEnd: boolean;
  currentPeriodEnd: Date;
  currentPeriodStart: Date;
  id: string;
  productId: string;
  status: string;
}

export interface PolarCustomerStateResult {
  activeSubscriptions: PolarCustomerStateSubscription[];
  customerId: string;
}

export interface SubscriptionActionResult {
  cancelAtPeriodEnd: boolean;
  currentPeriodEnd: string | null;
  currentPeriodStart: string | null;
  id: string;
  status: string;
}

export async function createCheckoutUrl(input: CreateCheckoutUrlInput): Promise<string> {
  const response = await (await polarClient(input.accessToken, input.server)).checkouts.create({
    allowDiscountCodes: true,
    externalCustomerId: input.userId,
    metadata: { userId: input.userId },
    products: [input.productId],
    ...(input.customerEmail ? { customerEmail: input.customerEmail } : {}),
    ...(input.returnUrl ? { returnUrl: input.returnUrl } : {}),
    ...(input.successUrl ? { successUrl: input.successUrl } : {}),
  });
  return parseCheckoutUrl(response);
}

export async function createCustomerPortalUrl(
  input: CreateCustomerPortalUrlInput,
): Promise<string> {
  const sessionInput = input.customerId
    ? {
        customerId: input.customerId,
        ...(input.returnUrl ? { returnUrl: input.returnUrl } : {}),
      }
    : {
        externalCustomerId: input.externalCustomerId,
        ...(input.returnUrl ? { returnUrl: input.returnUrl } : {}),
      };
  const response = await (
    await polarClient(input.accessToken, input.server)
  ).customerSessions.create(sessionInput);
  return parseCustomerPortalUrl(response);
}

/** Resolves the Polar customer, creating it when local entitlements predate checkout sync. */
export async function ensurePolarCustomer(input: EnsurePolarCustomerInput): Promise<string> {
  const polar = await polarClient(input.accessToken, input.server);
  try {
    return parsePolarResponse(
      PolarCustomerResponseSchema,
      await polar.customers.getExternal({ externalId: input.externalCustomerId }),
      "Polar customer lookup returned an invalid response",
    ).id;
  } catch (error) {
    if (!isPolarNotFoundError(error)) {
      throw error;
    }
  }
  const customer = await polar.customers.create({
    email: input.email,
    externalId: input.externalCustomerId,
    metadata: { userId: input.externalCustomerId },
  });
  return parsePolarResponse(
    PolarCustomerResponseSchema,
    customer,
    "Polar customer creation returned an invalid response",
  ).id;
}

/** Reads Polar's canonical active-subscription projection for one internal user. */
export async function getPolarCustomerState(
  input: GetPolarCustomerStateInput,
): Promise<PolarCustomerStateResult> {
  const state = parsePolarResponse(
    PolarCustomerStateResponseSchema,
    await (await polarClient(input.accessToken, input.server)).customers.getStateExternal({
      externalId: input.externalCustomerId,
    }),
    "Polar customer state returned an invalid response",
  );
  return {
    activeSubscriptions: state.activeSubscriptions.map((subscription) => ({
      cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
      currentPeriodEnd: subscription.currentPeriodEnd,
      currentPeriodStart: subscription.currentPeriodStart,
      id: subscription.id,
      productId: subscription.productId,
      status: subscription.status,
    })),
    customerId: state.id,
  };
}

export async function cancelSubscriptionAtPeriodEnd(
  input: CancelSubscriptionAtPeriodEndInput,
): Promise<SubscriptionActionResult> {
  const subscriptionUpdate = {
    cancelAtPeriodEnd: true,
    ...(input.reason ? { customerCancellationReason: input.reason } : {}),
    ...(input.comment ? { customerCancellationComment: input.comment } : {}),
  };
  const response = await (await polarClient(input.accessToken, input.server)).subscriptions.update({
    id: input.subscriptionId,
    subscriptionUpdate,
  });
  return parseSubscriptionAction(response);
}

export async function reactivateSubscription(
  input: ReactivateSubscriptionInput,
): Promise<SubscriptionActionResult> {
  const response = await (await polarClient(input.accessToken, input.server)).subscriptions.update({
    id: input.subscriptionId,
    subscriptionUpdate: { cancelAtPeriodEnd: false },
  });
  return parseSubscriptionAction(response);
}

export async function updateCustomerProfile(input: UpdateCustomerProfileInput): Promise<void> {
  await (await polarClient(input.accessToken, input.server)).customers.update({
    customerUpdate: {
      email: input.email,
      ...(input.name !== undefined ? { name: input.name } : {}),
    },
    id: input.customerId,
  });
}

export function tierLimits(tier: BillingTier): TierLimits {
  return TIER_LIMITS[tier];
}

export function entitlementValuesForTier(tier: BillingTier): EntitlementValues {
  const limits = tierLimits(tier);
  return {
    maxProjects: integerLimit(limits.maxProjects),
    quotaComposioCalls: integerLimit(limits.quotaComposioCalls),
    quotaSandboxHours: numericLimit(limits.quotaSandboxHours),
    tier,
  };
}

export function entitlementCacheFromValues(input: EntitlementCacheInput): EntitlementCache {
  const tier = parseTier(input.tier);
  const defaults = entitlementValuesForTier(tier);
  return EntitlementCacheSchema.parse({
    currentPeriodEnd: isoDateOrNull(input.currentPeriodEnd),
    currentPeriodStart: isoDateOrNull(input.currentPeriodStart),
    maxProjects: input.maxProjects ?? defaults.maxProjects,
    quotaComposioCalls: input.quotaComposioCalls ?? defaults.quotaComposioCalls,
    quotaSandboxHours: numericQuota(input.quotaSandboxHours ?? defaults.quotaSandboxHours),
    subscriptionStatus: input.subscriptionStatus ?? "none",
    tier,
    updatedAt: isoDateOrNow(input.updatedAt),
  });
}

function parseTier(value: string | undefined): BillingTier {
  const parsed = BillingTierSchema.safeParse(value);
  return parsed.success ? parsed.data : "free";
}

function isoDateOrNull(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null;
}

function isoDateOrNow(value: Date | null | undefined): string {
  return (value ?? new Date()).toISOString();
}

// Dynamically imported so the 2.2 MB Polar SDK stays out of the importing
// isolate's startup path (CF startup CPU limit). The agent-worker pulls this
// package for pure entitlement math and must not pay the Polar parse cost; the
// SDK loads only when a checkout/portal/subscription call is actually made.
async function polarClient(
  accessToken: string,
  server: PolarServer = "production",
): Promise<Polar> {
  if (accessToken.trim().length === 0) {
    throw new APIError(503, "unavailable_maintenance", "Polar access token is not configured", {
      hint: "Set POLAR_ACCESS_TOKEN in the gateway Worker environment.",
      retriable: false,
    });
  }
  const { HTTPClient, Polar } = await import("@polar-sh/sdk");
  const httpClient = new HTTPClient({
    fetcher: async (input, init) => {
      const response = await fetch(input, init);
      return withBoundedResponseBody(response, POLAR_RESPONSE_MAX_BYTES, "Polar");
    },
  });
  return new Polar({ accessToken, httpClient, server, timeoutMs: POLAR_REQUEST_TIMEOUT_MS });
}

function isPolarNotFoundError(error: unknown): boolean {
  return (
    typeof error === "object" && error !== null && "statusCode" in error && error.statusCode === 404
  );
}

function integerLimit(value: number | null): number {
  return value ?? 2_147_483_647;
}

function numericLimit(value: number | null): string {
  return String(value ?? 2_147_483_647);
}

function numericQuota(value: number | string): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function parseCheckoutUrl(response: unknown): string {
  const parsed = CheckoutResponseSchema.safeParse(response);
  if (!parsed.success) {
    throw new APIError(502, "upstream_provider_outage", "Polar checkout did not return a URL", {
      retriable: true,
    });
  }
  return parsed.data.url;
}

function parseCustomerPortalUrl(response: unknown): string {
  const parsed = CustomerSessionResponseSchema.safeParse(response);
  if (!parsed.success) {
    throw new APIError(502, "upstream_provider_outage", "Polar portal did not return a URL", {
      retriable: true,
    });
  }
  const url = parsed.data.customerPortalUrl ?? parsed.data.url;
  if (!url) {
    throw new APIError(502, "upstream_provider_outage", "Polar portal URL is missing", {
      retriable: true,
    });
  }
  return url;
}

function parseSubscriptionAction(response: unknown): SubscriptionActionResult {
  const parsed = SubscriptionActionResponseSchema.safeParse(response);
  if (!parsed.success) {
    throw new APIError(502, "upstream_provider_outage", "Polar subscription update failed", {
      retriable: true,
    });
  }
  return {
    cancelAtPeriodEnd: parsed.data.cancelAtPeriodEnd,
    currentPeriodEnd: isoDateOrNull(parsed.data.currentPeriodEnd),
    currentPeriodStart: isoDateOrNull(parsed.data.currentPeriodStart),
    id: parsed.data.id,
    status: parsed.data.status,
  };
}

function parsePolarResponse<T>(schema: z.ZodType<T>, response: unknown, message: string): T {
  const parsed = schema.safeParse(response);
  if (parsed.success) {
    return parsed.data;
  }
  throw new APIError(502, "upstream_provider_outage", message, {
    retriable: true,
  });
}
