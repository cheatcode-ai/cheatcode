import type {
  InternalDurableObjectStorageRequest,
  InternalDurableObjectStorageResponse,
} from "@cheatcode/types";
import { InternalWorkspaceReconciliationBodySchema } from "@cheatcode/types";
import { reconcileProjectSandboxStorageRequest } from "./durable-storage-reconciliation";
import { ProjectSandboxContent } from "./project-sandbox-content";
import { APP_PREVIEW_SLOT_PREFIX } from "./project-sandbox-process-support";
import { ProjectWorkspaceSlugSchema, workspaceSlugFromPath } from "./project-sandbox-runtime";

/**
 * Public Durable Object facade. Every operational RPC takes an in-memory lease
 * before its first await so account deletion can fence new work and drain old
 * work without holding blockConcurrencyWhile across Daytona requests.
 */
export class ProjectSandbox extends ProjectSandboxContent {
  public reconcileStorageSchema(
    value: InternalDurableObjectStorageRequest,
  ): InternalDurableObjectStorageResponse {
    return reconcileProjectSandboxStorageRequest(this.ctx, this.env, value);
  }

  public override registerOwner(
    ...args: Parameters<ProjectSandboxContent["registerOwner"]>
  ): ReturnType<ProjectSandboxContent["registerOwner"]> {
    return this.withActiveOwnerRegistration(args[0], () => super.registerOwner(...args));
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
    // Late cleanup is absorbed by account deletion; workspace transitions reject it
    // because end/alarm can change Daytona activity or auto-stop during a rename.
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
    return this.withActiveProjectWorkspaceOperation(null, () => super.runCode(...args));
  }

  public override exec(
    ...args: Parameters<ProjectSandboxContent["exec"]>
  ): ReturnType<ProjectSandboxContent["exec"]> {
    return this.withActiveProjectWorkspaceOperation(null, () => super.exec(...args));
  }

  public override startProcess(
    ...args: Parameters<ProjectSandboxContent["startProcess"]>
  ): ReturnType<ProjectSandboxContent["startProcess"]> {
    return this.withActiveProjectWorkspaceOperation(null, () => super.startProcess(...args));
  }

  public override allocateProjectPort(
    ...args: Parameters<ProjectSandboxContent["allocateProjectPort"]>
  ): ReturnType<ProjectSandboxContent["allocateProjectPort"]> {
    return this.withActiveProjectWorkspaceOperation(workspaceSlug(args[0].projectId), () =>
      super.allocateProjectPort(...args),
    );
  }

  public override getProjectPort(
    ...args: Parameters<ProjectSandboxContent["getProjectPort"]>
  ): ReturnType<ProjectSandboxContent["getProjectPort"]> {
    return this.withActiveProjectWorkspaceOperation(workspaceSlug(args[0].projectId), () =>
      super.getProjectPort(...args),
    );
  }

  public override allocateProcessPort(
    ...args: Parameters<ProjectSandboxContent["allocateProcessPort"]>
  ): ReturnType<ProjectSandboxContent["allocateProcessPort"]> {
    return this.withActiveProjectWorkspaceOperation(
      workspaceSlugFromProcessId(args[0].processId),
      () => super.allocateProcessPort(...args),
    );
  }

  public override killAllProcesses(
    ...args: Parameters<ProjectSandboxContent["killAllProcesses"]>
  ): ReturnType<ProjectSandboxContent["killAllProcesses"]> {
    return this.withActiveSharedWorkspaceMutation(() => super.killAllProcesses(...args));
  }

  public override killProcess(
    ...args: Parameters<ProjectSandboxContent["killProcess"]>
  ): ReturnType<ProjectSandboxContent["killProcess"]> {
    return this.withActiveProjectWorkspaceOperation(
      workspaceSlugFromProcessId(args[0].processId),
      () => super.killProcess(...args),
    );
  }

  public override readDevServerLogs(
    ...args: Parameters<ProjectSandboxContent["readDevServerLogs"]>
  ): ReturnType<ProjectSandboxContent["readDevServerLogs"]> {
    return this.withActiveProjectWorkspaceOperation(
      workspaceSlugFromProcessId(args[0].processId),
      () => super.readDevServerLogs(...args),
    );
  }

  public override downloadProjectArchive(
    ...args: Parameters<ProjectSandboxContent["downloadProjectArchive"]>
  ): ReturnType<ProjectSandboxContent["downloadProjectArchive"]> {
    return this.withActiveProjectWorkspaceStreamingOperation(
      workspaceSlug(args[0].workspaceSlug),
      (release) => super.downloadProjectArchiveForRpc(args[0], release),
    );
  }

  public override readFile(
    ...args: Parameters<ProjectSandboxContent["readFile"]>
  ): ReturnType<ProjectSandboxContent["readFile"]> {
    return this.withActiveProjectWorkspaceOperation(workspaceSlugFromPath(args[0].path), () =>
      super.readFile(...args),
    );
  }

  public override previewFile(
    ...args: Parameters<ProjectSandboxContent["previewFile"]>
  ): ReturnType<ProjectSandboxContent["previewFile"]> {
    return this.withActiveProjectWorkspaceOperation(workspaceSlugFromPath(args[0].path), () =>
      super.previewFile(...args),
    );
  }

