import { createInternalMaintenanceHeaders } from "@cheatcode/auth";
import { ComposioClient, isComposioNotFoundError } from "@cheatcode/composio";
import { resolveWorkerSecret, type WorkerSecret } from "@cheatcode/env";
import { APIError, readBoundedResponseJson } from "@cheatcode/observability";
import {
  canonicalWorkspaceDigest,
  type InternalAgentStateDeleteBody,
  InternalAgentStateDeleteBodySchema,
  InternalStateDeleteResponseSchema,
  type InternalWorkspaceReconciliationBody,
  InternalWorkspaceReconciliationBodySchema,
  type InternalWorkspaceReconciliationResponse,
  InternalWorkspaceReconciliationResponseSchema,
  internalUserStateDeletePath,
  internalUserWorkspaceReconciliationPath,
  type UserId,
} from "@cheatcode/types";
import {
  requireAgentLifecycleSecret,
  type WebhooksMaintenanceSecretBindings,
} from "./internal-maintenance";

export interface AgentStateDeletionEnv extends WebhooksMaintenanceSecretBindings {
  AGENT: Fetcher;
}

export interface LifecycleEnv extends AgentStateDeletionEnv {
  COMPOSIO_API_KEY?: WorkerSecret;
  POLAR_ACCESS_TOKEN?: WorkerSecret;
  POLAR_SERVER?: "production" | "sandbox";
  QUOTA_TRACKER: DurableObjectNamespace;
  R2_OUTPUTS: R2Bucket;
}

const INTERNAL_AGENT_RESPONSE_MAX_BYTES = 64 * 1024;
const COMPOSIO_DELETE_CONCURRENCY = 5;
const COMPOSIO_REQUEST_TIMEOUT_MS = 30_000;

export async function deleteUserQuotaDurableState(
  env: LifecycleEnv,
  userId: UserId,
): Promise<void> {
  await deleteQuotaNamespaceState(env.QUOTA_TRACKER, userId);
}

async function deleteQuotaNamespaceState(
  namespace: DurableObjectNamespace,
  userId: UserId,
): Promise<void> {
  const quota = namespace.get(namespace.idFromName(`quota:${userId}`));
  const response = await quota.fetch("https://quota.internal/delete-all", {
    method: "POST",
  });
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    throw new APIError(503, "unavailable_maintenance", "Quota durable state deletion failed", {
      details: { status: response.status },
      retriable: true,
    });
  }
  await response.body?.cancel().catch(() => undefined);
}

export async function deleteUserAgentAccountState(
  env: AgentStateDeletionEnv,
  userId: UserId,
  deletionFence: string,
): Promise<void> {
  return deleteAgentState(env, userId, { deletionFence, scope: "account" });
}

type AgentRunDeletionAuthority = Extract<
  InternalAgentStateDeleteBody,
  { scope: "runs" }
>["authority"];

export async function deleteUserAgentRunStatePage(
  env: AgentStateDeletionEnv,
  userId: UserId,
  runIds: string[],
  authority: AgentRunDeletionAuthority,
): Promise<void> {
  return deleteAgentState(env, userId, { authority, runIds, scope: "runs" });
}

export async function deleteProjectAgentWorkspace(
  env: AgentStateDeletionEnv,
  input: { deletedAt: Date; projectId: string; userId: UserId; workspaceSlug: string },
): Promise<void> {
  return deleteAgentState(env, input.userId, {
    deletedAt: input.deletedAt.toISOString(),
    projectId: input.projectId,
    scope: "project",
    workspaceSlug: input.workspaceSlug,
  });
}

