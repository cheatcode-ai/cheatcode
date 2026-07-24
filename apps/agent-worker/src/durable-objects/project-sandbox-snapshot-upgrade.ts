import { APIError } from "@cheatcode/observability";
import { DaytonaApiError, type DaytonaClient, type DaytonaSandbox } from "@cheatcode/tools-code";
import type { SandboxSnapshotReconciliation } from "@cheatcode/types";
import type { z } from "zod";
import {
  candidateSandboxLabels,
  canonicalSandboxLabels,
  isDesiredCanonicalSandbox,
  isUpgradeCandidate,
  retiredSandboxLabels,
} from "./project-sandbox-daytona-identity";
import {
  AUTO_ARCHIVE_MIN,
  DAYTONA_ID_KEY,
  DEFAULT_IDLE_STOP_MIN,
  NEVER_AUTO_DELETE,
  type ProjectSandboxEnv,
} from "./project-sandbox-lifecycle-support";
import { isDestroyed, sleep } from "./project-sandbox-process-support";
import type { ProjectSandboxProvisioning } from "./project-sandbox-provisioning";
import {
  digestWorkspaceCommand,
  prepareWorkspaceArchiveCommand,
  SNAPSHOT_TRANSFER_CHUNK_BYTES,
  verifyTransferChunkCommand,
  verifyWorkspaceArchiveCommand,
} from "./project-sandbox-snapshot-scripts";
import {
  ArchiveEvidenceSchema,
  ArchiveVerificationSchema,
  ChunkEvidenceSchema,
  DigestEvidenceSchema,
  RetryTransferSchema,
  SNAPSHOT_RELEASE_SHA_PATTERN,
  type SnapshotUpgradeState,
  SnapshotUpgradeStateSchema,
} from "./project-sandbox-snapshot-state";

const SNAPSHOT_UPGRADE_STATE_KEY = "sandbox_snapshot_upgrade";
const SNAPSHOT_EXEC_TIMEOUT_SECONDS = 480;
const DELETE_VERIFY_ATTEMPTS = 30;
const DELETE_VERIFY_DELAY_MS = 2_000;
const WORKSPACE_MOUNT_PATH = "/workspace";

interface SnapshotUpgradeInput {
  adoptSandboxId: (sandboxId: string) => void;
  client: DaytonaClient;
  ctx: DurableObjectState;
  env: ProjectSandboxEnv;
  killProcesses: () => Promise<number>;
  provisioning: ProjectSandboxProvisioning;
  sandboxName: string;
  toUpstreamError: (error: unknown, fallback: string) => APIError;
}

export class ProjectSandboxSnapshotUpgrade {
  public constructor(private readonly input: SnapshotUpgradeInput) {}

  public async advance(releaseSha: string): Promise<SandboxSnapshotReconciliation> {
    if (!SNAPSHOT_RELEASE_SHA_PATTERN.test(releaseSha)) {
      throw snapshotInvariant("Snapshot upgrade release identity is invalid.");
    }
    try {
      return await this.advanceExclusive(releaseSha);
    } catch (error) {
      throw this.input.toUpstreamError(error, "Daytona snapshot reconciliation failed.");
    }
  }

  private async advanceExclusive(releaseSha: string): Promise<SandboxSnapshotReconciliation> {
    let state = await this.loadState();
    if (state?.phase === "completed" && state.releaseSha === releaseSha) {
      this.assertCurrentContract(state, releaseSha);
      return this.completeAndClear(state);
    }
    if (state?.phase === "completed") {
      await this.input.ctx.storage.delete(SNAPSHOT_UPGRADE_STATE_KEY);
      state = null;
    }
    state ??= await this.initializeState(releaseSha);
    if (!state) {
      return this.currentOrAbsentResult();
    }
    this.assertCurrentContract(state, releaseSha);
    for (;;) {
      const next = await this.advancePhase(state);
      if (next === null) {
        return upgradingResult(state);
      }
      state = next;
      if (state.phase === "completed") {
        return this.completeAndClear(state);
      }
    }
  }

