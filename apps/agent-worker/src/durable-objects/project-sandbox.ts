import { DurableObject } from "cloudflare:workers";
import { resolveWorkerSecret, type WorkerSecret } from "@cheatcode/env";
import { APIError, createLogger, normalizeUnknownError } from "@cheatcode/observability";
import {
  DaytonaApiError,
  DaytonaClient,
  type DaytonaSandbox,
  type SandboxBackupHandle,
  type SandboxDeleteFileResult,
  type SandboxDestroyResult,
  type SandboxExecResult,
  type SandboxExposePortResult,
  type SandboxKillProcessResult,
  type SandboxListFilesResult,
  type SandboxProcessResult,
  type SandboxReadFileResult,
  type SandboxRestoreBackupResult,
  type SandboxRunCodeResult,
  type SandboxSearchFilesResult,
  type SandboxWriteFileResult,
} from "@cheatcode/tools-code";
import type { SandboxConsoleSnapshot, SandboxFilePreview } from "@cheatcode/types";
import { z } from "zod";
import { type SandboxExecAuditEntry, writeExecAudit } from "./project-sandbox-audit";
import { listSandboxFiles } from "./project-sandbox-files";
import {
  clearSandboxMeterCheckpoint,
  initSandboxMeterCheckpoint,
  recordSandboxUsageBestEffort,
  type SandboxMeteringContext,
  setSandboxQuotaPeriod,
} from "./project-sandbox-metering";
import { buildPreviewUrl, signedUrlToExpo } from "./project-sandbox-preview";
import { emptyConsoleSnapshot, sliceProcessLogs } from "./project-sandbox-process-logs";
import {
  commandToShellString,
  type ProjectAllocatePortInput,
  ProjectAllocatePortInputSchema,
  type ProjectCleanupWorkspaceInput,
  ProjectCleanupWorkspaceInputSchema,
  type ProjectCodeServerInput,
  ProjectCodeServerInputSchema,
  type ProjectCreateBackupInput,
  ProjectCreateBackupInputSchema,
  type ProjectDeleteFileInput,
  ProjectDeleteFileInputSchema,
  type ProjectExecInput,
  ProjectExecInputSchema,
  type ProjectExposePortInput,
  ProjectExposePortInputSchema,
  type ProjectKillProcessInput,
  ProjectKillProcessInputSchema,
  type ProjectListFilesInput,
  ProjectListFilesInputSchema,
  type ProjectPreviewFileInput,
  ProjectPreviewFileInputSchema,
  type ProjectPreviewStatusInput,
  ProjectPreviewStatusInputSchema,
  type ProjectReadDevServerLogsInput,
  ProjectReadDevServerLogsInputSchema,
  type ProjectReadFileInput,
  ProjectReadFileInputSchema,
  type ProjectRestoreBackupInput,
  ProjectRestoreBackupInputSchema,
  type ProjectRunCodeInput,
  ProjectRunCodeInputSchema,
  type ProjectSandboxRuntimeState,
  type ProjectSearchFilesInput,
  ProjectSearchFilesInputSchema,
  type ProjectSignedPreviewUrlInput,
  ProjectSignedPreviewUrlInputSchema,
  type ProjectStartProcessInput,
  ProjectStartProcessInputSchema,
  type ProjectUnexposePortInput,
  ProjectUnexposePortInputSchema,
  type ProjectWakePreviewInput,
  ProjectWakePreviewInputSchema,
  type ProjectWakePreviewResult,
  type ProjectWriteFileInput,
  ProjectWriteFileInputSchema,
} from "./project-sandbox-runtime";

interface ProjectSandboxEnv {
  DAYTONA_API_KEY: WorkerSecret;
  DAYTONA_API_URL: string;
  DAYTONA_TARGET: string;
  DAYTONA_SANDBOX_SNAPSHOT: string;
  DAYTONA_ORG_ID?: string;
  PREVIEW_TOKEN_SECRET: WorkerSecret;
  PREVIEW_HOSTNAME?: string;
  QUOTA_TRACKER?: DurableObjectNamespace;
  R2_AUDIT: R2Bucket;
}

export interface ProjectSandboxStatus {
  healthy: boolean;
  ping: string;
  sandboxId: string;
}

const WORKSPACE_DIR = "/workspace";
// Fallback cwd when relaunching a dev server whose ProcessRecord has no persisted cwd (legacy /
// slug-less projects). Per-project dev servers run in /workspace/<slug> and always persist cwd.
const APP_BUILDER_DIR = "/workspace/app";
const ENV_FILE_DIR = "/home/node/.cc-env";
const DEFAULT_EXEC_TIMEOUT_MS = 60_000;
// Daytona auto-stops after this many idle minutes. IMPORTANT: preview/proxy traffic does NOT
// count as activity (only SDK/toolbox calls do), so a live preview would otherwise die mid-view.
// 30 min softens that; the wake-on-open path (wakePreview) restarts a stopped sandbox + dev server.
const DEFAULT_IDLE_STOP_MIN = 30;
const AUTO_ARCHIVE_MIN = 1_440; // 1 day stopped → cold storage
const NEVER_AUTO_DELETE = -1; // the sandbox disk is the durable store
const APP_PREVIEW_TTL_MS = 24 * 60 * 60 * 1000;
// Daytona's signed preview URL (token in the subdomain) TTL — 24h is Daytona's max. Regenerated on
// every mobile dev-server (re)start so Expo Go always has an unexpired, header-free manifest URL.
const SIGNED_PREVIEW_TTL_SECONDS = 24 * 60 * 60;
// Per-project dev-server slot prefix. Each project's dev server occupies proc:app-preview:<workspaceSlug>
// so multiple projects' servers persist side by side in the one per-user sandbox (bud parity).
const APP_PREVIEW_SLOT_PREFIX = "app-preview:";
// Legacy slug-less projects were built into /workspace/app with the slot "app-preview:app" (the
// app-builder's basename fallback). The status/console/wake routes normalize a null workspaceSlug to
// this so all of them address the same slot instead of the bare "app-preview" default.
const LEGACY_APP_SLUG = "app";
// Single short liveness probe budget for the read-only preview status check (no VM boot).
const PREVIEW_STATUS_PROBE_TIMEOUT_MS = 3_000;
// Per-project dev-server port pools. Web previews start at 5173, mobile (Expo Metro) at 8081, each
// incrementing per new project, unique within the sandbox — the port is per-project, not fixed.
const WEB_PORT_BASE = 5173;
const MOBILE_PORT_BASE = 8081;
const PORT_ALLOC_KEY = "port_alloc";
// Upper bound for a dev server (Expo Metro / Next) to boot when waking a stopped preview.
const PREVIEW_WAKE_TIMEOUT_MS = 90_000;
const CODE_SERVER_PORT = 13_340;
const CODE_SERVER_PROCESS_ID = "code-server";
const CODE_SERVER_START_TIMEOUT_MS = 120_000;
const CODE_SERVER_SETTINGS_MARKER =
  "/home/node/.local/share/code-server/user-data/.cheatcode-settings-v5";
// bud parity: the Explorer header + command center show the opened folder's basename. bud opens a
// "computer" home folder; cheatcode opens the project dir (e.g. /workspace/app → "APP"). A display
// symlink outside the workspace lets the IDE header read "COMPUTER" without relocating the project.
const CODE_SERVER_DISPLAY_DIR = "/home/node/Computer";
const DEFAULT_TAKEOVER_TTL_MS = 15 * 60 * 1000;
const KEEPALIVE_ALARM_MS = 4 * 60 * 1000;
const MAX_RUN_LEASE_MS = 6 * 60 * 60 * 1000;
const STARTED_REVERIFY_MS = 30 * 1000;
const ENSURE_STARTED_ATTEMPTS = 30;
const ENSURE_STARTED_DELAY_MS = 2_000;
const MAX_PREVIEW_BYTES = 15 * 1024 * 1024;
const PREVIEW_DIR = "/workspace/.cheatcode-previews";

