import type { ProjectSandboxIdentityState } from "./project-sandbox-identity-state";
import {
  accountSandboxDeletedError,
  type ProjectSandboxEnv,
  sandboxRuntimeUpdatePending,
} from "./project-sandbox-lifecycle-support";
import { assertProjectSandboxOwnerActive } from "./project-sandbox-owner-admission";
import {
  initializeProjectSandboxStorage,
  ProjectSandboxWorkspaceState,
} from "./project-sandbox-workspace-state";

interface SandboxLeaseState {
  accountDeletionInProgress: boolean;
  activeOperationCount: number;
  activeOperationDrainWaiters: Set<() => void>;
  ctx: DurableObjectState;
  env: ProjectSandboxEnv;
  identity: ProjectSandboxIdentityState;
  sandboxRuntimeUpdateInProgress: boolean;
  workspaceState: ProjectSandboxWorkspaceState | undefined;
}

export function workspaceState(state: SandboxLeaseState): ProjectSandboxWorkspaceState {
  if (!state.workspaceState) {
    initializeProjectSandboxStorage(state.ctx);
    state.workspaceState = new ProjectSandboxWorkspaceState(state.ctx);
  }
  return state.workspaceState;
}

export function withOwnerRegistration<Result>(
  state: SandboxLeaseState,
  userId: string,
  operation: () => Promise<Result>,
): Promise<Result> {
  if (state.identity.hasRegisteredOwner()) {
    return withActiveOperation(state, null, operation);
  }
  let release: (() => void) | undefined;
  try {
    release = acquireActiveSandboxOperation(state, true);
    return runOwnerRegistrationPreflight(state, userId, operation).finally(release);
  } catch (error) {
    release?.();
    return Promise.reject(error);
  }
}

async function runOwnerRegistrationPreflight<Result>(
  state: SandboxLeaseState,
  userId: string,
  operation: () => Promise<Result>,
): Promise<Result> {
  await assertProjectSandboxOwnerActive(state.env, userId);
  if (state.accountDeletionInProgress) {
    throw accountSandboxDeletedError();
  }
  const result = await operation();
  if (state.accountDeletionInProgress) {
    throw accountSandboxDeletedError();
  }
  workspaceState(state);
  return result;
}

export function withSharedWorkspaceMutation<Result>(
  state: SandboxLeaseState,
  operation: () => Promise<Result>,
): Promise<Result> {
  return withActiveOperation(
    state,
    null,
    async () => {
      await workspaceState(state).waitForWorkspaceDrain();
      return operation();
    },
    true,
  );
}

export function withActiveOperation<Result>(
  state: SandboxLeaseState,
  scope: string | readonly string[] | null,
  operation: () => Promise<Result>,
  isSharedMutation = false,
  shouldLeaseUnknownWorkspace = false,
  allowRuntimeUpdate = false,
): Promise<Result> {
  let release: (() => void) | undefined;
  try {
    release = acquireActiveOperation(
      state,
      scope,
      isSharedMutation,
      shouldLeaseUnknownWorkspace,
      allowRuntimeUpdate,
    );
    return operation().finally(release);
  } catch (error) {
    release?.();
    return Promise.reject(error);
  }
}

export function withStreamingOperation(
  state: SandboxLeaseState,
  scope: string | readonly string[] | null,
  operation: (release: () => void) => Promise<Response>,
): Promise<Response> {
  let release: (() => void) | undefined;
  try {
    release = acquireActiveOperation(state, scope, false, true, false);
    return operation(release).catch((error: unknown) => {
      release?.();
      throw error;
    });
  } catch (error) {
    release?.();
    return Promise.reject(error);
  }
}

export function withCleanupSignal<Result>(
  state: SandboxLeaseState,
  operation: () => Promise<Result>,
): Promise<Result | undefined> {
  return state.accountDeletionInProgress || !state.identity.hasRegisteredOwner()
    ? Promise.resolve(undefined)
    : withActiveOperation(state, null, operation, false, false, true);
}

export function withProjectCleanup<Result>(
  state: SandboxLeaseState,
  operation: () => Promise<Result>,
): Promise<Result> {
  let release: (() => void) | undefined;
  try {
    // Cleanup holds only the sandbox lease after its tombstone drains workspace work.
    release = acquireActiveSandboxOperation(state, false, true);
    return operation().finally(release);
  } catch (error) {
    release?.();
    return Promise.reject(error);
  }
}

function acquireActiveSandboxOperation(
  state: SandboxLeaseState,
  allowUnregisteredOwner = false,
  allowWorkspaceCleanup = false,
  allowRuntimeUpdate = false,
): () => void {
  assertSandboxOperationAllowed(
    state,
    allowUnregisteredOwner,
    allowWorkspaceCleanup,
    allowRuntimeUpdate,
  );
  state.activeOperationCount += 1;
  let isReleased = false;
  return () => {
    if (isReleased) return;
    isReleased = true;
    finishActiveSandboxOperation(state);
  };
}

function assertSandboxOperationAllowed(
  state: SandboxLeaseState,
  allowUnregisteredOwner: boolean,
  allowWorkspaceCleanup: boolean,
  allowRuntimeUpdate: boolean,
): void {
  if (state.accountDeletionInProgress) {
    throw accountSandboxDeletedError();
  }
  if (state.sandboxRuntimeUpdateInProgress && !allowRuntimeUpdate) {
    throw sandboxRuntimeUpdatePending(state.env.DAYTONA_SANDBOX_SNAPSHOT);
  }
  if (!allowUnregisteredOwner && !state.identity.hasRegisteredOwner()) {
    throw accountSandboxDeletedError();
  }
  const currentWorkspaceState =
    allowUnregisteredOwner && !state.identity.hasRegisteredOwner()
      ? state.workspaceState
      : workspaceState(state);
  currentWorkspaceState?.assertOperationAllowed(allowWorkspaceCleanup);
}

function acquireActiveOperation(
  state: SandboxLeaseState,
  scope: string | readonly string[] | null,
  isSharedMutation: boolean,
  shouldLeaseUnknownWorkspace: boolean,
  allowRuntimeUpdate: boolean,
): () => void {
  const releaseSandbox = acquireActiveSandboxOperation(state, false, false, allowRuntimeUpdate);
  let releaseWorkspace: (() => void) | undefined;
  try {
    const slugs = typeof scope === "string" ? [scope] : (scope ?? []);
    releaseWorkspace = workspaceRelease(
      workspaceState(state),
      slugs,
      isSharedMutation,
      shouldLeaseUnknownWorkspace,
    );
  } catch (error) {
    releaseSandbox();
    throw error;
  }
  return () => {
    releaseWorkspace?.();
    releaseSandbox();
  };
}

function workspaceRelease(
  state: ProjectSandboxWorkspaceState,
  slugs: readonly string[],
  isSharedMutation: boolean,
  shouldLeaseUnknownWorkspace: boolean,
): (() => void) | undefined {
  if (isSharedMutation) return state.acquireSharedMutation();
  if (slugs.length > 0) return state.acquire(slugs);
  return shouldLeaseUnknownWorkspace ? state.acquireUnscoped() : undefined;
}

function finishActiveSandboxOperation(state: SandboxLeaseState): void {
  state.activeOperationCount -= 1;
  if (state.activeOperationCount !== 0) return;
  for (const resolve of state.activeOperationDrainWaiters) {
    resolve();
  }
  state.activeOperationDrainWaiters.clear();
}