  private async completeAndClear(
    state: SnapshotUpgradeState,
  ): Promise<SandboxSnapshotReconciliation> {
    const result = completedResult(state);
    await this.input.ctx.storage.delete(SNAPSHOT_UPGRADE_STATE_KEY);
    if ((await this.input.ctx.storage.get(SNAPSHOT_UPGRADE_STATE_KEY)) !== undefined) {
      throw snapshotInvariant("Completed snapshot upgrade state could not be removed.");
    }
    return result;
  }

  private async initializeState(releaseSha: string): Promise<SnapshotUpgradeState | null> {
    const source = await this.input.provisioning.findExisting(this.input.client);
    if (!source || isDestroyed(source)) {
      return null;
    }
    if (this.input.provisioning.isDesired(source)) {
      return null;
    }
    const volume = await this.input.provisioning.ensureWorkspaceVolume(this.input.client);
    const upgradeId = await upgradeIdentity(
      this.input.sandboxName,
      source.id,
      volume.id,
      this.target,
    );
    const state = SnapshotUpgradeStateSchema.parse({
      archiveDigest: null,
      archiveSize: null,
      candidateId: null,
      chunkCount: null,
      needsTransfer:
        source.labels["workspaceVolumeId"] !== volume.id ||
        source.labels["workspaceVolumeName"] !== volume.name,
      nextChunk: 0,
      phase: "claimed",
      releaseSha,
      sandboxName: this.input.sandboxName,
      sourceId: source.id,
      sourceSnapshot: source.snapshot,
      targetSnapshot: this.target,
      treeDigest: null,
      upgradeId,
      volumeId: volume.id,
      volumeName: volume.name,
    });
    await this.storeState(state);
    return state;
  }

  private async currentOrAbsentResult(): Promise<SandboxSnapshotReconciliation> {
    const current = await this.input.provisioning.findExisting(this.input.client);
    if (!current || isDestroyed(current)) {
      return snapshotResult({
        sourceSnapshot: null,
        status: "absent",
        targetSnapshot: this.target,
      });
    }
    if (!this.input.provisioning.isDesired(current)) {
      throw snapshotInvariant("Snapshot upgrade state is absent for a noncurrent sandbox.");
    }
    return snapshotResult({
      sourceSnapshot: current.snapshot,
      status: "current",
      targetSnapshot: this.target,
    });
  }

  private async advancePhase(state: SnapshotUpgradeState): Promise<SnapshotUpgradeState | null> {
    switch (state.phase) {
      case "claimed":
        return this.prepareSource(state);
      case "source-prepared":
        return this.createCandidate(state);
      case "candidate-created":
        return this.verifyCandidate(state);
      case "candidate-verified":
        return this.retireSource(state);
      case "source-retired":
        return this.promoteCandidate(state);
      case "candidate-promoted":
        return this.switchDurableIdentity(state);
      case "switched":
        return this.deleteSource(state);
      case "completed":
        return state;
    }
  }

  private async prepareSource(state: SnapshotUpgradeState): Promise<SnapshotUpgradeState> {
    const source = await this.requireSource(state);
    await this.ensureStarted(source, "source");
    await this.input.killProcesses();
    const evidence = state.needsTransfer
      ? await this.executeJson(
          source.id,
          prepareWorkspaceArchiveCommand(state.upgradeId),
          ArchiveEvidenceSchema,
        )
      : await this.executeJson(source.id, digestWorkspaceCommand(), DigestEvidenceSchema);
    const next = SnapshotUpgradeStateSchema.parse({
      ...state,
      archiveDigest: "archiveDigest" in evidence ? evidence.archiveDigest : null,
      archiveSize: "archiveSize" in evidence ? evidence.archiveSize : null,
      chunkCount: "chunkCount" in evidence ? evidence.chunkCount : null,
      nextChunk: 0,
      phase: "source-prepared",
      treeDigest: evidence.treeDigest,
    });
    await this.storeState(next);
    return next;
  }

