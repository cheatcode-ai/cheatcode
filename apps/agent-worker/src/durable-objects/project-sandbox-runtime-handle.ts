import { DaytonaClient, type DaytonaSandbox } from "@cheatcode/agent-core/tools/code";
import { previewHostnameForWorker, resolveWorkerSecret } from "@cheatcode/env";
import { APIError, createLogger } from "@cheatcode/observability";
import { performAccountDeletion } from "./project-sandbox-account-deletion";
import { type SandboxExecAuditEntry, writeExecAudit } from "./project-sandbox-audit";
import { ProjectSandboxIdentityState } from "./project-sandbox-identity-state";
import {
  withActiveOperation,
  withCleanupSignal,
  withOwnerRegistration,
  withProjectCleanup,
  withSharedWorkspaceMutation,
  withStreamingOperation,
  workspaceState,
} from "./project-sandbox-lease-runtime";
import {
  ACCOUNT_DELETION_TOMBSTONE_KEY,
  DAYTONA_ID_KEY,
  daytonaTarget,
  type ProjectSandboxEnv,
  RUN_LEASES_KEY,
  runLeases,
  STALE_RUN_LEASE_MS,
  STARTED_REVERIFY_MS,
  sandboxRuntimeUpdatePending,
  storedDaytonaId,
  toUpstreamError,
} from "./project-sandbox-lifecycle-support";
import type { SandboxMeteringContext } from "./project-sandbox-metering";
import { PROC_PREFIX, PROCESS_PORT_ALLOC_KEY } from "./project-sandbox-process-support";
import { ProjectSandboxProvisioning } from "./project-sandbox-provisioning";
import type { ParsedProjectCleanupWorkspaceInput } from "./project-sandbox-runtime";
import {
  openProjectSandboxWorkspaceState,
  type ProjectSandboxWorkspaceState,
} from "./project-sandbox-workspace-state";

const RUNTIME_RESET_PENDING_KEY = "sandbox_runtime_reset_pending";
const SKILL_RUNTIME_DIRECTORY = "/workspace/.cheatcode/runtime";
interface RuntimeCache {
  client: DaytonaClient | undefined;
  sandboxId: string | undefined;
  startedVerifiedAtMs: number;
}

interface RuntimeState {
  isAccountDeletionCompleted: boolean;
  isAccountDeletionInProgress: boolean;
  accountDeletionPromise: Promise<void> | undefined;
  activeOperationCount: number;
  activeOperationDrainWaiters: Set<() => void>;
  cache: RuntimeCache;
  ctx: DurableObjectState;
  env: ProjectSandboxEnv;
  identity: ProjectSandboxIdentityState;
  provisioning: ProjectSandboxProvisioning;
  sandboxMutationTail: Promise<void>;
  isSandboxRuntimeUpdateInProgress: boolean;
  workspaceState: ProjectSandboxWorkspaceState | undefined;
}

interface SandboxLeaseRuntime {
  withCleanupSignal: <Result>(operation: () => Promise<Result>) => Promise<Result | undefined>;
  withOwnerRegistration: <Result>(
    userId: string,
    operation: () => Promise<Result>,
  ) => Promise<Result>;
  withProjectCleanup: <Result>(operation: () => Promise<Result>) => Promise<Result>;
  withSandboxOperation: <Result>(operation: () => Promise<Result>) => Promise<Result>;
  withSharedWorkspaceMutation: <Result>(operation: () => Promise<Result>) => Promise<Result>;
  withStreamingOperation: (
    workspaceScope: string | readonly string[] | null,
    operation: (release: () => void) => Promise<Response>,
  ) => Promise<Response>;
  withWorkspaceOperation: <Result>(
    workspaceScope: string | readonly string[] | null,
    operation: () => Promise<Result>,
  ) => Promise<Result>;
}

export interface SandboxRuntime {
  readonly client: () => DaytonaClient;
  readonly deleteAccountState: () => Promise<void>;
  readonly deleteProjectWorkspace: (
    input: ParsedProjectCleanupWorkspaceInput,
    cleanup: () => Promise<void>,
  ) => Promise<void>;
  readonly ensureExistingSandboxStarted: () => Promise<string | null>;
  readonly ensureSandbox: (startingRunId?: string) => Promise<string>;
  readonly existingSandboxId: () => Promise<string | null>;
  readonly lease: SandboxLeaseRuntime;
  readonly meteringContext: () => Promise<SandboxMeteringContext>;
  readonly outputBucket: R2Bucket;
  readonly ownerUserId: () => string;
  readonly previewHostname: () => string;
  readonly previewSecret: () => Promise<string>;
  readonly registerOwner: (userId: string, sandboxName?: string) => Promise<void>;
  readonly restartSandboxForWorkspaceRecovery: (sandboxId: string) => Promise<void>;
  readonly sandboxName: () => string;
  readonly storage: DurableObjectStorage;
  readonly toUpstreamError: (error: unknown, fallback: string) => APIError;
  readonly writeExecAudit: (entry: SandboxExecAuditEntry) => Promise<void>;
}