export async function reconcileUserAgentWorkspaces(
  env: AgentStateDeletionEnv,
  userId: UserId,
  payload: InternalWorkspaceReconciliationBody,
): Promise<InternalWorkspaceReconciliationResponse> {
  const parsed = InternalWorkspaceReconciliationBodySchema.parse(payload);
  const body = JSON.stringify(parsed);
  const pathname = internalUserWorkspaceReconciliationPath(userId);
  const headers = await internalMaintenanceHeaders(env, pathname, body);
  const response = await env.AGENT.fetch(`https://agent.internal${pathname}`, {
    body,
    headers,
    method: "POST",
  });
  if (!response.ok) {
    const status = response.status;
    await response.body?.cancel().catch(() => undefined);
    throw new APIError(503, "unavailable_maintenance", "Workspace reconciliation failed", {
      details: { status },
      retriable: isRetriableUpstreamStatus(status),
    });
  }
  const result = InternalWorkspaceReconciliationResponseSchema.parse(
    await readBoundedResponseJson(response, INTERNAL_AGENT_RESPONSE_MAX_BYTES, "Agent Worker"),
  );
  const expectedDigest = await canonicalWorkspaceDigest(
    parsed.projects.map((project) => project.canonicalWorkspaceSlug),
  );
  const isExpectedPhase =
    result.transitionPhase === "completed" ||
    (parsed.phase === "prepare" && result.transitionPhase === "prepared");
  if (
    result.canonicalDigest !== expectedDigest ||
    result.canonicalWorkspaceCount !== parsed.projects.length ||
    result.releaseSha !== parsed.releaseSha ||
    !isExpectedPhase
  ) {
    throw new APIError(409, "conflict_state_invalid", "Workspace evidence does not match request", {
      retriable: false,
    });
  }
  return result;
}

async function deleteAgentState(
  env: AgentStateDeletionEnv,
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
    const status = response.status;
    await response.body?.cancel().catch(() => undefined);
    throw new APIError(503, "unavailable_maintenance", "Agent durable state deletion failed", {
      details: { status },
      retriable: isRetriableUpstreamStatus(status),
    });
  }
  InternalStateDeleteResponseSchema.parse(
    await readBoundedResponseJson(response, INTERNAL_AGENT_RESPONSE_MAX_BYTES, "Agent Worker"),
  );
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
  for (let offset = 0; offset < connectionIds.length; offset += COMPOSIO_DELETE_CONCURRENCY) {
    const batch = connectionIds.slice(offset, offset + COMPOSIO_DELETE_CONCURRENCY);
    revoked += await revokeComposioBatch(composio, batch);
  }
  return revoked;
}

async function revokeComposioBatch(
  composio: ComposioClient,
  connectionIds: string[],
): Promise<number> {
  const results = await Promise.allSettled(
    connectionIds.map((connectionId) => revokeComposio(composio, connectionId)),
  );
  const failure = results.find((result) => result.status === "rejected");
  if (failure?.status === "rejected") {
    throw failure.reason;
  }
  return results.filter((result) => result.status === "fulfilled" && result.value).length;
}

async function revokeComposio(composio: ComposioClient, connectionId: string): Promise<boolean> {
  try {
    await composio.deleteConnectedAccount(connectionId, COMPOSIO_REQUEST_TIMEOUT_MS);
    return true;
  } catch (error) {
    if (isComposioNotFoundError(error)) {
      return true;
    }
    throw upstreamLifecycleError("Composio connection revoke failed", error);
  }
}

export async function deleteUserR2ObjectBatch(
  bucket: R2Bucket,
  userId: UserId,
): Promise<{ deleted: number; hasMore: boolean }> {
  return deleteR2ObjectPrefixBatch(bucket, `${userId}/`);
}

export async function deleteR2ObjectPrefixBatch(
  bucket: R2Bucket,
  prefix: string,
): Promise<{ deleted: number; hasMore: boolean }> {
  const listed = await bucket.list({ limit: 1_000, prefix });
  const keys = listed.objects.map((object) => object.key);
  if (keys.length > 0) {
    await bucket.delete(keys);
  }
  return { deleted: keys.length, hasMore: listed.truncated };
}

async function internalMaintenanceHeaders(
  env: AgentStateDeletionEnv,
  pathname: string,
  rawBody: string,
): Promise<Headers> {
  const secret = await requireAgentLifecycleSecret(env);
  const headers = await createInternalMaintenanceHeaders({
    audience: "agent",
    capability: "agent-lifecycle",
    issuer: "webhooks",
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

function isRetriableUpstreamStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}
