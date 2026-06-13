import { DurableObject } from "cloudflare:workers";
import { initialize, SandboxInstance, VolumeInstance } from "@blaxel/core";
import { APIError, createLogger, normalizeUnknownError } from "@cheatcode/observability";
import type {
  SandboxBackupHandle,
  SandboxDeleteFileResult,
  SandboxDestroyResult,
  SandboxExecResult,
  SandboxExposePortResult,
  SandboxKillProcessResult,
  SandboxListFilesResult,
  SandboxProcessResult,
  SandboxReadFileResult,
  SandboxRestoreBackupResult,
  SandboxRunCodeResult,
  SandboxSearchFilesResult,
  SandboxWriteFileResult,
} from "@cheatcode/tools-code";
import type { SandboxConsoleSnapshot } from "@cheatcode/types";
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
import { buildPreviewSpec, createOrReplacePreview, previewUrl } from "./project-sandbox-preview";
import {
  emptyConsoleSnapshot,
  ProcessListSchema,
  ProcessResponseSchema,
  readCompletedProcessLogs,
  resolveDevServerProcess,
  sliceProcessLogs,
} from "./project-sandbox-process-logs";
import {
  commandToShellString,
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
  type ProjectReadDevServerLogsInput,
  ProjectReadDevServerLogsInputSchema,
  type ProjectReadFileInput,
  ProjectReadFileInputSchema,
  type ProjectRestoreBackupInput,
  ProjectRestoreBackupInputSchema,
  type ProjectRunCodeInput,
  ProjectRunCodeInputSchema,
  type ProjectSearchFilesInput,
  ProjectSearchFilesInputSchema,
  type ProjectStartProcessInput,
  ProjectStartProcessInputSchema,
  type ProjectUnexposePortInput,
  ProjectUnexposePortInputSchema,
  type ProjectWriteFileInput,
  ProjectWriteFileInputSchema,
} from "./project-sandbox-runtime";

interface ProjectSandboxEnv {
  BL_API_KEY: string;
  BL_REGION: string;
  BL_WORKSPACE: string;
  BLAXEL_SANDBOX_IMAGE: string;
  BLAXEL_SANDBOX_MEMORY_MB?: string;
  QUOTA_TRACKER?: DurableObjectNamespace;
  R2_AUDIT: R2Bucket;
}

export interface ProjectSandboxStatus {
  healthy: boolean;
  ping: string;
  sandboxId: string;
}

const DEFAULT_MEMORY_MB = 4096;
const DEFAULT_VOLUME_SIZE_MB = 2048;
const DEFAULT_EXEC_TIMEOUT_MS = 60_000;
const WORKSPACE_DIR = "/workspace";
const VOLUME_ID_PREFIX = "ccv";
const DEFAULT_PREVIEW_TOKEN_TTL_MS = 15 * 60 * 1000;
const SANDBOX_IDLE_DELETE_TTL = "30d";
const SANDBOX_OWNER_USER_ID_KEY = "sandbox_owner_user_id";

const OwnerUserIdSchema = z.string().uuid();

const SearchResponseSchema = z
  .object({
    matches: z.array(
      z
        .object({
          column: z.number().int().nonnegative().optional(),
          context: z.string().optional(),
          line: z.number().int().positive(),
          path: z.string(),
          text: z.string(),
        })
        .passthrough(),
    ),
    query: z.string(),
    total: z.number().int().nonnegative(),
  })
  .passthrough();

export class ProjectSandbox extends DurableObject<ProjectSandboxEnv> {
  private sandboxPromise: Promise<SandboxInstance> | undefined;

  public async registerOwner(userId: string): Promise<void> {
    const parsedUserId = OwnerUserIdSchema.parse(userId);
    const existingUserId = await this.ownerUserId();
    if (existingUserId && existingUserId !== parsedUserId) {
      throw new APIError(403, "permission_denied", "Sandbox ownership mismatch", {
        retriable: false,
      });
    }
    await this.ctx.storage.put(SANDBOX_OWNER_USER_ID_KEY, parsedUserId);
    await initSandboxMeterCheckpoint(this.ctx.storage);
  }

  public async setQuotaPeriod(periodEndIso: string): Promise<void> {
    await setSandboxQuotaPeriod(this.ctx.storage, periodEndIso);
  }

