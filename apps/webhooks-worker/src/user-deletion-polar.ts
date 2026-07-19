import type {
  UserDeletionContext,
  UserDeletionRefundCandidate,
  UserDeletionRefundEvidence,
  UserDeletionRefundIntentRecord,
} from "@cheatcode/db";
import { resolveWorkerSecret, type WorkerSecret } from "@cheatcode/env";
import { APIError, withBoundedResponseBody } from "@cheatcode/observability";
import type { UserId } from "@cheatcode/types";
import { HTTPClient, Polar } from "@polar-sh/sdk";
import type { Refund } from "@polar-sh/sdk/models/components/refund.js";
import { AlreadyCanceledSubscription } from "@polar-sh/sdk/models/errors/alreadycanceledsubscription.js";
import { PolarError } from "@polar-sh/sdk/models/errors/polarerror.js";
import { RefundedAlready } from "@polar-sh/sdk/models/errors/refundedalready.js";
import { ResourceNotFound } from "@polar-sh/sdk/models/errors/resourcenotfound.js";

const POLAR_REQUEST_TIMEOUT_MS = 30_000;
const POLAR_RESPONSE_MAX_BYTES = 1024 * 1024;
const REFUND_PAGE_SIZE = 100;
const REFUND_METADATA_IDENTITY = "cheatcode_intent";
const REFUND_METADATA_JOB = "cheatcode_deletion_job";
const REFUND_METADATA_GENERATION = "cheatcode_deletion_generation";
const NO_POLAR_RETRIES = { retries: { strategy: "none" } } as const;

export interface UserDeletionPolarEnv {
  POLAR_ACCESS_TOKEN?: WorkerSecret;
  POLAR_SERVER?: "production" | "sandbox";
}

export interface UserDeletionPolarPage {
  candidate: UserDeletionRefundCandidate | null;
  nextPage: number | null;
}

/** Read the candidate without mutation; after reservation retries use the durable intent. */
export async function inspectUserDeletionPolarPage(
  env: UserDeletionPolarEnv,
  context: UserDeletionContext,
  page: number,
): Promise<UserDeletionPolarPage> {
  if (!context.polarSubscriptionId) {
    return { candidate: null, nextPage: null };
  }
  const polar = await requirePolarClient(env);
  const subscriptionId = context.polarSubscriptionId;
  const orders = await listSubscriptionOrders(polar, context.userId, subscriptionId, page);
  const order = orders.result.items.find(isLatestPaidSubscriptionOrder(context));
  if (!order) {
    return {
      candidate: null,
      nextPage: page < orders.result.pagination.maxPage ? page + 1 : null,
    };
  }
  const amount = proratedRefundAmount(order.refundableAmount, context);
  return {
    candidate:
      amount > 0
        ? { amount, currency: normalizeCurrency(order.currency), orderId: order.id }
        : null,
    nextPage: null,
  };
}

/** Reconcile by immutable metadata before replaying the same idempotent create. */
export async function reconcileUserDeletionPolarRefund(
  env: UserDeletionPolarEnv,
  context: UserDeletionContext,
  intent: UserDeletionRefundIntentRecord,
): Promise<UserDeletionRefundEvidence> {
  const polar = await requirePolarClient(env);
  if (context.polarSubscriptionId) {
    await revokeSubscription(polar, context.polarSubscriptionId);
  }
  const reconciled = await findExactRefund(polar, intent);
  if (reconciled) {
    return refundEvidence(reconciled, intent);
  }
  return createExactRefund(polar, intent);
}

export async function completeUserDeletionPolarBilling(
  env: UserDeletionPolarEnv,
  context: UserDeletionContext,
): Promise<void> {
  if (!context.polarSubscriptionId && !context.polarCustomerId) {
    return;
  }
  const polar = await requirePolarClient(env);
  if (context.polarSubscriptionId) {
    await revokeSubscription(polar, context.polarSubscriptionId);
  }
  try {
    await polar.customers.deleteExternal(
      { anonymize: true, externalId: context.userId },
      NO_POLAR_RETRIES,
    );
  } catch (error) {
    if (isNotFoundError(error)) {
      return;
    }
    throw classifiedPolarError("Polar customer deletion failed", error);
  }
}

