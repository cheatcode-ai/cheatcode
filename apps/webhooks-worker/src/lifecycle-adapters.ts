import { initialize, SandboxInstance, VolumeInstance } from "@blaxel/core";
import { hmacSha256Base64 } from "@cheatcode/auth";
import type { UserDeletionManifest } from "@cheatcode/db";
import { resolveWorkerSecret, type WorkerSecret } from "@cheatcode/env";
import { APIError, createLogger, normalizeUnknownError } from "@cheatcode/observability";
import type { UserId } from "@cheatcode/types";
import { Composio } from "@composio/core";
import { Polar } from "@polar-sh/sdk";
import { z } from "zod";

export interface LifecycleEnv {
  AGENT?: Fetcher;
  BL_API_KEY?: WorkerSecret | string;
  BL_REGION?: WorkerSecret | string;
  BL_WORKSPACE?: WorkerSecret | string;
  COMPOSIO_API_KEY?: WorkerSecret;
  GATEWAY?: Fetcher;
  INTERNAL_MAINTENANCE_SECRET?: WorkerSecret;
  POLAR_ACCESS_TOKEN?: WorkerSecret;
  R2_OUTPUTS: R2Bucket;
  R2_SNAPSHOTS: R2Bucket;
  R2_UPLOADS: R2Bucket;
}

export interface UserDeletionExternalResult {
  composioConnectionsRevoked: number;
  outputObjectsDeleted: number;
  polarCustomerDeleted: boolean;
  polarRefundCreated: boolean;
  polarSubscriptionRevoked: boolean;
  quotaStateDeleted: boolean;
  sandboxCount: number;
  sandboxVolumesDeleted: number;
  snapshotObjectsDeleted: number;
  uploadObjectsDeleted: number;
}

const AgentDeleteStateResponseSchema = z
  .object({
    ok: z.literal(true),
    projectStatesDeleted: z.number().int().nonnegative(),
    projectVolumesDeleted: z.number().int().nonnegative(),
    runStatesDeleted: z.number().int().nonnegative(),
  })
  .strict();

interface AgentDurableStateDeletionResult {
  projectStatesDeleted: number;
  projectVolumesDeleted: number;
  runStatesDeleted: number;
}

interface PolarDeletionResult {
  customerDeleted: boolean;
  refundCreated: boolean;
  subscriptionRevoked: boolean;
}

export async function deleteUserExternalResources(input: {
  env: LifecycleEnv;
  manifest: UserDeletionManifest;
}): Promise<UserDeletionExternalResult> {
  const [
    polarResult,
    composioConnectionsRevoked,
    agentStateDeleted,
    quotaStateDeleted,
    outputObjectsDeleted,
  ] = await Promise.all([
    deletePolarBilling(input.env, input.manifest),
    revokeComposioConnections(input.env, input.manifest.composioConnectionIds),
    deleteAgentDurableState(input.env, input.manifest),
    deleteGatewayDurableState(input.env, input.manifest.userId),
    deleteUserOutputObjects(input.env.R2_OUTPUTS, input.manifest.userId, input.manifest.outputKeys),
  ]);

  const [uploadObjectsDeleted, snapshotObjectsDeleted] = await Promise.all([
    deleteR2Prefix(input.env.R2_UPLOADS, `${input.manifest.userId}/`),
    deleteR2Prefixes(
      input.env.R2_SNAPSHOTS,
      input.manifest.projectIds.map((projectId) => `${input.manifest.userId}/${projectId}/`),
    ),
  ]);

  return {
    composioConnectionsRevoked,
    outputObjectsDeleted,
    polarCustomerDeleted: polarResult.customerDeleted,
    polarRefundCreated: polarResult.refundCreated,
    polarSubscriptionRevoked: polarResult.subscriptionRevoked,
    quotaStateDeleted,
    sandboxCount: agentStateDeleted.projectStatesDeleted,
    sandboxVolumesDeleted: agentStateDeleted.projectVolumesDeleted,
    snapshotObjectsDeleted,
    uploadObjectsDeleted,
  };
}

