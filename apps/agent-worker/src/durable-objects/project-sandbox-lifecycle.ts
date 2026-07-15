import { DurableObject } from "cloudflare:workers";
import { PreviewHostnameSchema, resolveWorkerSecret, type WorkerSecret } from "@cheatcode/env";
import { APIError, createLogger } from "@cheatcode/observability";
import {
  DaytonaApiError,
  DaytonaClient,
  type DaytonaSandbox,
  type SandboxDestroyResult,
} from "@cheatcode/tools-code";
import { z } from "zod";
import { type SandboxExecAuditEntry, writeExecAudit } from "./project-sandbox-audit";
import {
  beginSandboxUsageBestEffort,
  clearSandboxMeterState,
  finalizeSandboxUsageBestEffort,
  recordSandboxUsageBestEffort,
  type SandboxMeteringContext,
  setSandboxQuotaPeriod,
} from "./project-sandbox-metering";
import {
  isDestroyed,
  isFailedState,
  scrubPersistedProcessEnvironments,
  sleep,
} from "./project-sandbox-process-support";
import type { ProjectSandboxRuntimeState } from "./project-sandbox-runtime";

export interface ProjectSandboxEnv {
  DAYTONA_API_KEY: WorkerSecret;
  DAYTONA_API_URL: string;
  DAYTONA_TARGET: string;
  DAYTONA_SANDBOX_SNAPSHOT: string;
  DAYTONA_ORG_ID?: string;
  DAYTONA_PREVIEW_HOST_SUFFIXES?: string;
  PREVIEW_TOKEN_SECRET: WorkerSecret;
  PREVIEW_HOSTNAME: string;
  QUOTA_TRACKER: DurableObjectNamespace;
  R2_AUDIT: R2Bucket;
}

const SANDBOX_OWNER_USER_ID_KEY = "sandbox_owner_user_id";
const ACCOUNT_DELETION_TOMBSTONE_KEY = "account_deletion_tombstone";
const DAYTONA_ID_KEY = "daytona_sandbox_id";
const RUN_LEASES_KEY = "run_leases";
const SANDBOX_NAME_KEY = "sandbox_name";
const DEFAULT_IDLE_STOP_MIN = 30;
const AUTO_ARCHIVE_MIN = 1_440;
const NEVER_AUTO_DELETE = -1;
const KEEPALIVE_ALARM_MS = 4 * 60 * 1_000;
const STALE_RUN_LEASE_MS = 20 * 60 * 1_000;
const STARTED_REVERIFY_MS = 30_000;
const ENSURE_STARTED_ATTEMPTS = 30;
const ENSURE_STARTED_DELAY_MS = 2_000;
const DURABLE_DELETE_BATCH_SIZE = 128;
const OwnerUserIdSchema = z.string().uuid();
const RunLeasesSchema = z
  .array(z.object({ runId: z.string(), startedMs: z.number() }).strict())
  .default([]);

export abstract class ProjectSandboxLifecycle extends DurableObject<ProjectSandboxEnv> {
  private accountDeletionCompleted = false;
  private accountDeletionInProgress = false;
  private accountDeletionPromise: Promise<void> | undefined;
  private activeOperationCount = 0;
  private readonly activeOperationDrainWaiters = new Set<() => void>();
  private daytonaClient: DaytonaClient | undefined;
  private daytonaId: string | undefined;
  private sandboxMutationTail: Promise<void> = Promise.resolve();
  private startedVerifiedAtMs = 0;
  private cachedSandboxName: string | undefined;
  private snapshotDriftLoggedFor: string | undefined;

  constructor(ctx: DurableObjectState, env: ProjectSandboxEnv) {
    super(ctx, env);
    void ctx.blockConcurrencyWhile(async () => {
      const fromId = ctx.id.name;
      if ((await ctx.storage.get(ACCOUNT_DELETION_TOMBSTONE_KEY)) === true) {
        this.accountDeletionInProgress = true;
        this.cachedSandboxName = fromId;
        return;
      }
      const stored = await ctx.storage.get<string>(SANDBOX_NAME_KEY);
      if (fromId) {
        this.cachedSandboxName = fromId;
        if (stored !== fromId) {
          await ctx.storage.put(SANDBOX_NAME_KEY, fromId);
        }
      } else if (typeof stored === "string") {
        this.cachedSandboxName = stored;
      }
      await scrubPersistedProcessEnvironments(ctx.storage);
    });
  }