async function createExactRefund(
  polar: Polar,
  intent: UserDeletionRefundIntentRecord,
): Promise<UserDeletionRefundEvidence> {
  try {
    const created = await polar.refunds.create(
      {
        amount: intent.amount,
        comment: "GDPR account deletion requested by customer.",
        metadata: refundMetadata(intent),
        orderId: intent.orderId,
        reason: "customer_request",
      },
      {
        headers: { "Idempotency-Key": intent.idempotencyKey },
        ...NO_POLAR_RETRIES,
      },
    );
    return refundEvidence(created, intent);
  } catch (error) {
    if (error instanceof APIError) {
      throw error;
    }
    if (isAlreadyRefundedError(error)) {
      const reconciled = await findExactRefund(polar, intent);
      if (reconciled) {
        return refundEvidence(reconciled, intent);
      }
      throw retriablePolarError("Polar refund evidence is not yet visible", error);
    }
    if (isNotFoundError(error)) {
      throw permanentPolarError("Polar refund order disappeared", error);
    }
    throw classifiedPolarError("Polar prorated refund failed", error);
  }
}

async function findExactRefund(
  polar: Polar,
  intent: UserDeletionRefundIntentRecord,
): Promise<Refund | null> {
  let pages: Awaited<ReturnType<Polar["refunds"]["list"]>>;
  try {
    pages = await polar.refunds.list(
      {
        limit: REFUND_PAGE_SIZE,
        orderId: intent.orderId,
        sorting: ["created_at"],
      },
      NO_POLAR_RETRIES,
    );
  } catch (error) {
    throw classifiedPolarError("Polar refund reconciliation failed", error);
  }
  try {
    let match: Refund | null = null;
    for await (const page of pages) {
      for (const refund of page.result.items) {
        match = reconcileRefundMatch(match, refund, intent);
      }
    }
    return match;
  } catch (error) {
    if (error instanceof APIError) {
      throw error;
    }
    throw classifiedPolarError("Polar refund reconciliation failed", error);
  }
}

function reconcileRefundMatch(
  current: Refund | null,
  candidate: Refund,
  intent: UserDeletionRefundIntentRecord,
): Refund | null {
  if (!hasIntentIdentity(candidate, intent)) {
    if (hasPartialIntentIdentity(candidate, intent)) {
      throw permanentPolarError("Polar refund metadata identity is inconsistent");
    }
    return current;
  }
  if (current && current.id !== candidate.id) {
    throw permanentPolarError("Polar returned duplicate refund identities");
  }
  return candidate;
}

function refundEvidence(
  refund: Refund,
  intent: UserDeletionRefundIntentRecord,
): UserDeletionRefundEvidence {
  if (
    refund.orderId !== intent.orderId ||
    refund.amount !== intent.amount ||
    normalizeCurrency(refund.currency) !== intent.currency ||
    !hasIntentIdentity(refund, intent)
  ) {
    throw permanentPolarError("Polar refund evidence does not match its durable intent");
  }
  return {
    amount: refund.amount,
    currency: intent.currency,
    orderId: refund.orderId,
    providerRefundId: refund.id,
    providerStatus: refundProviderStatus(refund.status),
  };
}

function refundProviderStatus(
  status: Refund["status"],
): UserDeletionRefundEvidence["providerStatus"] {
  if (status === "pending") {
    return "pending";
  }
  if (status === "succeeded") {
    return "succeeded";
  }
  if (status === "failed") {
    return "failed";
  }
  if (status === "canceled") {
    return "canceled";
  }
  throw permanentPolarError("Polar returned an unrecognized refund status");
}

function refundMetadata(intent: UserDeletionRefundIntentRecord): Record<string, string> {
  return {
    [REFUND_METADATA_GENERATION]: String(intent.generation.getTime()),
    [REFUND_METADATA_IDENTITY]: intent.idempotencyKey,
    [REFUND_METADATA_JOB]: intent.jobId,
  };
}

function hasIntentIdentity(refund: Refund, intent: UserDeletionRefundIntentRecord): boolean {
  return (
    refund.metadata[REFUND_METADATA_IDENTITY] === intent.idempotencyKey &&
    refund.metadata[REFUND_METADATA_JOB] === intent.jobId &&
    refund.metadata[REFUND_METADATA_GENERATION] === String(intent.generation.getTime())
  );
}

function hasPartialIntentIdentity(refund: Refund, intent: UserDeletionRefundIntentRecord): boolean {
  const matches = [
    refund.metadata[REFUND_METADATA_IDENTITY] === intent.idempotencyKey,
    refund.metadata[REFUND_METADATA_JOB] === intent.jobId,
    refund.metadata[REFUND_METADATA_GENERATION] === String(intent.generation.getTime()),
  ].filter(Boolean).length;
  return matches > 0 && matches < 3;
}

function isLatestPaidSubscriptionOrder(context: UserDeletionContext) {
  return (order: { paid: boolean; subscriptionId: string | null }): boolean =>
    order.paid && order.subscriptionId === context.polarSubscriptionId;
}