  private async createCandidate(state: SnapshotUpgradeState): Promise<SnapshotUpgradeState> {
    const candidate =
      (await this.findCandidate(state)) ?? (await this.createCandidateSandbox(state));
    this.assertCandidate(candidate, state);
    await this.ensureStarted(candidate, "candidate");
    const next = SnapshotUpgradeStateSchema.parse({
      ...state,
      candidateId: candidate.id,
      phase: "candidate-created",
    });
    await this.storeState(next);
    return next;
  }

  private async createCandidateSandbox(state: SnapshotUpgradeState): Promise<DaytonaSandbox> {
    try {
      return await this.input.client.createSandbox({
        autoArchiveInterval: AUTO_ARCHIVE_MIN,
        autoDeleteInterval: NEVER_AUTO_DELETE,
        autoStopInterval: DEFAULT_IDLE_STOP_MIN,
        labels: candidateSandboxLabels(candidateLabelInput(state)),
        name: candidateName(state),
        snapshot: state.targetSnapshot,
        target: this.input.env.DAYTONA_TARGET,
        user: "node",
        volumes: [
          {
            mountPath: WORKSPACE_MOUNT_PATH,
            subpath: this.input.sandboxName,
            volumeId: state.volumeId,
          },
        ],
      });
    } catch (error) {
      if (error instanceof DaytonaApiError && error.status === 409) {
        const existing = await this.findCandidate(state);
        if (existing) return existing;
      }
      throw error;
    }
  }

  private async findCandidate(state: SnapshotUpgradeState): Promise<DaytonaSandbox | null> {
    const matches = (
      await this.input.client.listSandboxesByLabels({
        app: "cheatcode",
        role: "candidate",
        sandboxOwner: state.sandboxName,
        upgradeId: state.upgradeId,
      })
    ).filter((sandbox) => !isDestroyed(sandbox));
    if (matches.length > 1) {
      throw snapshotInvariant("Multiple live Daytona snapshot candidates were found.");
    }
    const listed = matches[0];
    if (!listed) return null;
    const candidate = await this.input.client.getSandbox(listed.id);
    if (!candidate || isDestroyed(candidate)) return null;
    this.assertCandidate(candidate, state);
    return candidate;
  }

  private async verifyCandidate(state: SnapshotUpgradeState): Promise<SnapshotUpgradeState | null> {
    const candidate = await this.requireCandidate(state);
    await this.ensureStarted(candidate, "candidate");
    if (!state.needsTransfer) {
      return this.verifyMountedWorkspace(state, candidate);
    }
    const transfer = await this.transferNextChunk(state, candidate);
    if (!transfer) return null;
    if (transfer.nextChunk < requireNumber(state.chunkCount, "chunk count")) return null;
    return this.restoreTransferredWorkspace(transfer, candidate);
  }

  private async transferNextChunk(
    state: SnapshotUpgradeState,
    candidate: DaytonaSandbox,
  ): Promise<SnapshotUpgradeState | null> {
    const chunkCount = requireNumber(state.chunkCount, "chunk count");
    if (state.nextChunk >= chunkCount) return state;
    const source = await this.requireSource(state);
    await this.ensureStarted(source, "source");
    const sourcePath = transferChunkPath(state.upgradeId, state.nextChunk);
    let bytes: Uint8Array;
    try {
      bytes = await this.input.client.downloadFile(
        state.sourceId,
        sourcePath,
        SNAPSHOT_TRANSFER_CHUNK_BYTES,
      );
    } catch (error) {
      if (error instanceof DaytonaApiError && error.status === 404) {
        await this.resetPreparedSource(state);
        return null;
      }
      throw error;
    }
    const digest = await sha256Hex(bytes);
    await this.input.client.createFolder(candidate.id, transferChunksPath(state.upgradeId), "700");
    await this.input.client.uploadFile(candidate.id, sourcePath, bytes);
    await this.verifyTransferredChunk(candidate.id, sourcePath, bytes.byteLength, digest);
    const next = SnapshotUpgradeStateSchema.parse({ ...state, nextChunk: state.nextChunk + 1 });
    await this.storeState(next);
    return next;
  }