async function deleteGatewayDurableState(env: LifecycleEnv, userId: UserId): Promise<boolean> {
  if (!env.GATEWAY) {
    throw new APIError(
      503,
      "unavailable_maintenance",
      "Gateway service binding is not configured",
      {
        hint: "Bind GATEWAY on the webhooks Worker before running lifecycle maintenance.",
        retriable: false,
      },
    );
  }
  const body = "{}";
  const headers = await internalMaintenanceHeaders(env, body);
  const response = await env.GATEWAY.fetch(
    `https://gateway.internal/internal/users/${userId}/delete-state`,
    {
      body,
      headers,
      method: "POST",
    },
  );
  if (!response.ok) {
    throw new APIError(503, "unavailable_maintenance", "Gateway durable state deletion failed", {
      details: { status: response.status },
      retriable: true,
    });
  }
  return true;
}

async function deleteAgentDurableState(
  env: LifecycleEnv,
  manifest: UserDeletionManifest,
): Promise<AgentDurableStateDeletionResult> {
  if (!env.AGENT) {
    const [projectStatesDeleted, projectVolumesDeleted] = await deleteBlaxelSandboxesAndVolumes(
      env,
      manifest.sandboxIds,
    );
    return { projectStatesDeleted, projectVolumesDeleted, runStatesDeleted: 0 };
  }
  const body = JSON.stringify({
    projectIds: manifest.projectIds,
    runIds: manifest.runIds,
  });
  const headers = await internalMaintenanceHeaders(env, body);
  const response = await env.AGENT.fetch(
    `https://agent.internal/internal/users/${manifest.userId}/delete-state`,
    {
      body,
      headers,
      method: "POST",
    },
  );
  if (!response.ok) {
    throw new APIError(503, "unavailable_maintenance", "Agent durable state deletion failed", {
      details: { status: response.status },
      retriable: true,
    });
  }
  const parsed = AgentDeleteStateResponseSchema.parse(await response.json());
  return {
    projectStatesDeleted: parsed.projectStatesDeleted,
    projectVolumesDeleted: parsed.projectVolumesDeleted,
    runStatesDeleted: parsed.runStatesDeleted,
  };
}

async function deletePolarBilling(
  env: LifecycleEnv,
  manifest: UserDeletionManifest,
): Promise<PolarDeletionResult> {
  const token = await optionalSecret(env.POLAR_ACCESS_TOKEN, "POLAR_ACCESS_TOKEN");
  if (!token) {
    createLogger({ userId: manifest.userId }).warn("gdpr_polar_delete_skipped", {
      reason: "missing_token",
    });
    return { customerDeleted: false, refundCreated: false, subscriptionRevoked: false };
  }
  const polar = new Polar({ accessToken: token });
  const subscriptionRevoked = await revokePolarSubscription(polar, manifest);
  const refundCreated = await refundLatestPolarSubscriptionOrder(polar, manifest);
  const customerDeleted = await deletePolarCustomer(polar, manifest.userId);
  return { customerDeleted, refundCreated, subscriptionRevoked };
}

