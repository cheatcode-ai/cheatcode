import { createInternalMaintenanceHeaders } from "@cheatcode/auth";
import { ComposioClient, isComposioNotFoundError } from "@cheatcode/composio";
import type { UserDeletionContext } from "@cheatcode/db";
import { resolveWorkerSecret, type WorkerSecret } from "@cheatcode/env";
import {
  APIError,
  readBoundedResponseJson,
  withBoundedResponseBody,
} from "@cheatcode/observability";
import {
  type InternalAgentStateDeleteBody,
  InternalAgentStateDeleteBodySchema,
  InternalGatewayStateDeleteBodySchema,
  InternalStateDeleteResponseSchema,
  internalUserStateDeletePath,
  type UserId,
} from "@cheatcode/types";
import { HTTPClient, Polar } from "@polar-sh/sdk";

export interface LifecycleEnv {
  AGENT: Fetcher;
  COMPOSIO_API_KEY?: WorkerSecret;
  GATEWAY: Fetcher;
  INTERNAL_MAINTENANCE_SECRET?: WorkerSecret;
  POLAR_ACCESS_TOKEN?: WorkerSecret;
  POLAR_SERVER?: "production" | "sandbox";
  R2_OUTPUTS: R2Bucket;
  R2_UPLOADS: R2Bucket;
}

const INTERNAL_AGENT_RESPONSE_MAX_BYTES = 64 * 1024;
const POLAR_ORDER_MAX_PAGES = 100;
const POLAR_REQUEST_TIMEOUT_MS = 30_000;
const POLAR_RESPONSE_MAX_BYTES = 1024 * 1024;
const COMPOSIO_REQUEST_TIMEOUT_MS = 30_000;

interface PolarDeletionResult {
  customerDeleted: boolean;
  refundCreated: boolean;
  subscriptionRevoked: boolean;
}

export async function deleteUserGatewayDurableState(
  env: LifecycleEnv,
  userId: UserId,
): Promise<void> {
  const body = JSON.stringify(InternalGatewayStateDeleteBodySchema.parse({}));
  const pathname = internalUserStateDeletePath(userId);
  const headers = await internalMaintenanceHeaders(env, pathname, body);
  const response = await env.GATEWAY.fetch(`https://gateway.internal${pathname}`, {
    body,
    headers,
    method: "POST",
  });
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    throw new APIError(503, "unavailable_maintenance", "Gateway durable state deletion failed", {
      details: { status: response.status },
      retriable: true,
    });
  }
  InternalStateDeleteResponseSchema.parse(
    await readBoundedResponseJson(response, INTERNAL_AGENT_RESPONSE_MAX_BYTES, "Gateway Worker"),
  );
}

export async function deleteUserAgentAccountState(
  env: LifecycleEnv,
  userId: UserId,
): Promise<void> {
  return deleteAgentState(env, userId, { scope: "account" });
}

export async function deleteUserAgentRunStatePage(
  env: LifecycleEnv,
  userId: UserId,
  runIds: string[],
): Promise<void> {
  return deleteAgentState(env, userId, { runIds, scope: "runs" });
}

async function deleteAgentState(
  env: LifecycleEnv,
  userId: UserId,
  payload: InternalAgentStateDeleteBody,
): Promise<void> {
  const body = JSON.stringify(InternalAgentStateDeleteBodySchema.parse(payload));
  const pathname = internalUserStateDeletePath(userId);
  const headers = await internalMaintenanceHeaders(env, pathname, body);
  const response = await env.AGENT.fetch(`https://agent.internal${pathname}`, {
    body,
    headers,
    method: "POST",
  });
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    throw new APIError(503, "unavailable_maintenance", "Agent durable state deletion failed", {
      details: { status: response.status },
      retriable: true,
    });
  }
  InternalStateDeleteResponseSchema.parse(
    await readBoundedResponseJson(response, INTERNAL_AGENT_RESPONSE_MAX_BYTES, "Agent Worker"),
  );
}

