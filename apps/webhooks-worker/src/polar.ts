import {
  type BillingTier,
  BillingTierSchema,
  entitlementValuesForTier,
  inferTierFromPolarProduct,
  tierLimits,
} from "@cheatcode/billing";
import {
  applyEntitlementResourceLimits,
  type BillingUserRecord,
  type Database,
  findBillingUserById,
  findBillingUserByPolarCustomerId,
  findEntitlementByUserId,
  recordBillingEvent,
  updateUserPolarCustomerId,
  upsertEntitlement,
} from "@cheatcode/db";
import { UserId } from "@cheatcode/types";
import { z } from "zod";

const PolarEventSchema = z
  .object({
    data: z.record(z.string(), z.unknown()),
    type: z.string().min(1),
  })
  .passthrough();

const RawPayloadSchema = z.record(z.string(), z.unknown());
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
  input: { event: unknown; eventId: string | null; rawBody: string },
): Promise<PolarWebhookResult> {
  const event = PolarEventSchema.parse(input.event);
  const payload = parseRawPayload(input.rawBody);
  const user = await resolvePolarUser(db, event.data);

  if (event.type === "customer.state_changed" && user) {
    const result = await applyCustomerStateChanged(db, event.data, input.eventId, user);
    await recordPolarEvent(db, event.type, payload, input.eventId, result.userId ?? user.id);
    return result;
  }

  if (event.type.startsWith("subscription.") && user) {
    const result = await applySubscriptionEvent(db, event.type, event.data, input.eventId, user);
    await recordPolarEvent(db, event.type, payload, input.eventId, result.userId ?? user.id);
    return result;
  }

  await recordPolarEvent(db, event.type, payload, input.eventId, user?.id ?? null);
  return {
    action: user ? "recorded" : "recorded_without_user",
    eventType: event.type,
    ...(user ? { userId: user.id } : {}),
  };
}

async function applyCustomerStateChanged(
  db: Database,
  data: Record<string, unknown>,
  eventId: string | null,
  user: BillingUserRecord,
): Promise<PolarWebhookResult> {
  const customerId = stringField(data, "id");
  if (customerId) {
    await updateUserPolarCustomerId(db, { polarCustomerId: customerId, userId: user.id });
  }

  const activeSubscription = firstRecordArrayItem(data, "activeSubscriptions");
  if (!activeSubscription || dateField(data, "deletedAt")) {
    const previousTier = await writeEntitlement(db, {
      customerId: customerId ?? null,
      eventId,
      status: activeSubscription ? "deleted" : "none",
      tier: "free",
      userId: user.id,
    });
    return {
      action: "entitlement_downgraded_to_free",
      eventType: "customer.state_changed",
      previousTier,
      userId: user.id,
      tier: "free",
    };
  }

  const product = recordField(activeSubscription, "product");
  const tier = inferTierFromPolarFields({
    metadata:
      recordField(product, "metadata") ??
      recordField(activeSubscription, "metadata") ??
      recordField(data, "metadata"),
    productId: stringField(activeSubscription, "productId"),
    productName: stringField(product, "name"),
  });
  const previousTier = await writeEntitlement(db, {
    customerId: customerId ?? null,
    cancelAtPeriodEnd: booleanField(activeSubscription, "cancelAtPeriodEnd"),
    currentPeriodEnd: dateField(activeSubscription, "currentPeriodEnd"),
    currentPeriodStart: dateField(activeSubscription, "currentPeriodStart"),
    eventId,
    status: stringField(activeSubscription, "status") ?? "active",
    subscriptionId: stringField(activeSubscription, "id") ?? null,
    tier,
    userId: user.id,
  });
  return {
    action: "entitlement_synced",
    eventType: "customer.state_changed",
    previousTier,
    tier,
    userId: user.id,
  };
}

