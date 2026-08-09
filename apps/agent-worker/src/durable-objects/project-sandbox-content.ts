import { DaytonaApiError } from "@cheatcode/agent-core/tools/code";
import { APIError } from "@cheatcode/observability";
import type {
  SandboxCompareAndSwapFileResult,
  SandboxDeleteFileResult,
  SandboxListFilesResult,
  SandboxReadFileResult,
  SandboxSearchFilesResult,
  SandboxWriteFileResult,
} from "@cheatcode/sandbox-contracts";
import { encodeBase64, shellQuote } from "../sandbox-support";
import { metroForwardedHostFixScript } from "./expo-metro-forwarded-host";
import {
  CODE_SERVER_DISPLAY_DIR,
  CODE_SERVER_PORT,
  CODE_SERVER_PROCESS_ID,
  CODE_SERVER_SETTINGS_MARKER,
  CODE_SERVER_START_TIMEOUT_MS,
  codeServerFolderUrl,
  codeServerStartCommand,
  codeServerTrustedOrigins,
} from "./project-sandbox-code-server";
import {
  assertDeletableWorkspacePath,
  buildGrepCommand,
  PROJECT_ARCHIVE_MAX_BYTES,
  PROJECT_ARCHIVE_MAX_FILES,
  PROJECT_ARCHIVE_MAX_OUTPUT_BYTES,
  PROJECT_ARCHIVE_SCRIPT,
  parseGrepOutput,
  WORKSPACE_DIR,
} from "./project-sandbox-content-support";
import { compareAndSwapFile, writeFile } from "./project-sandbox-file-apply";
import { listSandboxFiles } from "./project-sandbox-files";
import { projectLocalRuntimeDir } from "./project-sandbox-package-runtime";
import { buildPreviewUrl, signedUrlToExpo } from "./project-sandbox-preview";
import {
  APP_PREVIEW_SLOT_PREFIX,
  type ProcessRecord,
  restartEnvironment,
  timeoutSeconds,
} from "./project-sandbox-process-support";
import type { CoordinatedProcessOps, ProcessOps } from "./project-sandbox-processes";
import type { FileOps } from "./project-sandbox-project-files";
import {
  type ProjectArchiveInput,
  ProjectArchiveInputSchema,
  type ProjectBrowserTakeoverInput,
  ProjectBrowserTakeoverInputSchema,
  type ProjectBrowserTakeoverResult,
  type ProjectBrowserTakeoverStopInput,
  ProjectBrowserTakeoverStopInputSchema,
  type ProjectCleanupWorkspaceInput,
  ProjectCleanupWorkspaceInputSchema,
  type ProjectCodeServerInput,
  ProjectCodeServerInputSchema,
  type ProjectCompareAndSwapFileInput,
  type ProjectDeleteFileInput,
  ProjectDeleteFileInputSchema,
  type ProjectListFilesInput,
  ProjectListFilesInputSchema,
  type ProjectPreviewStatusInput,
  ProjectPreviewStatusInputSchema,
  type ProjectReadFileInput,
  ProjectReadFileInputSchema,
  type ProjectSandboxRuntimeState,
  type ProjectSearchFilesInput,
  ProjectSearchFilesInputSchema,
  type ProjectSignedPreviewUrlInput,
  ProjectSignedPreviewUrlInputSchema,
  type ProjectWakePreviewInput,
  ProjectWakePreviewInputSchema,
  type ProjectWakePreviewResult,
  type ProjectWriteFileInput,
} from "./project-sandbox-runtime";
import type { SandboxRuntime } from "./project-sandbox-runtime-handle";

const PREVIEW_STATUS_PROBE_TIMEOUT_MS = 3_000;
const PREVIEW_WAKE_TIMEOUT_MS = 90_000;
const SIGNED_PREVIEW_TTL_SECONDS = 60 * 60;
const SANDBOX_READ_FILE_MAX_BYTES = 1024 * 1024;
const BROWSER_TAKEOVER_PORT_MIN = 60_000;
const BROWSER_TAKEOVER_PORT_MAX = 60_999;
const BROWSER_TAKEOVER_SCRIPT = "/opt/cheatcode/start-browser-takeover.sh";