export function createSandboxRuntime(
  ctx: DurableObjectState,
  env: ProjectSandboxEnv,
): SandboxRuntime {
  const identity = new ProjectSandboxIdentityState(ctx);
  const cache: RuntimeCache = {
    client: undefined,
    sandboxId: undefined,
    startedVerifiedAtMs: 0,
  };
  const provisioning = createProvisioning(env, identity, cache, ctx);
  const state: RuntimeState = {
    isAccountDeletionCompleted: false,
    isAccountDeletionInProgress: false,
    accountDeletionPromise: undefined,
    activeOperationCount: 0,
    activeOperationDrainWaiters: new Set(),
    cache,
    ctx,
    env,
    identity,
    provisioning,
    sandboxMutationTail: Promise.resolve(),
    isSandboxRuntimeUpdateInProgress: false,
    workspaceState: openProjectSandboxWorkspaceState(ctx),
  };
  void ctx.blockConcurrencyWhile(() => initializeIdentityState(state));
  return runtimeHandle(state);
}

function createProvisioning(
  env: ProjectSandboxEnv,
  identity: ProjectSandboxIdentityState,
  cache: RuntimeCache,
  ctx: DurableObjectState,
): ProjectSandboxProvisioning {
  return new ProjectSandboxProvisioning({
    cachedSandboxId: async () => cache.sandboxId ?? storedDaytonaId(ctx.storage),
    env,
    sandboxName: () => identity.sandboxName(),
    toUpstreamError: (error, fallback) => toUpstreamError(error, fallback, identity.sandboxName()),
  });
}

function runtimeHandle(state: RuntimeState): SandboxRuntime {
  return {
    client: () => client(state),
    deleteAccountState: () => deleteAccountState(state),
    deleteProjectWorkspace: (input, cleanup) =>
      workspaceState(state).deleteWorkspace(input, cleanup),
    ensureExistingSandboxStarted: () => ensureExistingSandboxStarted(state),
    ensureSandbox: (startingRunId) => ensureSandbox(state, startingRunId),
    existingSandboxId: () => existingSandboxId(state),
    lease: leaseRuntime(state),
    meteringContext: () => Promise.resolve(meteringContext(state)),
    outputBucket: state.env.R2_OUTPUTS,
    ownerUserId: () => ownerUserId(state),
    previewHostname: () =>
      previewHostnameForWorker(state.env.CHEATCODE_ENVIRONMENT, state.env.PREVIEW_HOSTNAME),
    previewSecret: () => previewSecret(state),
    registerOwner: (userId, sandboxName) => state.identity.registerOwner(userId, sandboxName),
    restartSandboxForWorkspaceRecovery: (sandboxId) =>
      restartSandboxForWorkspaceRecovery(state, sandboxId),
    sandboxName: () => state.identity.sandboxName(),
    storage: state.ctx.storage,
    toUpstreamError: (error, fallback) =>
      toUpstreamError(error, fallback, state.identity.sandboxName()),
    writeExecAudit: (entry) => writeExecAudit(state.env.R2_AUDIT, entry),
  };
}

function leaseRuntime(state: RuntimeState): SandboxLeaseRuntime {
  return {
    withCleanupSignal: (operation) => withCleanupSignal(state, operation),
    withOwnerRegistration: (userId, operation) => withOwnerRegistration(state, userId, operation),
    withProjectCleanup: (operation) => withProjectCleanup(state, operation),
    withSandboxOperation: (operation) => withActiveOperation(state, null, operation, false, true),
    withSharedWorkspaceMutation: (operation) => withSharedWorkspaceMutation(state, operation),
    withStreamingOperation: (scope, operation) => withStreamingOperation(state, scope, operation),
    withWorkspaceOperation: (scope, operation) =>
      withActiveOperation(state, scope, operation, false, true),
  };
}

async function initializeIdentityState(state: RuntimeState): Promise<void> {
  const isDeleted = (await state.ctx.storage.get(ACCOUNT_DELETION_TOMBSTONE_KEY)) === true;
  if (isDeleted) {
    state.isAccountDeletionInProgress = true;
  }
  await state.identity.initialize();
}