  private async verifyTransferredChunk(
    candidateId: string,
    path: string,
    size: number,
    digest: string,
  ): Promise<void> {
    const result = await this.input.client.execute(candidateId, {
      command: verifyTransferChunkCommand({ digest, path, size }),
      timeout: SNAPSHOT_EXEC_TIMEOUT_SECONDS,
    });
    const evidence = ChunkEvidenceSchema.safeParse(parseJson(result.result));
    if (result.exitCode === 0 && evidence.success && evidence.data.verified) return;
    if (result.exitCode === 4 && evidence.success && !evidence.data.verified) {
      throw new APIError(502, "upstream_sandbox_failed", "Daytona transfer chunk was corrupted", {
        retriable: true,
      });
    }
    throw snapshotInvariant("Daytona transfer chunk verification failed.", result.result);
  }

  private async restoreTransferredWorkspace(
    state: SnapshotUpgradeState,
    candidate: DaytonaSandbox,
  ): Promise<SnapshotUpgradeState | null> {
    const result = await this.input.client.execute(candidate.id, {
      command: verifyWorkspaceArchiveCommand({
        archiveDigest: requireString(state.archiveDigest, "archive digest"),
        archiveSize: requireNumber(state.archiveSize, "archive size"),
        chunkCount: requireNumber(state.chunkCount, "chunk count"),
        treeDigest: requireString(state.treeDigest, "tree digest"),
        upgradeId: state.upgradeId,
      }),
      timeout: SNAPSHOT_EXEC_TIMEOUT_SECONDS,
    });
    if (result.exitCode === 3 && RetryTransferSchema.safeParse(parseJson(result.result)).success) {
      const reset = SnapshotUpgradeStateSchema.parse({ ...state, nextChunk: 0 });
      await this.storeState(reset);
      return null;
    }
    const evidence = parseExecutedResult(result, ArchiveVerificationSchema, "workspace restore");
    if (
      evidence.archiveDigest !== state.archiveDigest ||
      evidence.treeDigest !== state.treeDigest
    ) {
      throw snapshotInvariant("Candidate workspace digest does not match the source.");
    }
    return this.markCandidateVerified(state);
  }

  private async verifyMountedWorkspace(
    state: SnapshotUpgradeState,
    candidate: DaytonaSandbox,
  ): Promise<SnapshotUpgradeState> {
    const evidence = await this.executeJson(
      candidate.id,
      digestWorkspaceCommand(),
      DigestEvidenceSchema,
    );
    if (evidence.treeDigest !== state.treeDigest) {
      throw snapshotInvariant("Mounted workspace changed while the release gate was closed.");
    }
    return this.markCandidateVerified(state);
  }

  private async markCandidateVerified(state: SnapshotUpgradeState): Promise<SnapshotUpgradeState> {
    const next = SnapshotUpgradeStateSchema.parse({ ...state, phase: "candidate-verified" });
    await this.storeState(next);
    return next;
  }

  private async retireSource(state: SnapshotUpgradeState): Promise<SnapshotUpgradeState> {
    const source = await this.input.client.getSandbox(state.sourceId);
    if (source && !isDestroyed(source)) {
      const expected = retiredSandboxLabels({
        sandbox: source,
        sandboxName: this.input.sandboxName,
        upgradeId: state.upgradeId,
      });
      if (!labelsEqual(source.labels, expected)) {
        this.input.provisioning.assertIdentity(source);
        await this.input.client.replaceSandboxLabels(source.id, expected);
        await this.assertLabels(source.id, expected, "retired source");
      }
    }
    const next = SnapshotUpgradeStateSchema.parse({ ...state, phase: "source-retired" });
    await this.storeState(next);
    return next;
  }

