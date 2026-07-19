import { APIError } from "@cheatcode/observability";
import type {
  SandboxDeleteFileResult,
  SandboxListFilesResult,
  SandboxReadFileResult,
  SandboxSearchFilesResult,
  SandboxWriteFileResult,
} from "@cheatcode/sandbox-contracts";
import { DaytonaApiError } from "@cheatcode/tools-code";
import type { SandboxFilePreview } from "@cheatcode/types";
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
  basename,
  buildGrepCommand,
  conversionErrorMessage,
  decodeBase64,
  dirname,
  encodeBase64,
  imageMimeType,
  isOfficePreviewExtension,
  lowercaseExtension,
  MAX_PREVIEW_BYTES,
  PREVIEW_DIR,
  PROJECT_ARCHIVE_MAX_BYTES,
  PROJECT_ARCHIVE_MAX_FILES,
  PROJECT_ARCHIVE_MAX_OUTPUT_BYTES,
  PROJECT_ARCHIVE_SCRIPT,
  parseGrepOutput,
  unsupportedPreview,
  WORKSPACE_DIR,
  withoutExtension,
} from "./project-sandbox-content-support";
import { listSandboxFiles } from "./project-sandbox-files";
import { buildPreviewUrl, signedUrlToExpo } from "./project-sandbox-preview";
import {
  APP_PREVIEW_SLOT_PREFIX,
  type ProcessRecord,
  restartEnvironment,
  shellQuote,
  timeoutSeconds,
} from "./project-sandbox-process-support";
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
  type ProjectDeleteFileInput,
  ProjectDeleteFileInputSchema,
  type ProjectListFilesInput,
  ProjectListFilesInputSchema,
  type ProjectPreviewFileInput,
  ProjectPreviewFileInputSchema,
  type ProjectPreviewStatusInput,
  ProjectPreviewStatusInputSchema,
  type ProjectReadFileInput,
  ProjectReadFileInputSchema,
  type ProjectSearchFilesInput,
  ProjectSearchFilesInputSchema,
  type ProjectSignedPreviewUrlInput,
  ProjectSignedPreviewUrlInputSchema,
  type ProjectWakePreviewInput,
  ProjectWakePreviewInputSchema,
  type ProjectWakePreviewResult,
  type ProjectWriteFileInput,
  ProjectWriteFileInputSchema,
} from "./project-sandbox-runtime";
import { ProjectSandboxWorkspaceTransition } from "./project-sandbox-workspace-transition";

const PREVIEW_STATUS_PROBE_TIMEOUT_MS = 3_000;
const PREVIEW_WAKE_TIMEOUT_MS = 90_000;
const SIGNED_PREVIEW_TTL_SECONDS = 60 * 60;
const SANDBOX_READ_FILE_MAX_BYTES = 1024 * 1024;
const BROWSER_TAKEOVER_PORT_MIN = 60_000;
const BROWSER_TAKEOVER_PORT_MAX = 60_999;
const BROWSER_TAKEOVER_SCRIPT = "/opt/cheatcode/start-browser-takeover.sh";

export abstract class ProjectSandboxContent extends ProjectSandboxWorkspaceTransition {
  public downloadProjectArchive(input: ProjectArchiveInput): Promise<Response> {
    return this.downloadProjectArchiveForRpc(input, () => undefined);
  }

