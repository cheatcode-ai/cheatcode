import { DurableObject } from "cloudflare:workers";
import type {
  SandboxCompareAndSwapFileResult,
  SandboxDeleteFileResult,
  SandboxExecResult,
  SandboxKillProcessResult,
  SandboxListFilesResult,
  SandboxProcessResult,
  SandboxReadFileResult,
  SandboxRunCodeResult,
  SandboxSearchFilesResult,
  SandboxWriteFileResult,
} from "@cheatcode/sandbox-contracts";
import type {
  ProjectFile,
  ProjectFileUploadResponse,
  SandboxConsoleSnapshot,
} from "@cheatcode/types/api";
import { type ContentOps, createContentOps } from "./project-sandbox-content";
import {
  createGeneratedOutputOps,
  type GeneratedOutputOps,
} from "./project-sandbox-generated-outputs";
import { type LeaseMethod, leaseKind, workspaceScope } from "./project-sandbox-lease-policy";
import { createLifecycleOps, type LifecycleOps } from "./project-sandbox-lifecycle";
import type { ProjectSandboxEnv } from "./project-sandbox-lifecycle-support";
import {
  type CoordinatedProcessOps,
  createProcessOps,
  type ProcessOps,
  type ProjectSandboxStatus,
} from "./project-sandbox-processes";
import { createFileOps, type FileOps } from "./project-sandbox-project-files";
import type {
  ProjectAllocatePortInput,
  ProjectAllocateProcessPortInput,
  ProjectArchiveInput,
  ProjectBrowserTakeoverInput,
  ProjectBrowserTakeoverResult,
  ProjectBrowserTakeoverStopInput,
  ProjectCleanupWorkspaceInput,
  ProjectCodeServerInput,
  ProjectCompareAndSwapFileInput,
  ProjectDeleteFileInput,
  ProjectExecInput,
  ProjectKillProcessInput,
  ProjectListFilesInput,
  ProjectListUploadedFilesInput,
  ProjectPreviewStatusInput,
  ProjectReadDevServerLogsInput,
  ProjectReadFileInput,
  ProjectRestoreGeneratedOutputInput,
  ProjectRestoreUploadedFilesInput,
  ProjectRunCodeInput,
  ProjectSandboxRuntimeState,
  ProjectSearchFilesInput,
  ProjectSignedPreviewUrlInput,
  ProjectStartProcessInput,
  ProjectUploadFileInput,
  ProjectWakePreviewInput,
  ProjectWakePreviewResult,
  ProjectWriteFileInput,
} from "./project-sandbox-runtime";
import { createSandboxRuntime, type SandboxRuntime } from "./project-sandbox-runtime-handle";

type ProjectSandboxOperations = LifecycleOps &
  ProcessOps &
  FileOps &
  ContentOps &
  GeneratedOutputOps;

/**
 * Public Durable Object facade. The policy table is interpreted only here;
 * collaborators expose raw operations and request coordinated nested calls
 * through callbacks built in this constructor.
 */
export class ProjectSandbox extends DurableObject<ProjectSandboxEnv> {
  private readonly operations: ProjectSandboxOperations;
  private readonly runtime: SandboxRuntime;

  public constructor(ctx: DurableObjectState, env: ProjectSandboxEnv) {
    super(ctx, env);
    this.runtime = createSandboxRuntime(ctx, env);
    const lifecycle = createLifecycleOps(this.runtime);
    // TDZ invariant: collaborator factories must not invoke coordinated ops during construction.
    let process: ProcessOps;
    const coordinated = this.coordinatedProcessOps(() => process);
    process = createProcessOps(this.runtime, coordinated);
    const files = createFileOps(this.runtime);
    const generatedOutputs = createGeneratedOutputOps(this.runtime);
    const content = createContentOps(this.runtime, {
      coordinatedProcess: coordinated,
      deleteUploadedFileMetadata: files.deleteUploadedFileMetadata,
      process,
      sandboxRuntimeState: () =>
        this.withLease("sandboxRuntimeState", undefined, lifecycle.sandboxRuntimeState),
    });
    this.operations = { ...lifecycle, ...process, ...files, ...content, ...generatedOutputs };
  }

  // Account deletion fences and drains active operations; taking a lease would deadlock.
  public deleteAccountState(): Promise<void> {
    return this.operations.deleteAccountState();
  }

  public registerOwner(userId: string, sandboxName?: string): Promise<void> {
    return this.withLease("registerOwner", userId, () =>
      this.operations.registerOwner(userId, sandboxName),
    );
  }

  public setQuotaPeriod(periodEndIso: string): Promise<void> {
    return this.withLease("setQuotaPeriod", periodEndIso, () =>
      this.operations.setQuotaPeriod(periodEndIso),
    );
  }

