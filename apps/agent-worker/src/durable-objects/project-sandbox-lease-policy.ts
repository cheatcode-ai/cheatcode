import { APP_PREVIEW_SLOT_PREFIX } from "./project-sandbox-process-support";
import { ProjectWorkspaceSlugSchema, workspaceSlugFromPath } from "./project-sandbox-runtime";

type LeasePolicy = readonly [
  kind:
    | "account-deletion-control"
    | "cleanup-signal"
    | "owner-registration"
    | "project-cleanup"
    | "sandbox"
    | "shared-workspace"
    | "streaming"
    | "workspace",
  slug?: "none" | "path" | "process-id" | "project-id" | "workspace-path" | "workspace-slug",
];

// biome-ignore format: Group the complete RPC policy surface by lease behavior for compact auditing.
const LEASE_POLICIES = {
  deleteAccountState: ["account-deletion-control"],
  registerOwner: ["owner-registration"],
  setQuotaPeriod: ["sandbox"], beginRun: ["sandbox"],
  renewRun: ["cleanup-signal"], endRun: ["cleanup-signal"], alarm: ["cleanup-signal"],
  runtimeSandboxId: ["sandbox"], existingDaytonaId: ["sandbox"], sandboxRuntimeState: ["sandbox"],
  ensureReady: ["sandbox"], getStatus: ["sandbox"],
  runCode: ["workspace", "none"], exec: ["workspace", "none"], startProcess: ["workspace", "none"],
  allocateProjectPort: ["workspace", "project-id"],
  allocateProcessPort: ["workspace", "process-id"],
  killAllProcesses: ["shared-workspace"],
  killProcess: ["workspace", "process-id"], readDevServerLogs: ["workspace", "process-id"],
  downloadProjectArchive: ["streaming", "workspace-slug"],
  readFile: ["workspace", "path"], listUploadedFiles: ["sandbox"],
  uploadProjectFile: ["workspace", "workspace-slug"],
  restoreUploadedFiles: ["workspace", "workspace-slug"],
  writeFile: ["workspace", "path"], listFiles: ["workspace", "path"],
  searchFiles: ["workspace", "path"], deleteFile: ["workspace", "path"],
  getSignedPreviewUrl: ["sandbox"], exposeBrowserTakeover: ["sandbox"],
  stopBrowserTakeover: ["cleanup-signal"],
  exposeCodeServer: ["workspace", "workspace-path"],
  wakePreview: ["workspace", "workspace-slug"],
  projectPreviewStatus: ["workspace", "workspace-slug"],
  cleanupProjectWorkspace: ["project-cleanup"],
} as const satisfies Record<string, LeasePolicy>;

export type LeaseMethod = keyof typeof LEASE_POLICIES;

export function leaseKind(method: LeaseMethod): LeasePolicy[0] {
  return LEASE_POLICIES[method][0];
}

export function workspaceScope(method: LeaseMethod, input: unknown): string | null {
  const [, source] = LEASE_POLICIES[method] as LeasePolicy;
  if (!source || source === "none") return null;
  if (source === "path") return workspaceSlugFromPath(stringField(input, "path"));
  if (source === "workspace-path")
    return workspaceSlugFromPath(stringField(input, "workspacePath"));
  if (source === "process-id") return workspaceSlugFromProcessId(stringField(input, "processId"));
  if (source === "project-id") return workspaceSlug(stringField(input, "projectId"));
  return workspaceSlug(stringField(input, "workspaceSlug"));
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

function stringField(input: unknown, field: string): string | undefined {
  if (typeof input !== "object" || input === null) return undefined;
  const value = (input as Record<string, unknown>)[field];
  return typeof value === "string" ? value : undefined;
}
