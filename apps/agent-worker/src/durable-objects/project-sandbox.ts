import { ProjectSandboxContent } from "./project-sandbox-content";
import { type LeaseMethod, leaseKind, workspaceScope } from "./project-sandbox-lease-policy";

type MethodArgs<Method extends LeaseMethod> = ProjectSandboxContent[Method] extends (
  ...args: infer Args
) => unknown
  ? Args
  : never;

/**
 * Public Durable Object facade. Every operational RPC takes its table-selected
 * in-memory lease before the first await so account deletion can drain safely.
 */
// biome-ignore format: Keep the explicit Durable Object RPC facade as an auditable one-line policy map.
export class ProjectSandbox extends ProjectSandboxContent {
  public override registerOwner(...args: MethodArgs<"registerOwner">) { return this.withLease("registerOwner", args[0], () => super.registerOwner(...args)); }
  public override setQuotaPeriod(...args: MethodArgs<"setQuotaPeriod">) { return this.withLease("setQuotaPeriod", args[0], () => super.setQuotaPeriod(...args)); }
  public override beginRun(...args: MethodArgs<"beginRun">) { return this.withLease("beginRun", args[0], () => super.beginRun(...args)); }
  public override renewRun(...args: MethodArgs<"renewRun">) { return this.withLease("renewRun", args[0], () => super.renewRun(...args)); }
  public override endRun(...args: MethodArgs<"endRun">) { return this.withLease("endRun", args[0], () => super.endRun(...args)); }
  public override alarm(...args: MethodArgs<"alarm">) { return this.withLease("alarm", undefined, () => super.alarm(...args)); }
  public override runtimeSandboxId(...args: MethodArgs<"runtimeSandboxId">) { return this.withLease("runtimeSandboxId", undefined, () => super.runtimeSandboxId(...args)); }
  public override existingDaytonaId(...args: MethodArgs<"existingDaytonaId">) { return this.withLease("existingDaytonaId", undefined, () => super.existingDaytonaId(...args)); }
  public override sandboxRuntimeState(...args: MethodArgs<"sandboxRuntimeState">) { return this.withLease("sandboxRuntimeState", undefined, () => super.sandboxRuntimeState(...args)); }
  public override ensureReady(...args: MethodArgs<"ensureReady">) { return this.withLease("ensureReady", undefined, () => super.ensureReady(...args)); }
  public override getStatus(...args: MethodArgs<"getStatus">) { return this.withLease("getStatus", undefined, () => super.getStatus(...args)); }
  public override runCode(...args: MethodArgs<"runCode">) { return this.withLease("runCode", args[0], () => super.runCode(...args)); }
  public override exec(...args: MethodArgs<"exec">) { return this.withLease("exec", args[0], () => super.exec(...args)); }
  public override startProcess(...args: MethodArgs<"startProcess">) { return this.withLease("startProcess", args[0], () => super.startProcess(...args)); }
  public override allocateProjectPort(...args: MethodArgs<"allocateProjectPort">) { return this.withLease("allocateProjectPort", args[0], () => super.allocateProjectPort(...args)); }
  public override allocateProcessPort(...args: MethodArgs<"allocateProcessPort">) { return this.withLease("allocateProcessPort", args[0], () => super.allocateProcessPort(...args)); }
  public override killAllProcesses(...args: MethodArgs<"killAllProcesses">) { return this.withLease("killAllProcesses", undefined, () => super.killAllProcesses(...args)); }
  public override killProcess(...args: MethodArgs<"killProcess">) { return this.withLease("killProcess", args[0], () => super.killProcess(...args)); }
  public override readDevServerLogs(...args: MethodArgs<"readDevServerLogs">) { return this.withLease("readDevServerLogs", args[0], () => super.readDevServerLogs(...args)); }
  public override downloadProjectArchive(...args: MethodArgs<"downloadProjectArchive">) { return this.withActiveProjectWorkspaceStreamingOperation(workspaceScope("downloadProjectArchive", args[0]), (release) => super.downloadProjectArchiveForRpc(args[0], release)); }
  public override readFile(...args: MethodArgs<"readFile">) { return this.withLease("readFile", args[0], () => super.readFile(...args)); }
  public override listUploadedFiles(...args: MethodArgs<"listUploadedFiles">) { return this.withLease("listUploadedFiles", undefined, () => super.listUploadedFiles(...args)); }
  public override uploadProjectFile(...args: MethodArgs<"uploadProjectFile">) { return this.withLease("uploadProjectFile", args[0], () => super.uploadProjectFile(...args)); }
  public override restoreUploadedFiles(...args: MethodArgs<"restoreUploadedFiles">) { return this.withLease("restoreUploadedFiles", args[0], () => super.restoreUploadedFiles(...args)); }
  public override writeFile(...args: MethodArgs<"writeFile">) { return this.withLease("writeFile", args[0], () => super.writeFile(...args)); }
  public override listFiles(...args: MethodArgs<"listFiles">) { return this.withLease("listFiles", args[0], () => super.listFiles(...args)); }
  public override searchFiles(...args: MethodArgs<"searchFiles">) { return this.withLease("searchFiles", args[0], () => super.searchFiles(...args)); }
  public override deleteFile(...args: MethodArgs<"deleteFile">) { return this.withLease("deleteFile", args[0], () => super.deleteFile(...args)); }
  public override getSignedPreviewUrl(...args: MethodArgs<"getSignedPreviewUrl">) { return this.withLease("getSignedPreviewUrl", args[0], () => super.getSignedPreviewUrl(...args)); }
  public override exposeBrowserTakeover(...args: MethodArgs<"exposeBrowserTakeover">) { return this.withLease("exposeBrowserTakeover", args[0], () => super.exposeBrowserTakeover(...args)); }
  public override stopBrowserTakeover(...args: MethodArgs<"stopBrowserTakeover">) { return this.withLease("stopBrowserTakeover", args[0], () => super.stopBrowserTakeover(...args)); }
  public override exposeCodeServer(...args: MethodArgs<"exposeCodeServer">) { return this.withLease("exposeCodeServer", args[0], () => super.exposeCodeServer(...args)); }
  public override wakePreview(...args: MethodArgs<"wakePreview">) { return this.withLease("wakePreview", args[0], () => super.wakePreview(...args)); }
  public override projectPreviewStatus(...args: MethodArgs<"projectPreviewStatus">) { return this.withLease("projectPreviewStatus", args[0], () => super.projectPreviewStatus(...args)); }
  public override cleanupProjectWorkspace(...args: MethodArgs<"cleanupProjectWorkspace">) { return this.withLease("cleanupProjectWorkspace", args[0], () => super.cleanupProjectWorkspace(...args)); }