  /**
   * Atomically fences the user-scoped sandbox before draining in-flight RPCs and
   * deleting its external and durable state. The tombstone is intentionally kept
   * after cleanup so an evicted object can never recreate the account sandbox.
   */
  public deleteAccountState(): Promise<void> {
    if (this.accountDeletionCompleted) {
      return Promise.resolve();
    }
    if (this.accountDeletionPromise !== undefined) {
      return this.accountDeletionPromise;
    }

    // This assignment must remain before the first await: ordinary Durable Object
    // RPC work can interleave whenever an operation yields.
    this.accountDeletionInProgress = true;
    const deletion = this.performAccountDeletion();
    const tracked = deletion.finally(() => {
      if (this.accountDeletionPromise === tracked) {
        this.accountDeletionPromise = undefined;
      }
    });
    this.accountDeletionPromise = tracked;
    return tracked;
  }

  /** Guard used by the exported ProjectSandbox RPC facade. */
  protected withActiveSandboxOperation<T>(operation: () => Promise<T>): Promise<T> {
    let release: (() => void) | undefined;
    try {
      release = this.acquireActiveSandboxOperation();
      return operation().finally(release);
    } catch (error) {
      release?.();
      return Promise.reject(error);
    }
  }

  /** Keep a response-producing RPC active until its stream cleanup releases it. */
  protected withActiveSandboxStreamingOperation(
    operation: (release: () => void) => Promise<Response>,
  ): Promise<Response> {
    let release: (() => void) | undefined;
    try {
      release = this.acquireActiveSandboxOperation();
      return operation(release).catch((error: unknown) => {
        release?.();
        throw error;
      });
    } catch (error) {
      release?.();
      return Promise.reject(error);
    }
  }

  /** Lease signals and alarms are obsolete once account deletion starts. */
  protected withActiveSandboxCleanupSignal(operation: () => Promise<void>): Promise<void> {
    return this.accountDeletionInProgress
      ? Promise.resolve()
      : this.withActiveSandboxOperation(operation);
  }

  public async registerOwner(userId: string, sandboxName?: string): Promise<void> {
    if (sandboxName && this.cachedSandboxName !== sandboxName) {
      this.cachedSandboxName = sandboxName;
      await this.ctx.storage.put(SANDBOX_NAME_KEY, sandboxName);
    }
    const parsedUserId = OwnerUserIdSchema.parse(userId);
    const existingUserId = await this.ownerUserId();
    if (existingUserId && existingUserId !== parsedUserId) {
      throw new APIError(403, "permission_denied", "Sandbox ownership mismatch", {
        retriable: false,
      });
    }
    await this.ctx.storage.put(SANDBOX_OWNER_USER_ID_KEY, parsedUserId);
  }

  public async setQuotaPeriod(periodEndIso: string): Promise<void> {
    await setSandboxQuotaPeriod(this.ctx.storage, periodEndIso);
  }

  public async beginRun(runId: string): Promise<void> {
    const leases = await this.runLeases();
    const remaining = leases.filter((lease) => lease.runId !== runId);
    remaining.push({ runId, startedMs: Date.now() });
    await this.ctx.storage.put(RUN_LEASES_KEY, remaining);
    try {
      const id = await this.ensureSandbox();
      await this.client()
        .setAutoStopInterval(id, 0)
        .catch(() => undefined);
      await beginSandboxUsageBestEffort(await this.meteringContext());
      await this.ctx.storage.setAlarm(Date.now() + KEEPALIVE_ALARM_MS);
    } catch (error) {
      await this.compensateFailedRunStart(runId);
      throw error;
    }
  }

  public async renewRun(runId: string): Promise<void> {
    const leases = await this.runLeases();
    const lease = leases.find((candidate) => candidate.runId === runId);
    if (!lease) {
      return;
    }
    const renewed = leases.filter((candidate) => candidate.runId !== runId);
    renewed.push({ runId, startedMs: Date.now() });
    await this.ctx.storage.put(RUN_LEASES_KEY, renewed);
    await this.ctx.storage.setAlarm(Date.now() + KEEPALIVE_ALARM_MS);
  }