export interface ContentOps {
  cleanupProjectWorkspace: (input: ProjectCleanupWorkspaceInput) => Promise<void>;
  compareAndSwapFile: (
    input: ProjectCompareAndSwapFileInput,
  ) => Promise<SandboxCompareAndSwapFileResult>;
  deleteFile: (input: ProjectDeleteFileInput) => Promise<SandboxDeleteFileResult>;
  downloadProjectArchive: (input: ProjectArchiveInput, onFinished: () => void) => Promise<Response>;
  exposeBrowserTakeover: (
    input: ProjectBrowserTakeoverInput,
  ) => Promise<ProjectBrowserTakeoverResult>;
  exposeCodeServer: (input: ProjectCodeServerInput) => Promise<{
    expiresAt: string;
    port: number;
    url: string;
    workspacePath: string;
  }>;
  getSignedPreviewUrl: (
    input: ProjectSignedPreviewUrlInput,
  ) => Promise<{ token: string; url: string }>;
  listFiles: (input: ProjectListFilesInput) => Promise<SandboxListFilesResult>;
  projectPreviewStatus: (
    input: ProjectPreviewStatusInput,
  ) => Promise<{ running: boolean; state: string }>;
  readFile: (input: ProjectReadFileInput) => Promise<SandboxReadFileResult>;
  searchFiles: (input: ProjectSearchFilesInput) => Promise<SandboxSearchFilesResult>;
  stopBrowserTakeover: (input: ProjectBrowserTakeoverStopInput) => Promise<void>;
  wakePreview: (input: ProjectWakePreviewInput) => Promise<ProjectWakePreviewResult>;
  writeFile: (input: ProjectWriteFileInput) => Promise<SandboxWriteFileResult>;
}

type ContentRuntime = Pick<
  SandboxRuntime,
  | "client"
  | "deleteProjectWorkspace"
  | "ensureExistingSandboxStarted"
  | "ensureSandbox"
  | "previewHostname"
  | "previewSecret"
  | "releaseSha"
  | "toUpstreamError"
>;

type ContentProcessOps = Pick<
  ProcessOps,
  | "deleteProcessRecord"
  | "deleteProcessesOnPort"
  | "freeProjectPort"
  | "httpPortReady"
  | "isPortAlive"
  | "killAllProcesses"
  | "processRecord"
  | "relaunchDevServer"
  | "terminateUntrackedSandboxProcesses"
  | "waitForPort"
>;

type ContentCoordinatedProcessOps = Pick<
  CoordinatedProcessOps,
  "allocateProcessPort" | "exec" | "killProcess" | "startProcess"
>;

interface ContentDependencies {
  coordinatedProcess: ContentCoordinatedProcessOps;
  deleteUploadedFileMetadata: FileOps["deleteUploadedFileMetadata"];
  process: ContentProcessOps;
  sandboxRuntimeState: () => Promise<ProjectSandboxRuntimeState>;
}

interface ContentContext {
  dependencies: ContentDependencies;
  runtime: ContentRuntime;
}

export function createContentOps(
  runtime: ContentRuntime,
  dependencies: ContentDependencies,
): ContentOps {
  const context = { dependencies, runtime };
  return {
    cleanupProjectWorkspace: (input) => cleanupProjectWorkspace(context, input),
    compareAndSwapFile: (input) => compareAndSwapFile(runtime, input),
    deleteFile: (input) => deleteFile(runtime, input),
    downloadProjectArchive: (input, onFinished) =>
      downloadProjectArchive(context, input, onFinished),
    exposeBrowserTakeover: (input) => exposeBrowserTakeover(context, input),
    exposeCodeServer: (input) => exposeCodeServer(context, input),
    getSignedPreviewUrl: (input) => getSignedPreviewUrl(runtime, input),
    listFiles: (input) => listFiles(runtime, input),
    projectPreviewStatus: (input) => projectPreviewStatus(context, input),
    readFile: (input) => readFile(runtime, input),
    searchFiles: (input) => searchFiles(runtime, input),
    stopBrowserTakeover: (input) => stopBrowserTakeover(context, input),
    wakePreview: (input) => wakePreview(context, input),
    writeFile: (input) => writeFile(runtime, input),
  };
}