  private async promoteCandidate(state: SnapshotUpgradeState): Promise<SnapshotUpgradeState> {
    const candidateId = requireString(state.candidateId, "candidate id");
    const candidate = await this.input.client.getSandbox(candidateId);
    if (!candidate || isDestroyed(candidate)) {
      throw snapshotInvariant("Snapshot upgrade candidate disappeared.");
    }
    const canonical = canonicalSandboxLabels({
      sandboxName: this.input.sandboxName,
      snapshot: state.targetSnapshot,
      volumeId: state.volumeId,
      volumeName: state.volumeName,
    });
    const liveCanonical = (
      await this.input.client.listSandboxesByLabels({
        app: "cheatcode",
        sandboxId: this.input.sandboxName,
      })
    ).filter((sandbox) => !isDestroyed(sandbox));
    if (liveCanonical.some((sandbox) => sandbox.id !== candidate.id)) {
      throw snapshotInvariant("Another canonical Daytona sandbox appeared during promotion.");
    }
    const isAlreadyPromoted = isDesiredCanonicalSandbox(candidate, {
      sandboxName: this.input.sandboxName,
      snapshot: state.targetSnapshot,
      volumeId: state.volumeId,
      volumeName: state.volumeName,
    });
    if (!isAlreadyPromoted) {
      this.assertCandidate(candidate, state);
      await this.input.client.replaceSandboxLabels(candidate.id, canonical);
      await this.assertLabels(candidate.id, canonical, "promoted candidate");
    }
    const promoted = await this.requireDesiredCandidate(state);
    const next = SnapshotUpgradeStateSchema.parse({
      ...state,
      candidateId: promoted.id,
      phase: "candidate-promoted",
    });
    await this.storeState(next);
    return next;
  }

  private async switchDurableIdentity(state: SnapshotUpgradeState): Promise<SnapshotUpgradeState> {
    const candidateId = requireString(state.candidateId, "candidate id");
    const next = SnapshotUpgradeStateSchema.parse({ ...state, phase: "switched" });
    await this.input.ctx.storage.transaction(async (transaction) => {
      await transaction.put(DAYTONA_ID_KEY, candidateId);
      await transaction.put(SNAPSHOT_UPGRADE_STATE_KEY, next);
    });
    this.input.adoptSandboxId(candidateId);
    return next;
  }

  private async deleteSource(state: SnapshotUpgradeState): Promise<SnapshotUpgradeState> {
    const candidateId = requireString(state.candidateId, "candidate id");
    await this.input.client.deleteFilePath(candidateId, transferBasePath(state.upgradeId), true);
    const source = await this.input.client.getSandbox(state.sourceId);
    if (source && !isDestroyed(source)) {
      await this.input.client.deleteFilePath(source.id, transferBasePath(state.upgradeId), true);
      await this.input.client.deleteSandbox(source.id);
      await this.waitForDeletion(source.id);
    }
    const next = SnapshotUpgradeStateSchema.parse({ ...state, phase: "completed" });
    await this.storeState(next);
    return next;
  }

  private async waitForDeletion(sandboxId: string): Promise<void> {
    for (let attempt = 0; attempt < DELETE_VERIFY_ATTEMPTS; attempt += 1) {
      const current = await this.input.client.getSandbox(sandboxId);
      if (!current || isDestroyed(current)) return;
      await sleep(DELETE_VERIFY_DELAY_MS);
    }
    throw new APIError(504, "upstream_sandbox_failed", "Retired Daytona sandbox was not deleted", {
      retriable: true,
    });
  }

  private async resetPreparedSource(state: SnapshotUpgradeState): Promise<void> {
    const reset = SnapshotUpgradeStateSchema.parse({
      ...state,
      archiveDigest: null,
      archiveSize: null,
      chunkCount: null,
      nextChunk: 0,
      phase: "claimed",
      treeDigest: null,
    });
    await this.storeState(reset);
  }