function deleteAccountState(state: RuntimeState): Promise<void> {
  if (state.isAccountDeletionCompleted) {
    return Promise.resolve();
  }
  if (state.accountDeletionPromise !== undefined) {
    return state.accountDeletionPromise;
  }
  state.isAccountDeletionInProgress = true;
  const deletion = performAccountDeletion(state, {
    clearCachedSandbox: () => clearCachedSandbox(state),
    ensureClient: () => ensureClient(state),
    meteringContext: () => meteringContext(state),
    withSandboxMutation: (operation) => withSandboxMutation(state, operation),
  });
  const tracked = deletion.finally(() => {
    if (state.accountDeletionPromise === tracked) {
      state.accountDeletionPromise = undefined;
    }
  });
  state.accountDeletionPromise = tracked;
  return tracked;
}

function client(state: RuntimeState): DaytonaClient {
  if (!state.cache.client) {
    throw new Error("Daytona client accessed before initialization.");
  }
  return state.cache.client;
}

async function ensureClient(state: RuntimeState): Promise<DaytonaClient> {
  if (state.cache.client) {
    return state.cache.client;
  }
  const apiKey = await resolveWorkerSecret(state.env.DAYTONA_API_KEY);
  if (!apiKey) {
    throw new APIError(
      503,
      "service_maintenance_unavailable",
      "DAYTONA_API_KEY is not configured",
      {
        retriable: false,
      },
    );
  }
  state.cache.client = new DaytonaClient({
    apiKey,
    apiUrl: state.env.DAYTONA_API_URL,
    target: daytonaTarget(state.env),
    ...(state.env.DAYTONA_ORG_ID ? { organizationId: state.env.DAYTONA_ORG_ID } : {}),
    ...(state.env.DAYTONA_PREVIEW_HOST_SUFFIXES
      ? { previewHostSuffixes: state.env.DAYTONA_PREVIEW_HOST_SUFFIXES }
      : {}),
  });
  return state.cache.client;
}

function setCachedSandboxId(state: RuntimeState, sandboxId: string): void {
  state.cache.sandboxId = sandboxId;
  state.cache.startedVerifiedAtMs = Date.now();
}

async function ensureSandbox(state: RuntimeState, startingRunId?: string): Promise<string> {
  return withSandboxMutation(state, async () => {
    if (
      state.cache.sandboxId &&
      Date.now() - state.cache.startedVerifiedAtMs < STARTED_REVERIFY_MS
    ) {
      return state.cache.sandboxId;
    }
    return resolveStartedSandbox(state, startingRunId);
  });
}

async function restartSandboxForWorkspaceRecovery(
  state: RuntimeState,
  sandboxId: string,
): Promise<void> {
  await withSandboxMutation(state, async () => {
    const daytona = await ensureClient(state);
    try {
      await state.provisioning.restart(daytona, sandboxId);
    } catch (error) {
      throw toUpstreamError(
        error,
        "Daytona workspace recovery failed.",
        state.identity.sandboxName(),
      );
    }
    setCachedSandboxId(state, sandboxId);
  });
}

async function ensureExistingSandboxStarted(state: RuntimeState): Promise<string | null> {
  return withSandboxMutation(state, async () => {
    const daytona = await ensureClient(state);
    let existing: DaytonaSandbox | null;
    try {
      existing = await state.provisioning.findExisting(daytona);
      if (!existing || !(await state.provisioning.ensureStarted(daytona, existing))) {
        return null;
      }
    } catch (error) {
      throw toUpstreamError(
        error,
        "Daytona sandbox cleanup startup failed.",
        state.identity.sandboxName(),
      );
    }
    state.cache.sandboxId = existing.id;
    await state.ctx.storage.put(DAYTONA_ID_KEY, existing.id);
    state.cache.startedVerifiedAtMs = Date.now();
    return existing.id;
  });
}

async function withSandboxMutation<Result>(
  state: RuntimeState,
  operation: () => Promise<Result>,
): Promise<Result> {
  const previous = state.sandboxMutationTail;
  let release = (): void => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  state.sandboxMutationTail = previous.catch(() => undefined).then(() => gate);
  await previous.catch(() => undefined);
  try {
    return await operation();
  } finally {
    release();
  }
}

async function resolveStartedSandbox(state: RuntimeState, startingRunId?: string): Promise<string> {
  const daytona = await ensureClient(state);
  let resolved: DaytonaSandbox;
  try {
    resolved = await state.provisioning.resolve(daytona);
    if (!state.provisioning.isDesired(resolved)) {
      resolved = await replaceSandboxRuntime(state, daytona, resolved, startingRunId);
    }
  } catch (error) {
    throw toUpstreamError(error, "Daytona sandbox lookup failed.", state.identity.sandboxName());
  }
  state.cache.sandboxId = resolved.id;
  await state.ctx.storage.put(DAYTONA_ID_KEY, resolved.id);
  if (!(await state.provisioning.ensureStarted(daytona, resolved))) {
    throw new APIError(502, "upstream_sandbox_failed", "Daytona sandbox disappeared", {
      retriable: true,
    });
  }
  await clearPersistedRuntimeProjection(state, daytona, resolved.id);
  state.cache.startedVerifiedAtMs = Date.now();
  return resolved.id;
}