async function downloadProjectArchive(
  context: ContentContext,
  input: ProjectArchiveInput,
  onFinished: () => void,
): Promise<Response> {
  const parsed = ProjectArchiveInputSchema.parse(input);
  const archivePath = `/tmp/cheatcode-project-${crypto.randomUUID()}.zip`;
  const workspacePath = `${WORKSPACE_DIR}/${parsed.workspaceSlug}`;
  const result = await context.dependencies.coordinatedProcess.exec({
    command: [
      "python3",
      "-c",
      PROJECT_ARCHIVE_SCRIPT,
      workspacePath,
      archivePath,
      String(PROJECT_ARCHIVE_MAX_BYTES),
      String(PROJECT_ARCHIVE_MAX_FILES),
      String(PROJECT_ARCHIVE_MAX_OUTPUT_BYTES),
    ],
    cwd: workspacePath,
    timeoutMs: 300_000,
  });
  const id = await context.runtime.ensureSandbox();
  if (!result.success) {
    await context.runtime
      .client()
      .deleteFilePath(id, archivePath, false)
      .catch(() => undefined);
    throw new APIError(422, "sandbox_command_failed", "Unable to prepare this project download", {
      hint: result.stdout.trim().slice(-300) || "Check the project files and try again.",
      retriable: true,
    });
  }
  return streamProjectArchive(context.runtime.client(), id, archivePath, onFinished);
}

async function streamProjectArchive(
  client: ReturnType<ContentRuntime["client"]>,
  sandboxId: string,
  archivePath: string,
  onFinished: () => void,
): Promise<Response> {
  const cleanup = async (): Promise<void> => {
    try {
      await client.deleteFilePath(sandboxId, archivePath, false).catch(() => undefined);
    } finally {
      onFinished();
    }
  };
  try {
    const upstream = await client.downloadFileResponse(sandboxId, archivePath);
    return await projectArchiveResponse(upstream, cleanup);
  } catch (error) {
    await cleanup();
    throw error;
  }
}

async function readFile(
  runtime: ContentRuntime,
  input: ProjectReadFileInput,
): Promise<SandboxReadFileResult> {
  const parsed = ProjectReadFileInputSchema.parse(input);
  const id = await runtime.ensureSandbox();
  let bytes: Uint8Array;
  try {
    bytes = await runtime.client().downloadFile(id, parsed.path, SANDBOX_READ_FILE_MAX_BYTES);
  } catch (error) {
    if (isDaytonaResponseTooLarge(error)) {
      throw new APIError(422, "sandbox_command_failed", "File is too large to read inline", {
        hint: "Use file search or a shell command to inspect a smaller range.",
        retriable: false,
      });
    }
    throw error;
  }
  if (parsed.encoding === "base64") {
    return {
      content: encodeBase64(bytes),
      encoding: "base64",
      path: parsed.path,
      size: bytes.byteLength,
    };
  }
  return {
    content: new TextDecoder().decode(bytes),
    encoding: "utf8",
    path: parsed.path,
    size: bytes.byteLength,
  };
}

async function listFiles(
  runtime: ContentRuntime,
  input: ProjectListFilesInput,
): Promise<SandboxListFilesResult> {
  const parsed = ProjectListFilesInputSchema.parse(input);
  const id = await runtime.ensureSandbox();
  const files = await listSandboxFiles({
    client: runtime.client(),
    includeHidden: parsed.includeHidden,
    path: parsed.path,
    recursive: parsed.recursive,
    sandboxId: id,
  });
  return { files, path: parsed.path };
}