  public async endRun(runId: string): Promise<void> {
    const remaining = (await this.runLeases()).filter((lease) => lease.runId !== runId);
    await this.ctx.storage.put(RUN_LEASES_KEY, remaining);
    if (remaining.length > 0) {
      await recordSandboxUsageBestEffort(await this.meteringContext());
      return;
    }
    await this.finalizeLastRunLease();
  }

  private async compensateFailedRunStart(runId: string): Promise<void> {
    try {
      const remaining = (await this.runLeases()).filter((lease) => lease.runId !== runId);
      await this.ctx.storage.put(RUN_LEASES_KEY, remaining);
      if (remaining.length > 0) {
        await this.ctx.storage.setAlarm(Date.now() + KEEPALIVE_ALARM_MS);
        return;
      }
      await this.finalizeLastRunLease();
    } catch (error) {
      createLogger().error("sandbox_run_lease_rollback_failed", {
        error,
        runId,
        sandboxId: this.sandboxName(),
      });
      await this.ctx.storage.setAlarm(Date.now() + KEEPALIVE_ALARM_MS).catch(() => undefined);
    }
  }

  private async finalizeLastRunLease(): Promise<void> {
    await finalizeSandboxUsageBestEffort(await this.meteringContext());
    if (await this.restoreIdleAutoStop()) {
      await this.ctx.storage.deleteAlarm();
      return;
    }
    await this.ctx.storage.setAlarm(Date.now() + KEEPALIVE_ALARM_MS);
  }

  override async alarm(): Promise<void> {
    const leases = (await this.runLeases()).filter(
      (lease) => Date.now() - lease.startedMs < STALE_RUN_LEASE_MS,
    );
    await this.ctx.storage.put(RUN_LEASES_KEY, leases);
    if (leases.length === 0) {
      await this.finalizeLastRunLease();
      return;
    }
    await this.refreshActiveSandboxBestEffort();
    try {
      await recordSandboxUsageBestEffort(await this.meteringContext());
    } finally {
      await this.ctx.storage.setAlarm(Date.now() + KEEPALIVE_ALARM_MS);
    }
  }

  private async refreshActiveSandboxBestEffort(): Promise<void> {
    try {
      const id = await this.existingSandboxId();
      if (id) {
        await this.client().refreshActivity(id);
      }
    } catch (error) {
      createLogger().warn("sandbox_keepalive_refresh_failed", {
        error,
        sandboxId: this.sandboxName(),
      });
    }
  }

  public async runtimeSandboxId(): Promise<string> {
    return this.ensureSandbox();
  }

  public async existingDaytonaId(): Promise<string | null> {
    return this.existingSandboxId();
  }

  public async sandboxRuntimeState(): Promise<ProjectSandboxRuntimeState> {
    const existing = await this.existingSandboxId();
    if (!existing) {
      return { state: "none" };
    }
    const sandbox = await this.client().getSandbox(existing);
    return { sandboxId: existing, state: sandbox?.state ?? "unknown" };
  }

  private async performAccountDeletion(): Promise<void> {
    // Persist the fence before any external call. If the object is evicted during
    // Daytona cleanup, its next incarnation still rejects operational RPCs.
    await this.ctx.storage.put(ACCOUNT_DELETION_TOMBSTONE_KEY, true);
    await this.waitForActiveSandboxOperations();
    await this.withSandboxMutation(async () => {
      await finalizeSandboxUsageBestEffort(await this.meteringContext());
      await this.destroySandboxExclusive();
      await this.clearDurableStateForDeletedAccount();
    });
    this.accountDeletionCompleted = true;
  }

  private async destroySandboxExclusive(): Promise<SandboxDestroyResult> {
    const client = await this.ensureClient();
    try {
      const sandbox = await this.findExistingSandbox(client);
      if (sandbox) {
        await client.deleteSandbox(sandbox.id);
      }
    } catch (error) {
      throw this.toUpstreamError(error, "Daytona sandbox deletion failed.");
    }
    return this.finishSandboxDestruction();
  }

  private async finishSandboxDestruction(): Promise<SandboxDestroyResult> {
    this.clearCachedSandbox();
    await this.ctx.storage.delete(DAYTONA_ID_KEY);
    await clearSandboxMeterState(this.ctx.storage);
    return { deleted: true, sandboxId: this.sandboxName() };
  }