  protected async downloadProjectArchiveForRpc(
    input: ProjectArchiveInput,
    onFinished: () => void,
  ): Promise<Response> {
    const parsed = ProjectArchiveInputSchema.parse(input);
    const archivePath = `/tmp/cheatcode-project-${crypto.randomUUID()}.zip`;
    const workspacePath = `${WORKSPACE_DIR}/${parsed.workspaceSlug}`;
    const result = await this.exec({
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
    const id = await this.ensureSandbox();
    if (!result.success) {
      await this.client()
        .deleteFilePath(id, archivePath, false)
        .catch(() => undefined);
      throw new APIError(422, "sandbox_command_failed", "Unable to prepare this project download", {
        hint: result.stdout.trim().slice(-300) || "Check the project files and try again.",
        retriable: true,
      });
    }
    const client = this.client();
    const cleanup = async (): Promise<void> => {
      try {
        await client.deleteFilePath(id, archivePath, false).catch(() => undefined);
      } finally {
        onFinished();
      }
    };
    try {
      const upstream = await client.downloadFileResponse(id, archivePath);
      return await projectArchiveResponse(upstream, cleanup);
    } catch (error) {
      await cleanup();
      throw error;
    }
  }

  public async readFile(input: ProjectReadFileInput): Promise<SandboxReadFileResult> {
    const parsed = ProjectReadFileInputSchema.parse(input);
    const id = await this.ensureSandbox();
    let bytes: Uint8Array;
    try {
      bytes = await this.client().downloadFile(id, parsed.path, SANDBOX_READ_FILE_MAX_BYTES);
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

  public async previewFile(input: ProjectPreviewFileInput): Promise<SandboxFilePreview> {
    const parsed = ProjectPreviewFileInputSchema.parse(input);
    const extension = lowercaseExtension(parsed.path);
    const imageMime = imageMimeType(extension);
    if (imageMime) {
      return this.base64Preview(parsed.path, parsed.path, "image", imageMime);
    }
    if (extension === ".pdf") {
      return this.base64Preview(parsed.path, parsed.path, "pdf", "application/pdf");
    }
    if (isOfficePreviewExtension(extension)) {
      return this.officePdfPreview(parsed.path);
    }
    return unsupportedPreview(parsed.path, "No preview renderer is available for this file type.");
  }

  public async writeFile(input: ProjectWriteFileInput): Promise<SandboxWriteFileResult> {
    const parsed = ProjectWriteFileInputSchema.parse(input);
    const id = await this.ensureSandbox();
    await this.client()
      .createFolder(id, dirname(parsed.path))
      .catch(() => undefined);
    const bytes =
      parsed.encoding === "base64"
        ? decodeBase64(parsed.content)
        : new TextEncoder().encode(parsed.content);
    await this.client().uploadFile(id, parsed.path, bytes);
    return { path: parsed.path, success: true };
  }

  public async listFiles(input: ProjectListFilesInput): Promise<SandboxListFilesResult> {
    const parsed = ProjectListFilesInputSchema.parse(input);
    const id = await this.ensureSandbox();
    const files = await listSandboxFiles({
      client: this.client(),
      includeHidden: parsed.includeHidden,
      path: parsed.path,
      recursive: parsed.recursive,
      sandboxId: id,
    });
    return { files, path: parsed.path };
  }

  public async searchFiles(input: ProjectSearchFilesInput): Promise<SandboxSearchFilesResult> {
    const parsed = ProjectSearchFilesInputSchema.parse(input);
    const id = await this.ensureSandbox();
    const completed = await this.client().execute(id, {
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

  public async deleteFile(input: ProjectDeleteFileInput): Promise<SandboxDeleteFileResult> {
    const parsed = ProjectDeleteFileInputSchema.parse(input);
    const id = await this.ensureSandbox();
    await this.client().deleteFilePath(id, parsed.path, parsed.recursive);
    return { path: parsed.path, success: true };
  }

  public async getSignedPreviewUrl(
    input: ProjectSignedPreviewUrlInput,
  ): Promise<{ token: string; url: string }> {
    const parsed = ProjectSignedPreviewUrlInputSchema.parse(input);
    const id = await this.ensureSandbox();
    const link = await this.client().getSignedPreviewUrl(id, parsed.port, parsed.expiresInSeconds);
    return { token: link.token, url: link.url };
  }

  public async exposeBrowserTakeover(
    input: ProjectBrowserTakeoverInput,
  ): Promise<ProjectBrowserTakeoverResult> {
    const parsed = ProjectBrowserTakeoverInputSchema.parse(input);
    const browserDriver = await this.processRecord(browserDriverProcessId(parsed.runId));
    if (!browserDriver) {
      throw new APIError(409, "conflict_state_invalid", "No live browser session is available", {
        hint: "Let Cheatcode open a website before taking over the browser.",
        retriable: true,
      });
    }
    const processId = browserTakeoverProcessId(parsed.runId);
    const port = await this.allocateProcessPort({
      maxPort: BROWSER_TAKEOVER_PORT_MAX,
      minPort: BROWSER_TAKEOVER_PORT_MIN,
      processId,
    });
    const password = crypto.randomUUID().replaceAll("-", "");
    await this.startProcess({
      command: ["sh", BROWSER_TAKEOVER_SCRIPT],
      env: { TAKEOVER_PASSWORD: password, TAKEOVER_PORT: String(port) },
      keepAliveTimeoutMs: parsed.expiresInSeconds * 1_000,
      maxRestarts: 0,
      processId,
      restartOnFailure: false,
      waitForPort: { path: "/vnc.html", port, timeoutMs: 30_000 },
    });
    const id = await this.ensureSandbox();
    const signed = await this.client().getSignedPreviewUrl(id, port, parsed.expiresInSeconds);
    const url = noVncSessionUrl(signed.url, password);
    return {
      expiresAt: new Date(Date.now() + parsed.expiresInSeconds * 1_000).toISOString(),
      takeoverId: parsed.takeoverId,
      url,
    };
  }

  public async stopBrowserTakeover(input: ProjectBrowserTakeoverStopInput): Promise<void> {
    const parsed = ProjectBrowserTakeoverStopInputSchema.parse(input);
    await this.killProcess({ processId: browserTakeoverProcessId(parsed.runId) });
  }

  public async exposeCodeServer(input: ProjectCodeServerInput): Promise<{
    expiresAt: string;
    port: number;
    url: string;
    workspacePath: string;
  }> {
    const parsed = ProjectCodeServerInputSchema.parse(input);
    const id = await this.ensureSandbox();
    await this.ensureCodeServer(id);
    const displayFolder =
      parsed.workspacePath === WORKSPACE_DIR
        ? await this.ensureCodeServerDisplayFolder(id, parsed.workspacePath)
        : parsed.workspacePath;
    await this.client()
      .getPreviewLink(id, CODE_SERVER_PORT)
      .catch(() => undefined);
    const built = await buildPreviewUrl({
      hostname: this.previewHostname(),
      port: CODE_SERVER_PORT,
      sandboxId: id,
      secret: await this.previewSecret(),
      useSubdomain: true,
    });
    return {
      expiresAt: built.expiresAt,
      port: CODE_SERVER_PORT,
      url: codeServerFolderUrl(built.url, displayFolder, parsed.initialFilePath),
      workspacePath: parsed.workspacePath,
    };
  }

  public async wakePreview(input: ProjectWakePreviewInput): Promise<ProjectWakePreviewResult> {
    const parsed = ProjectWakePreviewInputSchema.parse(input);
    const id = await this.ensureSandbox();
    const slot = parsed.workspaceSlug
      ? `${APP_PREVIEW_SLOT_PREFIX}${parsed.workspaceSlug}`
      : "app-preview";
    const record = await this.processRecord(slot);
    if (!record?.port) {
      return { running: false, state: "started" };
    }
    const mobile = await this.mobileExpoProxy(id, record);
    const repairedMobileConfig = record.isMobile
      ? await this.ensureMobileMetroForwardedHostConfig(id, record.cwd)
      : false;
    let running = await this.isPortAlive(id, record.port);
    if (!running || repairedMobileConfig) {
      await this.relaunchDevServer(
        id,
        slot,
        record,
        mobile?.restartEnv ?? restartEnvironment(slot, record),
      );
      await this.waitForPort(id, record.port, "/", PREVIEW_WAKE_TIMEOUT_MS).catch(() => undefined);
      running = await this.isPortAlive(id, record.port);
    }
    await this.client()
      .getPreviewLink(id, record.port)
      .catch(() => undefined);
    const built = await buildPreviewUrl({
      hostname: this.previewHostname(),
      isMobile: record.isMobile === true,
      port: record.port,
      sandboxId: id,
      secret: await this.previewSecret(),
    });
    return {
      expiresAt: built.expiresAt,
      port: record.port,
      running,
      state: "started",
      url: built.url,
      ...(mobile?.expoUrl ? { expoUrl: mobile.expoUrl } : {}),
    };
  }

  public async projectPreviewStatus(
    input: ProjectPreviewStatusInput,
  ): Promise<{ running: boolean; state: string }> {
    const parsed = ProjectPreviewStatusInputSchema.parse(input);
    const runtime = await this.sandboxRuntimeState();
    if (runtime.state !== "started" || !runtime.sandboxId) {
      return { running: false, state: runtime.state };
    }
    const record = await this.processRecord(`${APP_PREVIEW_SLOT_PREFIX}${parsed.workspaceSlug}`);
    if (!record?.port) {
      return { running: false, state: runtime.state };
    }
    const running = await this.httpPortReady(
      runtime.sandboxId,
      record.port,
      "/",
      PREVIEW_STATUS_PROBE_TIMEOUT_MS,
    );
    return { running, state: runtime.state };
  }

  public cleanupProjectWorkspace(input: ProjectCleanupWorkspaceInput): Promise<void> {
    const parsed = ProjectCleanupWorkspaceInputSchema.parse(input);
    return this.deleteProjectWorkspace(parsed, () =>
      this.performProjectWorkspaceCleanup(parsed.workspaceSlug),
    );
  }

  private async performProjectWorkspaceCleanup(workspaceSlug: string): Promise<void> {
    const id = await this.ensureExistingSandboxStarted();
    await super.killAllProcesses();
    if (id) {
      await this.terminateUntrackedSandboxProcesses(id);
      await this.removeWorkspaceFolder(id, workspaceSlug);
    }
    await this.freeProjectPort(workspaceSlug);
  }

  private async mobileExpoProxy(
    id: string,
    record: ProcessRecord,
  ): Promise<{ expoUrl: string; restartEnv: Record<string, string> } | null> {
    if (!record.isMobile || record.port === undefined) {
      return null;
    }
    const signed = await this.client()
      .getSignedPreviewUrl(id, record.port, SIGNED_PREVIEW_TTL_SECONDS)
      .catch(() => null);
    if (!signed) {
      return null;
    }
    return {
      expoUrl: signedUrlToExpo(signed.url),
      restartEnv: {
        CI: "1",
        EXPO_NO_TELEMETRY: "1",
        EXPO_PACKAGER_PROXY_URL: signed.url,
        PORT: String(record.port),
      },
    };
  }

  private async base64Preview(
    sourcePath: string,
    previewPath: string,
    kind: "image" | "pdf",
    mimeType: string,
  ): Promise<SandboxFilePreview> {
    const id = await this.ensureSandbox();
    let bytes: Uint8Array;
    try {
      bytes = await this.client().downloadFile(id, previewPath, MAX_PREVIEW_BYTES + 1);
    } catch (error) {
      if (isDaytonaResponseTooLarge(error)) {
        return unsupportedPreview(sourcePath, "Preview file is too large to display inline.");
      }
      throw error;
    }
    if (bytes.byteLength > MAX_PREVIEW_BYTES) {
      return unsupportedPreview(sourcePath, "Preview file is too large to display inline.");
    }
    return {
      content: encodeBase64(bytes),
      encoding: "base64",
      error: null,
      kind,
      mimeType,
      path: sourcePath,
      previewPath,
    };
  }

  private async officePdfPreview(sourcePath: string): Promise<SandboxFilePreview> {
    const id = await this.ensureSandbox();
    if (!(await this.hasLibreOfficeRuntime(id))) {
      return unsupportedPreview(
        sourcePath,
        "Office preview requires the current sandbox image with LibreOffice installed.",
      );
    }
    const outputDir = `${PREVIEW_DIR}/${crypto.randomUUID()}`;
    const command = [
      `mkdir -p ${shellQuote(outputDir)}`,
      `libreoffice --headless --nologo --nofirststartwizard --convert-to pdf --outdir ${shellQuote(
        outputDir,
      )} ${shellQuote(sourcePath)}`,
    ].join(" && ");
    const converted = await this.client()
      .execute(id, { command, cwd: WORKSPACE_DIR, timeout: timeoutSeconds(90_000) })
      .catch((error: unknown) => {
        throw this.toUpstreamError(error, "Office preview conversion failed.");
      });
    if (converted.exitCode !== 0) {
      return unsupportedPreview(sourcePath, conversionErrorMessage(converted.result ?? ""));
    }
    const previewPath = `${outputDir}/${withoutExtension(basename(sourcePath))}.pdf`;
    return this.base64Preview(sourcePath, previewPath, "pdf", "application/pdf");
  }

  private async hasLibreOfficeRuntime(id: string): Promise<boolean> {
    const probe = await this.client()
      .execute(id, { command: "command -v libreoffice >/dev/null", timeout: 5 })
      .catch(() => null);
    return probe?.exitCode === 0;
  }

  private async ensureMobileMetroForwardedHostConfig(id: string, cwd: string): Promise<boolean> {
    const current = await this.client()
      .execute(id, {
        command: 'test -f metro.config.js && grep -q "x-forwarded-host" metro.config.js',
        cwd,
        timeout: 5,
      })
      .catch(() => null);
    if (current?.exitCode === 0) {
      return false;
    }
    const repair = await this.client().execute(id, {
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

  private async ensureCodeServer(id: string): Promise<void> {
    if (
      (await this.httpPortReady(id, CODE_SERVER_PORT, "/", 5_000)) &&
      (await this.hasCodeServerSettingsMarker(id))
    ) {
      return;
    }
    if (!(await this.hasCodeServerRuntime(id))) {
      throw new APIError(502, "sandbox_failed_to_start", "code-server is not installed", {
        hint: "Start a new project sandbox from the current Daytona snapshot to use the Files viewer.",
        retriable: false,
      });
    }
    await this.deleteProcessRecord(id, CODE_SERVER_PROCESS_ID);
    await this.deleteProcessesOnPort(id, CODE_SERVER_PORT, CODE_SERVER_PROCESS_ID);
    await this.client()
      .execute(id, { command: "pkill -f code-server || true", timeout: 5 })
      .catch(() => null);
    await this.startProcess({
      command: ["bash", "-lc", codeServerStartCommand()],
      cwd: WORKSPACE_DIR,
      env: {
        CODE_SERVER_PORT: String(CODE_SERVER_PORT),
        CODE_SERVER_TRUSTED_ORIGINS: codeServerTrustedOrigins(this.previewHostname()),
        CODE_SERVER_WORKSPACE: WORKSPACE_DIR,
      },
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
    if (!(await this.httpPortReady(id, CODE_SERVER_PORT, "/", 5_000))) {
      throw new APIError(502, "sandbox_failed_to_start", "Unable to start code-server", {
        hint: "Rebuild the Daytona sandbox snapshot with code-server, then retry the Files tab.",
        retriable: true,
      });
    }
  }

  private async hasCodeServerRuntime(id: string): Promise<boolean> {
    const probe = await this.client()
      .execute(id, { command: "command -v code-server >/dev/null", timeout: 5 })
      .catch(() => null);
    return probe?.exitCode === 0;
  }

  private async hasCodeServerSettingsMarker(id: string): Promise<boolean> {
    const probe = await this.client()
      .execute(id, {
        command: `test -f ${shellQuote(CODE_SERVER_SETTINGS_MARKER)}`,
        timeout: 5,
      })
      .catch(() => null);
    return probe?.exitCode === 0;
  }

  private async ensureCodeServerDisplayFolder(id: string, workspacePath: string): Promise<string> {
    const probe = await this.client()
      .execute(id, {
        command: `ln -sfn ${shellQuote(workspacePath)} ${shellQuote(CODE_SERVER_DISPLAY_DIR)} && test -d ${shellQuote(CODE_SERVER_DISPLAY_DIR)}`,
        timeout: 10,
      })
      .catch(() => null);
    return probe?.exitCode === 0 ? CODE_SERVER_DISPLAY_DIR : workspacePath;
  }

  private async removeWorkspaceFolder(id: string, workspaceSlug: string): Promise<void> {
    try {
      await this.client().deleteFilePath(id, `${WORKSPACE_DIR}/${workspaceSlug}`, true);
    } catch (error) {
      throw this.toUpstreamError(error, "Project workspace removal failed.");
    }
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
  if (declaredLength !== null) {
    headers.set("Content-Length", String(declaredLength));
  }
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
  if (!value || !/^\d+$/u.test(value)) {
    return null;
  }
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
