import { DurableObject } from "cloudflare:workers";
import { PreviewHostnameSchema, resolveWorkerSecret } from "@cheatcode/env";
import { APIError, createLogger } from "@cheatcode/observability";
import {
  DaytonaApiError,
  DaytonaClient,
  type DaytonaSandbox,
  type SandboxDestroyResult,
} from "@cheatcode/tools-code";
import { z } from "zod";
import { type SandboxExecAuditEntry, writeExecAudit } from "./project-sandbox-audit";
import { ProjectSandboxIdentityState } from "./project-sandbox-identity-state";
import {
  ACCOUNT_DELETION_TOMBSTONE_KEY,
  accountSandboxDeletedError,
  DAYTONA_ID_KEY,
  DEFAULT_IDLE_STOP_MIN,
  KEEPALIVE_ALARM_MS,
  type ProjectSandboxEnv,
  parseSandboxJson,
  RUN_LEASES_KEY,
  RunLeasesSchema,
  STALE_RUN_LEASE_MS,
  STARTED_REVERIFY_MS,
  sandboxReleaseGateError,
  uniqueSandboxes,
} from "./project-sandbox-lifecycle-support";
import {
  beginSandboxUsageBestEffort,
  clearSandboxMeterState,
  finalizeSandboxUsageBestEffort,
  recordSandboxUsageBestEffort,
  type SandboxMeteringContext,
  setSandboxQuotaPeriod,
} from "./project-sandbox-metering";
import { assertProjectSandboxOwnerActive } from "./project-sandbox-owner-admission";
import { ProjectSandboxProvisioning } from "./project-sandbox-provisioning";
import type {
  ParsedProjectCleanupWorkspaceInput,
  ProjectSandboxRuntimeState,
} from "./project-sandbox-runtime";
import { clearWorkspaceCommand } from "./project-sandbox-snapshot-scripts";
import {
  initializeProjectSandboxStorage,
  openProjectSandboxWorkspaceState,
  ProjectSandboxWorkspaceState,
} from "./project-sandbox-workspace-state";

const ClearWorkspaceEvidenceSchema = z.object({ cleared: z.literal(true) }).strict();

export abstract class ProjectSandboxLifecycle extends DurableObject<ProjectSandboxEnv> {
  private accountDeletionCompleted = false;
  private accountDeletionInProgress = false;
  private accountDeletionPromise: Promise<void> | undefined;
  private activeOperationCount = 0;
  private readonly activeOperationDrainWaiters = new Set<() => void>();
  private activeWorkspaceTransitionId: string | null = null;
  private daytonaClient: DaytonaClient | undefined;
  private daytonaId: string | undefined;
  private sandboxMutationTail: Promise<void> = Promise.resolve();
  private startedVerifiedAtMs = 0;
  private readonly identityState: ProjectSandboxIdentityState;
  private readonly provisioning: ProjectSandboxProvisioning;
  private workspaceStateValue: ProjectSandboxWorkspaceState | undefined;

  constructor(ctx: DurableObjectState, env: ProjectSandboxEnv) {
    super(ctx, env);
    this.identityState = new ProjectSandboxIdentityState(ctx);
    this.provisioning = new ProjectSandboxProvisioning({
      cachedSandboxId: async () => this.daytonaId ?? this.storedDaytonaId(),
      env,
      sandboxName: () => this.sandboxName(),
      toUpstreamError: (error, fallback) => this.toUpstreamError(error, fallback),
    });
    if (env.CHEATCODE_RELEASE_GATE !== "closed") {
      this.workspaceStateValue = openProjectSandboxWorkspaceState(ctx);
      void ctx.blockConcurrencyWhile(() => this.initializeIdentityState());
    }
  }