  private async requireSource(state: SnapshotUpgradeState): Promise<DaytonaSandbox> {
    const source = await this.input.client.getSandbox(state.sourceId);
    if (!source || isDestroyed(source)) {
      throw snapshotInvariant("Source Daytona sandbox disappeared before promotion.");
    }
    this.input.provisioning.assertIdentity(source);
    return source;
  }

  private async requireCandidate(state: SnapshotUpgradeState): Promise<DaytonaSandbox> {
    const id = requireString(state.candidateId, "candidate id");
    const candidate = await this.input.client.getSandbox(id);
    if (!candidate || isDestroyed(candidate)) {
      throw snapshotInvariant("Snapshot upgrade candidate disappeared.");
    }
    this.assertCandidate(candidate, state);
    return candidate;
  }

  private async requireDesiredCandidate(state: SnapshotUpgradeState): Promise<DaytonaSandbox> {
    const id = requireString(state.candidateId, "candidate id");
    const candidate = await this.input.client.getSandbox(id);
    if (
      !candidate ||
      isDestroyed(candidate) ||
      !isDesiredCanonicalSandbox(candidate, {
        sandboxName: this.input.sandboxName,
        snapshot: state.targetSnapshot,
        volumeId: state.volumeId,
        volumeName: state.volumeName,
      })
    ) {
      throw snapshotInvariant("Promoted Daytona sandbox identity did not converge.");
    }
    return candidate;
  }

  private async ensureStarted(sandbox: DaytonaSandbox, label: string): Promise<void> {
    if (!(await this.input.provisioning.ensureStarted(this.input.client, sandbox))) {
      throw snapshotInvariant(`Snapshot upgrade ${label} sandbox disappeared.`);
    }
  }

  private assertCandidate(candidate: DaytonaSandbox, state: SnapshotUpgradeState): void {
    if (!isUpgradeCandidate(candidate, candidateLabelInput(state))) {
      throw snapshotInvariant("Daytona snapshot candidate identity mismatch.");
    }
  }

  private async assertLabels(
    id: string,
    expected: Record<string, string>,
    label: string,
  ): Promise<void> {
    const current = await this.input.client.getSandbox(id);
    if (!current || isDestroyed(current) || !labelsEqual(current.labels, expected)) {
      throw snapshotInvariant(`Daytona ${label} labels did not converge.`);
    }
  }

  private async executeJson<T extends z.ZodType>(
    sandboxId: string,
    command: string,
    schema: T,
  ): Promise<z.infer<T>> {
    const result = await this.input.client.execute(sandboxId, {
      command,
      timeout: SNAPSHOT_EXEC_TIMEOUT_SECONDS,
    });
    return parseExecutedResult(result, schema, "snapshot evidence");
  }

  private assertCurrentContract(state: SnapshotUpgradeState, releaseSha: string): void {
    if (
      state.releaseSha !== releaseSha ||
      state.sandboxName !== this.input.sandboxName ||
      state.targetSnapshot !== this.target ||
      state.volumeName !== this.input.env.DAYTONA_WORKSPACE_VOLUME
    ) {
      throw snapshotInvariant("Pending snapshot upgrade belongs to another release contract.");
    }
  }

  private async loadState(): Promise<SnapshotUpgradeState | null> {
    const value = await this.input.ctx.storage.get(SNAPSHOT_UPGRADE_STATE_KEY);
    return value === undefined ? null : SnapshotUpgradeStateSchema.parse(value);
  }

  private storeState(state: SnapshotUpgradeState): Promise<void> {
    return this.input.ctx.storage.put(
      SNAPSHOT_UPGRADE_STATE_KEY,
      SnapshotUpgradeStateSchema.parse(state),
    );
  }

  private get target(): string {
    return this.input.env.DAYTONA_SANDBOX_SNAPSHOT;
  }
}

