import {
  entitlementValuesForTier,
  getPolarCustomerState,
  type PolarCustomerStateSubscription,
  type PolarServer,
} from "@cheatcode/billing";
import {
  applyEntitlementResourceLimits,
  type BillingUserRecord,
  type Database,
  findBillingUserById,
  findBillingUserByPolarCustomerId,
  findEntitlementByUserId,
  updateUserPolarCustomerId,
  upsertEntitlement,
  withUserContext,
} from "@cheatcode/db";
import { APIError } from "@cheatcode/observability";
import { type BillingTier, BillingTierSchema, billingTierRank, UserId } from "@cheatcode/types";
import { z } from "zod";

type PolarProductTierMap = Readonly<Record<string, BillingTier>>;

const PolarEventSchema = z
  .object({
    data: z.record(z.string(), z.unknown()),
    type: z.string().min(1),
  })
  .passthrough();

const InternalUserIdSchema = z
  .string()
  .uuid()
  .transform((value) => UserId(value));

export interface PolarWebhookResult {
  action: string;
  eventType: string;
  previousTier?: BillingTier;
  tier?: BillingTier;
  userId?: UserId;
}

export async function handlePolarWebhookEvent(
  db: Database,
  input: {
    accessToken: string;
    event: unknown;
    productTierById: PolarProductTierMap;
    server?: PolarServer;
  },
): Promise<PolarWebhookResult> {
  const event = PolarEventSchema.parse(input.event);
  const user = await resolvePolarUser(db, event.data);

  if (shouldReconcileCustomer(event.type) && user) {
    const result = await reconcilePolarCustomer(db, {
      accessToken: input.accessToken,
      eventType: event.type,
      productTierById: input.productTierById,
      ...(input.server ? { server: input.server } : {}),
      user,
    });
    return result;
  }

  return {
    action: user ? "acknowledged" : "acknowledged_without_user",
    eventType: event.type,
    ...(user ? { userId: user.id } : {}),
  };
}

async function reconcilePolarCustomer(
  db: Database,
  input: {
    accessToken: string;
    eventType: string;
    productTierById: PolarProductTierMap;
    server?: PolarServer;
    user: BillingUserRecord;
  },
): Promise<PolarWebhookResult> {
  const state = await getPolarCustomerState({
    accessToken: input.accessToken,
    externalCustomerId: input.user.id,
    ...(input.server ? { server: input.server } : {}),
  });
  return withUserContext(db, input.user.id, async (tx) => {
    await updateUserPolarCustomerId(tx, {
      polarCustomerId: state.customerId,
      userId: input.user.id,
    });
    const selection = highestTierSubscription(state.activeSubscriptions, input.productTierById);
    const tier = selection?.tier ?? "free";
    const previousTier = await writeEntitlement(tx, {
      cancelAtPeriodEnd: selection?.subscription.cancelAtPeriodEnd ?? false,
      currentPeriodEnd: selection?.subscription.currentPeriodEnd ?? null,
      currentPeriodStart: selection?.subscription.currentPeriodStart ?? null,
      status: selection?.subscription.status ?? freeStatus(input.eventType),
      subscriptionId: selection?.subscription.id ?? null,
      tier,
      userId: input.user.id,
    });
    return {
      action: tier === "free" ? "entitlement_downgraded_to_free" : "entitlement_synced",
      eventType: input.eventType,
      previousTier,
      tier,
      userId: input.user.id,
    };
  });
}

function highestTierSubscription(
  subscriptions: PolarCustomerStateSubscription[],
  productTierById: PolarProductTierMap,
): { subscription: PolarCustomerStateSubscription; tier: BillingTier } | null {
  let selected: { subscription: PolarCustomerStateSubscription; tier: BillingTier } | null = null;
  for (const subscription of subscriptions) {
    const tier = productTierById[subscription.productId];
    if (!tier || tier === "free") {
      throw new APIError(
        503,
        "unavailable_maintenance",
        "Active Polar product is not mapped to a billing tier",
        {
          details: { productId: subscription.productId },
          hint: "Configure the same POLAR_PRODUCT_ID_* catalog on gateway and webhooks Workers.",
          retriable: false,
        },
      );
    }
    if (!selected || billingTierRank(tier) > billingTierRank(selected.tier)) {
      selected = { subscription, tier };
    }
  }
  return selected;
}

function shouldReconcileCustomer(eventType: string): boolean {
  return eventType === "customer.state_changed" || eventType.startsWith("subscription.");
}

function freeStatus(eventType: string): string {
  return eventType === "subscription.revoked" ? "revoked" : "none";
}

async function resolvePolarUser(
  db: Database,
  data: Record<string, unknown>,
): Promise<BillingUserRecord | null> {
  const externalUserId = internalUserIdFromData(data);
  if (externalUserId) {
    const user = await withUserContext(db, externalUserId, (tx) =>
      findBillingUserById(tx, externalUserId),
    );
    if (user) {
      return user;
    }
  }

  const customer = recordField(data, "customer");
  const polarCustomerId =
    stringField(data, "customerId") ?? stringField(customer, "id") ?? stringField(data, "id");
  return polarCustomerId ? findBillingUserByPolarCustomerId(db, polarCustomerId) : null;
}

function internalUserIdFromData(data: Record<string, unknown>): UserId | null {
  const customer = recordField(data, "customer");
  const metadata = recordField(data, "metadata");
  const candidate =
    stringField(data, "externalCustomerId") ??
    stringField(data, "externalId") ??
    stringField(customer, "externalCustomerId") ??
    stringField(customer, "externalId") ??
    stringField(metadata, "userId");
  const parsed = candidate ? InternalUserIdSchema.safeParse(candidate) : null;
  return parsed?.success ? parsed.data : null;
}

async function writeEntitlement(
  db: Database,
  input: {
    cancelAtPeriodEnd?: boolean;
    currentPeriodEnd?: Date | null;
    currentPeriodStart?: Date | null;
    status: string;
    subscriptionId?: string | null;
    tier: BillingTier;
    userId: UserId;
  },
): Promise<BillingTier> {
  const previous = await findEntitlementByUserId(db, input.userId);
  const previousTier = parseTier(previous?.tier);
  const values = entitlementValuesForTier(input.tier);
  await upsertEntitlement(db, {
    cancelAtPeriodEnd: input.cancelAtPeriodEnd ?? false,
    currentPeriodEnd: input.currentPeriodEnd ?? null,
    currentPeriodStart: input.currentPeriodStart ?? null,
    polarSubscriptionId: input.subscriptionId ?? null,
    subscriptionStatus: input.status,
    tier: input.tier,
    userId: input.userId,
  });
  await applyEntitlementResourceLimits(db, {
    maxProjects: values.maxProjects,
    userId: input.userId,
  });
  return previousTier;
}

function recordField(
  record: Record<string, unknown> | undefined,
  key: string,
): Record<string, unknown> | undefined {
  const value = record?.[key];
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function stringField(record: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = record?.[key];
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function parseTier(value: string | undefined): BillingTier {
  const parsed = BillingTierSchema.safeParse(value);
  return parsed.success ? parsed.data : "free";
}