export async function deleteUserPolarBilling(
  env: LifecycleEnv,
  manifest: UserDeletionContext,
): Promise<PolarDeletionResult> {
  if (!manifest.polarCustomerId && !manifest.polarSubscriptionId) {
    return { customerDeleted: false, refundCreated: false, subscriptionRevoked: false };
  }
  const token = await optionalSecret(env.POLAR_ACCESS_TOKEN, "POLAR_ACCESS_TOKEN");
  if (!token) {
    throw new APIError(503, "unavailable_maintenance", "Polar deletion credentials are missing", {
      hint: "Set POLAR_ACCESS_TOKEN before retrying the user deletion Workflow.",
      retriable: false,
    });
  }
  const polar = createPolarClient(token, env.POLAR_SERVER ?? "production");
  const subscriptionRevoked = await revokePolarSubscription(polar, manifest);
  const refundCreated = await refundLatestPolarSubscriptionOrder(polar, manifest);
  const customerDeleted = await deletePolarCustomer(polar, manifest.userId);
  return { customerDeleted, refundCreated, subscriptionRevoked };
}

function createPolarClient(accessToken: string, server: "production" | "sandbox"): Polar {
  const httpClient = new HTTPClient({
    fetcher: async (input, init) => {
      const response = await fetch(input, init);
      return withBoundedResponseBody(response, POLAR_RESPONSE_MAX_BYTES, "Polar");
    },
  });
  return new Polar({ accessToken, httpClient, server, timeoutMs: POLAR_REQUEST_TIMEOUT_MS });
}

async function revokePolarSubscription(
  polar: Polar,
  manifest: UserDeletionContext,
): Promise<boolean> {
  if (!manifest.polarSubscriptionId) {
    return false;
  }
  try {
    await polar.subscriptions.revoke({ id: manifest.polarSubscriptionId });
    return true;
  } catch (error) {
    if (isNotFoundError(error)) {
      return false;
    }
    throw upstreamLifecycleError("Polar subscription revoke failed", error);
  }
}

async function refundLatestPolarSubscriptionOrder(
  polar: Polar,
  manifest: UserDeletionContext,
): Promise<boolean> {
  if (!manifest.polarSubscriptionId) {
    return false;
  }
  const order = await latestRefundableSubscriptionOrder(polar, manifest);
  const amount = order ? proratedRefundAmount(order.refundableAmount, manifest) : 0;
  if (!order || amount < 1) {
    return false;
  }
  try {
    await polar.refunds.create({
      amount,
      comment: "GDPR deletion requested by customer.",
      orderId: order.id,
      reason: "customer_request",
    });
    return true;
  } catch (error) {
    if (isAlreadyRefundedError(error) || isNotFoundError(error)) {
      return false;
    }
    throw upstreamLifecycleError("Polar prorated refund failed", error);
  }
}

async function latestRefundableSubscriptionOrder(
  polar: Polar,
  manifest: UserDeletionContext,
): Promise<{ id: string; refundableAmount: number } | null> {
  const pages = await polar.orders.list({
    externalCustomerId: manifest.userId,
    limit: 100,
    productBillingType: "recurring",
    sorting: ["-created_at"],
  });
  let pagesRead = 0;
  for await (const page of pages) {
    pagesRead += 1;
    if (pagesRead > POLAR_ORDER_MAX_PAGES) {
      throw new APIError(
        503,
        "upstream_provider_outage",
        "Polar order listing exceeded the safe pagination limit",
        { retriable: true },
      );
    }
    const order = page.result.items.find(
      (candidate) =>
        candidate.paid &&
        candidate.subscriptionId === manifest.polarSubscriptionId &&
        candidate.totalAmount > candidate.refundedAmount,
    );
    if (order) {
      return { id: order.id, refundableAmount: order.totalAmount - order.refundedAmount };
    }
  }
  return null;
}

function proratedRefundAmount(refundableAmount: number, manifest: UserDeletionContext): number {
  const periodStart = manifest.polarCurrentPeriodStartMs;
  const periodEnd = manifest.polarCurrentPeriodEndMs;
  if (!periodStart || !periodEnd || periodEnd <= periodStart) {
    return 0;
  }
  const now = Date.now();
  const remainingRatio = Math.max(0, Math.min(1, (periodEnd - now) / (periodEnd - periodStart)));
  return Math.floor(refundableAmount * remainingRatio);
}