async function searchFiles(
  runtime: ContentRuntime,
  input: ProjectSearchFilesInput,
): Promise<SandboxSearchFilesResult> {
  const parsed = ProjectSearchFilesInputSchema.parse(input);
  const id = await runtime.ensureSandbox();
  const completed = await runtime.client().execute(id, {
    command: buildGrepCommand(parsed),
    cwd: WORKSPACE_DIR,
    timeout: timeoutSeconds(60_000),
  });
  const matches = parseGrepOutput(completed.result ?? "", parsed.maxResults);
  return {
    matches,
    query: parsed.query,
    total: matches.length,
    truncated: matches.length >= parsed.maxResults,
  };
}

async function deleteFile(
  runtime: ContentRuntime,
  input: ProjectDeleteFileInput,
): Promise<SandboxDeleteFileResult> {
  const parsed = ProjectDeleteFileInputSchema.parse(input);
  assertDeletableWorkspacePath(parsed.path);
  const id = await runtime.ensureSandbox();
  await runtime.client().deleteFilePath(id, parsed.path, parsed.recursive);
  return { path: parsed.path, success: true };
}

async function getSignedPreviewUrl(
  runtime: ContentRuntime,
  input: ProjectSignedPreviewUrlInput,
): Promise<{ token: string; url: string }> {
  const parsed = ProjectSignedPreviewUrlInputSchema.parse(input);
  const id = await runtime.ensureSandbox();
  const link = await runtime.client().getSignedPreviewUrl(id, parsed.port, parsed.expiresInSeconds);
  return { token: link.token, url: link.url };
}

async function exposeBrowserTakeover(
  context: ContentContext,
  input: ProjectBrowserTakeoverInput,
): Promise<ProjectBrowserTakeoverResult> {
  const parsed = ProjectBrowserTakeoverInputSchema.parse(input);
  const browserDriver = await context.dependencies.process.processRecord(
    browserDriverProcessId(parsed.runId),
  );
  if (!browserDriver) {
    throw new APIError(409, "conflict_state_invalid", "No live browser session is available", {
      hint: "Let Cheatcode open a website before taking over the browser.",
      retriable: true,
    });
  }
  const processId = browserTakeoverProcessId(parsed.runId);
  const port = await context.dependencies.coordinatedProcess.allocateProcessPort({
    maxPort: BROWSER_TAKEOVER_PORT_MAX,
    minPort: BROWSER_TAKEOVER_PORT_MIN,
    processId,
  });
  const password = crypto.randomUUID().replaceAll("-", "");
  await context.dependencies.coordinatedProcess.startProcess({
    command: ["sh", BROWSER_TAKEOVER_SCRIPT],
    env: { TAKEOVER_PASSWORD: password, TAKEOVER_PORT: String(port) },
    keepAliveTimeoutMs: parsed.expiresInSeconds * 1_000,
    maxRestarts: 0,
    processId,
    restartOnFailure: false,
    waitForPort: { path: "/vnc.html", port, timeoutMs: 30_000 },
  });
  return browserTakeoverResult(context.runtime, parsed, port, password);
}

async function browserTakeoverResult(
  runtime: ContentRuntime,
  input: ReturnType<typeof ProjectBrowserTakeoverInputSchema.parse>,
  port: number,
  password: string,
): Promise<ProjectBrowserTakeoverResult> {
  const id = await runtime.ensureSandbox();
  const preview = await buildPreviewUrl({
    hostname: runtime.previewHostname(),
    port,
    sandboxId: id,
    secret: await runtime.previewSecret(),
  });
  return {
    expiresAt: new Date(Date.now() + input.expiresInSeconds * 1_000).toISOString(),
    takeoverId: input.takeoverId,
    url: noVncSessionUrl(preview.url, password),
  };
}

async function stopBrowserTakeover(
  context: ContentContext,
  input: ProjectBrowserTakeoverStopInput,
): Promise<void> {
  const parsed = ProjectBrowserTakeoverStopInputSchema.parse(input);
  await context.dependencies.coordinatedProcess.killProcess({
    processId: browserTakeoverProcessId(parsed.runId),
  });
}