  public beginRun(runId: string): Promise<void> {
    return this.withLease("beginRun", runId, () => this.operations.beginRun(runId));
  }

  public renewRun(runId: string): Promise<void> {
    return this.withLease("renewRun", runId, () => this.operations.renewRun(runId));
  }

  public endRun(runId: string): Promise<void> {
    return this.withLease("endRun", runId, () => this.operations.endRun(runId));
  }

  public override alarm(): Promise<void> {
    return this.withLease("alarm", undefined, this.operations.alarm);
  }

  public runtimeSandboxId(): Promise<string> {
    return this.withLease("runtimeSandboxId", undefined, this.operations.runtimeSandboxId);
  }

  public existingDaytonaId(): Promise<string | null> {
    return this.withLease("existingDaytonaId", undefined, this.operations.existingDaytonaId);
  }

  public sandboxRuntimeState(): Promise<ProjectSandboxRuntimeState> {
    return this.withLease("sandboxRuntimeState", undefined, this.operations.sandboxRuntimeState);
  }

  public ensureReady(): Promise<ProjectSandboxStatus> {
    return this.withLease("ensureReady", undefined, this.operations.ensureReady);
  }

  public getStatus(): Promise<ProjectSandboxStatus> {
    return this.withLease("getStatus", undefined, this.operations.getStatus);
  }

  public runCode(input: ProjectRunCodeInput): Promise<SandboxRunCodeResult> {
    return this.withLease("runCode", input, () => this.operations.runCode(input));
  }

  public exec(input: ProjectExecInput): Promise<SandboxExecResult> {
    return this.withLease("exec", input, () => this.operations.exec(input));
  }

  public startProcess(input: ProjectStartProcessInput): Promise<SandboxProcessResult> {
    return this.withLease("startProcess", input, () => this.operations.startProcess(input));
  }

  public allocateProjectPort(input: ProjectAllocatePortInput): Promise<number> {
    return this.withLease("allocateProjectPort", input, () =>
      this.operations.allocateProjectPort(input),
    );
  }

  public allocateProcessPort(input: ProjectAllocateProcessPortInput): Promise<number> {
    return this.withLease("allocateProcessPort", input, () =>
      this.operations.allocateProcessPort(input),
    );
  }

  public killAllProcesses(): Promise<number> {
    return this.withLease("killAllProcesses", undefined, this.operations.killAllProcesses);
  }

  public killProcess(input: ProjectKillProcessInput): Promise<SandboxKillProcessResult> {
    return this.withLease("killProcess", input, () => this.operations.killProcess(input));
  }

  public readDevServerLogs(input: ProjectReadDevServerLogsInput): Promise<SandboxConsoleSnapshot> {
    return this.withLease("readDevServerLogs", input, () =>
      this.operations.readDevServerLogs(input),
    );
  }

  public downloadProjectArchive(input: ProjectArchiveInput): Promise<Response> {
    return this.runtime.lease.withStreamingOperation(
      workspaceScope("downloadProjectArchive", input),
      (release) => this.operations.downloadProjectArchive(input, release),
    );
  }

  public readFile(input: ProjectReadFileInput): Promise<SandboxReadFileResult> {
    return this.withLease("readFile", input, () => this.operations.readFile(input));
  }

  public listUploadedFiles(
    input: ProjectListUploadedFilesInput,
  ): Promise<{ files: ProjectFile[] }> {
    return this.withLease("listUploadedFiles", input, () =>
      this.operations.listUploadedFiles(input),
    );
  }

  public uploadProjectFile(input: ProjectUploadFileInput): Promise<ProjectFileUploadResponse> {
    return this.withLease("uploadProjectFile", input, () =>
      this.operations.uploadProjectFile(input),
    );
  }

  public restoreUploadedFiles(
    input: ProjectRestoreUploadedFilesInput,
  ): Promise<{ restoredFileCount: number }> {
    return this.withLease("restoreUploadedFiles", input, () =>
      this.operations.restoreUploadedFiles(input),
    );
  }

  public restoreGeneratedOutput(
    input: ProjectRestoreGeneratedOutputInput,
  ): Promise<SandboxWriteFileResult> {
    return this.withLease("restoreGeneratedOutput", input, () =>
      this.operations.restoreGeneratedOutput(input),
    );
  }

  public writeFile(input: ProjectWriteFileInput): Promise<SandboxWriteFileResult> {
    return this.withLease("writeFile", input, () => this.operations.writeFile(input));
  }