  private async clearDurableStateForDeletedAccount(): Promise<void> {
    for (;;) {
      const keys = [
        ...(await this.ctx.storage.list({ limit: DURABLE_DELETE_BATCH_SIZE })).keys(),
      ].filter((key) => key !== ACCOUNT_DELETION_TOMBSTONE_KEY);
      if (keys.length === 0) {
        break;
      }
      await this.ctx.storage.delete(keys);
    }
    await this.ctx.storage.deleteAlarm();
    this.clearCachedSandbox();
  }

  private waitForActiveSandboxOperations(): Promise<void> {
    if (this.activeOperationCount === 0) {
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      this.activeOperationDrainWaiters.add(resolve);
    });
  }

  private finishActiveSandboxOperation(): void {
    this.activeOperationCount -= 1;
    if (this.activeOperationCount !== 0) {
      return;
    }
    for (const resolve of this.activeOperationDrainWaiters) {
      resolve();
    }
    this.activeOperationDrainWaiters.clear();
  }

  private acquireActiveSandboxOperation(): () => void {
    if (this.accountDeletionInProgress) {
      throw accountSandboxDeletedError();
    }
    this.activeOperationCount += 1;
    let isReleased = false;
    return () => {
      if (isReleased) {
        return;
      }
      isReleased = true;
      this.finishActiveSandboxOperation();
    };
  }

  protected client(): DaytonaClient {
    if (!this.daytonaClient) {
      throw new Error("Daytona client accessed before initialization.");
    }
    return this.daytonaClient;
  }

  protected async ensureClient(): Promise<DaytonaClient> {
    if (this.daytonaClient) {
      return this.daytonaClient;
    }
    const apiKey = await resolveWorkerSecret(this.env.DAYTONA_API_KEY);
    if (!apiKey) {
      throw new APIError(503, "unavailable_maintenance", "DAYTONA_API_KEY is not configured", {
        retriable: false,
      });
    }
    this.daytonaClient = new DaytonaClient({
      apiKey,
      apiUrl: this.env.DAYTONA_API_URL,
      target: this.env.DAYTONA_TARGET,
      ...(this.env.DAYTONA_ORG_ID ? { organizationId: this.env.DAYTONA_ORG_ID } : {}),
      ...(this.env.DAYTONA_PREVIEW_HOST_SUFFIXES
        ? { previewHostSuffixes: this.env.DAYTONA_PREVIEW_HOST_SUFFIXES }
        : {}),
    });
    return this.daytonaClient;
  }

  protected async ensureSandbox(): Promise<string> {
    return this.withSandboxMutation(async () => {
      if (this.daytonaId && Date.now() - this.startedVerifiedAtMs < STARTED_REVERIFY_MS) {
        return this.daytonaId;
      }
      return this.resolveStartedSandbox();
    });
  }

  private async withSandboxMutation<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.sandboxMutationTail;
    let release = (): void => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.sandboxMutationTail = previous.catch(() => undefined).then(() => gate);
    await previous.catch(() => undefined);
    try {
      return await operation();
    } finally {
      release();
    }
  }

  private async resolveStartedSandbox(): Promise<string> {
    const client = await this.ensureClient();
    let resolved: DaytonaSandbox;
    try {
      resolved = await this.resolveSandbox(client);
    } catch (error) {
      throw this.toUpstreamError(error, "Daytona sandbox lookup failed.");
    }
    this.daytonaId = resolved.id;
    await this.ctx.storage.put(DAYTONA_ID_KEY, resolved.id);
    await this.ensureStarted(client, resolved);
    this.startedVerifiedAtMs = Date.now();
    return resolved.id;
  }

  protected async existingSandboxId(): Promise<string | null> {
    const client = await this.ensureClient();
    try {
      const existing = await this.findExistingSandbox(client);
      if (existing) {
        this.daytonaId = existing.id;
        return existing.id;
      }
      return null;
    } catch (error) {
      throw this.toUpstreamError(error, "Daytona sandbox lookup failed.");
    }
  }

  protected async meteringContext(): Promise<SandboxMeteringContext> {
    return {
      env: this.env,
      ownerUserId: await this.ownerUserId(),
      sandboxId: this.sandboxName(),
      storage: this.ctx.storage,
    };
  }

  protected async previewSecret(): Promise<string> {
    const secret = await resolveWorkerSecret(this.env.PREVIEW_TOKEN_SECRET);
    if (!secret) {
      throw new APIError(503, "unavailable_maintenance", "PREVIEW_TOKEN_SECRET is not configured", {
        retriable: false,
      });
    }
    return secret;
  }

  protected previewHostname(): string {
    return PreviewHostnameSchema.parse(this.env.PREVIEW_HOSTNAME);
  }

  protected sandboxName(): string {
    const name = this.cachedSandboxName ?? this.ctx.id.name;
    if (!name) {
      throw new Error("ProjectSandbox must be addressed with idFromName().");
    }
    return name;
  }

  protected writeExecAudit(entry: SandboxExecAuditEntry): Promise<void> {
    return writeExecAudit(this.env.R2_AUDIT, entry);
  }

  protected toUpstreamError(error: unknown, fallback: string): APIError {
    if (error instanceof APIError) {
      return error;
    }
    const status = error instanceof DaytonaApiError ? error.status : 502;
    const retriable = error instanceof DaytonaApiError ? error.retriable : true;
    return new APIError(status >= 500 ? 502 : status, "upstream_sandbox_failed", fallback, {
      cause: error,
      details: { sandboxId: this.sandboxName() },
      hint: "Retry. If it persists, check Daytona sandbox lifecycle status.",
      retriable,
    });
  }

  private async resolveSandbox(client: DaytonaClient): Promise<DaytonaSandbox> {
    const name = this.sandboxName();
    return (await this.findExistingSandbox(client)) ?? this.createSandbox(client, name);
  }

  private async createSandbox(client: DaytonaClient, name: string): Promise<DaytonaSandbox> {
    try {
      const created = await client.createSandbox({
        name,
        snapshot: this.env.DAYTONA_SANDBOX_SNAPSHOT,
        target: this.env.DAYTONA_TARGET,
        user: "node",
        labels: {
          app: "cheatcode",
          sandboxId: name,
          snapshot: this.env.DAYTONA_SANDBOX_SNAPSHOT,
        },
        autoStopInterval: DEFAULT_IDLE_STOP_MIN,
        autoArchiveInterval: AUTO_ARCHIVE_MIN,
        autoDeleteInterval: NEVER_AUTO_DELETE,
      });
      this.assertSandboxIdentity(created);
      this.observeSnapshotDrift(created);
      return created;
    } catch (error) {
      if (isDaytonaNameConflictError(error)) {
        const existing = await this.findExistingSandboxAfterCreateConflict(client, name);
        if (existing) {
          return existing;
        }
      }
      throw this.toUpstreamError(error, "Daytona sandbox failed to start.");
    }
  }

  private async findExistingSandboxAfterCreateConflict(
    client: DaytonaClient,
    name: string,
  ): Promise<DaytonaSandbox | null> {
    const byLabel = await this.findSandboxByLabels(client);
    if (byLabel) {
      return byLabel;
    }
    const byName = await client.getSandbox(name);
    if (byName && !isDestroyed(byName)) {
      this.assertSandboxIdentity(byName);
      this.observeSnapshotDrift(byName);
      return byName;
    }
    return null;
  }

  private async findExistingSandbox(client: DaytonaClient): Promise<DaytonaSandbox | null> {
    const cachedId = this.daytonaId ?? (await this.storedDaytonaId());
    if (cachedId) {
      const existing = await client.getSandbox(cachedId);
      if (existing && !isDestroyed(existing)) {
        this.assertSandboxIdentity(existing);
        this.observeSnapshotDrift(existing);
        return existing;
      }
    }
    return this.findSandboxByLabels(client);
  }

  private async findSandboxByLabels(client: DaytonaClient): Promise<DaytonaSandbox | null> {
    const byLabel = await client.listSandboxesByLabels({
      app: "cheatcode",
      sandboxId: this.sandboxName(),
    });
    const live = byLabel.filter((sandbox) => !isDestroyed(sandbox));
    if (live.length > 1) {
      throw new APIError(409, "conflict_state_invalid", "Multiple active sandboxes found", {
        details: { daytonaIds: live.map((sandbox) => sandbox.id), sandboxId: this.sandboxName() },
        hint: "Resolve the duplicate Daytona sandboxes explicitly before retrying.",
        retriable: false,
      });
    }
    const sandbox = live[0] ?? null;
    if (sandbox) {
      this.assertSandboxIdentity(sandbox);
      this.observeSnapshotDrift(sandbox);
    }
    return sandbox;
  }

  private assertSandboxIdentity(sandbox: DaytonaSandbox): void {
    const name = this.sandboxName();
    if (
      sandbox.name === name &&
      sandbox.labels["app"] === "cheatcode" &&
      sandbox.labels["sandboxId"] === name
    ) {
      return;
    }
    throw new APIError(409, "conflict_state_invalid", "Daytona sandbox identity mismatch", {
      details: { actualName: sandbox.name, daytonaId: sandbox.id, expectedName: name },
      hint: "Inspect the sandbox labels and durable object binding before retrying.",
      retriable: false,
    });
  }

  private observeSnapshotDrift(sandbox: DaytonaSandbox): void {
    const expected = this.env.DAYTONA_SANDBOX_SNAPSHOT;
    if (sandbox.snapshot === expected) {
      return;
    }
    const signature = `${sandbox.id}:${sandbox.snapshot}:${expected}`;
    if (this.snapshotDriftLoggedFor === signature) {
      return;
    }
    this.snapshotDriftLoggedFor = signature;
    createLogger().warn("sandbox_snapshot_drift", {
      actualSnapshot: sandbox.snapshot,
      daytonaId: sandbox.id,
      expectedSnapshot: expected,
      sandboxId: this.sandboxName(),
      state: sandbox.state,
    });
  }

  private async ensureStarted(client: DaytonaClient, sandbox: DaytonaSandbox): Promise<void> {
    if (sandbox.state === "started") {
      return;
    }
    if (sandbox.state === "stopped" || sandbox.state === "archived") {
      await client.startSandbox(sandbox.id).catch((error: unknown) => {
        throw this.toUpstreamError(error, "Daytona sandbox failed to start.");
      });
    }
    for (let attempt = 0; attempt < ENSURE_STARTED_ATTEMPTS; attempt += 1) {
      const current = await client.getSandbox(sandbox.id);
      if (current?.state === "started") {
        return;
      }
      if (current && isFailedState(current.state)) {
        throw new APIError(
          502,
          "upstream_sandbox_failed",
          `Daytona sandbox in state ${current.state}`,
          { details: { sandboxId: this.sandboxName(), state: current.state }, retriable: true },
        );
      }
      await sleep(ENSURE_STARTED_DELAY_MS);
    }
    throw new APIError(
      504,
      "upstream_sandbox_failed",
      "Daytona sandbox did not reach started state",
      {
        retriable: true,
      },
    );
  }

  private async storedDaytonaId(): Promise<string | null> {
    const value = await this.ctx.storage.get(DAYTONA_ID_KEY);
    return typeof value === "string" ? value : null;
  }

  private async ownerUserId(): Promise<string | null> {
    const value = await this.ctx.storage.get(SANDBOX_OWNER_USER_ID_KEY);
    return typeof value === "string" ? value : null;
  }

  private async runLeases(): Promise<Array<{ runId: string; startedMs: number }>> {
    return RunLeasesSchema.parse((await this.ctx.storage.get(RUN_LEASES_KEY)) ?? []);
  }

  private async restoreIdleAutoStop(): Promise<boolean> {
    try {
      const id = await this.existingSandboxId();
      if (!id) {
        return true;
      }
      await this.client().setAutoStopInterval(id, DEFAULT_IDLE_STOP_MIN);
      return true;
    } catch (error) {
      createLogger().warn("sandbox_autostop_restore_failed", {
        error,
        sandboxId: this.sandboxName(),
      });
      return false;
    }
  }

  private clearCachedSandbox(): void {
    this.daytonaClient = undefined;
    this.daytonaId = undefined;
    this.snapshotDriftLoggedFor = undefined;
    this.startedVerifiedAtMs = 0;
  }
}

function isDaytonaNameConflictError(error: unknown): boolean {
  if (!(error instanceof DaytonaApiError) || error.status !== 409) {
    return false;
  }
  const message = error.message.toLowerCase();
  return message.includes("already exists") || message.includes("conflict");
}

function accountSandboxDeletedError(): APIError {
  return new APIError(
    410,
    "conflict_state_invalid",
    "Sandbox account state is unavailable after deletion started",
    { retriable: false },
  );
}