async function exposeCodeServer(
  context: ContentContext,
  input: ProjectCodeServerInput,
): Promise<{
  expiresAt: string;
  port: number;
  url: string;
  workspacePath: string;
}> {
  const parsed = ProjectCodeServerInputSchema.parse(input);
  const id = await context.runtime.ensureSandbox();
  await ensureCodeServer(context, id);
  const displayFolder =
    parsed.workspacePath === WORKSPACE_DIR
      ? await ensureCodeServerDisplayFolder(context.runtime, id, parsed.workspacePath)
      : parsed.workspacePath;
  await context.runtime
    .client()
    .getPreviewLink(id, CODE_SERVER_PORT)
    .catch(() => undefined);
  const built = await buildPreviewUrl({
    hostname: context.runtime.previewHostname(),
    port: CODE_SERVER_PORT,
    sandboxId: id,
    secret: await context.runtime.previewSecret(),
    useSubdomain: true,
  });
  const bridgeRelease = context.runtime.releaseSha();
  return {
    expiresAt: built.expiresAt,
    port: CODE_SERVER_PORT,
    url: codeServerFolderUrl(built.url, displayFolder, bridgeRelease, parsed.initialFilePath),
    workspacePath: parsed.workspacePath,
  };
}

async function wakePreview(
  context: ContentContext,
  input: ProjectWakePreviewInput,
): Promise<ProjectWakePreviewResult> {
  const parsed = ProjectWakePreviewInputSchema.parse(input);
  const slot = parsed.workspaceSlug
    ? `${APP_PREVIEW_SLOT_PREFIX}${parsed.workspaceSlug}`
    : "app-preview";
  const record = await context.dependencies.process.processRecord(slot);
  if (!record?.port) return { running: false, state: "none" };
  const id = await context.runtime.ensureSandbox();
  const mobile = await mobileExpoProxy(context.runtime, id, record);
  const repaired = record.isMobile
    ? await ensureMobileMetroForwardedHostConfig(context.runtime, id, record.cwd)
    : false;
  let running = await context.dependencies.process.isPortAlive(id, record.port);
  if (!running || repaired) {
    const relaunched = await context.dependencies.process.relaunchDevServer(
      id,
      slot,
      record,
      mobile?.restartEnv ?? restartEnvironment(slot, record),
    );
    await context.dependencies.process
      .waitForPort(id, record.port, "/", PREVIEW_WAKE_TIMEOUT_MS, {
        cmdId: relaunched.cmdId,
        sessionId: relaunched.sessionId,
      })
      .catch(() => undefined);
    running = await context.dependencies.process.isPortAlive(id, record.port);
  }
  return wakePreviewResult(context.runtime, id, record, record.port, running, mobile?.expoUrl);
}

async function wakePreviewResult(
  runtime: ContentRuntime,
  sandboxId: string,
  record: ProcessRecord,
  port: number,
  running: boolean,
  expoUrl: string | undefined,
): Promise<ProjectWakePreviewResult> {
  await runtime
    .client()
    .getPreviewLink(sandboxId, port)
    .catch(() => undefined);
  const built = await buildPreviewUrl({
    hostname: runtime.previewHostname(),
    isMobile: record.isMobile === true,
    port,
    sandboxId,
    secret: await runtime.previewSecret(),
  });
  return {
    expiresAt: built.expiresAt,
    port,
    running,
    state: "started",
    url: built.url,
    ...(expoUrl ? { expoUrl } : {}),
  };
}