  public async ensureReady(): Promise<ProjectSandboxStatus> {
    const result = await this.runCode({
      code: "print('ready')",
      language: "python",
    });
    return {
      healthy: result.success === true,
      ping: result.stdout?.trim() ?? "",
      sandboxId: this.sandboxId(),
    };
  }

  public async getStatus(): Promise<ProjectSandboxStatus> {
    return this.ensureReady();
  }

  public async runCode(input: ProjectRunCodeInput): Promise<SandboxRunCodeResult> {
    const parsedInput = ProjectRunCodeInputSchema.parse(input);
    const command =
      parsedInput.language === "python"
        ? ["python3", "-c", parsedInput.code]
        : ["node", "--input-type=module", "-e", parsedInput.code];
    const result = await this.exec({
      command,
      cwd: WORKSPACE_DIR,
      env: parsedInput.env,
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
    const parsedInput = ProjectExecInputSchema.parse(input);
    const sandbox = await this.sandbox();
    const startedAt = Date.now();
    const processName = `exec-${crypto.randomUUID()}`;
    const command = commandToShellString(parsedInput.command);
    const cwd = parsedInput.cwd ?? WORKSPACE_DIR;
    const timeoutMs = parsedInput.timeoutMs ?? DEFAULT_EXEC_TIMEOUT_MS;
    try {
      const completed = await sandbox.process.exec({
        command,
        name: processName,
        timeout: timeoutSeconds(timeoutMs),
        waitForCompletion: true,
        workingDir: cwd,
        ...(parsedInput.env === undefined ? {} : { env: parsedInput.env }),
      });
      const parsed = ProcessResponseSchema.parse(completed);
      const exitCode = parsed.exitCode ?? (parsed.status === "completed" ? 0 : 1);
      let stdout = firstNonEmptyString(parsed.stdout, parsed.logs) ?? "";
      let stderr = parsed.stderr ?? "";
      if (!stdout && !stderr && parsed.status === "completed") {
        const logs = await readCompletedProcessLogs(sandbox, processName, this.sandboxId());
        stdout = logs.stdout;
        stderr = logs.stderr;
      }
      const durationMs = Date.now() - startedAt;
      const result = {
        command,
        durationMs,
        exitCode,
        stderr,
        stdout,
        success: exitCode === 0 && parsed.status !== "failed",
      };
      createLogger().info("sandbox_process_completed", {
        durationMs,
        exitCode,
        processName,
        sandboxId: this.sandboxId(),
        status: parsed.status,
        stderrBytes: stderr.length,
        stdoutBytes: stdout.length,
      });
      await this.writeExecAudit({
        argc: parsedInput.command.length,
        argv0: parsedInput.command[0] ?? "unknown",
        cwd,
        durationMs: result.durationMs,
        exitCode,
        processName,
        sandboxId: this.sandboxId(),
        status: parsed.status,
        success: result.success,
        timestamp: new Date(startedAt).toISOString(),
        type: "sandbox_exec",
      });
      return result;
    } catch (error) {
      const normalized = normalizeUnknownError(error, "Sandbox command failed.");
      await this.writeExecAudit({
        argc: parsedInput.command.length,
        argv0: parsedInput.command[0] ?? "unknown",
        cwd,
        durationMs: Date.now() - startedAt,
        error: normalized.details,
        processName,
        sandboxId: this.sandboxId(),
        status: "error",
        success: false,
        timestamp: new Date(startedAt).toISOString(),
        type: "sandbox_exec",
      });
      throw error;
    }
  }

  public async startProcess(input: ProjectStartProcessInput): Promise<SandboxProcessResult> {
    const parsedInput = ProjectStartProcessInputSchema.parse(input);
    const sandbox = await this.sandbox();
    const processName = parsedInput.processId ?? `process-${crypto.randomUUID()}`;
    if (parsedInput.processId) {
      await sandbox.process.kill(parsedInput.processId).catch(() => undefined);
      createLogger().info("sandbox_process_name_reused", {
        processId: parsedInput.processId,
        sandboxId: this.sandboxId(),
      });
    }
    const process = await sandbox.process.exec({
      command: commandToShellString(parsedInput.command),
      keepAlive: true,
      ...(parsedInput.keepAliveTimeoutMs === undefined
        ? {}
        : { timeout: timeoutSeconds(parsedInput.keepAliveTimeoutMs) }),
      ...(parsedInput.maxRestarts === undefined ? {} : { maxRestarts: parsedInput.maxRestarts }),
      name: processName,
      ...(parsedInput.restartOnFailure === undefined
        ? {}
        : { restartOnFailure: parsedInput.restartOnFailure }),
      workingDir: parsedInput.cwd ?? WORKSPACE_DIR,
      ...(parsedInput.env === undefined ? {} : { env: parsedInput.env }),
      ...(parsedInput.waitForPort === undefined
        ? {}
        : { waitForPorts: [parsedInput.waitForPort.port] }),
    });
    const parsed = ProcessResponseSchema.parse(process);
    return {
      command: parsed.command,
      id: parsed.name ?? processName,
      status: parsed.status,
    };
  }

  public async readFile(input: ProjectReadFileInput): Promise<SandboxReadFileResult> {
    const parsedInput = ProjectReadFileInputSchema.parse(input);
    if (parsedInput.encoding === "base64") {
      const result = await this.exec({
        command: ["base64", "--wrap=0", parsedInput.path],
        timeoutMs: DEFAULT_EXEC_TIMEOUT_MS,
      });
      return { content: result.stdout, encoding: "base64", path: parsedInput.path };
    }
    const sandbox = await this.sandbox();
    const content = await sandbox.fs.read(parsedInput.path);
    return { content, encoding: "utf8", path: parsedInput.path };
  }

  public async writeFile(input: ProjectWriteFileInput): Promise<SandboxWriteFileResult> {
    const parsedInput = ProjectWriteFileInputSchema.parse(input);
    const sandbox = await this.sandbox();
    if (parsedInput.encoding === "base64") {
      await sandbox.fs.writeBinary(parsedInput.path, decodeBase64(parsedInput.content));
      return { path: parsedInput.path, success: true };
    }
    await sandbox.fs.write(parsedInput.path, parsedInput.content);
    return { path: parsedInput.path, success: true };
  }

  public async listFiles(input: ProjectListFilesInput): Promise<SandboxListFilesResult> {
    const parsedInput = ProjectListFilesInputSchema.parse(input);
    const sandbox = await this.sandbox();
    const files = await listSandboxFiles({
      includeHidden: parsedInput.includeHidden,
      path: parsedInput.path,
      recursive: parsedInput.recursive,
      sandbox,
    });
    return {
      files,
      path: parsedInput.path,
    };
  }

  public async searchFiles(input: ProjectSearchFilesInput): Promise<SandboxSearchFilesResult> {
    const parsedInput = ProjectSearchFilesInputSchema.parse(input);
    const sandbox = await this.sandbox();
    const result = SearchResponseSchema.parse(
      await sandbox.fs.grep(parsedInput.query, parsedInput.path, {
        caseSensitive: parsedInput.caseSensitive,
        contextLines: parsedInput.contextLines,
        excludeDirs: parsedInput.excludeDirs,
        ...(parsedInput.filePattern ? { filePattern: parsedInput.filePattern } : {}),
        maxResults: parsedInput.maxResults,
      }),
    );
    return {
      matches: result.matches.map((match) => ({
        ...(match.column === undefined ? {} : { column: match.column }),
        ...(match.context === undefined ? {} : { context: match.context }),
        line: match.line,
        path: match.path,
        text: match.text,
      })),
      query: result.query,
      total: result.total,
      truncated: result.total > result.matches.length,
    };
  }

  public async deleteFile(input: ProjectDeleteFileInput): Promise<SandboxDeleteFileResult> {
    const parsedInput = ProjectDeleteFileInputSchema.parse(input);
    const sandbox = await this.sandbox();
    await sandbox.fs.rm(parsedInput.path, parsedInput.recursive);
    return { path: parsedInput.path, success: true };
  }

  public async exposePort(input: ProjectExposePortInput): Promise<SandboxExposePortResult> {
    const parsedInput = ProjectExposePortInputSchema.parse(input);
    const sandbox = await this.sandbox();
    const name = parsedInput.name ?? `preview-${parsedInput.port}`;
    const tokenTtlMs = parsedInput.tokenTtlMs ?? DEFAULT_PREVIEW_TOKEN_TTL_MS;
    const preview = await createOrReplacePreview({
      name,
      sandbox,
      spec: buildPreviewSpec({
        hostname: parsedInput.hostname,
        name,
        port: parsedInput.port,
        public: parsedInput.tokenTtlMs === undefined,
        sandboxId: this.sandboxId(),
      }),
    });
    if (parsedInput.tokenTtlMs !== undefined) {
      const token = await preview.tokens.create(new Date(Date.now() + tokenTtlMs));
      return {
        name,
        port: parsedInput.port,
        token: token.value,
        url: `${previewUrl(preview)}?bl_preview_token=${token.value}`,
      };
    }
    return { name, port: parsedInput.port, url: previewUrl(preview) };
  }

  public async unexposePort(input: ProjectUnexposePortInput): Promise<void> {
    const parsedInput = ProjectUnexposePortInputSchema.parse(input);
    const sandbox = await this.sandbox();
    const name = parsedInput.name ?? `preview-${parsedInput.port}`;
    await sandbox.previews.delete(name).catch(() => undefined);
  }

  public async killAllProcesses(): Promise<number> {
    const sandbox = await this.sandbox();
    const processes = ProcessListSchema.parse(await sandbox.process.list());
    let killed = 0;
    for (const process of processes) {
      if (process.status === "running" && process.name) {
        await sandbox.process.kill(process.name).catch(() => undefined);
        killed += 1;
      }
    }
    return killed;
  }

  public async killProcess(input: ProjectKillProcessInput): Promise<SandboxKillProcessResult> {
    const parsedInput = ProjectKillProcessInputSchema.parse(input);
    const sandbox = await this.sandbox();
    await sandbox.process.kill(parsedInput.processId);
    return {
      processId: parsedInput.processId,
      status: "killed",
      success: true,
    };
  }

  /**
   * Tails the dev-server process logs for the preview console strip (preview
   * §4.1). Read-only: never creates/wakes a sandbox via `createIfNotExists` —
   * returns an empty snapshot when no sandbox or dev-server process exists.
   */
  public async readDevServerLogs(
    input: ProjectReadDevServerLogsInput,
  ): Promise<SandboxConsoleSnapshot> {
    const parsed = ProjectReadDevServerLogsInputSchema.parse(input);
    const sandbox = await this.existingSandbox();
    if (sandbox === null) {
      return emptyConsoleSnapshot({ stderr: parsed.stderrCursor, stdout: parsed.stdoutCursor });
    }
    return this.readResolvedDevServerLogs(sandbox, parsed);
  }

  public async createBackup(input: ProjectCreateBackupInput): Promise<SandboxBackupHandle> {
    const parsedInput = ProjectCreateBackupInputSchema.parse(input);
    await this.ensureProjectVolume();
    await this.sandbox();
    return {
      dir: parsedInput.dir,
      id: this.volumeName(),
      ...(parsedInput.localBucket === undefined ? {} : { localBucket: parsedInput.localBucket }),
    };
  }

  public async restoreBackup(
    input: ProjectRestoreBackupInput,
  ): Promise<SandboxRestoreBackupResult> {
    const parsedInput = ProjectRestoreBackupInputSchema.parse(input);
    if (!this.isCompatibleBackupId(parsedInput.backup.id)) {
      throw new APIError(400, "invalid_request_body", "Snapshot handle does not match project", {
        retriable: false,
      });
    }
    await this.ensureProjectVolume();
    await this.sandbox();
    return { dir: parsedInput.backup.dir, id: this.volumeName(), success: true };
  }

  public async destroySandbox(): Promise<SandboxDestroyResult> {
    await recordSandboxUsageBestEffort(await this.meteringContext());
    this.configureBlaxel();
    try {
      await SandboxInstance.delete(this.sandboxId());
    } catch (error) {
      if (!isNotFoundError(error)) {
        const normalized = normalizeUnknownError(error, "Blaxel sandbox deletion failed.");
        throw new APIError(
          502,
          "upstream_sandbox_failed",
          `Blaxel sandbox delete failed: ${normalized.message}`,
          {
            details: {
              blaxel: normalized.details,
              sandboxId: this.sandboxId(),
            },
            hint: "Retry deletion. If it persists, check Blaxel sandbox lifecycle status.",
            retriable: true,
          },
        );
      }
    }
    this.sandboxPromise = undefined;
    await clearSandboxMeterCheckpoint(this.ctx.storage);
    return { deleted: true, sandboxId: this.sandboxId() };
  }

  public async deleteProjectVolume(): Promise<boolean> {
    this.configureBlaxel();
    try {
      await VolumeInstance.delete(this.volumeName());
      return true;
    } catch (error) {
      if (isNotFoundError(error)) {
        return false;
      }
      const normalized = normalizeUnknownError(error, "Blaxel volume deletion failed.");
      throw new APIError(
        502,
        "upstream_sandbox_failed",
        `Blaxel volume delete failed: ${normalized.message}`,
        {
          details: {
            blaxel: normalized.details,
            volumeName: this.volumeName(),
          },
          hint: "Retry deletion. If it persists, check Blaxel volume attachment status.",
          retriable: true,
        },
      );
    }
  }

  public async deleteDurableState(): Promise<void> {
    await this.ctx.storage.deleteAll();
    this.sandboxPromise = undefined;
  }

  private async sandbox(): Promise<SandboxInstance> {
    this.sandboxPromise ??= this.createSandbox();
    await recordSandboxUsageBestEffort(await this.meteringContext());
    return this.sandboxPromise;
  }

  private async meteringContext(): Promise<SandboxMeteringContext> {
    return {
      env: this.env,
      ownerUserId: await this.ownerUserId(),
      sandboxId: this.sandboxId(),
      storage: this.ctx.storage,
    };
  }

  private async createSandbox(): Promise<SandboxInstance> {
    this.configureBlaxel();
    try {
      const volumeName = await this.ensureProjectVolume();
      return await SandboxInstance.createIfNotExists({
        image: this.env.BLAXEL_SANDBOX_IMAGE,
        labels: {
          app: "cheatcode",
          sandboxId: this.sandboxId(),
        },
        lifecycle: {
          expirationPolicies: [
            {
              action: "delete",
              type: "ttl-idle",
              value: SANDBOX_IDLE_DELETE_TTL,
            },
          ],
        },
        memory: this.sandboxMemoryMb(),
        name: this.sandboxId(),
        ports: [
          { protocol: "HTTP", target: 5173 },
          { protocol: "HTTP", target: 8000 },
          { protocol: "HTTP", target: 6080 },
        ],
        region: this.env.BL_REGION,
        volumes: [{ mountPath: WORKSPACE_DIR, name: volumeName, readOnly: false }],
      });
    } catch (error) {
      const normalized = normalizeUnknownError(error, "Blaxel sandbox creation failed.");
      throw new APIError(
        502,
        "upstream_sandbox_failed",
        `Blaxel sandbox failed to start: ${normalized.message}`,
        {
          details: {
            blaxel: normalized.details,
            region: this.env.BL_REGION,
            sandboxId: this.sandboxId(),
          },
          hint: "Refresh local Blaxel credentials and verify the sandbox image exists.",
          retriable: true,
        },
      );
    }
  }

  private configureBlaxel(): void {
    initialize({
      apiKey: this.env.BL_API_KEY,
      disableH2: true,
      workspace: this.env.BL_WORKSPACE,
    });
  }

  private async ensureProjectVolume(): Promise<string> {
    this.configureBlaxel();
    const name = this.volumeName();
    try {
      await VolumeInstance.createIfNotExists({
        labels: {
          app: "cheatcode",
          sandboxId: this.sandboxId(),
        },
        name,
        region: this.env.BL_REGION,
        size: DEFAULT_VOLUME_SIZE_MB,
      });
      return name;
    } catch (error) {
      const normalized = normalizeUnknownError(error, "Blaxel volume creation failed.");
      throw new APIError(
        502,
        "upstream_sandbox_failed",
        `Blaxel volume failed to initialize: ${normalized.message}`,
        {
          details: {
            blaxel: normalized.details,
            region: this.env.BL_REGION,
            volumeName: name,
          },
          hint: "Verify Blaxel volume quota and region availability.",
          retriable: true,
        },
      );
    }
  }

  private sandboxMemoryMb(): number {
    if (!this.env.BLAXEL_SANDBOX_MEMORY_MB) {
      return DEFAULT_MEMORY_MB;
    }
    const parsed = Number(this.env.BLAXEL_SANDBOX_MEMORY_MB);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : DEFAULT_MEMORY_MB;
  }

  private sandboxId(): string {
    const name = this.ctx.id.name;
    if (!name) {
      throw new Error("ProjectSandbox must be addressed with idFromName().");
    }
    return name;
  }

  private volumeName(): string {
    return `${VOLUME_ID_PREFIX}-${this.sandboxId()}`;
  }

  private async readResolvedDevServerLogs(
    sandbox: SandboxInstance,
    parsed: {
      lastPid?: string | undefined;
      processId: string;
      stderrCursor: number;
      stdoutCursor: number;
      tail: number;
    },
  ): Promise<SandboxConsoleSnapshot> {
    try {
      const processes = ProcessListSchema.parse(await sandbox.process.list());
      const proc = resolveDevServerProcess(processes, parsed.processId);
      if (proc === null) {
        createLogger().debug("sandbox_console_process_unresolved", {
          candidateCount: processes.length,
          preferredId: parsed.processId,
          sandboxId: this.sandboxId(),
        });
        return emptyConsoleSnapshot({ stderr: parsed.stderrCursor, stdout: parsed.stdoutCursor });
      }
      const [stdoutText, stderrText] = await Promise.all([
        sandbox.process.logs(proc.id, "stdout"),
        sandbox.process.logs(proc.id, "stderr"),
      ]);
      const result = sliceProcessLogs({
        lastPid: parsed.lastPid,
        pid: proc.pid,
        stderrCursor: parsed.stderrCursor,
        stderrText,
        stdoutCursor: parsed.stdoutCursor,
        stdoutText,
        tail: parsed.tail,
      });
      createLogger().info("sandbox_console_logs_read", {
        lineCount: result.lines.length,
        processId: proc.id,
        reset: result.reset,
        sandboxId: this.sandboxId(),
        stderrBytes: stderrText.length,
        stdoutBytes: stdoutText.length,
        truncated: result.truncated,
      });
      return { ...result, process: proc };
    } catch (error) {
      const normalized = normalizeUnknownError(error, "Sandbox console log read failed.");
      createLogger().warn("sandbox_console_logs_failed", {
        error: normalized.message,
        processId: parsed.processId,
        sandboxId: this.sandboxId(),
      });
      throw new APIError(
        502,
        "upstream_sandbox_failed",
        `Sandbox console read failed: ${normalized.message}`,
        {
          details: { blaxel: normalized.details, sandboxId: this.sandboxId() },
          hint: "Retry the console poll. If it persists, check Blaxel sandbox status.",
          retriable: true,
        },
      );
    }
  }

  /**
   * Read-only sandbox acquisition for log polling (preview §A7). Uses
   * `SandboxInstance.get`, never `createIfNotExists`, so a poll cannot create a
   * sandbox; returns null when the sandbox does not exist.
   */
  private async existingSandbox(): Promise<SandboxInstance | null> {
    this.configureBlaxel();
    if (this.sandboxPromise !== undefined) {
      return this.sandboxPromise;
    }
    try {
      const sandbox = await SandboxInstance.get(this.sandboxId());
      this.sandboxPromise = Promise.resolve(sandbox);
      await recordSandboxUsageBestEffort(await this.meteringContext());
      return sandbox;
    } catch (error) {
      if (isNotFoundError(error)) {
        return null;
      }
      const normalized = normalizeUnknownError(error, "Blaxel sandbox lookup failed.");
      throw new APIError(
        502,
        "upstream_sandbox_failed",
        `Blaxel sandbox lookup failed: ${normalized.message}`,
        {
          details: { blaxel: normalized.details, sandboxId: this.sandboxId() },
          hint: "Retry. If it persists, check Blaxel sandbox lifecycle status.",
          retriable: true,
        },
      );
    }
  }

  private isCompatibleBackupId(backupId: string): boolean {
    return backupId === this.volumeName() || backupId === `blaxel-standby-${this.sandboxId()}`;
  }

  private async ownerUserId(): Promise<string | null> {
    const value = await this.ctx.storage.get(SANDBOX_OWNER_USER_ID_KEY);
    return typeof value === "string" ? value : null;
  }

  private writeExecAudit(entry: SandboxExecAuditEntry): Promise<void> {
    return writeExecAudit(this.env.R2_AUDIT, entry);
  }
}

function timeoutSeconds(timeoutMs: number | undefined): number {
  if (!timeoutMs) {
    return 600;
  }
  return Math.max(1, Math.ceil(timeoutMs / 1000));
}

function firstNonEmptyString(...values: Array<null | string | undefined>): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.length > 0) {
      return value;
    }
  }
  return undefined;
}

function decodeBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function isNotFoundError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  const normalized = `${error.name} ${error.message}`.toLowerCase();
  return normalized.includes("notfound") || normalized.includes("not found");
}
