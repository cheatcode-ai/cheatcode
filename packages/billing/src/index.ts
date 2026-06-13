import { APIError } from "@cheatcode/observability";
import { Polar } from "@polar-sh/sdk";
import { z } from "zod";

export const BillingTierSchema = z.enum(["free", "pro", "team", "enterprise"]);
export type BillingTier = z.infer<typeof BillingTierSchema>;

export const CancellationReasonSchema = z.enum([
  "too_expensive",
  "missing_features",
  "switched_service",
  "unused",
  "customer_service",
  "low_quality",
  "too_complex",
  "other",
]);
export type CancellationReason = z.infer<typeof CancellationReasonSchema>;

export interface TierLimits {
  byokProviderSlots: number | null;
  dailyCostCapUsd: number | null;
  maxConcurrentSandboxes: number;
  maxProjects: number | null;
  maxSeats: number;
  quotaComposioCalls: number | null;
  quotaDeployments: number | null;
  quotaSandboxHours: number | null;
  researchFanoutSubagents: number | null;
}

export interface EntitlementValues {
  flagPrivateProjects: boolean;
  flagSso: boolean;
  maxConcurrentSandboxes: number;
  maxProjects: number;
  maxSeats: number;
  quotaComposioCalls: number;
  quotaDeployments: number;
  quotaSandboxHours: string;
  tier: BillingTier;
}