async function applySubscriptionEvent(
  db: Database,
  eventType: string,
  data: Record<string, unknown>,
  eventId: string | null,
  user: BillingUserRecord,
): Promise<PolarWebhookResult> {
  const customer = recordField(data, "customer");
  const customerId = stringField(data, "customerId") ?? stringField(customer, "id");
  if (customerId) {
    await updateUserPolarCustomerId(db, { polarCustomerId: customerId, userId: user.id });
  }

  const status = stringField(data, "status") ?? eventType.replace("subscription.", "");
  const product = recordField(data, "product");
  const tier = paidAccessStillApplies(eventType, data, status)
    ? inferTierFromPolarFields({
        metadata: recordField(product, "metadata"),
        productId: stringField(data, "productId"),
        productName: stringField(product, "name"),
      })
    : "free";

  const previousTier = await writeEntitlement(db, {
    customerId: customerId ?? null,
    cancelAtPeriodEnd: tier === "free" ? false : booleanField(data, "cancelAtPeriodEnd"),
    currentPeriodEnd: dateField(data, "currentPeriodEnd"),
    currentPeriodStart: dateField(data, "currentPeriodStart"),
    eventId,
    status,
    subscriptionId: tier === "free" ? null : (stringField(data, "id") ?? null),
    tier,
    userId: user.id,
  });

  return {
    action: tier === "free" ? "entitlement_downgraded_to_free" : "entitlement_synced",
    eventType,
    previousTier,
    tier,
    userId: user.id,
  };
}

async function resolvePolarUser(
  db: Database,
  data: Record<string, unknown>,
): Promise<BillingUserRecord | null> {
  const externalUserId = internalUserIdFromData(data);
  if (externalUserId) {
    const user = await findBillingUserById(db, externalUserId);
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
    customerId?: string | null;
    cancelAtPeriodEnd?: boolean;
    currentPeriodEnd?: Date | null;
    currentPeriodStart?: Date | null;
    eventId: string | null;
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
    ...values,
    cancelAtPeriodEnd: input.cancelAtPeriodEnd ?? false,
    currentPeriodEnd: input.currentPeriodEnd ?? null,
    currentPeriodStart: input.currentPeriodStart ?? null,
    polarCustomerId: input.customerId ?? null,
    polarSubscriptionId: input.subscriptionId ?? null,
    source: "polar",
    subscriptionStatus: input.status,
    userId: input.userId,
    webhookEventId: input.eventId,
  });
  await applyEntitlementResourceLimits(db, {
    byokProviderSlots: tierLimits(input.tier).byokProviderSlots,
    maxProjects: values.maxProjects,
    userId: input.userId,
  });
  return previousTier;
}

async function recordPolarEvent(
  db: Database,
  eventType: string,
  payload: Record<string, unknown>,
  eventId: string | null,
  userId: UserId | null,
): Promise<void> {
  await recordBillingEvent(db, {
    eventType,
    payload,
    polarEventId: eventId,
    userId,
  });
}

function paidAccessStillApplies(
  eventType: string,
  data: Record<string, unknown>,
  status: string,
): boolean {
  if (eventType === "subscription.revoked") {
    return false;
  }
  if (eventType === "subscription.canceled" && booleanField(data, "cancelAtPeriodEnd")) {
    return true;
  }
  return status === "active" || status === "trialing" || status === "past_due";
}

function inferTierFromPolarFields(input: {
  metadata?: Record<string, unknown> | undefined;
  productId?: string | undefined;
  productName?: string | undefined;
}): BillingTier {
  return inferTierFromPolarProduct({
    ...(input.metadata === undefined ? {} : { metadata: input.metadata }),
    ...(input.productId === undefined ? {} : { productId: input.productId }),
    ...(input.productName === undefined ? {} : { productName: input.productName }),
  });
}

function parseRawPayload(rawBody: string): Record<string, unknown> {
  return RawPayloadSchema.parse(JSON.parse(rawBody) as unknown);
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

function firstRecordArrayItem(
  record: Record<string, unknown>,
  key: string,
): Record<string, unknown> | undefined {
  const value = record[key];
  if (!Array.isArray(value)) {
    return undefined;
  }
  const first = value[0] as unknown;
  return first && typeof first === "object" && !Array.isArray(first)
    ? (first as Record<string, unknown>)
    : undefined;
}

function stringField(record: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = record?.[key];
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function booleanField(record: Record<string, unknown>, key: string): boolean {
  return record[key] === true;
}

function dateField(record: Record<string, unknown>, key: string): Date | null {
  const value = record[key];
  if (value instanceof Date) {
    return value;
  }
  if (typeof value !== "string") {
    return null;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function parseTier(value: string | undefined): BillingTier {
  const parsed = BillingTierSchema.safeParse(value);
  return parsed.success ? parsed.data : "free";
}
