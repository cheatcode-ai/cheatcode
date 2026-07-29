import { createLogger } from "@cheatcode/observability";
import {
  DEFAULT_IDLE_STOP_MIN,
  KEEPALIVE_ALARM_MS,
  RUN_LEASES_KEY,
  runLeases,
  STALE_RUN_LEASE_MS,
} from "./project-sandbox-lifecycle-support";
import {
  beginSandboxUsageBestEffort,
  finalizeSandboxUsageBestEffort,
  recordSandboxUsageBestEffort,
  setSandboxQuotaPeriod,
} from "./project-sandbox-metering";
import type { ProjectSandboxRuntimeState } from "./project-sandbox-runtime";
import type { SandboxRuntime } from "./project-sandbox-runtime-handle";

export interface LifecycleOps {
  alarm: () => Promise<void>;
  beginRun: (runId: string) => Promise<void>;
  deleteAccountState: () => Promise<void>;
  endRun: (runId: string) => Promise<void>;
  existingDaytonaId: () => Promise<string | null>;
  registerOwner: (userId: string, sandboxName?: string) => Promise<void>;
  renewRun: (runId: string) => Promise<void>;
  runtimeSandboxId: () => Promise<string>;
  sandboxRuntimeState: () => Promise<ProjectSandboxRuntimeState>;
  setQuotaPeriod: (periodEndIso: string) => Promise<void>;
}

type LifecycleRuntime = Pick<
  SandboxRuntime,
  | "client"
  | "deleteAccountState"
  | "ensureSandbox"
  | "existingSandboxId"
  | "meteringContext"
  | "registerOwner"
  | "sandboxName"
  | "storage"
>;

export function createLifecycleOps(runtime: LifecycleRuntime): LifecycleOps {
  return {
    alarm: () => handleAlarm(runtime),
    beginRun: (runId) => beginRun(runtime, runId),
    deleteAccountState: runtime.deleteAccountState,
    endRun: (runId) => endRun(runtime, runId),
    existingDaytonaId: runtime.existingSandboxId,
    registerOwner: runtime.registerOwner,
    renewRun: (runId) => renewRun(runtime, runId),
    runtimeSandboxId: () => runtime.ensureSandbox(),
    sandboxRuntimeState: () => sandboxRuntimeState(runtime),
    setQuotaPeriod: (periodEndIso) => setSandboxQuotaPeriod(runtime.storage, periodEndIso),
  };
}

async function beginRun(runtime: LifecycleRuntime, runId: string): Promise<void> {
  const leases = await runLeases(runtime.storage);
  const remaining = leases.filter((lease) => lease.runId !== runId);
  remaining.push({ runId, startedMs: Date.now() });
  await runtime.storage.put(RUN_LEASES_KEY, remaining);
  try {
    const id = await runtime.ensureSandbox(runId);
    await runtime
      .client()
      .setAutoStopInterval(id, 0)
      .catch(() => undefined);
    await beginSandboxUsageBestEffort(await runtime.meteringContext());
    await runtime.storage.setAlarm(Date.now() + KEEPALIVE_ALARM_MS);
  } catch (error) {
    await compensateFailedRunStart(runtime, runId);
    throw error;
  }
}

async function renewRun(runtime: LifecycleRuntime, runId: string): Promise<void> {
  const leases = await runLeases(runtime.storage);
  const lease = leases.find((candidate) => candidate.runId === runId);
  if (!lease) {
    return;
  }
  const renewed = leases.filter((candidate) => candidate.runId !== runId);
  renewed.push({ runId, startedMs: Date.now() });
  await runtime.storage.put(RUN_LEASES_KEY, renewed);
  await runtime.storage.setAlarm(Date.now() + KEEPALIVE_ALARM_MS);
}

async function endRun(runtime: LifecycleRuntime, runId: string): Promise<void> {
  const remaining = (await runLeases(runtime.storage)).filter((lease) => lease.runId !== runId);
  await runtime.storage.put(RUN_LEASES_KEY, remaining);
  if (remaining.length > 0) {
    await recordSandboxUsageBestEffort(await runtime.meteringContext());
    return;
  }
  await finalizeLastRunLease(runtime);
}

async function compensateFailedRunStart(runtime: LifecycleRuntime, runId: string): Promise<void> {
  try {
    const remaining = (await runLeases(runtime.storage)).filter((lease) => lease.runId !== runId);
    await runtime.storage.put(RUN_LEASES_KEY, remaining);
    if (remaining.length > 0) {
      await runtime.storage.setAlarm(Date.now() + KEEPALIVE_ALARM_MS);
      return;
    }
    await finalizeLastRunLease(runtime);
  } catch (error) {
    createLogger().error("sandbox_run_lease_rollback_failed", {
      error,
      runId,
      sandboxId: runtime.sandboxName(),
    });
    await runtime.storage.setAlarm(Date.now() + KEEPALIVE_ALARM_MS).catch(() => undefined);
  }
}

async function finalizeLastRunLease(runtime: LifecycleRuntime): Promise<void> {
  await finalizeSandboxUsageBestEffort(await runtime.meteringContext());
  if (await restoreIdleAutoStop(runtime)) {
    await runtime.storage.deleteAlarm();
    return;
  }
  await runtime.storage.setAlarm(Date.now() + KEEPALIVE_ALARM_MS);
}

async function handleAlarm(runtime: LifecycleRuntime): Promise<void> {
  const leases = (await runLeases(runtime.storage)).filter(
    (lease) => Date.now() - lease.startedMs < STALE_RUN_LEASE_MS,
  );
  await runtime.storage.put(RUN_LEASES_KEY, leases);
  if (leases.length === 0) {
    await finalizeLastRunLease(runtime);
    return;
  }
  await refreshActiveSandboxBestEffort(runtime);
  try {
    await recordSandboxUsageBestEffort(await runtime.meteringContext());
  } finally {
    await runtime.storage.setAlarm(Date.now() + KEEPALIVE_ALARM_MS);
  }
}

async function refreshActiveSandboxBestEffort(runtime: LifecycleRuntime): Promise<void> {
  try {
    const id = await runtime.existingSandboxId();
    if (id) {
      await runtime.client().refreshActivity(id);
    }
  } catch (error) {
    createLogger().warn("sandbox_keepalive_refresh_failed", {
      error,
      sandboxId: runtime.sandboxName(),
    });
  }
}

async function sandboxRuntimeState(runtime: LifecycleRuntime): Promise<ProjectSandboxRuntimeState> {
  const existing = await runtime.existingSandboxId();
  if (!existing) {
    return { state: "none" };
  }
  const sandbox = await runtime.client().getSandbox(existing);
  return { sandboxId: existing, state: sandbox?.state ?? "unknown" };
}

async function restoreIdleAutoStop(runtime: LifecycleRuntime): Promise<boolean> {
  try {
    const id = await runtime.existingSandboxId();
    if (!id) {
      return true;
    }
    await runtime.client().setAutoStopInterval(id, DEFAULT_IDLE_STOP_MIN);
    return true;
  } catch (error) {
    createLogger().warn("sandbox_autostop_restore_failed", {
      error,
      sandboxId: runtime.sandboxName(),
    });
    return false;
  }
}