  public compareAndSwapFile(
    input: ProjectCompareAndSwapFileInput,
  ): Promise<SandboxCompareAndSwapFileResult> {
    return this.withLease("compareAndSwapFile", input, () =>
      this.operations.compareAndSwapFile(input),
    );
  }

  public listFiles(input: ProjectListFilesInput): Promise<SandboxListFilesResult> {
    return this.withLease("listFiles", input, () => this.operations.listFiles(input));
  }

  public searchFiles(input: ProjectSearchFilesInput): Promise<SandboxSearchFilesResult> {
    return this.withLease("searchFiles", input, () => this.operations.searchFiles(input));
  }

  public deleteFile(input: ProjectDeleteFileInput): Promise<SandboxDeleteFileResult> {
    return this.withLease("deleteFile", input, () => this.operations.deleteFile(input));
  }

  public getSignedPreviewUrl(
    input: ProjectSignedPreviewUrlInput,
  ): Promise<{ token: string; url: string }> {
    return this.withLease("getSignedPreviewUrl", input, () =>
      this.operations.getSignedPreviewUrl(input),
    );
  }

  public exposeBrowserTakeover(
    input: ProjectBrowserTakeoverInput,
  ): Promise<ProjectBrowserTakeoverResult> {
    return this.withLease("exposeBrowserTakeover", input, () =>
      this.operations.exposeBrowserTakeover(input),
    );
  }

  public stopBrowserTakeover(input: ProjectBrowserTakeoverStopInput): Promise<void> {
    return this.withLease("stopBrowserTakeover", input, () =>
      this.operations.stopBrowserTakeover(input),
    );
  }

  public exposeCodeServer(input: ProjectCodeServerInput): Promise<{
    expiresAt: string;
    port: number;
    url: string;
    workspacePath: string;
  }> {
    return this.withLease("exposeCodeServer", input, () => this.operations.exposeCodeServer(input));
  }

  public wakePreview(input: ProjectWakePreviewInput): Promise<ProjectWakePreviewResult> {
    return this.withLease("wakePreview", input, () => this.operations.wakePreview(input));
  }

  public projectPreviewStatus(
    input: ProjectPreviewStatusInput,
  ): Promise<{ running: boolean; state: string }> {
    return this.withLease("projectPreviewStatus", input, () =>
      this.operations.projectPreviewStatus(input),
    );
  }

  public cleanupProjectWorkspace(input: ProjectCleanupWorkspaceInput): Promise<void> {
    return this.withLease("cleanupProjectWorkspace", input, () =>
      this.operations.cleanupProjectWorkspace(input),
    );
  }

  private coordinatedProcessOps(process: () => ProcessOps): CoordinatedProcessOps {
    return {
      allocateProcessPort: (input) =>
        this.withLease("allocateProcessPort", input, () => process().allocateProcessPort(input)),
      ensureReady: () => this.withLease("ensureReady", undefined, () => process().ensureReady()),
      exec: (input) => this.withLease("exec", input, () => process().exec(input)),
      killProcess: (input) =>
        this.withLease("killProcess", input, () => process().killProcess(input)),
      runCode: (input) => this.withLease("runCode", input, () => process().runCode(input)),
      startProcess: (input) =>
        this.withLease("startProcess", input, () => process().startProcess(input)),
    };
  }

  private withLease<Result>(
    method: Exclude<LeaseMethod, "deleteAccountState" | "downloadProjectArchive">,
    input: unknown,
    operation: () => Promise<Result>,
  ): Promise<Result>;
  private withLease(
    method: Exclude<LeaseMethod, "deleteAccountState" | "downloadProjectArchive">,
    input: unknown,
    operation: () => Promise<unknown>,
  ): Promise<unknown> {
    const kind = leaseKind(method);
    if (kind === "account-deletion-control" || kind === "streaming") {
      throw new TypeError(`Lease kind "${kind}" must not route through withLease`);
    }
    if (kind === "owner-registration") {
      if (typeof input !== "string") throw new TypeError("Expected string RPC argument");
      return this.runtime.lease.withOwnerRegistration(input, operation);
    }
    if (kind === "cleanup-signal") {
      let result: unknown;
      return this.runtime.lease
        .withCleanupSignal(async () => {
          result = await operation();
          return result;
        })
        .then(() => result);
    }
    if (kind === "shared-workspace") {
      return this.runtime.lease.withSharedWorkspaceMutation(operation);
    }
    if (kind === "project-cleanup") {
      return this.runtime.lease.withProjectCleanup(operation);
    }
    if (kind === "workspace") {
      return this.runtime.lease.withWorkspaceOperation(workspaceScope(method, input), operation);
    }
    return this.runtime.lease.withSandboxOperation(operation);
  }
}