  public deleteAccountState(): Promise<void> {
    if (this.env.CHEATCODE_RELEASE_GATE === "closed") {
      return Promise.reject(sandboxReleaseGateError());
    }
    if (this.accountDeletionCompleted) {
      return Promise.resolve();
    }
    if (this.accountDeletionPromise !== undefined) {
      return this.accountDeletionPromise;
    }

    this.workspaceStateValue?.assertAccountDeletionAllowed();
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

  protected withActiveSandboxOperation<T>(operation: () => Promise<T>): Promise<T> {
    if (this.env.CHEATCODE_RELEASE_GATE === "closed") {
      return Promise.reject(sandboxReleaseGateError());
    }
    return this.withActiveOperation(null, operation, false, true);
  }
  protected withActiveOwnerRegistration<T>(
    userId: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    if (this.env.CHEATCODE_RELEASE_GATE === "closed") {
      return Promise.reject(sandboxReleaseGateError());
    }
    if (this.identityState.hasRegisteredOwner()) {
      return this.withActiveOperation(null, operation);
    }
    let release: (() => void) | undefined;
    try {
      release = this.acquireActiveSandboxOperation(undefined, true);
      return assertProjectSandboxOwnerActive(this.env, userId)
        .then(() => {
          if (this.accountDeletionInProgress) {
            throw accountSandboxDeletedError();
          }
          return operation().then((result) => {
            if (this.accountDeletionInProgress) {
              throw accountSandboxDeletedError();
            }
            this.ensureWorkspaceState();
            return result;
          });
        })
        .finally(release);
    } catch (error) {
      release?.();
      return Promise.reject(error);
    }
  }
  protected withActiveSharedWorkspaceMutation<T>(operation: () => Promise<T>): Promise<T> {
    if (this.env.CHEATCODE_RELEASE_GATE === "closed") {
      return Promise.reject(sandboxReleaseGateError());
    }
    return this.withActiveOperation(
      null,
      async () => {
        await this.workspaceState.waitForWorkspaceDrain();
        return operation();
      },
      true,
    );
  }
  protected withActiveWorkspaceTransition<T>(
    transitionId: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    if (this.env.CHEATCODE_RELEASE_GATE !== "closed") {
      return Promise.reject(
        new APIError(
          409,
          "conflict_state_invalid",
          "Workspace transitions require the closed release gate",
          { retriable: false },
        ),
      );
    }
    return this.initializeIdentityState().then(() =>
      this.runActiveWorkspaceTransition(transitionId, operation),
    );
  }
  private runActiveWorkspaceTransition<T>(
    transitionId: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    let releaseSandbox: (() => void) | undefined;
    let releaseWorkspace: (() => void) | undefined;
    try {
      const workspaceState = this.openWorkspaceState();
      releaseWorkspace = workspaceState
        ? workspaceState.acquireTransitionMutation(transitionId)
        : this.acquireTransientWorkspaceTransition(transitionId);
      return Promise.all([
        this.waitForActiveSandboxOperations(),
        workspaceState?.waitForWorkspaceDrain() ?? Promise.resolve(),
      ])
        .then(() => {
          releaseSandbox = this.acquireActiveSandboxOperation(transitionId, true);
          return operation();
        })
        .finally(() => {
          releaseSandbox?.();
          releaseWorkspace?.();
        });
    } catch (error) {
      releaseWorkspace?.();
      releaseSandbox?.();
      return Promise.reject(error);
    }
  }

  private acquireTransientWorkspaceTransition(transitionId: string): () => void {
    if (this.activeWorkspaceTransitionId !== null) {
      throw new APIError(409, "conflict_state_invalid", "Workspace maintenance is in progress", {
        retriable: true,
      });
    }
    this.activeWorkspaceTransitionId = transitionId;
    let isReleased = false;
    return () => {
      if (isReleased) {
        return;
      }
      isReleased = true;
      if (this.activeWorkspaceTransitionId === transitionId) {
        this.activeWorkspaceTransitionId = null;
      }
    };
  }
  protected withActiveProjectWorkspaceOperation<T>(
    workspaceScope: string | readonly string[] | null,
    operation: () => Promise<T>,
  ): Promise<T> {
    if (this.env.CHEATCODE_RELEASE_GATE === "closed") {
      return Promise.reject(sandboxReleaseGateError());
    }
    return this.withActiveOperation(workspaceScope, operation, false, true);
  }
  private withActiveOperation<T>(
    workspaceScope: string | readonly string[] | null,
    operation: () => Promise<T>,
    isSharedMutation = false,
    shouldLeaseUnknownWorkspace = false,
  ): Promise<T> {
    let release: (() => void) | undefined;
    try {
      release = this.acquireActiveOperation(
        workspaceScope,
        isSharedMutation,
        shouldLeaseUnknownWorkspace,
      );
      return operation().finally(release);
    } catch (error) {
      release?.();
      return Promise.reject(error);
    }
  }

  protected withActiveProjectWorkspaceStreamingOperation(
    workspaceScope: string | readonly string[] | null,
    operation: (release: () => void) => Promise<Response>,
  ): Promise<Response> {
    if (this.env.CHEATCODE_RELEASE_GATE === "closed") {
      return Promise.reject(sandboxReleaseGateError());
    }
    return this.withActiveStreamingOperation(workspaceScope, operation);
  }
  private withActiveStreamingOperation(
    workspaceScope: string | readonly string[] | null,
    operation: (release: () => void) => Promise<Response>,
  ): Promise<Response> {
    let release: (() => void) | undefined;
    try {
      release = this.acquireActiveOperation(workspaceScope, false, true);
      return operation(release).catch((error: unknown) => {
        release?.();
        throw error;
      });
    } catch (error) {
      release?.();
      return Promise.reject(error);
    }
  }

  protected withActiveSandboxCleanupSignal(operation: () => Promise<void>): Promise<void> {
    return this.env.CHEATCODE_RELEASE_GATE === "closed" ||
      this.accountDeletionInProgress ||
      !this.identityState.hasRegisteredOwner()
      ? Promise.resolve()
      : this.withActiveSandboxOperation(operation);
  }

  private async initializeIdentityState(): Promise<void> {
    const isAccountDeleted = (await this.ctx.storage.get(ACCOUNT_DELETION_TOMBSTONE_KEY)) === true;
    if (isAccountDeleted) {
      this.accountDeletionInProgress = true;
    }
    await this.identityState.initialize();
  }

  private get workspaceState(): ProjectSandboxWorkspaceState {
    return this.ensureWorkspaceState();
  }

  private ensureWorkspaceState(): ProjectSandboxWorkspaceState {
    if (!this.workspaceStateValue) {
      initializeProjectSandboxStorage(this.ctx);
      this.workspaceStateValue = new ProjectSandboxWorkspaceState(this.ctx);
    }
    return this.workspaceStateValue;
  }

  private openWorkspaceState(): ProjectSandboxWorkspaceState | undefined {
    this.workspaceStateValue ??= openProjectSandboxWorkspaceState(this.ctx);
    return this.workspaceStateValue;
  }

  protected deleteProjectWorkspace(
    input: ParsedProjectCleanupWorkspaceInput,
    cleanup: () => Promise<void>,
  ): Promise<void> {
    return this.workspaceState.deleteWorkspace(input, cleanup);
  }

  protected withActiveProjectWorkspaceCleanup<T>(operation: () => Promise<T>): Promise<T> {
    if (this.env.CHEATCODE_RELEASE_GATE === "closed") {
      return Promise.reject(sandboxReleaseGateError());
    }
    let release: (() => void) | undefined;
    try {
      // Cleanup itself must not take a workspace lease: its durable tombstone
      // blocks new work, then it drains every existing lease before killing
      // sandbox-wide processes.
      release = this.acquireActiveSandboxOperation(undefined, false, true);
      return operation().finally(release);
    } catch (error) {
      release?.();
      return Promise.reject(error);
    }
  }

  public async registerOwner(userId: string, sandboxName?: string): Promise<void> {
    await this.identityState.registerOwner(userId, sandboxName);
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
      const canonical = await this.provisioning.findExisting(client);
      const owned = await this.provisioning.findOwned(client);
      const sandboxes = uniqueSandboxes(canonical ? [canonical, ...owned] : owned);
      const volumeSandbox = sandboxes.find(
        (sandbox) => sandbox.labels["workspaceVolumeName"] === this.env.DAYTONA_WORKSPACE_VOLUME,
      );
      if (volumeSandbox) {
        if (!(await this.provisioning.ensureStarted(client, volumeSandbox))) {
          throw new APIError(502, "upstream_sandbox_failed", "Daytona workspace disappeared", {
            retriable: true,
          });
        }
        const cleared = await client.execute(volumeSandbox.id, {
          command: clearWorkspaceCommand(),
          timeout: 480,
        });
        if (
          cleared.exitCode !== 0 ||
          !ClearWorkspaceEvidenceSchema.safeParse(parseSandboxJson(cleared.result)).success
        ) {
          throw new APIError(502, "upstream_sandbox_failed", "Daytona workspace deletion failed", {
            details: { sandboxId: this.sandboxName() },
            retriable: true,
          });
        }
      }
      for (const sandbox of sandboxes) {
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
    await this.ctx.storage.deleteAll();
    this.workspaceStateValue = undefined;
    this.identityState.clearRegisteredOwner();
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

  private acquireActiveSandboxOperation(
    transitionId?: string,
    allowUnregisteredOwner = false,
    allowWorkspaceCleanup = false,
  ): () => void {
    if (this.accountDeletionInProgress) {
      throw accountSandboxDeletedError();
    }
    if (!allowUnregisteredOwner && !this.identityState.hasRegisteredOwner()) {
      throw accountSandboxDeletedError();
    }
    const workspaceState =
      allowUnregisteredOwner && !this.identityState.hasRegisteredOwner()
        ? this.workspaceStateValue
        : this.ensureWorkspaceState();
    workspaceState?.assertOperationAllowed(transitionId, allowWorkspaceCleanup);
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

  private acquireActiveOperation(
    workspaceScope: string | readonly string[] | null,
    isSharedMutation = false,
    shouldLeaseUnknownWorkspace = false,
  ): () => void {
    const releaseSandbox = this.acquireActiveSandboxOperation();
    let releaseWorkspace: (() => void) | undefined;
    try {
      const workspaceSlugs =
        typeof workspaceScope === "string" ? [workspaceScope] : (workspaceScope ?? []);
      releaseWorkspace = isSharedMutation
        ? this.workspaceState.acquireSharedMutation()
        : workspaceSlugs.length > 0
          ? this.workspaceState.acquire(workspaceSlugs)
          : shouldLeaseUnknownWorkspace
            ? this.workspaceState.acquireUnscoped()
            : undefined;
    } catch (error) {
      releaseSandbox();
      throw error;
    }
    return () => {
      releaseWorkspace?.();
      releaseSandbox();
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

  protected sandboxProvisioning(): ProjectSandboxProvisioning {
    return this.provisioning;
  }

  protected adoptDaytonaId(sandboxId: string): void {
    this.daytonaId = sandboxId;
    this.startedVerifiedAtMs = Date.now();
  }

  protected async ensureSandbox(): Promise<string> {
    return this.withSandboxMutation(async () => {
      if (this.daytonaId && Date.now() - this.startedVerifiedAtMs < STARTED_REVERIFY_MS) {
        return this.daytonaId;
      }
      return this.resolveStartedSandbox();
    });
  }

  protected async restartSandboxForWorkspaceRecovery(sandboxId: string): Promise<void> {
    await this.withSandboxMutation(async () => {
      const client = await this.ensureClient();
      try {
        await this.provisioning.restart(client, sandboxId);
      } catch (error) {
        throw this.toUpstreamError(error, "Daytona workspace recovery failed.");
      }
      this.daytonaId = sandboxId;
      this.startedVerifiedAtMs = Date.now();
    });
  }

  protected async ensureExistingSandboxStarted(): Promise<string | null> {
    return this.withSandboxMutation(async () => {
      const client = await this.ensureClient();
      let existing: DaytonaSandbox | null;
      try {
        existing = await this.provisioning.findExisting(client);
        if (!existing) {
          return null;
        }
        if (!(await this.provisioning.ensureStarted(client, existing))) {
          return null;
        }
      } catch (error) {
        throw this.toUpstreamError(error, "Daytona sandbox cleanup startup failed.");
      }
      this.daytonaId = existing.id;
      await this.ctx.storage.put(DAYTONA_ID_KEY, existing.id);
      this.startedVerifiedAtMs = Date.now();
      return existing.id;
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
      resolved = await this.provisioning.resolve(client);
    } catch (error) {
      throw this.toUpstreamError(error, "Daytona sandbox lookup failed.");
    }
    this.daytonaId = resolved.id;
    await this.ctx.storage.put(DAYTONA_ID_KEY, resolved.id);
    if (!(await this.provisioning.ensureStarted(client, resolved))) {
      throw new APIError(502, "upstream_sandbox_failed", "Daytona sandbox disappeared", {
        retriable: true,
      });
    }
    this.startedVerifiedAtMs = Date.now();
    return resolved.id;
  }

  protected async existingSandboxId(): Promise<string | null> {
    const client = await this.ensureClient();
    try {
      const existing = await this.provisioning.findExisting(client);
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
      ownerUserId: this.identityState.ownerUserId(),
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
    return this.identityState.sandboxName();
  }

  protected ownerUserId(): string {
    const userId = this.identityState.ownerUserId();
    if (!userId) {
      throw new APIError(500, "internal_error", "ProjectSandbox owner is not registered", {
        retriable: false,
      });
    }
    return userId;
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

  private async storedDaytonaId(): Promise<string | null> {
    const value = await this.ctx.storage.get(DAYTONA_ID_KEY);
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
    this.startedVerifiedAtMs = 0;
  }
}