async function projectPreviewStatus(
  context: ContentContext,
  input: ProjectPreviewStatusInput,
): Promise<{ running: boolean; state: string }> {
  const parsed = ProjectPreviewStatusInputSchema.parse(input);
  const record = await context.dependencies.process.processRecord(
    `${APP_PREVIEW_SLOT_PREFIX}${parsed.workspaceSlug}`,
  );
  if (!record?.port) return { running: false, state: "none" };
  const runtimeState = await context.dependencies.sandboxRuntimeState();
  if (runtimeState.state !== "started" || !runtimeState.sandboxId) {
    return { running: false, state: runtimeState.state };
  }
  const running = await context.dependencies.process.httpPortReady(
    runtimeState.sandboxId,
    record.port,
    "/",
    PREVIEW_STATUS_PROBE_TIMEOUT_MS,
  );
  return { running, state: runtimeState.state };
}

function cleanupProjectWorkspace(
  context: ContentContext,
  input: ProjectCleanupWorkspaceInput,
): Promise<void> {
  const parsed = ProjectCleanupWorkspaceInputSchema.parse(input);
  return context.runtime.deleteProjectWorkspace(parsed, () =>
    performProjectWorkspaceCleanup(context, parsed.projectId, parsed.workspaceSlug),
  );
}

async function performProjectWorkspaceCleanup(
  context: ContentContext,
  projectId: string,
  workspaceSlug: string,
): Promise<void> {
  const id = await context.runtime.ensureExistingSandboxStarted();
  // Explicit raw bypass: cleanup has already fenced and drained workspace operations.
  await context.dependencies.process.killAllProcesses();
  if (id) {
    await context.dependencies.process.terminateUntrackedSandboxProcesses(id);
    await removeWorkspaceFolder(context.runtime, id, workspaceSlug);
    await context.runtime
      .client()
      .deleteFilePath(id, projectLocalRuntimeDir(workspaceSlug), true)
      .catch((error: unknown) => {
        if (error instanceof DaytonaApiError && error.status === 404) return;
        throw context.runtime.toUpstreamError(error, "Project local runtime removal failed.");
      });
  }
  await context.dependencies.process.freeProjectPort(workspaceSlug);
  await context.dependencies.deleteUploadedFileMetadata(projectId);
}

async function mobileExpoProxy(
  runtime: ContentRuntime,
  id: string,
  record: ProcessRecord,
): Promise<{ expoUrl: string; restartEnv: Record<string, string> } | null> {
  if (!record.isMobile || record.port === undefined) return null;
  const signed = await runtime
    .client()
    .getSignedPreviewUrl(id, record.port, SIGNED_PREVIEW_TTL_SECONDS)
    .catch(() => null);
  if (!signed) return null;
  return {
    expoUrl: signedUrlToExpo(signed.url),
    restartEnv: {
      CHEATCODE_APP_RUNTIME: "expo",
      CI: "1",
      EXPO_NO_TELEMETRY: "1",
      EXPO_PACKAGER_PROXY_URL: signed.url,
      PORT: String(record.port),
    },
  };
}

async function ensureMobileMetroForwardedHostConfig(
  runtime: ContentRuntime,
  id: string,
  cwd: string,
): Promise<boolean> {
  const current = await runtime
    .client()
    .execute(id, {
      command: 'test -f metro.config.js && grep -q "x-forwarded-host" metro.config.js',
      cwd,
      timeout: 5,
    })
    .catch(() => null);
  if (current?.exitCode === 0) return false;
  const repair = await runtime.client().execute(id, {
    command: `bash -lc ${shellQuote(metroForwardedHostFixScript())}`,
    cwd,
    timeout: 15,
  });
  if (repair.exitCode !== 0) {
    throw new APIError(
      502,
      "upstream_sandbox_failed",
      "Could not repair the mobile preview proxy configuration.",
      { retriable: true },
    );
  }
  return true;
}