export const EntitlementCacheSchema = z
  .object({
    currentPeriodEnd: z.string().datetime().nullable(),
    currentPeriodStart: z.string().datetime().nullable(),
    flagPrivateProjects: z.boolean(),
    flagSso: z.boolean(),
    maxConcurrentSandboxes: z.number().int().positive(),
    maxProjects: z.number().int().positive(),
    maxSeats: z.number().int().positive(),
    quotaComposioCalls: z.number().int().nonnegative(),
    quotaDeployments: z.number().int().nonnegative(),
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
  flagPrivateProjects?: boolean;
  flagSso?: boolean;
  maxConcurrentSandboxes?: number;
  maxProjects?: number;
  maxSeats?: number;
  quotaComposioCalls?: number;
  quotaDeployments?: number;
  quotaSandboxHours?: number | string;
  subscriptionStatus?: string;
  tier?: string;
  updatedAt?: Date | null;
}

export const TIER_LIMITS = {
  free: {
    byokProviderSlots: 3,
    dailyCostCapUsd: 10,
    maxConcurrentSandboxes: 1,
    maxProjects: 3,
    maxSeats: 1,
    quotaComposioCalls: 1_000,
    quotaDeployments: 5,
    quotaSandboxHours: 5,
    researchFanoutSubagents: 3,
  },
  pro: {
    byokProviderSlots: 10,
    dailyCostCapUsd: 50,
    maxConcurrentSandboxes: 3,
    maxProjects: 25,
    maxSeats: 1,
    quotaComposioCalls: 20_000,
    quotaDeployments: 100,
    quotaSandboxHours: 50,
    researchFanoutSubagents: 10,
  },
  team: {
    byokProviderSlots: null,
    dailyCostCapUsd: 200,
    maxConcurrentSandboxes: 10,
    maxProjects: null,
    maxSeats: 50,
    quotaComposioCalls: 100_000,
    quotaDeployments: null,
    quotaSandboxHours: 200,
    researchFanoutSubagents: 25,
  },
  enterprise: {
    byokProviderSlots: null,
    dailyCostCapUsd: null,
    maxConcurrentSandboxes: 50,
    maxProjects: null,
    maxSeats: 500,
    quotaComposioCalls: null,
    quotaDeployments: null,
    quotaSandboxHours: null,
    researchFanoutSubagents: null,
  },
} as const satisfies Record<BillingTier, TierLimits>;

const CheckoutResponseSchema = z
  .object({
    url: z.string().url(),
  })
  .passthrough();

const CustomerSessionResponseSchema = z
  .object({
    customerPortalUrl: z.string().url().optional(),
    url: z.string().url().optional(),
  })
  .passthrough();

const SubscriptionActionResponseSchema = z
  .object({
    cancelAtPeriodEnd: z.boolean(),
    currentPeriodEnd: z.date().nullable(),
    currentPeriodStart: z.date().nullable(),
    id: z.string().min(1),
    status: z.string().min(1),
  })
  .passthrough();

export interface CreateCheckoutUrlInput {
  accessToken: string;
  customerEmail?: string;
  productId: string;
  returnUrl?: string;
  successUrl?: string;
  userId: string;
}

export interface CreateCustomerPortalUrlInput {
  accessToken: string;
  customerId?: string;
  externalCustomerId: string;
  returnUrl?: string;
}

export interface CancelSubscriptionAtPeriodEndInput {
  accessToken: string;
  comment?: string;
  reason?: CancellationReason;
  subscriptionId: string;
}

export interface ReactivateSubscriptionInput {
  accessToken: string;
  subscriptionId: string;
}

export interface UpdateCustomerProfileInput {
  accessToken: string;
  customerId: string;
  email: string;
  name?: string | null;
}

export interface SubscriptionActionResult {
  cancelAtPeriodEnd: boolean;
  currentPeriodEnd: string | null;
  currentPeriodStart: string | null;
  id: string;
  status: string;
}

export async function createCheckoutUrl(input: CreateCheckoutUrlInput): Promise<string> {
  const response = await polarClient(input.accessToken).checkouts.create({
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
  const response = await polarClient(input.accessToken).customerSessions.create(sessionInput);
  return parseCustomerPortalUrl(response);
}

export async function cancelSubscriptionAtPeriodEnd(
  input: CancelSubscriptionAtPeriodEndInput,
): Promise<SubscriptionActionResult> {
  const subscriptionUpdate = {
    cancelAtPeriodEnd: true,
    ...(input.reason ? { customerCancellationReason: input.reason } : {}),
    ...(input.comment ? { customerCancellationComment: input.comment } : {}),
  };
  const response = await polarClient(input.accessToken).subscriptions.update({
    id: input.subscriptionId,
    subscriptionUpdate,
  });
  return parseSubscriptionAction(response);
}

export async function reactivateSubscription(
  input: ReactivateSubscriptionInput,
): Promise<SubscriptionActionResult> {
  const response = await polarClient(input.accessToken).subscriptions.update({
    id: input.subscriptionId,
    subscriptionUpdate: { cancelAtPeriodEnd: false },
  });
  return parseSubscriptionAction(response);
}

export async function updateCustomerProfile(input: UpdateCustomerProfileInput): Promise<void> {
  await polarClient(input.accessToken).customers.update({
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
    flagPrivateProjects: tier !== "free",
    flagSso: tier === "team" || tier === "enterprise",
    maxConcurrentSandboxes: limits.maxConcurrentSandboxes,
    maxProjects: integerLimit(limits.maxProjects),
    maxSeats: limits.maxSeats,
    quotaComposioCalls: integerLimit(limits.quotaComposioCalls),
    quotaDeployments: integerLimit(limits.quotaDeployments),
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
    flagPrivateProjects: input.flagPrivateProjects ?? defaults.flagPrivateProjects,
    flagSso: input.flagSso ?? defaults.flagSso,
    maxConcurrentSandboxes: input.maxConcurrentSandboxes ?? defaults.maxConcurrentSandboxes,
    maxProjects: input.maxProjects ?? defaults.maxProjects,
    maxSeats: input.maxSeats ?? defaults.maxSeats,
    quotaComposioCalls: input.quotaComposioCalls ?? defaults.quotaComposioCalls,
    quotaDeployments: input.quotaDeployments ?? defaults.quotaDeployments,
    quotaSandboxHours: numericQuota(input.quotaSandboxHours ?? defaults.quotaSandboxHours),
    subscriptionStatus: input.subscriptionStatus ?? "none",
    tier,
    updatedAt: isoDateOrNow(input.updatedAt),
  });
}

export function inferTierFromPolarProduct(input: {
  allowNameFallback?: boolean;
  metadata?: Record<string, unknown>;
  productId?: string | null;
  productName?: string | null;
}): BillingTier {
  const metadataTier = input.metadata?.["tier"];
  const parsedMetadataTier = BillingTierSchema.safeParse(metadataTier);
  if (parsedMetadataTier.success) {
    return parsedMetadataTier.data;
  }

  if (!input.allowNameFallback) {
    throw new APIError(400, "invalid_request_body", "Polar product metadata tier is required", {
      details: {
        ...(input.productId ? { productId: input.productId } : {}),
        ...(input.productName ? { productName: input.productName } : {}),
      },
      hint: "Set product metadata tier=pro|team|enterprise on every paid Polar product.",
      retriable: false,
    });
  }

  const searchable = `${input.productName ?? ""} ${input.productId ?? ""}`.toLowerCase();
  if (searchable.includes("enterprise")) {
    return "enterprise";
  }
  if (searchable.includes("team")) {
    return "team";
  }
  if (searchable.includes("pro")) {
    return "pro";
  }
  return "pro";
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

function polarClient(accessToken: string): Polar {
  if (accessToken.trim().length === 0) {
    throw new APIError(503, "unavailable_maintenance", "Polar access token is not configured", {
      hint: "Set POLAR_ACCESS_TOKEN in the gateway Worker environment.",
      retriable: false,
    });
  }
  return new Polar({ accessToken });
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
