import { DurableObject } from "cloudflare:workers";
import { resolveWorkerSecret, type WorkerSecret } from "@cheatcode/env";
import { APIError, normalizeUnknownError } from "@cheatcode/observability";
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
import { buildPreviewUrl } from "./project-sandbox-preview";
import { emptyConsoleSnapshot, sliceProcessLogs } from "./project-sandbox-process-logs";
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
const ENV_FILE_DIR = "/home/daytona/.cc-env";
const DEFAULT_EXEC_TIMEOUT_MS = 60_000;
const DEFAULT_IDLE_STOP_MIN = 15;
const AUTO_ARCHIVE_MIN = 1_440; // 1 day stopped → cold storage
const NEVER_AUTO_DELETE = -1; // the sandbox disk is the durable store
const APP_PREVIEW_TTL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_TAKEOVER_TTL_MS = 15 * 60 * 1000;
const KEEPALIVE_ALARM_MS = 4 * 60 * 1000;
const MAX_RUN_LEASE_MS = 6 * 60 * 60 * 1000;
const STARTED_REVERIFY_MS = 30 * 1000;
const ENSURE_STARTED_ATTEMPTS = 30;
const ENSURE_STARTED_DELAY_MS = 2_000;

const SANDBOX_OWNER_USER_ID_KEY = "sandbox_owner_user_id";
const DAYTONA_ID_KEY = "daytona_sandbox_id";
const RUN_LEASES_KEY = "run_leases";
const PROC_PREFIX = "proc:";

const OwnerUserIdSchema = z.string().uuid();
const RunLeasesSchema = z.array(z.object({ runId: z.string(), startedMs: z.number() })).default([]);
const ProcessRecordSchema = z
  .object({
    sessionId: z.string(),
    cmdId: z.string(),
    command: z.string(),
    port: z.number().optional(),
  })
  .strict();
type ProcessRecord = z.infer<typeof ProcessRecordSchema>;

export class ProjectSandbox extends DurableObject<ProjectSandboxEnv> {
  private daytonaClient: DaytonaClient | undefined;
  private daytonaId: string | undefined;
  private startedVerifiedAtMs = 0;

  // ----- ownership + quota -----

  public async registerOwner(userId: string): Promise<void> {
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
    const id = await this.ensureSandbox();
    const client = this.client();
    const name = parsed.processId ?? `process-${crypto.randomUUID()}`;
    const sessionId = `cc-${name}`;
    if (parsed.processId) {
      await client.deleteSession(id, sessionId).catch(() => undefined);
      await this.ctx.storage.delete(`${PROC_PREFIX}${name}`);
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
    const mode = parsed.tokenTtlMs === undefined ? "app" : "takeover";
    const ttlMs =
      parsed.tokenTtlMs ?? (mode === "app" ? APP_PREVIEW_TTL_MS : DEFAULT_TAKEOVER_TTL_MS);
    const built = await buildPreviewUrl({
      hostname: parsed.hostname ?? this.env.PREVIEW_HOSTNAME ?? "trycheatcode.com",
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
    const record = await this.processRecord(parsed.processId);
    if (id === null || record === null) {
      return emptyConsoleSnapshot({ stderr: parsed.stderrCursor, stdout: parsed.stdoutCursor });
    }
    try {
      const buffer = await this.client().getSessionCommandLogs(id, record.sessionId, record.cmdId);
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
          id: parsed.processId,
          pid: record.cmdId,
          status: "running",
        },
      };
    } catch (error) {
      throw this.toUpstreamError(error, "Sandbox console read failed.");
    }
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
    try {
      await this.client().deleteSandbox(this.sandboxName());
      const id = this.daytonaId;
      if (id && id !== this.sandboxName()) {
        await this.client()
          .deleteSandbox(id)
          .catch(() => undefined);
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
      throw this.toUpstreamError(error, "Daytona sandbox failed to start.");
    }
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

  private async runLeases(): Promise<Array<{ runId: string; startedMs: number }>> {
    return RunLeasesSchema.parse((await this.ctx.storage.get(RUN_LEASES_KEY)) ?? []);
  }

  private async processRecord(name: string): Promise<ProcessRecord | null> {
    const value = await this.ctx.storage.get(`${PROC_PREFIX}${name}`);
    const parsed = ProcessRecordSchema.safeParse(value);
    return parsed.success ? parsed.data : null;
  }

  private async storedDaytonaId(): Promise<string | null> {
    const value = await this.ctx.storage.get(DAYTONA_ID_KEY);
    return typeof value === "string" ? value : null;
  }

  private sandboxName(): string {
    const name = this.ctx.id.name;
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

function shellQuote(arg: string): string {
  return `'${arg.replaceAll("'", "'\\''")}'`;
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