async function ensureCodeServer(context: ContentContext, id: string): Promise<void> {
  const [isPortReady, hasCurrentSettings] = await Promise.all([
    context.dependencies.process.httpPortReady(id, CODE_SERVER_PORT, "/", 5_000),
    hasCodeServerSettingsMarker(context.runtime, id),
  ]);
  if (isPortReady && hasCurrentSettings) {
    return;
  }
  const tracked = await context.dependencies.process.processRecord(CODE_SERVER_PROCESS_ID);
  if (hasCurrentSettings && tracked?.port === CODE_SERVER_PORT) {
    await relaunchTrackedCodeServer(context, id, tracked);
    return;
  }
  if (!(await hasCodeServerRuntime(context.runtime, id))) {
    throw new APIError(502, "sandbox_start_failed", "code-server is not installed", {
      hint: "Start a new project sandbox from the current Daytona snapshot to use the Files viewer.",
      retriable: false,
    });
  }
  await context.dependencies.process.deleteProcessRecord(id, CODE_SERVER_PROCESS_ID);
  await context.dependencies.process.deleteProcessesOnPort(
    id,
    CODE_SERVER_PORT,
    CODE_SERVER_PROCESS_ID,
  );
  await context.runtime
    .client()
    .execute(id, { command: "pkill -f code-server || true", timeout: 5 })
    .catch(() => null);
  await startCodeServer(context);
  if (!(await context.dependencies.process.httpPortReady(id, CODE_SERVER_PORT, "/", 5_000))) {
    throw new APIError(502, "sandbox_start_failed", "Unable to start code-server", {
      hint: "Rebuild the Daytona sandbox snapshot with code-server, then retry the Files tab.",
      retriable: true,
    });
  }
}

async function relaunchTrackedCodeServer(
  context: ContentContext,
  id: string,
  record: ProcessRecord,
): Promise<void> {
  const relaunched = await context.dependencies.process.relaunchDevServer(
    id,
    CODE_SERVER_PROCESS_ID,
    record,
    codeServerEnvironment(context.runtime.previewHostname()),
  );
  await context.dependencies.process.waitForPort(
    id,
    CODE_SERVER_PORT,
    "/",
    CODE_SERVER_START_TIMEOUT_MS,
    { cmdId: relaunched.cmdId, sessionId: relaunched.sessionId },
  );
}

async function startCodeServer(context: ContentContext): Promise<void> {
  await context.dependencies.coordinatedProcess.startProcess({
    command: ["bash", "-lc", codeServerStartCommand()],
    cwd: WORKSPACE_DIR,
    env: codeServerEnvironment(context.runtime.previewHostname()),
    keepAliveTimeoutMs: 0,
    maxRestarts: 3,
    processId: CODE_SERVER_PROCESS_ID,
    restartOnFailure: true,
    timeoutMs: CODE_SERVER_START_TIMEOUT_MS,
    waitForPort: {
      path: "/",
      port: CODE_SERVER_PORT,
      timeoutMs: CODE_SERVER_START_TIMEOUT_MS,
    },
  });
}

function codeServerEnvironment(previewHostname: string): Record<string, string> {
  return {
    CODE_SERVER_PORT: String(CODE_SERVER_PORT),
    CODE_SERVER_TRUSTED_ORIGINS: codeServerTrustedOrigins(previewHostname),
    CODE_SERVER_WORKSPACE: WORKSPACE_DIR,
  };
}

async function hasCodeServerRuntime(runtime: ContentRuntime, id: string): Promise<boolean> {
  const probe = await runtime
    .client()
    .execute(id, { command: "command -v code-server >/dev/null", timeout: 5 })
    .catch(() => null);
  return probe?.exitCode === 0;
}

async function hasCodeServerSettingsMarker(runtime: ContentRuntime, id: string): Promise<boolean> {
  const probe = await runtime
    .client()
    .execute(id, {
      command: `test -f ${shellQuote(CODE_SERVER_SETTINGS_MARKER)}`,
      timeout: 5,
    })
    .catch(() => null);
  return probe?.exitCode === 0;
}

async function ensureCodeServerDisplayFolder(
  runtime: ContentRuntime,
  id: string,
  workspacePath: string,
): Promise<string> {
  const probe = await runtime
    .client()
    .execute(id, {
      command: `ln -sfn ${shellQuote(workspacePath)} ${shellQuote(CODE_SERVER_DISPLAY_DIR)} && test -d ${shellQuote(CODE_SERVER_DISPLAY_DIR)}`,
      timeout: 10,
    })
    .catch(() => null);
  return probe?.exitCode === 0 ? CODE_SERVER_DISPLAY_DIR : workspacePath;
}