async function deletePolarCustomer(polar: Polar, userId: UserId): Promise<boolean> {
  try {
    await polar.customers.deleteExternal({
      anonymize: true,
      externalId: userId,
    });
    return true;
  } catch (error) {
    if (isNotFoundError(error)) {
      return false;
    }
    throw upstreamLifecycleError("Polar customer deletion failed", error);
  }
}

export async function revokeUserComposioConnectionPage(
  env: LifecycleEnv,
  connectionIds: string[],
): Promise<number> {
  if (connectionIds.length === 0) {
    return 0;
  }
  const apiKey = await optionalSecret(env.COMPOSIO_API_KEY, "COMPOSIO_API_KEY");
  if (!apiKey) {
    throw new APIError(
      503,
      "unavailable_maintenance",
      "Composio deletion credentials are missing",
      {
        hint: "Set COMPOSIO_API_KEY before retrying the user deletion Workflow.",
        retriable: false,
      },
    );
  }
  const composio = new ComposioClient(apiKey);
  let revoked = 0;
  for (const connectionId of connectionIds) {
    try {
      await composio.deleteConnectedAccount(connectionId, COMPOSIO_REQUEST_TIMEOUT_MS);
      revoked += 1;
    } catch (error) {
      if (isComposioNotFoundError(error)) {
        revoked += 1;
      } else {
        throw upstreamLifecycleError("Composio connection revoke failed", error);
      }
    }
  }
  return revoked;
}

export async function deleteUserR2ObjectBatch(
  bucket: R2Bucket,
  userId: UserId,
): Promise<{ deleted: number; hasMore: boolean }> {
  const listed = await bucket.list({ limit: 1_000, prefix: `${userId}/` });
  const keys = listed.objects.map((object) => object.key);
  if (keys.length > 0) {
    await bucket.delete(keys);
  }
  return { deleted: keys.length, hasMore: listed.truncated };
}

async function requiredSecret(
  secret: WorkerSecret | string | undefined,
  name: string,
): Promise<string> {
  const value = await optionalSecret(secret, name);
  if (!value) {
    throw new APIError(503, "unavailable_maintenance", `${name} is not configured`, {
      hint: `Set ${name} on the webhooks Worker before running lifecycle maintenance.`,
      retriable: false,
    });
  }
  return value;
}

async function internalMaintenanceHeaders(
  env: LifecycleEnv,
  pathname: string,
  rawBody: string,
): Promise<Headers> {
  const secret = await requiredSecret(
    env.INTERNAL_MAINTENANCE_SECRET,
    "INTERNAL_MAINTENANCE_SECRET",
  );
  const headers = await createInternalMaintenanceHeaders({
    method: "POST",
    pathname,
    rawBody,
    secret,
  });
  headers.set("content-type", "application/json");
  return headers;
}

async function optionalSecret(
  secret: WorkerSecret | string | undefined,
  name: string,
): Promise<string | null> {
  if (!secret) {
    return null;
  }
  if (typeof secret === "string") {
    return secret.trim() ? secret : null;
  }
  try {
    const value = await resolveWorkerSecret(secret);
    return value?.trim() ? value : null;
  } catch {
    throw new APIError(503, "unavailable_maintenance", `${name} is unavailable`, {
      hint: `Verify the ${name} Cloudflare secret binding.`,
      retriable: false,
    });
  }
}

function upstreamLifecycleError(message: string, error: unknown): APIError {
  return new APIError(503, "upstream_provider_outage", message, {
    cause: error,
    retriable: true,
  });
}

function isNotFoundError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  const normalized = `${error.name} ${error.message}`.toLowerCase();
  return normalized.includes("notfound") || normalized.includes("not found");
}

function isAlreadyRefundedError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  const normalized = `${error.name} ${error.message}`.toLowerCase();
  return normalized.includes("refundedalready") || normalized.includes("already refunded");
}