function proratedRefundAmount(refundableAmount: number, context: UserDeletionContext): number {
  const periodStart = context.polarCurrentPeriodStartMs;
  const periodEnd = context.polarCurrentPeriodEndMs;
  if (
    periodStart === null ||
    periodEnd === null ||
    !Number.isSafeInteger(periodStart) ||
    !Number.isSafeInteger(periodEnd) ||
    periodEnd <= periodStart
  ) {
    throw permanentPolarError("Polar subscription period is invalid for refund calculation");
  }
  if (!Number.isSafeInteger(refundableAmount) || refundableAmount < 0) {
    throw permanentPolarError("Polar refundable amount is invalid");
  }
  const deletionRequestedAt = Number(context.deletionFence);
  if (!Number.isSafeInteger(deletionRequestedAt) || deletionRequestedAt < 0) {
    throw permanentPolarError("User deletion fence is not a valid refund timestamp");
  }
  const remainingRatio = Math.max(
    0,
    Math.min(1, (periodEnd - deletionRequestedAt) / (periodEnd - periodStart)),
  );
  return Math.floor(refundableAmount * remainingRatio);
}

async function revokeSubscription(polar: Polar, subscriptionId: string): Promise<void> {
  try {
    await polar.subscriptions.revoke({ id: subscriptionId }, NO_POLAR_RETRIES);
  } catch (error) {
    if (!isNotFoundError(error) && !(error instanceof AlreadyCanceledSubscription)) {
      throw classifiedPolarError("Polar subscription revoke failed", error);
    }
  }
}

async function listSubscriptionOrders(
  polar: Polar,
  userId: UserId,
  subscriptionId: string,
  page: number,
) {
  try {
    return await polar.orders.list(
      {
        externalCustomerId: userId,
        limit: REFUND_PAGE_SIZE,
        page,
        productBillingType: "recurring",
        sorting: ["-created_at"],
        subscriptionId,
      },
      NO_POLAR_RETRIES,
    );
  } catch (error) {
    throw classifiedPolarError("Polar refund order inspection failed", error);
  }
}

async function requirePolarClient(env: UserDeletionPolarEnv): Promise<Polar> {
  const token = await polarAccessToken(env.POLAR_ACCESS_TOKEN);
  if (!token) {
    throw new APIError(503, "unavailable_maintenance", "Polar deletion credentials are missing", {
      hint: "Set POLAR_ACCESS_TOKEN before retrying the user deletion Workflow.",
      retriable: false,
    });
  }
  const httpClient = new HTTPClient({
    fetcher: async (input, init) =>
      withBoundedResponseBody(await fetch(input, init), POLAR_RESPONSE_MAX_BYTES, "Polar"),
  });
  return new Polar({
    accessToken: token,
    httpClient,
    server: env.POLAR_SERVER ?? "production",
    timeoutMs: POLAR_REQUEST_TIMEOUT_MS,
  });
}

async function polarAccessToken(secret: WorkerSecret | undefined): Promise<string | null> {
  if (!secret) {
    return null;
  }
  try {
    const value = await resolveWorkerSecret(secret);
    return value?.trim() ? value : null;
  } catch (error) {
    throw new APIError(503, "unavailable_maintenance", "POLAR_ACCESS_TOKEN is unavailable", {
      cause: error,
      hint: "Verify the POLAR_ACCESS_TOKEN Cloudflare secret binding.",
      retriable: false,
    });
  }
}

function normalizeCurrency(currency: string): string {
  const normalized = currency.toLowerCase();
  if (!/^[a-z]{3}$/u.test(normalized)) {
    throw permanentPolarError("Polar refund currency is invalid");
  }
  return normalized;
}

function permanentPolarError(message: string, cause?: unknown): APIError {
  return new APIError(409, "conflict_state_invalid", message, { cause, retriable: false });
}

function retriablePolarError(message: string, cause?: unknown): APIError {
  return new APIError(503, "upstream_provider_outage", message, { cause, retriable: true });
}

function isNotFoundError(error: unknown): boolean {
  return error instanceof ResourceNotFound;
}

function isAlreadyRefundedError(error: unknown): boolean {
  return error instanceof RefundedAlready;
}

function classifiedPolarError(message: string, cause: unknown): APIError {
  if (cause instanceof PolarError && isPermanentProviderStatus(cause.statusCode)) {
    return permanentPolarError(message, cause);
  }
  return retriablePolarError(message, cause);
}

function isPermanentProviderStatus(status: number): boolean {
  return status >= 400 && status < 500 && ![408, 425, 429].includes(status);
}
