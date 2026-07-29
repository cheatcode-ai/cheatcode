import type {
  DaytonaClient,
  DaytonaSandbox,
  SandboxDestroyResult,
} from "@cheatcode/agent-core/tools/code";
import { APIError } from "@cheatcode/observability";
import { z } from "zod";
import { clearWorkspaceCommand } from "./project-sandbox-cleanup-script";
import type { ProjectSandboxIdentityState } from "./project-sandbox-identity-state";
import {
  ACCOUNT_DELETION_TOMBSTONE_KEY,
  DAYTONA_ID_KEY,
  type ProjectSandboxEnv,
  parseSandboxJson,
  toUpstreamError,
  uniqueSandboxes,
} from "./project-sandbox-lifecycle-support";
import {
  clearSandboxMeterState,
  finalizeSandboxUsageBestEffort,
  type SandboxMeteringContext,
} from "./project-sandbox-metering";
import type { ProjectSandboxProvisioning } from "./project-sandbox-provisioning";
import type { ProjectSandboxWorkspaceState } from "./project-sandbox-workspace-state";

const ClearWorkspaceEvidenceSchema = z.object({ cleared: z.literal(true) }).strict();

interface AccountDeletionState {
  accountDeletionCompleted: boolean;
  activeOperationCount: number;
  activeOperationDrainWaiters: Set<() => void>;
  ctx: DurableObjectState;
  env: ProjectSandboxEnv;
  identity: ProjectSandboxIdentityState;
  provisioning: ProjectSandboxProvisioning;
  workspaceState: ProjectSandboxWorkspaceState | undefined;
}

interface AccountDeletionRuntime {
  clearCachedSandbox: () => void;
  ensureClient: () => Promise<DaytonaClient>;
  meteringContext: () => SandboxMeteringContext;
  withSandboxMutation: <Result>(operation: () => Promise<Result>) => Promise<Result>;
}

export async function performAccountDeletion(
  state: AccountDeletionState,
  runtime: AccountDeletionRuntime,
): Promise<void> {
  await state.ctx.storage.put(ACCOUNT_DELETION_TOMBSTONE_KEY, true);
  await waitForActiveSandboxOperations(state);
  await runtime.withSandboxMutation(async () => {
    await finalizeSandboxUsageBestEffort(runtime.meteringContext());
    await destroySandboxExclusive(state, runtime);
    await clearDurableStateForDeletedAccount(state, runtime);
  });
  state.accountDeletionCompleted = true;
}

function waitForActiveSandboxOperations(state: AccountDeletionState): Promise<void> {
  if (state.activeOperationCount === 0) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    state.activeOperationDrainWaiters.add(resolve);
  });
}

async function destroySandboxExclusive(
  state: AccountDeletionState,
  runtime: AccountDeletionRuntime,
): Promise<SandboxDestroyResult> {
  const daytona = await runtime.ensureClient();
  try {
    const canonical = await state.provisioning.findExisting(daytona);
    const owned = await state.provisioning.findOwned(daytona);
    const sandboxes = uniqueSandboxes(canonical ? [canonical, ...owned] : owned);
    const volumeSandbox = sandboxes.find(
      (sandbox) => sandbox.labels["workspaceVolumeName"] === state.env.DAYTONA_WORKSPACE_VOLUME,
    );
    if (volumeSandbox) {
      await clearWorkspaceVolume(state, daytona, volumeSandbox);
    }
    for (const sandbox of sandboxes) {
      await daytona.deleteSandbox(sandbox.id);
    }
  } catch (error) {
    throw toUpstreamError(error, "Daytona sandbox deletion failed.", state.identity.sandboxName());
  }
  return finishSandboxDestruction(state, runtime);
}

async function clearWorkspaceVolume(
  state: AccountDeletionState,
  daytona: DaytonaClient,
  sandbox: DaytonaSandbox,
): Promise<void> {
  if (!(await state.provisioning.ensureStarted(daytona, sandbox))) {
    throw new APIError(502, "upstream_sandbox_failed", "Daytona workspace disappeared", {
      retriable: true,
    });
  }
  const cleared = await daytona.execute(sandbox.id, {
    command: clearWorkspaceCommand(),
    timeout: 480,
  });
  if (
    cleared.exitCode !== 0 ||
    !ClearWorkspaceEvidenceSchema.safeParse(parseSandboxJson(cleared.result)).success
  ) {
    throw new APIError(502, "upstream_sandbox_failed", "Daytona workspace deletion failed", {
      details: { sandboxId: state.identity.sandboxName() },
      retriable: true,
    });
  }
}

async function finishSandboxDestruction(
  state: AccountDeletionState,
  runtime: AccountDeletionRuntime,
): Promise<SandboxDestroyResult> {
  runtime.clearCachedSandbox();
  await state.ctx.storage.delete(DAYTONA_ID_KEY);
  await clearSandboxMeterState(state.ctx.storage);
  return { deleted: true, sandboxId: state.identity.sandboxName() };
}

async function clearDurableStateForDeletedAccount(
  state: AccountDeletionState,
  runtime: AccountDeletionRuntime,
): Promise<void> {
  await state.ctx.storage.deleteAll();
  state.workspaceState = undefined;
  state.identity.clearRegisteredOwner();
  runtime.clearCachedSandbox();
}
