import { ComposioClient, isComposioNotFoundError } from "@cheatcode/composio";
import { resolveWorkerSecret, type WorkerSecret } from "@cheatcode/env";
import { APIError } from "@cheatcode/observability";
import {
  type AgentLifecycleServiceBinding,
  AgentLifecycleServiceResultSchema,
  type InternalAgentStateDeleteBody,
  InternalAgentStateDeleteBodySchema,
  type UserId,
} from "@cheatcode/types";
import type { QuotaTrackerNamespace } from "./quota-tracker-binding";

export interface AgentStateDeletionEnv {
  AGENT_LIFECYCLE: AgentLifecycleServiceBinding;
}

export interface LifecycleEnv extends AgentStateDeletionEnv {
  COMPOSIO_API_KEY?: WorkerSecret;
  POLAR_ACCESS_TOKEN?: WorkerSecret;
  POLAR_SERVER?: "production" | "sandbox";
  QUOTA_TRACKER: QuotaTrackerNamespace;
  R2_OUTPUTS: R2Bucket;
}

const COMPOSIO_DELETE_CONCURRENCY = 5;
const COMPOSIO_REQUEST_TIMEOUT_MS = 30_000;

export async function deleteUserQuotaDurableState(
  env: LifecycleEnv,
  userId: UserId,
): Promise<void> {
  await deleteQuotaNamespaceState(env.QUOTA_TRACKER, userId);
}

async function deleteQuotaNamespaceState(
  namespace: QuotaTrackerNamespace,
  userId: UserId,
): Promise<void> {
  const quota = namespace.get(namespace.idFromName(`quota:${userId}`));
  try {
    await quota.deleteAllState();
  } catch (error) {
    throw new APIError(503, "unavailable_maintenance", "Quota durable state deletion failed", {
      cause: error,
      retriable: true,
    });
  }
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

async function deleteAgentState(
  env: AgentStateDeletionEnv,
  userId: UserId,
  payload: InternalAgentStateDeleteBody,
): Promise<void> {
  const body = InternalAgentStateDeleteBodySchema.parse(payload);
  let result: Awaited<ReturnType<AgentLifecycleServiceBinding["deleteUserState"]>>;
  try {
    result = AgentLifecycleServiceResultSchema.parse(
      await env.AGENT_LIFECYCLE.deleteUserState({ body, userId }),
    );
  } catch (error) {
    throw new APIError(503, "unavailable_maintenance", "Agent durable state deletion failed", {
      cause: error,
      retriable: true,
    });
  }
  if (!result.ok) {
    throw new APIError(503, "unavailable_maintenance", "Agent durable state deletion failed", {
      details: { status: result.status },
      retriable: result.retriable,
    });
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