function parseExecutedResult<T extends z.ZodType>(
  result: { exitCode: number; result?: string | null | undefined },
  schema: T,
  label: string,
): z.infer<T> {
  if (result.exitCode !== 0) {
    throw snapshotInvariant(`Daytona ${label} command failed.`, result.result);
  }
  const parsed = schema.safeParse(parseJson(result.result));
  if (!parsed.success) {
    throw snapshotInvariant(`Daytona ${label} was invalid.`);
  }
  return parsed.data;
}

function snapshotResult(input: {
  sourceSnapshot: string | null;
  status: "absent" | "current";
  targetSnapshot: string;
}): SandboxSnapshotReconciliation {
  return {
    complete: true,
    sourceSnapshot: input.sourceSnapshot,
    status: input.status,
    targetSnapshot: input.targetSnapshot,
    upgradeId: null,
    workspaceDigest: null,
  };
}

function upgradingResult(state: SnapshotUpgradeState): SandboxSnapshotReconciliation {
  return {
    complete: false,
    sourceSnapshot: state.sourceSnapshot,
    status: "upgrading",
    targetSnapshot: state.targetSnapshot,
    upgradeId: state.upgradeId,
    workspaceDigest: state.treeDigest,
  };
}

function completedResult(state: SnapshotUpgradeState): SandboxSnapshotReconciliation {
  return {
    complete: true,
    sourceSnapshot: state.sourceSnapshot,
    status: "upgraded",
    targetSnapshot: state.targetSnapshot,
    upgradeId: state.upgradeId,
    workspaceDigest: requireString(state.treeDigest, "tree digest"),
  };
}

function candidateLabelInput(state: SnapshotUpgradeState) {
  return {
    sandboxName: state.sandboxName,
    snapshot: state.targetSnapshot,
    upgradeId: state.upgradeId,
    volumeId: state.volumeId,
    volumeName: state.volumeName,
  };
}

function candidateName(state: SnapshotUpgradeState): string {
  return `cheatcode-upgrade-${state.upgradeId}`;
}

function transferBasePath(upgradeId: string): string {
  return `/tmp/cheatcode-snapshot-upgrade/${upgradeId}`;
}

function transferChunksPath(upgradeId: string): string {
  return `${transferBasePath(upgradeId)}/chunks`;
}

function transferChunkPath(upgradeId: string, index: number): string {
  return `${transferChunksPath(upgradeId)}/chunk-${String(index).padStart(12, "0")}`;
}

async function upgradeIdentity(
  sandboxName: string,
  sourceId: string,
  volumeId: string,
  targetSnapshot: string,
): Promise<string> {
  const digest = await sha256Hex(JSON.stringify([sandboxName, sourceId, targetSnapshot, volumeId]));
  return digest.slice(0, 32);
}

async function sha256Hex(value: string | Uint8Array): Promise<string> {
  const source = typeof value === "string" ? new TextEncoder().encode(value) : value;
  const bytes = new Uint8Array(source.byteLength);
  bytes.set(source);
  const digest = await crypto.subtle.digest("SHA-256", bytes.buffer);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function labelsEqual(actual: Record<string, string>, expected: Record<string, string>): boolean {
  const actualEntries = Object.entries(actual).sort(([left], [right]) => left.localeCompare(right));
  const expectedEntries = Object.entries(expected).sort(([left], [right]) =>
    left.localeCompare(right),
  );
  return JSON.stringify(actualEntries) === JSON.stringify(expectedEntries);
}

function parseJson(value: string | null | undefined): unknown {
  try {
    return JSON.parse(value ?? "") as unknown;
  } catch {
    return null;
  }
}

function requireString(value: string | null, label: string): string {
  if (!value) throw snapshotInvariant(`Snapshot upgrade ${label} is absent.`);
  return value;
}

function requireNumber(value: number | null, label: string): number {
  if (value === null) throw snapshotInvariant(`Snapshot upgrade ${label} is absent.`);
  return value;
}

function snapshotInvariant(message: string, output?: string | null): APIError {
  return new APIError(409, "conflict_state_invalid", message, {
    ...(output ? { details: { output: output.slice(-1_000) } } : {}),
    retriable: false,
  });
}