  public override writeFile(
    ...args: Parameters<ProjectSandboxContent["writeFile"]>
  ): ReturnType<ProjectSandboxContent["writeFile"]> {
    return this.withActiveProjectWorkspaceOperation(workspaceSlugFromPath(args[0].path), () =>
      super.writeFile(...args),
    );
  }

  public override listFiles(
    ...args: Parameters<ProjectSandboxContent["listFiles"]>
  ): ReturnType<ProjectSandboxContent["listFiles"]> {
    return this.withActiveProjectWorkspaceOperation(workspaceSlugFromPath(args[0].path), () =>
      super.listFiles(...args),
    );
  }

  public override searchFiles(
    ...args: Parameters<ProjectSandboxContent["searchFiles"]>
  ): ReturnType<ProjectSandboxContent["searchFiles"]> {
    return this.withActiveProjectWorkspaceOperation(workspaceSlugFromPath(args[0].path), () =>
      super.searchFiles(...args),
    );
  }

  public override deleteFile(
    ...args: Parameters<ProjectSandboxContent["deleteFile"]>
  ): ReturnType<ProjectSandboxContent["deleteFile"]> {
    return this.withActiveProjectWorkspaceOperation(workspaceSlugFromPath(args[0].path), () =>
      super.deleteFile(...args),
    );
  }

  public override getSignedPreviewUrl(
    ...args: Parameters<ProjectSandboxContent["getSignedPreviewUrl"]>
  ): ReturnType<ProjectSandboxContent["getSignedPreviewUrl"]> {
    return this.withActiveSandboxOperation(() => super.getSignedPreviewUrl(...args));
  }

  public override exposeBrowserTakeover(
    ...args: Parameters<ProjectSandboxContent["exposeBrowserTakeover"]>
  ): ReturnType<ProjectSandboxContent["exposeBrowserTakeover"]> {
    return this.withActiveSandboxOperation(() => super.exposeBrowserTakeover(...args));
  }

  public override stopBrowserTakeover(
    ...args: Parameters<ProjectSandboxContent["stopBrowserTakeover"]>
  ): ReturnType<ProjectSandboxContent["stopBrowserTakeover"]> {
    return this.withActiveSandboxCleanupSignal(() => super.stopBrowserTakeover(...args));
  }

  public override exposeCodeServer(
    ...args: Parameters<ProjectSandboxContent["exposeCodeServer"]>
  ): ReturnType<ProjectSandboxContent["exposeCodeServer"]> {
    return this.withActiveProjectWorkspaceOperation(
      workspaceSlugFromPath(args[0].workspacePath),
      () => super.exposeCodeServer(...args),
    );
  }

  public override wakePreview(
    ...args: Parameters<ProjectSandboxContent["wakePreview"]>
  ): ReturnType<ProjectSandboxContent["wakePreview"]> {
    return this.withActiveProjectWorkspaceOperation(workspaceSlug(args[0].workspaceSlug), () =>
      super.wakePreview(...args),
    );
  }

  public override projectPreviewStatus(
    ...args: Parameters<ProjectSandboxContent["projectPreviewStatus"]>
  ): ReturnType<ProjectSandboxContent["projectPreviewStatus"]> {
    return this.withActiveProjectWorkspaceOperation(workspaceSlug(args[0].workspaceSlug), () =>
      super.projectPreviewStatus(...args),
    );
  }

  public override cleanupProjectWorkspace(
    ...args: Parameters<ProjectSandboxContent["cleanupProjectWorkspace"]>
  ): ReturnType<ProjectSandboxContent["cleanupProjectWorkspace"]> {
    return this.withActiveProjectWorkspaceCleanup(() => super.cleanupProjectWorkspace(...args));
  }

  public override prepareWorkspaceTransition(
    ...args: Parameters<ProjectSandboxContent["prepareWorkspaceTransition"]>
  ): ReturnType<ProjectSandboxContent["prepareWorkspaceTransition"]> {
    return this.withActiveWorkspaceTransition(transitionId(args[0]), () =>
      super.prepareWorkspaceTransition(...args),
    );
  }

  public override finalizeWorkspaceTransition(
    ...args: Parameters<ProjectSandboxContent["finalizeWorkspaceTransition"]>
  ): ReturnType<ProjectSandboxContent["finalizeWorkspaceTransition"]> {
    return this.withActiveWorkspaceTransition(transitionId(args[0]), () =>
      super.finalizeWorkspaceTransition(...args),
    );
  }
}

function transitionId(input: unknown): string {
  const parsed = InternalWorkspaceReconciliationBodySchema.parse(input);
  return `workspace-sandbox-release:${parsed.releaseSha}`;
}

function workspaceSlug(value: string | undefined): string | null {
  const parsed = ProjectWorkspaceSlugSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

function workspaceSlugFromProcessId(processId: string | undefined): string | null {
  return processId?.startsWith(APP_PREVIEW_SLOT_PREFIX)
    ? workspaceSlug(processId.slice(APP_PREVIEW_SLOT_PREFIX.length))
    : null;
}
