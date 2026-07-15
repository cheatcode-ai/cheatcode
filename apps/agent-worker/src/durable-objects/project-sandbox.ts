import { ProjectSandboxContent } from "./project-sandbox-content";

/**
 * Public Durable Object facade. Every operational RPC takes an in-memory lease
 * before its first await so account deletion can fence new work and drain old
 * work without holding blockConcurrencyWhile across Daytona requests.
 */
export class ProjectSandbox extends ProjectSandboxContent {
  public override registerOwner(
    ...args: Parameters<ProjectSandboxContent["registerOwner"]>
  ): ReturnType<ProjectSandboxContent["registerOwner"]> {
    return this.withActiveSandboxOperation(() => super.registerOwner(...args));
  }

  public override setQuotaPeriod(
    ...args: Parameters<ProjectSandboxContent["setQuotaPeriod"]>
  ): ReturnType<ProjectSandboxContent["setQuotaPeriod"]> {
    return this.withActiveSandboxOperation(() => super.setQuotaPeriod(...args));
  }

  public override beginRun(
    ...args: Parameters<ProjectSandboxContent["beginRun"]>
  ): ReturnType<ProjectSandboxContent["beginRun"]> {
    return this.withActiveSandboxOperation(() => super.beginRun(...args));
  }

  public override renewRun(
    ...args: Parameters<ProjectSandboxContent["renewRun"]>
  ): ReturnType<ProjectSandboxContent["renewRun"]> {
    return this.withActiveSandboxCleanupSignal(() => super.renewRun(...args));
  }

  public override endRun(
    ...args: Parameters<ProjectSandboxContent["endRun"]>
  ): ReturnType<ProjectSandboxContent["endRun"]> {
    return this.withActiveSandboxCleanupSignal(() => super.endRun(...args));
  }

  public override alarm(
    ...args: Parameters<ProjectSandboxContent["alarm"]>
  ): ReturnType<ProjectSandboxContent["alarm"]> {
    return this.withActiveSandboxCleanupSignal(() => super.alarm(...args));
  }

  public override runtimeSandboxId(
    ...args: Parameters<ProjectSandboxContent["runtimeSandboxId"]>
  ): ReturnType<ProjectSandboxContent["runtimeSandboxId"]> {
    return this.withActiveSandboxOperation(() => super.runtimeSandboxId(...args));
  }

  public override existingDaytonaId(
    ...args: Parameters<ProjectSandboxContent["existingDaytonaId"]>
  ): ReturnType<ProjectSandboxContent["existingDaytonaId"]> {
    return this.withActiveSandboxOperation(() => super.existingDaytonaId(...args));
  }

  public override sandboxRuntimeState(
    ...args: Parameters<ProjectSandboxContent["sandboxRuntimeState"]>
  ): ReturnType<ProjectSandboxContent["sandboxRuntimeState"]> {
    return this.withActiveSandboxOperation(() => super.sandboxRuntimeState(...args));
  }

  public override ensureReady(
    ...args: Parameters<ProjectSandboxContent["ensureReady"]>
  ): ReturnType<ProjectSandboxContent["ensureReady"]> {
    return this.withActiveSandboxOperation(() => super.ensureReady(...args));
  }

  public override getStatus(
    ...args: Parameters<ProjectSandboxContent["getStatus"]>
  ): ReturnType<ProjectSandboxContent["getStatus"]> {
    return this.withActiveSandboxOperation(() => super.getStatus(...args));
  }

  public override runCode(
    ...args: Parameters<ProjectSandboxContent["runCode"]>
  ): ReturnType<ProjectSandboxContent["runCode"]> {
    return this.withActiveSandboxOperation(() => super.runCode(...args));
  }

  public override exec(
    ...args: Parameters<ProjectSandboxContent["exec"]>
  ): ReturnType<ProjectSandboxContent["exec"]> {
    return this.withActiveSandboxOperation(() => super.exec(...args));
  }

  public override startProcess(
    ...args: Parameters<ProjectSandboxContent["startProcess"]>
  ): ReturnType<ProjectSandboxContent["startProcess"]> {
    return this.withActiveSandboxOperation(() => super.startProcess(...args));
  }

  public override allocateProjectPort(
    ...args: Parameters<ProjectSandboxContent["allocateProjectPort"]>
  ): ReturnType<ProjectSandboxContent["allocateProjectPort"]> {
    return this.withActiveSandboxOperation(() => super.allocateProjectPort(...args));
  }