const SANDBOX_OWNER_USER_ID_KEY = "sandbox_owner_user_id";
const DAYTONA_ID_KEY = "daytona_sandbox_id";
const RUN_LEASES_KEY = "run_leases";
const SANDBOX_NAME_KEY = "sandbox_name";
const PROC_PREFIX = "proc:";

const OwnerUserIdSchema = z.string().uuid();
const RunLeasesSchema = z.array(z.object({ runId: z.string(), startedMs: z.number() })).default([]);
const ProcessRecordSchema = z
  .object({
    sessionId: z.string(),
    cmdId: z.string(),
    command: z.string(),
    port: z.number().optional(),
    // Mobile (Expo Metro) dev server — the wake path re-mints its signed preview URL. Persisted
    // because the per-project port is no longer a reliable "is mobile" signal.
    isMobile: z.boolean().optional(),
    // cwd + env are persisted so a dev server can be relaunched faithfully after the sandbox
    // idle-stops and its process dies (wakePreview) — the workspace disk survives the restart.
    cwd: z.string().optional(),
    env: z.record(z.string(), z.string()).optional(),
    startedAtMs: z.number().int().nonnegative().optional(),
  })
  .strict();
type ProcessRecord = z.infer<typeof ProcessRecordSchema>;
type NamedProcessRecord = { name: string; record: ProcessRecord };
const PortAllocationSchema = z
  .object({
    webNext: z.number().int().positive().default(WEB_PORT_BASE),
    mobileNext: z.number().int().positive().default(MOBILE_PORT_BASE),
    ports: z.record(z.string(), z.number().int().positive()).default({}),
  })
  .strict();
type PortAllocation = z.infer<typeof PortAllocationSchema>;

export class ProjectSandbox extends DurableObject<ProjectSandboxEnv> {
  private daytonaClient: DaytonaClient | undefined;
  private daytonaId: string | undefined;
  private startedVerifiedAtMs = 0;
  private cachedSandboxName: string | undefined;

  constructor(ctx: DurableObjectState, env: ProjectSandboxEnv) {
    super(ctx, env);
    // `ctx.id.name` is only populated when the DO is addressed via idFromName, and the
    // runtime drops it when it reconstructs the object (alarm wake / eviction / local
    // restart). Persist the name once we ever see it so sandboxName() can recover it on
    // those reconstructions instead of throwing and 500-ing every files/metering call.
    void ctx.blockConcurrencyWhile(async () => {
      const stored = await ctx.storage.get<string>(SANDBOX_NAME_KEY);
      const fromId = ctx.id.name;
      if (fromId) {
        this.cachedSandboxName = fromId;
        if (stored !== fromId) {
          await ctx.storage.put(SANDBOX_NAME_KEY, fromId);
        }
      } else if (typeof stored === "string") {
        this.cachedSandboxName = stored;
      }
    });
  }

  // ----- ownership + quota -----

  public async registerOwner(userId: string, sandboxName?: string): Promise<void> {
    // The caller addressed us via idFromName(sandboxName); persist it so a later
    // alarm-/eviction-reconstructed instance (which loses ctx.id.name) recovers the name.
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
    // Metering checkpoint is opened by beginRun (lifecycle-aware), not at registration.
  }

  public async setQuotaPeriod(periodEndIso: string): Promise<void> {
    await setSandboxQuotaPeriod(this.ctx.storage, periodEndIso);
  }

  // ----- run leases (active-run lifecycle) -----

  public async beginRun(runId: string): Promise<void> {
    const leases = await this.runLeases();
    if (!leases.some((lease) => lease.runId === runId)) {
      leases.push({ runId, startedMs: Date.now() });
      await this.ctx.storage.put(RUN_LEASES_KEY, leases);
    }
    const id = await this.ensureSandbox();
    await this.client()
      .setAutoStopInterval(id, 0)
      .catch(() => undefined);
    await initSandboxMeterCheckpoint(this.ctx.storage);
    await recordSandboxUsageBestEffort(await this.meteringContext());
    await this.ctx.storage.setAlarm(Date.now() + KEEPALIVE_ALARM_MS);
  }

  public async endRun(runId: string): Promise<void> {
    const remaining = (await this.runLeases()).filter((lease) => lease.runId !== runId);
    await this.ctx.storage.put(RUN_LEASES_KEY, remaining);
    await recordSandboxUsageBestEffort(await this.meteringContext());
    if (remaining.length === 0) {
      await clearSandboxMeterCheckpoint(this.ctx.storage);
      await this.ctx.storage.deleteAlarm();
      const id = this.daytonaId;
      if (id) {
        await this.client()
          .setAutoStopInterval(id, DEFAULT_IDLE_STOP_MIN)
          .catch(() => undefined);
      }
    }
  }

  override async alarm(): Promise<void> {
    const leases = (await this.runLeases()).filter(
      (lease) => Date.now() - lease.startedMs < MAX_RUN_LEASE_MS,
    );
    await this.ctx.storage.put(RUN_LEASES_KEY, leases);
    if (leases.length === 0) {
      await clearSandboxMeterCheckpoint(this.ctx.storage);
      return;
    }
    const id = await this.existingSandboxId();
    if (id) {
      await this.client()
        .refreshActivity(id)
        .catch(() => undefined);
    }
    await recordSandboxUsageBestEffort(await this.meteringContext());
    await this.ctx.storage.setAlarm(Date.now() + KEEPALIVE_ALARM_MS);
  }

  // ----- health -----

  public async ensureReady(): Promise<ProjectSandboxStatus> {
    const result = await this.runCode({ code: "print('ready')", language: "python" });
    return {
      healthy: result.success === true,
      ping: result.stdout?.trim() ?? "",
      sandboxId: this.sandboxName(),
    };
  }

  public async getStatus(): Promise<ProjectSandboxStatus> {
    return this.ensureReady();
  }

  public async runtimeSandboxId(): Promise<string> {
    return this.ensureSandbox();
  }

  // ----- code / exec -----

  public async runCode(input: ProjectRunCodeInput): Promise<SandboxRunCodeResult> {
    const parsed = ProjectRunCodeInputSchema.parse(input);
    const command =
      parsed.language === "python"
        ? ["python3", "-c", parsed.code]
        : ["node", "--input-type=module", "-e", parsed.code];
    const result = await this.exec({
      command,
      cwd: WORKSPACE_DIR,
      env: parsed.env,
      timeoutMs: DEFAULT_EXEC_TIMEOUT_MS,
    });
    return {
      exitCode: result.exitCode,
      stderr: result.stderr,
      stdout: result.stdout,
      success: result.success,
    };
  }

  public async exec(input: ProjectExecInput): Promise<SandboxExecResult> {
    const parsed = ProjectExecInputSchema.parse(input);
    const id = await this.ensureSandbox();
    const startedAt = Date.now();
    const command = commandToShellString(parsed.command);
    const cwd = parsed.cwd ?? WORKSPACE_DIR;
    const timeoutMs = parsed.timeoutMs ?? DEFAULT_EXEC_TIMEOUT_MS;
    try {
      const completed = await this.client().execute(id, {
        command,
        cwd,
        timeout: timeoutSeconds(timeoutMs),
        ...(parsed.env === undefined ? {} : { env: parsed.env }),
      });
      const stdout = completed.result ?? "";
      const result: SandboxExecResult = {
        command,
        durationMs: Date.now() - startedAt,
        exitCode: completed.exitCode,
        stderr: "",
        stdout,
        success: completed.exitCode === 0,
      };
      await this.writeExecAudit({
        argc: parsed.command.length,
        argv0: parsed.command[0] ?? "unknown",
        cwd,
        durationMs: result.durationMs ?? 0,
        exitCode: completed.exitCode,
        processName: command.slice(0, 64),
        sandboxId: this.sandboxName(),
        status: result.success ? "completed" : "failed",
        success: result.success,
        timestamp: new Date(startedAt).toISOString(),
        type: "sandbox_exec",
      });
      await recordSandboxUsageBestEffort(await this.meteringContext());
      return result;
    } catch (error) {
      throw this.toUpstreamError(error, "Sandbox command failed.");
    }
  }