async function removeWorkspaceFolder(
  runtime: ContentRuntime,
  id: string,
  workspaceSlug: string,
): Promise<void> {
  try {
    await runtime.client().deleteFilePath(id, `${WORKSPACE_DIR}/${workspaceSlug}`, true);
  } catch (error) {
    throw runtime.toUpstreamError(error, "Project workspace removal failed.");
  }
}

function browserDriverProcessId(runId: string): string {
  return `cheatcode-browser-driver-${safeProcessSuffix(runId)}`;
}

function browserTakeoverProcessId(runId: string): string {
  return `cheatcode-browser-takeover-${safeProcessSuffix(runId)}`;
}

function safeProcessSuffix(value: string): string {
  return value.replaceAll(/[^A-Za-z0-9_-]/g, "-").slice(0, 120);
}

function noVncSessionUrl(signedUrl: string, password: string): string {
  const url = new URL(signedUrl);
  url.pathname = `${url.pathname.replace(/\/?$/u, "/")}vnc.html`;
  url.searchParams.set("autoconnect", "1");
  url.searchParams.set("password", password);
  url.searchParams.set("reconnect", "1");
  url.searchParams.set("resize", "remote");
  return url.toString();
}

function isDaytonaResponseTooLarge(error: unknown): boolean {
  return error instanceof DaytonaApiError && error.code === "daytona_response_too_large";
}

async function projectArchiveResponse(
  upstream: Response,
  cleanup: () => Promise<void>,
): Promise<Response> {
  const declaredLength = boundedArchiveContentLength(upstream.headers.get("Content-Length"));
  if (!upstream.body) {
    throw archiveDownloadError("The sandbox returned an empty archive response.");
  }
  if (declaredLength === "too-large") {
    await upstream.body.cancel().catch(() => undefined);
    throw archiveDownloadError("The sandbox returned an oversized project archive.");
  }
  const headers = new Headers({ "Content-Type": "application/zip" });
  if (declaredLength !== null) headers.set("Content-Length", String(declaredLength));
  return new Response(
    archiveStreamWithCleanup(upstream.body, PROJECT_ARCHIVE_MAX_OUTPUT_BYTES, cleanup),
    { headers },
  );
}

function archiveStreamWithCleanup(
  body: ReadableStream<Uint8Array>,
  maxBytes: number,
  cleanup: () => Promise<void>,
): ReadableStream<Uint8Array> {
  const reader = body.getReader();
  let received = 0;
  let cleanupPromise: Promise<void> | undefined;
  const finish = () => (cleanupPromise ??= cleanup());
  return new ReadableStream<Uint8Array>({
    async cancel(reason) {
      await reader.cancel(reason).catch(() => undefined);
      await finish();
    },
    async pull(controller) {
      try {
        const result = await reader.read();
        if (result.done) {
          controller.close();
          await finish();
          return;
        }
        received += result.value.byteLength;
        if (received > maxBytes) {
          await reader.cancel().catch(() => undefined);
          controller.error(
            archiveDownloadError("The streamed project archive exceeded its limit."),
          );
          await finish();
          return;
        }
        controller.enqueue(result.value);
      } catch (error) {
        controller.error(error);
        await finish();
      }
    },
  });
}

function boundedArchiveContentLength(value: string | null): number | null | "too-large" {
  if (!value || !/^\d+$/u.test(value)) return null;
  const length = Number(value);
  if (!Number.isSafeInteger(length) || length > PROJECT_ARCHIVE_MAX_OUTPUT_BYTES) {
    return "too-large";
  }
  return length;
}

function archiveDownloadError(hint: string): APIError {
  return new APIError(502, "upstream_provider_outage", "Unable to stream this project download", {
    hint,
    retriable: true,
  });
}