  public override allocateProcessPort(
    ...args: Parameters<ProjectSandboxContent["allocateProcessPort"]>
  ): ReturnType<ProjectSandboxContent["allocateProcessPort"]> {
    return this.withActiveSandboxOperation(() => super.allocateProcessPort(...args));
  }

  public override killAllProcesses(
    ...args: Parameters<ProjectSandboxContent["killAllProcesses"]>
  ): ReturnType<ProjectSandboxContent["killAllProcesses"]> {
    return this.withActiveSandboxOperation(() => super.killAllProcesses(...args));
  }

  public override killProcess(
    ...args: Parameters<ProjectSandboxContent["killProcess"]>
  ): ReturnType<ProjectSandboxContent["killProcess"]> {
    return this.withActiveSandboxOperation(() => super.killProcess(...args));
  }

  public override readDevServerLogs(
    ...args: Parameters<ProjectSandboxContent["readDevServerLogs"]>
  ): ReturnType<ProjectSandboxContent["readDevServerLogs"]> {
    return this.withActiveSandboxOperation(() => super.readDevServerLogs(...args));
  }

  public override downloadProjectArchive(
    ...args: Parameters<ProjectSandboxContent["downloadProjectArchive"]>
  ): ReturnType<ProjectSandboxContent["downloadProjectArchive"]> {
    return this.withActiveSandboxStreamingOperation((release) =>
      super.downloadProjectArchiveForRpc(args[0], release),
    );
  }

  public override readFile(
    ...args: Parameters<ProjectSandboxContent["readFile"]>
  ): ReturnType<ProjectSandboxContent["readFile"]> {
    return this.withActiveSandboxOperation(() => super.readFile(...args));
  }

  public override previewFile(
    ...args: Parameters<ProjectSandboxContent["previewFile"]>
  ): ReturnType<ProjectSandboxContent["previewFile"]> {
    return this.withActiveSandboxOperation(() => super.previewFile(...args));
  }

  public override writeFile(
    ...args: Parameters<ProjectSandboxContent["writeFile"]>
  ): ReturnType<ProjectSandboxContent["writeFile"]> {
    return this.withActiveSandboxOperation(() => super.writeFile(...args));
  }

  public override listFiles(
    ...args: Parameters<ProjectSandboxContent["listFiles"]>
  ): ReturnType<ProjectSandboxContent["listFiles"]> {
    return this.withActiveSandboxOperation(() => super.listFiles(...args));
  }

  public override searchFiles(
    ...args: Parameters<ProjectSandboxContent["searchFiles"]>
  ): ReturnType<ProjectSandboxContent["searchFiles"]> {
    return this.withActiveSandboxOperation(() => super.searchFiles(...args));
  }

  public override deleteFile(
    ...args: Parameters<ProjectSandboxContent["deleteFile"]>
  ): ReturnType<ProjectSandboxContent["deleteFile"]> {
    return this.withActiveSandboxOperation(() => super.deleteFile(...args));
  }

  public override getSignedPreviewUrl(
    ...args: Parameters<ProjectSandboxContent["getSignedPreviewUrl"]>
  ): ReturnType<ProjectSandboxContent["getSignedPreviewUrl"]> {
    return this.withActiveSandboxOperation(() => super.getSignedPreviewUrl(...args));
  }

  public override exposeCodeServer(
    ...args: Parameters<ProjectSandboxContent["exposeCodeServer"]>
  ): ReturnType<ProjectSandboxContent["exposeCodeServer"]> {
    return this.withActiveSandboxOperation(() => super.exposeCodeServer(...args));
  }

  public override wakePreview(
    ...args: Parameters<ProjectSandboxContent["wakePreview"]>
  ): ReturnType<ProjectSandboxContent["wakePreview"]> {
    return this.withActiveSandboxOperation(() => super.wakePreview(...args));
  }

  public override projectPreviewStatus(
    ...args: Parameters<ProjectSandboxContent["projectPreviewStatus"]>
  ): ReturnType<ProjectSandboxContent["projectPreviewStatus"]> {
    return this.withActiveSandboxOperation(() => super.projectPreviewStatus(...args));
  }

  public override cleanupProjectWorkspace(
    ...args: Parameters<ProjectSandboxContent["cleanupProjectWorkspace"]>
  ): ReturnType<ProjectSandboxContent["cleanupProjectWorkspace"]> {
    return this.withActiveSandboxOperation(() => super.cleanupProjectWorkspace(...args));
  }
}