  public async startProcess(input: ProjectStartProcessInput): Promise<SandboxProcessResult> {
    const parsed = ProjectStartProcessInputSchema.parse(input);
    // A port-bound process must carry an explicit processId (its dev-server slot). Without one it
    // would land in the shared bare "app-preview" slot and could clobber another project's dev
    // server in the per-user sandbox, so refuse it loudly instead of silently sharing a slot.
    if (parsed.waitForPort && !parsed.processId) {
      throw new APIError(
        400,
        "invalid_request_body",
        "A port-bound sandbox process requires an explicit processId.",
        { retriable: false },
      );
    }
    const id = await this.ensureSandbox();
    const client = this.client();
    const name = parsed.processId ?? `process-${crypto.randomUUID()}`;
    const sessionId = `cc-${name}`;
    if (parsed.processId || parsed.waitForPort) {
      await this.deleteProcessRecord(id, name);
      if (parsed.waitForPort) {
        await this.deleteProcessesOnPort(id, parsed.waitForPort.port, name);
      }
    }
    const cwd = parsed.cwd ?? WORKSPACE_DIR;
    const command = await this.buildSessionCommand(
      id,
      sessionId,
      cwd,
      commandToShellString(parsed.command),
      parsed.env,
    );
    await client.createSession(id, sessionId);
    const exec = await client.execSessionCommand(id, sessionId, command, true);
    const cmdId = exec.cmdId ?? sessionId;
    const record: ProcessRecord = {
      sessionId,
      cmdId,
      command: commandToShellString(parsed.command),
      ...(parsed.waitForPort ? { port: parsed.waitForPort.port } : {}),
      ...(parsed.isMobile ? { isMobile: true } : {}),
      cwd,
      ...(parsed.env && Object.keys(parsed.env).length > 0 ? { env: parsed.env } : {}),
      startedAtMs: Date.now(),
    };
    await this.ctx.storage.put(`${PROC_PREFIX}${name}`, record);
    if (parsed.waitForPort) {
      await this.waitForPort(
        id,
        parsed.waitForPort.port,
        parsed.waitForPort.path,
        parsed.waitForPort.timeoutMs,
      );
    }
    await recordSandboxUsageBestEffort(await this.meteringContext());
    return { command: record.command, id: name, status: "running" };
  }

  // ----- filesystem -----