async function revokePolarSubscription(
  polar: Polar,
  manifest: UserDeletionManifest,
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
  manifest: UserDeletionManifest,
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
  manifest: UserDeletionManifest,
): Promise<{ id: string; refundableAmount: number } | null> {
  const pages = await polar.orders.list({
    externalCustomerId: manifest.userId,
    limit: 100,
    productBillingType: "recurring",
    sorting: ["-created_at"],
  });
  for await (const page of pages) {
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

function proratedRefundAmount(refundableAmount: number, manifest: UserDeletionManifest): number {
  const periodStart = manifest.polarCurrentPeriodStart?.getTime();
  const periodEnd = manifest.polarCurrentPeriodEnd?.getTime();
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

async function revokeComposioConnections(
  env: LifecycleEnv,
  connectionIds: string[],
): Promise<number> {
  if (connectionIds.length === 0) {
    return 0;
  }
  const apiKey = await optionalSecret(env.COMPOSIO_API_KEY, "COMPOSIO_API_KEY");
  if (!apiKey) {
    createLogger().warn("gdpr_composio_revoke_skipped", { reason: "missing_api_key" });
    return 0;
  }
  const composio = new Composio({ apiKey });
  let revoked = 0;
  for (const connectionId of connectionIds) {
    try {
      await composio.connectedAccounts.delete(connectionId);
      revoked += 1;
    } catch (error) {
      if (!isNotFoundError(error)) {
        throw upstreamLifecycleError("Composio connection revoke failed", error);
      }
    }
  }
  return revoked;
}

async function deleteBlaxelSandboxesAndVolumes(
  env: LifecycleEnv,
  sandboxIds: string[],
): Promise<[number, number]> {
  if (sandboxIds.length === 0) {
    return [0, 0];
  }
  const apiKey = await requiredSecret(env.BL_API_KEY, "BL_API_KEY");
  const workspace = await requiredSecret(env.BL_WORKSPACE, "BL_WORKSPACE");
  initialize({ apiKey, disableH2: true, workspace });
  let sandboxesDeleted = 0;
  for (const sandboxId of sandboxIds) {
    try {
      await SandboxInstance.delete(sandboxId);
      sandboxesDeleted += 1;
    } catch (error) {
      if (!isNotFoundError(error)) {
        throw upstreamLifecycleError("Blaxel sandbox deletion failed", error);
      }
    }
  }
  let volumesDeleted = 0;
  for (const sandboxId of sandboxIds) {
    try {
      await VolumeInstance.delete(projectVolumeName(sandboxId));
      volumesDeleted += 1;
    } catch (error) {
      if (!isNotFoundError(error)) {
        throw upstreamLifecycleError("Blaxel volume deletion failed", error);
      }
    }
  }
  return [sandboxesDeleted, volumesDeleted];
}

async function deleteR2Keys(bucket: R2Bucket, keys: string[]): Promise<number> {
  let deleted = 0;
  for (const key of uniqueStrings(keys)) {
    await bucket.delete(key);
    deleted += 1;
  }
  return deleted;
}

async function deleteUserOutputObjects(
  bucket: R2Bucket,
  userId: UserId,
  outputKeys: string[],
): Promise<number> {
  const userPrefix = `${userId}/`;
  const prefixDeleted = await deleteR2Prefix(bucket, userPrefix);
  const explicitKeysOutsidePrefix = outputKeys.filter((key) => !key.startsWith(userPrefix));
  return prefixDeleted + (await deleteR2Keys(bucket, explicitKeysOutsidePrefix));
}

async function deleteR2Prefixes(bucket: R2Bucket, prefixes: string[]): Promise<number> {
  let deleted = 0;
  for (const prefix of prefixes) {
    deleted += await deleteR2Prefix(bucket, prefix);
  }
  return deleted;
}

async function deleteR2Prefix(bucket: R2Bucket, prefix: string): Promise<number> {
  let cursor: string | undefined;
  let deleted = 0;
  do {
    const listed = await bucket.list({
      prefix,
      ...(cursor === undefined ? {} : { cursor }),
    });
    for (const object of listed.objects) {
      await bucket.delete(object.key);
      deleted += 1;
    }
    cursor = listed.truncated ? listed.cursor : undefined;
  } while (cursor);
  return deleted;
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

async function internalMaintenanceHeaders(env: LifecycleEnv, rawBody: string): Promise<Headers> {
  const secret = await requiredSecret(
    env.INTERNAL_MAINTENANCE_SECRET,
    "INTERNAL_MAINTENANCE_SECRET",
  );
  const timestamp = String(Date.now());
  const signature = await hmacSha256Base64(`${timestamp}.${rawBody}`, secret);
  return new Headers({
    "content-type": "application/json",
    "x-cheatcode-maintenance-signature": signature,
    "x-cheatcode-maintenance-timestamp": timestamp,
  });
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
  const normalized = normalizeUnknownError(error, message);
  return new APIError(503, "upstream_provider_outage", `${message}: ${normalized.message}`, {
    details: normalized.details,
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

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}

function projectVolumeName(sandboxId: string): string {
  return `ccv-${sandboxId}`;
}