  private withLease<Result>(
    method: Exclude<LeaseMethod, "downloadProjectArchive">,
    input: unknown,
    operation: () => Promise<Result>,
  ): Promise<Result>;
  private withLease(
    method: Exclude<LeaseMethod, "downloadProjectArchive">,
    input: unknown,
    operation: () => Promise<unknown>,
  ): Promise<unknown> {
    const kind = leaseKind(method);
    if (kind === "owner-registration") {
      if (typeof input !== "string") throw new TypeError("Expected string RPC argument");
      return this.withActiveOwnerRegistration(input, operation);
    }
    if (kind === "cleanup-signal") {
      // The signal wrapper is void-typed; capture the value so the overload's
      // Promise<Result> contract holds if a signal method ever returns one.
      let result: unknown;
      return this.withActiveSandboxCleanupSignal(async () => {
        result = await operation();
      }).then(() => result);
    }
    if (kind === "shared-workspace") {
      return this.withActiveSharedWorkspaceMutation(operation);
    }
    if (kind === "project-cleanup") {
      return this.withActiveProjectWorkspaceCleanup(operation);
    }
    if (kind === "workspace") {
      return this.withActiveProjectWorkspaceOperation(workspaceScope(method, input), operation);
    }
    return this.withActiveSandboxOperation(operation);
  }
}