  public async readFile(input: ProjectReadFileInput): Promise<SandboxReadFileResult> {
    const parsed = ProjectReadFileInputSchema.parse(input);
    const id = await this.ensureSandbox();
    const bytes = await this.client().downloadFile(id, parsed.path);
    if (parsed.encoding === "base64") {
      return { content: encodeBase64(bytes), encoding: "base64", path: parsed.path };
    }
    return { content: new TextDecoder().decode(bytes), encoding: "utf8", path: parsed.path };
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
    const dir = dirname(parsed.path);
    await this.client()
      .createFolder(id, dir)
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
    const command = buildGrepCommand(parsed);
    const completed = await this.client().execute(id, {
      command,
      cwd: WORKSPACE_DIR,
      timeout: timeoutSeconds(DEFAULT_EXEC_TIMEOUT_MS),
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

  // ----- preview / ports -----

  public async exposePort(input: ProjectExposePortInput): Promise<SandboxExposePortResult> {
    const parsed = ProjectExposePortInputSchema.parse(input);
    const id = await this.ensureSandbox();
    // Warm the Daytona port so the proxy's first getPreviewLink resolves quickly.
    await this.client()
      .getPreviewLink(id, parsed.port)
      .catch(() => undefined);
    const secret = await this.previewSecret();
    const hostname = this.previewHostname(parsed.hostname);
    const mode = parsed.tokenTtlMs === undefined ? "app" : "takeover";
    const ttlMs =
      parsed.tokenTtlMs ?? (mode === "app" ? APP_PREVIEW_TTL_MS : DEFAULT_TAKEOVER_TTL_MS);
    const built = await buildPreviewUrl({
      hostname,
      isMobile: parsed.isMobile,
      mode,
      port: parsed.port,
      sandboxId: id,
      secret,
      ttlMs,
    });
    return {
      ...(parsed.name === undefined ? {} : { name: parsed.name }),
      port: parsed.port,
      token: built.token,
      url: built.url,
    };
  }

  // Get-or-assign this project's stable dev-server port within the per-user sandbox. Web previews
  // draw from 5173+, mobile (Expo Metro) from 8081+, each unique across the sandbox's projects.
  public async allocateProjectPort(input: ProjectAllocatePortInput): Promise<number> {
    const parsed = ProjectAllocatePortInputSchema.parse(input);
    const alloc = await this.portAllocation();
    const existing = alloc.ports[parsed.projectId];
    if (existing !== undefined) {
      return existing;
    }
    const used = new Set(Object.values(alloc.ports));
    let candidate = parsed.stack === "mobile" ? alloc.mobileNext : alloc.webNext;
    while (used.has(candidate)) {
      candidate += 1;
    }
    alloc.ports[parsed.projectId] = candidate;
    if (parsed.stack === "mobile") {
      alloc.mobileNext = candidate + 1;
    } else {
      alloc.webNext = candidate + 1;
    }
    await this.ctx.storage.put(PORT_ALLOC_KEY, alloc);
    return candidate;
  }

  // Mint a Daytona-signed preview URL for a port. Unlike the custom token-gated proxy URL, the
  // token lives in the subdomain, so the URL is reachable with no header/cookie — used to hand
  // Expo Go a working manifest URL and to set the Metro dev server's EXPO_PACKAGER_PROXY_URL.
  public async getSignedPreviewUrl(
    input: ProjectSignedPreviewUrlInput,
  ): Promise<{ token: string; url: string }> {
    const parsed = ProjectSignedPreviewUrlInputSchema.parse(input);
    const id = await this.ensureSandbox();
    const link = await this.client().getSignedPreviewUrl(id, parsed.port, parsed.expiresInSeconds);
    return { token: link.token, url: link.url };
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
    // bud parity: a project-less chat opens the whole computer (/workspace) via a "Computer"-named
    // display symlink so the Explorer header reads "COMPUTER" and every project shows as a
    // subfolder. A project chat opens its own folder (/workspace/<slug>) directly, whose basename
    // (the slug) becomes the header — no symlink needed. Falls back to the real path on symlink
    // failure so the Files tab never opens an empty/broken folder.
    const displayFolder =
      parsed.workspacePath === WORKSPACE_DIR
        ? await this.ensureCodeServerDisplayFolder(id, parsed.workspacePath)
        : parsed.workspacePath;
    if (parsed.initialFilePath) {
      await this.openCodeServerFile(id, parsed.initialFilePath).catch(() => undefined);
    }
    const hostname = this.previewHostname(parsed.hostname);
    await this.client()
      .getPreviewLink(id, CODE_SERVER_PORT)
      .catch(() => undefined);
    const secret = await this.previewSecret();
    const built = await buildPreviewUrl({
      hostname,
      mode: "code",
      port: CODE_SERVER_PORT,
      sandboxId: id,
      secret,
      ttlMs: APP_PREVIEW_TTL_MS,
    });
    return {
      expiresAt: built.expiresAt,
      port: CODE_SERVER_PORT,
      url: codeServerFolderUrl(built.url, displayFolder),
      workspacePath: parsed.workspacePath,
    };
  }

  // Wake the app preview: start the sandbox if it idle-stopped (Daytona preview traffic does
  // not reset the auto-stop timer, so this is the common case) and relaunch the dev server from
  // its stored command if the process died with the VM. Returns a fresh preview URL + liveness.
  public async wakePreview(input: ProjectWakePreviewInput): Promise<ProjectWakePreviewResult> {
    const parsed = ProjectWakePreviewInputSchema.parse(input);
    const id = await this.ensureSandbox();
    const slot = parsed.workspaceSlug
      ? `${APP_PREVIEW_SLOT_PREFIX}${parsed.workspaceSlug}`
      : "app-preview";
    const record = await this.processRecord(slot);
    if (!record?.port) {
      // No dev server tracked for this project (e.g. a docs/data project or a project-less chat).
      return { running: false, state: "started" };
    }
    const port = record.port;
    // Mobile: re-mint the header-free signed URL and thread EXPO_PACKAGER_PROXY_URL into the
    // relaunch env so Metro emits bundle/asset URLs on that host after a restart.
    const mobile = await this.mobileExpoProxy(id, record);
    let running = await this.isPortAlive(id, port);
    if (!running) {
      await this.relaunchDevServer(id, slot, mobile?.record ?? record);
      await this.waitForPort(id, port, "/", PREVIEW_WAKE_TIMEOUT_MS).catch(() => undefined);
      running = await this.isPortAlive(id, port);
    }
    await this.client()
      .getPreviewLink(id, port)
      .catch(() => undefined);
    const secret = await this.previewSecret();
    const hostname = this.previewHostname(parsed.hostname);
    const built = await buildPreviewUrl({
      hostname,
      isMobile: record.isMobile === true,
      mode: "app",
      port,
      sandboxId: id,
      secret,
      ttlMs: APP_PREVIEW_TTL_MS,
    });
    return {
      expiresAt: built.expiresAt,
      port,
      running,
      state: "started",
      url: built.url,
      ...(mobile?.expoUrl ? { expoUrl: mobile.expoUrl } : {}),
    };
  }

  // For a mobile Expo dev server, mint a fresh 24h signed preview URL (token in the subdomain, so
  // Expo Go reaches it with no header), thread EXPO_PACKAGER_PROXY_URL into the relaunch env so
  // Metro's bundle/asset URLs use that signed host, and derive the exps:// deep link. Returns null
  // for non-mobile dev servers or when signing is unavailable.
  private async mobileExpoProxy(
    id: string,
    record: ProcessRecord,
  ): Promise<{ expoUrl: string; record: ProcessRecord } | null> {
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
      record: { ...record, env: { ...record.env, EXPO_PACKAGER_PROXY_URL: signed.url } },
    };
  }

  // Current Daytona lifecycle state without forcing a start — the status surface for the
  // preview panel (kept fresh by sandbox.state.updated webhooks, falls back to a live read).
  // The stored Daytona sandbox UUID with no upstream call (cache key for the state webhook);
  // null if this project has never resolved a sandbox.
  public async existingDaytonaId(): Promise<string | null> {
    return this.daytonaId ?? (await this.storedDaytonaId());
  }

  public async sandboxRuntimeState(): Promise<ProjectSandboxRuntimeState> {
    const existing = await this.existingSandboxId();
    if (!existing) {
      return { state: "none" };
    }
    const sandbox = await this.client()
      .getSandbox(existing)
      .catch(() => null);
    return { sandboxId: existing, state: sandbox?.state ?? "unknown" };
  }

  // Read-only preview liveness for the status panel: resolve the shared sandbox's lifecycle state
  // WITHOUT booting it (no ensureSandbox), then — only when the VM is started — probe THIS project's
  // own dev-server port so a dead dev server reads as not-running even while the sandbox is up (an
  // idle-stop can kill the dev-server process without stopping the VM). The slot is keyed by
  // workspaceSlug (defaulting to "app" for legacy slug-less projects), matching start_dev_server +
  // wakePreview, so each project reports on its own server rather than the shared sandbox state.
  public async projectPreviewStatus(
    input: ProjectPreviewStatusInput,
  ): Promise<{ running: boolean; state: string }> {
    const parsed = ProjectPreviewStatusInputSchema.parse(input);
    const runtime = await this.sandboxRuntimeState();
    if (runtime.state !== "started" || !runtime.sandboxId) {
      return { running: false, state: runtime.state };
    }
    const slug = parsed.workspaceSlug ?? LEGACY_APP_SLUG;
    const record = await this.processRecord(`${APP_PREVIEW_SLOT_PREFIX}${slug}`);
    if (!record?.port) {
      // Sandbox is up but this project has no tracked dev server (a docs/data project, or one not
      // started yet) — nothing is serving a preview.
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

  public async unexposePort(input: ProjectUnexposePortInput): Promise<void> {
    ProjectUnexposePortInputSchema.parse(input);
    // Daytona has no per-port preview object to delete; tokens expire on TTL.
  }

  public async killAllProcesses(): Promise<number> {
    const id = await this.existingSandboxId();
    const records = await this.ctx.storage.list({ prefix: PROC_PREFIX });
    let killed = 0;
    for (const [key, value] of records) {
      const record = ProcessRecordSchema.safeParse(value);
      if (id && record.success) {
        await this.client()
          .deleteSession(id, record.data.sessionId)
          .catch(() => undefined);
        killed += 1;
      }
      await this.ctx.storage.delete(key);
    }
    return killed;
  }

  public async killProcess(input: ProjectKillProcessInput): Promise<SandboxKillProcessResult> {
    const parsed = ProjectKillProcessInputSchema.parse(input);
    const record = await this.processRecord(parsed.processId);
    if (record) {
      const id = await this.existingSandboxId();
      if (id) {
        await this.client()
          .deleteSession(id, record.sessionId)
          .catch(() => undefined);
      }
      await this.ctx.storage.delete(`${PROC_PREFIX}${parsed.processId}`);
    }
    return { processId: parsed.processId, status: "killed", success: true };
  }

  public async readDevServerLogs(
    input: ProjectReadDevServerLogsInput,
  ): Promise<SandboxConsoleSnapshot> {
    const parsed = ProjectReadDevServerLogsInputSchema.parse(input);
    const id = await this.existingSandboxId();
    const processes = await this.processRecordsForRead(parsed.processId);
    if (id === null || processes.length === 0) {
      return emptyConsoleSnapshot({ stderr: parsed.stderrCursor, stdout: parsed.stdoutCursor });
    }
    for (const process of processes) {
      const { name, record } = process;
      try {
        const buffer = await this.client().getSessionCommandLogs(
          id,
          record.sessionId,
          record.cmdId,
        );
        const sliced = sliceProcessLogs({
          lastPid: parsed.lastPid,
          pid: record.cmdId,
          stderrCursor: parsed.stderrCursor,
          stderrText: "",
          stdoutCursor: parsed.stdoutCursor,
          stdoutText: buffer,
          tail: parsed.tail,
        });
        return {
          ...sliced,
          process: {
            command: record.command,
            id: name,
            pid: record.cmdId,
            status: "running",
          },
        };
      } catch (error) {
        if (isMissingDaytonaProcessError(error)) {
          await this.ctx.storage.delete(`${PROC_PREFIX}${name}`);
          continue;
        }
        throw this.toUpstreamError(error, "Sandbox console read failed.");
      }
    }
    return emptyConsoleSnapshot({ stderr: parsed.stderrCursor, stdout: parsed.stdoutCursor });
  }

  private async base64Preview(
    sourcePath: string,
    previewPath: string,
    kind: "image" | "pdf",
    mimeType: string,
  ): Promise<SandboxFilePreview> {
    const id = await this.ensureSandbox();
    const bytes = await this.client().downloadFile(id, previewPath);
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
      .execute(id, {
        command,
        cwd: WORKSPACE_DIR,
        timeout: timeoutSeconds(90_000),
      })
      .catch((error: unknown) => {
        throw this.toUpstreamError(error, "Office preview conversion failed.");
      });
    if (converted.exitCode !== 0) {
      return unsupportedPreview(sourcePath, conversionErrorMessage(converted.result ?? ""));
    }
    const previewPath = `${outputDir}/${withoutExtension(basename(sourcePath))}.pdf`;
    return this.base64Preview(sourcePath, previewPath, "pdf", "application/pdf");
  }

  // ----- backup / restore (sandbox disk is the durable store) -----

  public async createBackup(input: ProjectCreateBackupInput): Promise<SandboxBackupHandle> {
    const parsed = ProjectCreateBackupInputSchema.parse(input);
    const id = await this.ensureSandbox();
    await this.client()
      .setAutoDeleteInterval(id, NEVER_AUTO_DELETE)
      .catch(() => undefined);
    return { dir: parsed.dir, id };
  }

  public async restoreBackup(
    input: ProjectRestoreBackupInput,
  ): Promise<SandboxRestoreBackupResult> {
    const parsed = ProjectRestoreBackupInputSchema.parse(input);
    const id = await this.ensureSandbox();
    return { dir: parsed.backup.dir, id, success: true };
  }

  // ----- teardown -----

  public async destroySandbox(): Promise<SandboxDestroyResult> {
    await recordSandboxUsageBestEffort(await this.meteringContext());
    const client = await this.ensureClient();
    try {
      await client.deleteSandbox(this.sandboxName()).catch((error: unknown) => {
        if (!isMissingDaytonaResourceError(error)) {
          throw error;
        }
      });
      const id = this.daytonaId;
      if (id && id !== this.sandboxName()) {
        await client.deleteSandbox(id).catch(() => undefined);
      }
    } catch (error) {
      throw this.toUpstreamError(error, "Daytona sandbox deletion failed.");
    }
    this.daytonaClient = undefined;
    this.daytonaId = undefined;
    this.startedVerifiedAtMs = 0;
    await this.ctx.storage.delete(DAYTONA_ID_KEY);
    await clearSandboxMeterCheckpoint(this.ctx.storage);
    return { deleted: true, sandboxId: this.sandboxName() };
  }

  /** No-op under the disk-persistence model (no Daytona Volumes). */
  public async deleteProjectVolume(): Promise<boolean> {
    return false;
  }

  public async deleteDurableState(): Promise<void> {
    await this.ctx.storage.deleteAll();
    this.daytonaClient = undefined;
    this.daytonaId = undefined;
    this.startedVerifiedAtMs = 0;
  }

  // Best-effort teardown of ONE project's footprint inside the shared per-user sandbox: kills the
  // project's dev server, frees its port allocation, and removes its /workspace/<slug> folder. It
  // deliberately never destroys the sandbox or wipes DO state (that would nuke the user's OTHER
  // projects). Project deletion must not fail on cleanup, so every step is catch-and-log.
  public async cleanupProjectWorkspace(input: ProjectCleanupWorkspaceInput): Promise<void> {
    try {
      const { workspaceSlug } = ProjectCleanupWorkspaceInputSchema.parse(input);
      const id = await this.existingSandboxId();
      if (!id) {
        // Nothing provisioned — no dev server, port, or folder to reclaim.
        return;
      }
      const slot = `${APP_PREVIEW_SLOT_PREFIX}${workspaceSlug}`;
      const port = (await this.portAllocation()).ports[workspaceSlug];
      await this.deleteProcessRecord(id, slot);
      if (port !== undefined) {
        await this.deleteProcessesOnPort(id, port, slot);
        await this.unexposePort({ port });
      }
      await this.freeProjectPort(workspaceSlug);
      await this.removeWorkspaceFolder(id, workspaceSlug);
    } catch (error) {
      createLogger().warn("project_workspace_cleanup_failed", {
        error: error instanceof Error ? error.message : "Unknown cleanup error",
      });
    }
  }

  // Drop a project's dev-server port from the DO allocation table. webNext/mobileNext are left as-is
  // so freed ports are never recycled — a rebuilt project always takes the next fresh port.
  private async freeProjectPort(workspaceSlug: string): Promise<void> {
    const alloc = await this.portAllocation();
    if (alloc.ports[workspaceSlug] === undefined) {
      return;
    }
    const ports = Object.fromEntries(
      Object.entries(alloc.ports).filter(([slug]) => slug !== workspaceSlug),
    );
    await this.ctx.storage.put(PORT_ALLOC_KEY, { ...alloc, ports });
  }

  // Best-effort `rm -rf` of a single project's folder. Guarded so the target is always a non-empty
  // child of /workspace and can never resolve to /workspace itself or escape it.
  private async removeWorkspaceFolder(id: string, workspaceSlug: string): Promise<void> {
    if (!isSingleWorkspaceSegment(workspaceSlug)) {
      return;
    }
    const path = `${WORKSPACE_DIR}/${workspaceSlug}`;
    await this.client()
      .execute(id, {
        command: `rm -rf ${shellQuote(path)}`,
        timeout: timeoutSeconds(DEFAULT_EXEC_TIMEOUT_MS),
      })
      .catch(() => undefined);
  }

  // ----- internals -----

  private client(): DaytonaClient {
    if (!this.daytonaClient) {
      throw new Error("Daytona client accessed before initialization.");
    }
    return this.daytonaClient;
  }

  private async ensureClient(): Promise<DaytonaClient> {
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
    });
    return this.daytonaClient;
  }

  /** Get-or-create the Daytona sandbox and ensure it is started; returns its id. */
  private async ensureSandbox(): Promise<string> {
    const client = await this.ensureClient();
    if (this.daytonaId && Date.now() - this.startedVerifiedAtMs < STARTED_REVERIFY_MS) {
      return this.daytonaId;
    }
    const resolved = await this.resolveSandbox(client);
    this.daytonaId = resolved.id;
    await this.ctx.storage.put(DAYTONA_ID_KEY, resolved.id);
    await this.ensureStarted(client, resolved);
    this.startedVerifiedAtMs = Date.now();
    return resolved.id;
  }

  private async resolveSandbox(client: DaytonaClient): Promise<DaytonaSandbox> {
    const name = this.sandboxName();
    const cachedId = this.daytonaId ?? (await this.storedDaytonaId());
    if (cachedId) {
      const existing = await client.getSandbox(cachedId).catch(() => null);
      if (existing && !isDestroyed(existing)) {
        return existing;
      }
    }
    const byLabel = await client
      .listSandboxesByLabels({ app: "cheatcode", sandboxId: name })
      .catch(() => [] as DaytonaSandbox[]);
    const live = byLabel.filter((sb) => !isDestroyed(sb));
    if (live.length > 0) {
      const [primary, ...extras] = live;
      for (const extra of extras) {
        await client.deleteSandbox(extra.id).catch(() => undefined);
      }
      if (primary) {
        return primary;
      }
    }
    return this.createSandbox(client, name);
  }

  private async createSandbox(client: DaytonaClient, name: string): Promise<DaytonaSandbox> {
    try {
      return await client.createSandbox({
        name,
        snapshot: this.env.DAYTONA_SANDBOX_SNAPSHOT,
        target: this.env.DAYTONA_TARGET,
        user: "node", // our image runs as `node` with /workspace + templates owned by node
        labels: { app: "cheatcode", sandboxId: name },
        autoStopInterval: DEFAULT_IDLE_STOP_MIN,
        autoArchiveInterval: AUTO_ARCHIVE_MIN,
        autoDeleteInterval: NEVER_AUTO_DELETE,
      });
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
    const byName = await client.getSandbox(name).catch(() => null);
    if (byName && !isDestroyed(byName)) {
      return byName;
    }
    const byLabel = await client
      .listSandboxesByLabels({ app: "cheatcode", sandboxId: name })
      .catch(() => [] as DaytonaSandbox[]);
    return byLabel.find((sandbox) => !isDestroyed(sandbox)) ?? null;
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
          {
            details: { sandboxId: this.sandboxName(), state: current.state },
            retriable: true,
          },
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

  private async existingSandboxId(): Promise<string | null> {
    const client = await this.ensureClient();
    const cachedId = this.daytonaId ?? (await this.storedDaytonaId());
    if (cachedId) {
      const existing = await client.getSandbox(cachedId).catch(() => null);
      if (existing && !isDestroyed(existing)) {
        this.daytonaId = existing.id;
        return existing.id;
      }
    }
    const byLabel = await client
      .listSandboxesByLabels({ app: "cheatcode", sandboxId: this.sandboxName() })
      .catch(() => [] as DaytonaSandbox[]);
    const live = byLabel.find((sb) => !isDestroyed(sb));
    if (live) {
      this.daytonaId = live.id;
      return live.id;
    }
    return null;
  }

  private async buildSessionCommand(
    id: string,
    sessionId: string,
    cwd: string,
    rawCommand: string,
    env: Record<string, string> | undefined,
  ): Promise<string> {
    if (!env || Object.keys(env).length === 0) {
      return `cd ${shellQuote(cwd)} && ${rawCommand}`;
    }
    // Secrets must never be inlined (leak to logs/ps/session). Write an env file
    // OUTSIDE /workspace (excluded from backups/listing), source it, delete it,
    // then exec — the dev server inherits the exported vars for its lifetime.
    const envPath = `${ENV_FILE_DIR}/${sessionId}.env`;
    const body = Object.entries(env)
      .map(([key, value]) => `export ${key}=${shellQuote(value)}`)
      .join("\n");
    await this.client()
      .createFolder(id, ENV_FILE_DIR, "0700")
      .catch(() => undefined);
    await this.client().uploadFile(id, envPath, new TextEncoder().encode(`${body}\n`));
    await this.client()
      .execute(id, { command: `chmod 600 ${shellQuote(envPath)}`, timeout: 10 })
      .catch(() => undefined);
    return `cd ${shellQuote(cwd)} && set -a && . ${shellQuote(envPath)} && rm -f ${shellQuote(envPath)} && set +a && ${rawCommand}`;
  }

  // Single-shot liveness probe for a dev server port (inside the sandbox).
  private async isPortAlive(id: string, port: number): Promise<boolean> {
    const probe = await this.client()
      .execute(id, {
        command: `curl -sf -o /dev/null --max-time 3 http://localhost:${port}/`,
        timeout: 5,
      })
      .catch(() => null);
    return probe?.exitCode === 0;
  }

  // Re-exec a stored dev-server command in a fresh toolbox session. Called after a VM restart,
  // where the workspace disk survives but the process (and its session) are gone.
  private async relaunchDevServer(id: string, name: string, record: ProcessRecord): Promise<void> {
    const sessionId = record.sessionId || `cc-${name}`;
    const cwd = record.cwd ?? APP_BUILDER_DIR;
    await this.client()
      .createSession(id, sessionId)
      .catch(() => undefined);
    const command = await this.buildSessionCommand(id, sessionId, cwd, record.command, record.env);
    const exec = await this.client().execSessionCommand(id, sessionId, command, true);
    await this.ctx.storage.put(`${PROC_PREFIX}${name}`, {
      ...record,
      cmdId: exec.cmdId ?? sessionId,
      startedAtMs: Date.now(),
    } satisfies ProcessRecord);
  }

  private async waitForPort(
    id: string,
    port: number,
    path: string | undefined,
    timeoutMs: number | undefined,
  ): Promise<void> {
    const deadline = Date.now() + (timeoutMs ?? 120_000);
    const url = `http://localhost:${port}${path ?? "/"}`;
    while (Date.now() < deadline) {
      const probe = await this.client()
        .execute(id, {
          command: `curl -sf -o /dev/null --max-time 3 ${shellQuote(url)}`,
          timeout: 5,
        })
        .catch(() => null);
      if (probe && probe.exitCode === 0) {
        return;
      }
      await sleep(1_500);
    }
  }

  private async hasLibreOfficeRuntime(id: string): Promise<boolean> {
    const probe = await this.client()
      .execute(id, {
        command: "command -v libreoffice >/dev/null",
        timeout: 5,
      })
      .catch(() => null);
    return probe?.exitCode === 0;
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
      .execute(id, {
        command: "pkill -f code-server || true",
        timeout: 5,
      })
      .catch(() => null);
    await this.startProcess({
      command: ["bash", "-lc", codeServerStartCommand()],
      cwd: WORKSPACE_DIR,
      env: {
        CODE_SERVER_PORT: String(CODE_SERVER_PORT),
        CODE_SERVER_TRUSTED_ORIGINS: "localhost:8787,*.localhost:8787,*.trycheatcode.com",
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
    if (await this.httpPortReady(id, CODE_SERVER_PORT, "/", 5_000)) {
      return;
    }
    throw new APIError(502, "sandbox_failed_to_start", "Unable to start code-server", {
      hint: "Rebuild the Daytona sandbox snapshot with code-server, then retry the Files tab.",
      retriable: true,
    });
  }

  private async hasCodeServerRuntime(id: string): Promise<boolean> {
    const probe = await this.client()
      .execute(id, {
        command: "command -v code-server >/dev/null",
        timeout: 5,
      })
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
    // A symlink OUTSIDE the workspace (so it can point at /workspace or any subfolder without
    // self-recursion) whose basename is "Computer". code-server renders that basename as the
    // Explorer root header + command-center label, matching bud's "COMPUTER". If the link can't be
    // created we fall back to the real path so the Files tab still opens the project.
    const probe = await this.client()
      .execute(id, {
        command: `ln -sfn ${shellQuote(workspacePath)} ${shellQuote(CODE_SERVER_DISPLAY_DIR)} && test -d ${shellQuote(CODE_SERVER_DISPLAY_DIR)}`,
        timeout: 10,
      })
      .catch(() => null);
    return probe?.exitCode === 0 ? CODE_SERVER_DISPLAY_DIR : workspacePath;
  }

  private async openCodeServerFile(id: string, path: string): Promise<void> {
    await this.client().execute(id, {
      command: [
        "CODE_SERVER_USER_DATA_DIR=/home/node/.local/share/code-server/user-data",
        "CODE_SERVER_EXTENSIONS_DIR=/home/node/.local/share/code-server/extensions",
        "code-server",
        "--user-data-dir /home/node/.local/share/code-server/user-data",
        "--extensions-dir /home/node/.local/share/code-server/extensions",
        "--reuse-window",
        shellQuote(path),
        ">/tmp/cheatcode-code-server-open-file.log 2>&1 || true",
      ].join(" "),
      timeout: 15,
    });
  }

  private async httpPortReady(
    id: string,
    port: number,
    path: string,
    timeoutMs: number,
  ): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    const url = `http://localhost:${port}${path}`;
    while (Date.now() < deadline) {
      const probe = await this.client()
        .execute(id, {
          command: `curl -sf -o /dev/null --max-time 3 ${shellQuote(url)}`,
          timeout: 5,
        })
        .catch(() => null);
      if (probe?.exitCode === 0) {
        return true;
      }
      await sleep(1_000);
    }
    return false;
  }

  private async meteringContext(): Promise<SandboxMeteringContext> {
    return {
      env: this.env,
      ownerUserId: await this.ownerUserId(),
      sandboxId: this.sandboxName(),
      storage: this.ctx.storage,
    };
  }

  private async previewSecret(): Promise<string> {
    const secret = await resolveWorkerSecret(this.env.PREVIEW_TOKEN_SECRET);
    if (!secret) {
      throw new APIError(503, "unavailable_maintenance", "PREVIEW_TOKEN_SECRET is not configured", {
        retriable: false,
      });
    }
    return secret;
  }

  private previewHostname(hostname: string | undefined): string {
    if (this.env.PREVIEW_HOSTNAME && (hostname === undefined || hostname === "trycheatcode.com")) {
      return this.env.PREVIEW_HOSTNAME;
    }
    return hostname ?? this.env.PREVIEW_HOSTNAME ?? "trycheatcode.com";
  }

  private async runLeases(): Promise<Array<{ runId: string; startedMs: number }>> {
    return RunLeasesSchema.parse((await this.ctx.storage.get(RUN_LEASES_KEY)) ?? []);
  }

  private async portAllocation(): Promise<PortAllocation> {
    return PortAllocationSchema.parse((await this.ctx.storage.get(PORT_ALLOC_KEY)) ?? {});
  }

  private async processRecord(name: string): Promise<ProcessRecord | null> {
    const value = await this.ctx.storage.get(`${PROC_PREFIX}${name}`);
    const parsed = ProcessRecordSchema.safeParse(value);
    return parsed.success ? parsed.data : null;
  }

  private async processRecordsForRead(name: string): Promise<NamedProcessRecord[]> {
    const exact = await this.processRecord(name);
    const records = await this.ctx.storage.list({ prefix: PROC_PREFIX });
    const fallback: NamedProcessRecord[] = [];
    for (const [key, value] of records) {
      const parsed = ProcessRecordSchema.safeParse(value);
      if (!parsed.success) {
        continue;
      }
      const candidate = { name: key.slice(PROC_PREFIX.length), record: parsed.data };
      if (candidate.name === CODE_SERVER_PROCESS_ID) {
        continue;
      }
      if (candidate.name !== name) {
        fallback.push(candidate);
      }
    }
    fallback.sort((left, right) => compareProcessRecords(left.record, right.record));
    return exact ? [{ name, record: exact }, ...fallback] : fallback;
  }

  private async deleteProcessRecord(id: string, name: string): Promise<void> {
    const record = await this.processRecord(name);
    if (record) {
      await this.client()
        .deleteSession(id, record.sessionId)
        .catch(() => undefined);
    }
    await this.ctx.storage.delete(`${PROC_PREFIX}${name}`);
  }

  private async deleteProcessesOnPort(id: string, port: number, exceptName: string): Promise<void> {
    const records = await this.ctx.storage.list({ prefix: PROC_PREFIX });
    for (const [key, value] of records) {
      const parsed = ProcessRecordSchema.safeParse(value);
      const name = key.slice(PROC_PREFIX.length);
      if (!parsed.success || name === exceptName || parsed.data.port !== port) {
        continue;
      }
      await this.client()
        .deleteSession(id, parsed.data.sessionId)
        .catch(() => undefined);
      await this.ctx.storage.delete(key);
    }
  }

  private async storedDaytonaId(): Promise<string | null> {
    const value = await this.ctx.storage.get(DAYTONA_ID_KEY);
    return typeof value === "string" ? value : null;
  }

  private sandboxName(): string {
    const name = this.cachedSandboxName ?? this.ctx.id.name;
    if (!name) {
      throw new Error("ProjectSandbox must be addressed with idFromName().");
    }
    return name;
  }

  private async ownerUserId(): Promise<string | null> {
    const value = await this.ctx.storage.get(SANDBOX_OWNER_USER_ID_KEY);
    return typeof value === "string" ? value : null;
  }

  private writeExecAudit(entry: SandboxExecAuditEntry): Promise<void> {
    return writeExecAudit(this.env.R2_AUDIT, entry);
  }

  private toUpstreamError(error: unknown, fallback: string): APIError {
    if (error instanceof APIError) {
      return error;
    }
    const normalized = normalizeUnknownError(error, fallback);
    const status = error instanceof DaytonaApiError ? error.status : 502;
    const retriable = error instanceof DaytonaApiError ? error.retriable : true;
    return new APIError(
      status >= 500 ? 502 : status,
      "upstream_sandbox_failed",
      `${fallback} ${normalized.message}`,
      {
        details: { daytona: normalized.details, sandboxId: this.sandboxName() },
        hint: "Retry. If it persists, check Daytona sandbox lifecycle status.",
        retriable,
      },
    );
  }
}

function timeoutSeconds(timeoutMs: number | undefined): number {
  if (!timeoutMs) {
    return 600;
  }
  return Math.max(1, Math.ceil(timeoutMs / 1000));
}

function isDestroyed(sandbox: DaytonaSandbox): boolean {
  return sandbox.state === "destroyed" || sandbox.state === "destroying";
}

function isFailedState(state: string): boolean {
  return state === "error" || state === "build_failed";
}

function compareProcessRecords(left: ProcessRecord, right: ProcessRecord): number {
  return (right.startedAtMs ?? 0) - (left.startedAtMs ?? 0);
}

function isMissingDaytonaProcessError(error: unknown): boolean {
  return error instanceof DaytonaApiError && (error.status === 404 || error.status === 410);
}

function isDaytonaNameConflictError(error: unknown): boolean {
  if (!(error instanceof DaytonaApiError) || error.status !== 409) {
    return false;
  }
  const message = error.message.toLowerCase();
  return message.includes("already exists") || message.includes("conflict");
}

function isMissingDaytonaResourceError(error: unknown): boolean {
  return error instanceof DaytonaApiError && (error.status === 404 || error.status === 410);
}

function shellQuote(arg: string): string {
  return `'${arg.replaceAll("'", "'\\''")}'`;
}

// A workspace slug must be a single path segment so `/workspace/<slug>` cannot escape /workspace
// or resolve to /workspace itself (rm -rf guard).
function isSingleWorkspaceSegment(slug: string): boolean {
  return slug.length > 0 && !slug.includes("/") && slug !== "." && slug !== "..";
}

function lowercaseExtension(path: string): string {
  const filename = basename(path).toLowerCase();
  const dot = filename.lastIndexOf(".");
  return dot === -1 ? "" : filename.slice(dot);
}

function imageMimeType(extension: string): string | null {
  if (extension === ".png") {
    return "image/png";
  }
  if (extension === ".jpg" || extension === ".jpeg") {
    return "image/jpeg";
  }
  if (extension === ".gif") {
    return "image/gif";
  }
  if (extension === ".webp") {
    return "image/webp";
  }
  if (extension === ".svg") {
    return "image/svg+xml";
  }
  return null;
}

function isOfficePreviewExtension(extension: string): boolean {
  return [
    ".doc",
    ".docx",
    ".odp",
    ".ods",
    ".odt",
    ".pot",
    ".potx",
    ".pps",
    ".ppsx",
    ".ppt",
    ".pptx",
    ".xls",
    ".xlsx",
  ].includes(extension);
}

function unsupportedPreview(path: string, error: string): SandboxFilePreview {
  return {
    content: null,
    encoding: null,
    error,
    kind: "unsupported",
    mimeType: null,
    path,
    previewPath: null,
  };
}

function conversionErrorMessage(output: string): string {
  const trimmed = output.trim();
  if (!trimmed) {
    return "Office preview conversion failed.";
  }
  return trimmed.length > 1_000 ? `${trimmed.slice(0, 997)}...` : trimmed;
}

function withoutExtension(filename: string): string {
  const dot = filename.lastIndexOf(".");
  return dot <= 0 ? filename : filename.slice(0, dot);
}

function buildGrepCommand(input: ProjectSearchFilesInput): string {
  const flags = ["-rnI"];
  if (!input.caseSensitive) {
    flags.push("-i");
  }
  for (const dir of input.excludeDirs ?? []) {
    flags.push(`--exclude-dir=${shellQuote(dir)}`);
  }
  if (input.filePattern) {
    flags.push(`--include=${shellQuote(input.filePattern)}`);
  }
  const grep = `grep ${flags.join(" ")} -e ${shellQuote(input.query)} ${shellQuote(input.path)}`;
  return `${grep} | head -n ${input.maxResults ?? 100}`;
}

function parseGrepOutput(output: string, maxResults: number): SandboxSearchFilesResult["matches"] {
  const matches: SandboxSearchFilesResult["matches"] = [];
  for (const line of output.split("\n")) {
    if (matches.length >= maxResults) {
      break;
    }
    const match = /^(.*?):(\d+):(.*)$/u.exec(line);
    if (match?.[1] && match[2] && match[3] !== undefined) {
      matches.push({ line: Number(match[2]), path: match[1], text: match[3] });
    }
  }
  return matches;
}

function dirname(path: string): string {
  const index = path.lastIndexOf("/");
  return index <= 0 ? "/" : path.slice(0, index);
}

function basename(path: string): string {
  const index = path.lastIndexOf("/");
  return index === -1 ? path : path.slice(index + 1);
}

function encodeBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function decodeBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function codeServerFolderUrl(rawUrl: string, folderPath: string): string {
  const url = new URL(rawUrl);
  url.searchParams.set("folder", folderPath);
  return url.toString();
}

function codeServerStartCommand(): string {
  const settingsJson = JSON.stringify(
    {
      "breadcrumbs.enabled": false,
      "chat.commandCenter.enabled": false,
      "editor.fontFamily": "Menlo, Monaco, 'Courier New', monospace",
      "editor.fontSize": 13,
      "editor.lineHeight": 20,
      "editor.minimap.enabled": false,
      "explorer.confirmDelete": false,
      "explorer.confirmDragAndDrop": false,
      "explorer.openEditors.visible": 0,
      "extensions.ignoreRecommendations": true,
      "files.autoSave": "afterDelay",
      "files.autoSaveDelay": 800,
      // bud parity: bud's IDE surfaces no git state — its file tree is a single uniform colour with
      // no A/M/U badges and its editor title bar carries no "Open Changes"/"View File History"
      // actions. Disabling code-server's git UI (the agent tracks git itself via the toolbox, not
      // this viewer) reproduces bud's clean tree exactly.
      "git.decorations.enabled": false,
      "git.enabled": false,
      "muty-pptviewer.libreOfficePath": "/usr/bin/libreoffice",
      "security.workspace.trust.enabled": false,
      "telemetry.telemetryLevel": "off",
      "update.showReleaseNotes": false,
      "window.commandCenter": true,
      "window.menuBarVisibility": "hidden",
      "window.titleBarStyle": "custom",
      "workbench.activityBar.location": "hidden",
      "workbench.activityBar.visible": false,
      "workbench.colorCustomizations": {
        "activityBar.background": "#f8f8f8",
        "activityBar.foreground": "#1a1a1a",
        "activityBar.inactiveForeground": "#616161",
        "editor.background": "#ffffff",
        "editor.foreground": "#616161",
        "editorGroupHeader.tabsBackground": "#f8f8f8",
        "panel.background": "#ffffff",
        "sideBar.background": "#f8f8f8",
        "sideBar.foreground": "#1a1a1a",
        "sideBarTitle.foreground": "#1a1a1a",
        "statusBar.background": "#f8f8f8",
        "tab.activeBackground": "#ffffff",
        "tab.activeForeground": "#1a1a1a",
        "tab.inactiveBackground": "#f8f8f8",
        "tab.inactiveForeground": "#616161",
        "titleBar.activeBackground": "#f8f8f8",
        "titleBar.activeForeground": "#1a1a1a",
        "titleBar.inactiveBackground": "#f8f8f8",
        "titleBar.inactiveForeground": "#616161",
      },
      "workbench.colorTheme": "Default Light Modern",
      "workbench.editor.empty.hint": "hidden",
      "workbench.editor.enablePreview": false,
      "workbench.editorAssociations": {
        "*.ppt": "muty-pptviewer.preview",
        "*.pptx": "muty-pptviewer.preview",
      },
      "workbench.layoutControl.enabled": false,
      "workbench.panel.defaultLocation": "bottom",
      "workbench.secondarySideBar.defaultVisibility": "hidden",
      "workbench.startupEditor": "none",
      "workbench.statusBar.visible": false,
      "workbench.tips.enabled": false,
      "workbench.welcomePage.walkthroughs.openOnInstall": false,
    },
    null,
    2,
  );
  const portDefault = shellExpansion("CODE_SERVER_PORT:-13340");
  const workspaceDefault = shellExpansion("CODE_SERVER_WORKSPACE:-/workspace");
  const userDataDefault = shellExpansion(
    "CODE_SERVER_USER_DATA_DIR:-/home/node/.local/share/code-server/user-data",
  );
  const extensionsDefault = shellExpansion(
    "CODE_SERVER_EXTENSIONS_DIR:-/home/node/.local/share/code-server/extensions",
  );
  const trustedOriginsDefault = shellExpansion(
    "CODE_SERVER_TRUSTED_ORIGINS:-localhost:8787,*.localhost:8787,*.trycheatcode.com",
  );
  const trustedOriginListExpansion = shellExpansion("TRUSTED_ORIGIN_LIST[@]");
  const trustedOriginTrimLeading = shellExpansion(
    `TRUSTED_ORIGIN#"${shellExpansion("TRUSTED_ORIGIN%%[![:space:]]*")}"`,
  );
  const trustedOriginTrimTrailing = shellExpansion(
    `TRUSTED_ORIGIN%"${shellExpansion("TRUSTED_ORIGIN##*[![:space:]]}")}"`,
  );
  const portExpansion = shellExpansion("PORT");
  return [
    "set -euo pipefail",
    `PORT="${portDefault}"`,
    `WORKSPACE="${workspaceDefault}"`,
    `USER_DATA_DIR="${userDataDefault}"`,
    `EXTENSIONS_DIR="${extensionsDefault}"`,
    `TRUSTED_ORIGINS="${trustedOriginsDefault}"`,
    'mkdir -p "$USER_DATA_DIR/User" "$EXTENSIONS_DIR"',
    "cat > \"$USER_DATA_DIR/User/settings.json\" <<'JSON'",
    settingsJson,
    "JSON",
    "cat > \"$USER_DATA_DIR/User/keybindings.json\" <<'JSON'",
    "[]",
    "JSON",
    'rm -rf "$USER_DATA_DIR/User/workspaceStorage"',
    'touch "$USER_DATA_DIR/.cheatcode-settings-v5"',
    "export CS_DISABLE_GETTING_STARTED_OVERRIDE=1",
    'EXTRA_FLAGS=""',
    'if code-server --help 2>/dev/null | grep -q -- "--disable-getting-started-override"; then',
    '  EXTRA_FLAGS="$EXTRA_FLAGS --disable-getting-started-override"',
    "fi",
    'if code-server --help 2>/dev/null | grep -q -- "--disable-workspace-trust"; then',
    '  EXTRA_FLAGS="$EXTRA_FLAGS --disable-workspace-trust"',
    "fi",
    'IFS="," read -r -a TRUSTED_ORIGIN_LIST <<< "$TRUSTED_ORIGINS"',
    `for TRUSTED_ORIGIN in "${trustedOriginListExpansion}"; do`,
    `  TRUSTED_ORIGIN="${trustedOriginTrimLeading}"`,
    `  TRUSTED_ORIGIN="${trustedOriginTrimTrailing}"`,
    '  if [ -n "$TRUSTED_ORIGIN" ]; then',
    '    EXTRA_FLAGS="$EXTRA_FLAGS --trusted-origins $TRUSTED_ORIGIN"',
    "  fi",
    "done",
    'exec code-server "$WORKSPACE" \\',
    "  --auth none \\",
    `  --bind-addr "0.0.0.0:${portExpansion}" \\`,
    "  --disable-telemetry \\",
    "  --disable-update-check \\",
    '  --extensions-dir "$EXTENSIONS_DIR" \\',
    '  --user-data-dir "$USER_DATA_DIR" \\',
    "  $EXTRA_FLAGS",
  ].join("\n");
}

function shellExpansion(expression: string): string {
  return ["$", "{", expression, "}"].join("");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