async function replaceSandboxRuntime(
  state: RuntimeState,
  daytona: DaytonaClient,
  current: DaytonaSandbox,
  startingRunId?: string,
): Promise<DaytonaSandbox> {
  state.isSandboxRuntimeUpdateInProgress = true;
  try {
    await assertSandboxReplacementAllowed(state, startingRunId);
    state.provisioning.assertRuntimeReplacementSafe(current);
    await prepareForSandboxReplacement(state);
    await state.provisioning.deleteForReplacement(daytona, current);
    const replacement = await state.provisioning.create(daytona);
    if (!state.provisioning.isDesired(replacement)) {
      throw sandboxRuntimeUpdatePending(state.env.DAYTONA_SANDBOX_SNAPSHOT);
    }
    createLogger().info("sandbox_runtime_replaced", {
      sandboxId: state.identity.sandboxName(),
      snapshot: state.env.DAYTONA_SANDBOX_SNAPSHOT,
    });
    return replacement;
  } finally {
    state.isSandboxRuntimeUpdateInProgress = false;
  }
}

async function assertSandboxReplacementAllowed(
  state: RuntimeState,
  startingRunId?: string,
): Promise<void> {
  const leases = await runLeases(state.ctx.storage);
  const active = leases.filter((lease) => Date.now() - lease.startedMs < STALE_RUN_LEASE_MS);
  if (active.length !== leases.length) {
    await state.ctx.storage.put(RUN_LEASES_KEY, active);
  }
  const otherRuns = active.filter((lease) => lease.runId !== startingRunId);
  if (state.activeOperationCount > 1 || otherRuns.length > 0) {
    throw sandboxRuntimeUpdatePending(state.env.DAYTONA_SANDBOX_SNAPSHOT);
  }
}

async function prepareForSandboxReplacement(state: RuntimeState): Promise<void> {
  state.cache.sandboxId = undefined;
  state.cache.startedVerifiedAtMs = 0;
  await state.ctx.storage.delete(DAYTONA_ID_KEY);
  await state.ctx.storage.put(RUNTIME_RESET_PENDING_KEY, true);
  const processRecords = await state.ctx.storage.list({ prefix: PROC_PREFIX });
  if (processRecords.size > 0) {
    await state.ctx.storage.delete([...processRecords.keys()]);
  }
  await state.ctx.storage.delete(PROCESS_PORT_ALLOC_KEY);
}

async function clearPersistedRuntimeProjection(
  state: RuntimeState,
  daytona: DaytonaClient,
  sandboxId: string,
): Promise<void> {
  if ((await state.ctx.storage.get(RUNTIME_RESET_PENDING_KEY)) !== true) {
    return;
  }
  try {
    await daytona.deleteFilePath(sandboxId, SKILL_RUNTIME_DIRECTORY, true);
    await state.ctx.storage.delete(RUNTIME_RESET_PENDING_KEY);
  } catch (error) {
    throw toUpstreamError(error, "Daytona runtime reset failed.", state.identity.sandboxName());
  }
}

async function existingSandboxId(state: RuntimeState): Promise<string | null> {
  const daytona = await ensureClient(state);
  try {
    const existing = await state.provisioning.findExisting(daytona);
    if (existing) {
      state.cache.sandboxId = existing.id;
      return existing.id;
    }
    return null;
  } catch (error) {
    throw toUpstreamError(error, "Daytona sandbox lookup failed.", state.identity.sandboxName());
  }
}

function meteringContext(state: RuntimeState): SandboxMeteringContext {
  return {
    env: state.env,
    ownerUserId: state.identity.ownerUserId(),
    sandboxId: state.identity.sandboxName(),
    storage: state.ctx.storage,
  };
}

async function previewSecret(state: RuntimeState): Promise<string> {
  const secret = await resolveWorkerSecret(state.env.PREVIEW_TOKEN_SECRET);
  if (!secret) {
    throw new APIError(
      503,
      "service_maintenance_unavailable",
      "PREVIEW_TOKEN_SECRET is not configured",
      {
        retriable: false,
      },
    );
  }
  return secret;
}

function ownerUserId(state: RuntimeState): string {
  const userId = state.identity.ownerUserId();
  if (!userId) {
    throw new APIError(500, "internal_service_error", "ProjectSandbox owner is not registered", {
      retriable: false,
    });
  }
  return userId;
}

function clearCachedSandbox(state: RuntimeState): void {
  state.cache.client = undefined;
  state.cache.sandboxId = undefined;
  state.cache.startedVerifiedAtMs = 0;
}
