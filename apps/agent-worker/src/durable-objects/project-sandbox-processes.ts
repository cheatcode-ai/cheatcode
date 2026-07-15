import { APIError, createLogger } from "@cheatcode/observability";
import type {
  SandboxExecResult,
  SandboxKillProcessResult,
  SandboxProcessResult,
  SandboxRunCodeResult,
} from "@cheatcode/sandbox-contracts";
import type { DaytonaSessionExecResponse } from "@cheatcode/tools-code";
import type { SandboxConsoleSnapshot } from "@cheatcode/types";
import { sandboxExecProcessName } from "./project-sandbox-audit";
import { WORKSPACE_DIR } from "./project-sandbox-content-support";
import { ProjectSandboxLifecycle } from "./project-sandbox-lifecycle";
import { recordSandboxUsageBestEffort } from "./project-sandbox-metering";
import { emptyConsoleSnapshot, sliceProcessLogs } from "./project-sandbox-process-logs";
import {
  assertValidProcessStart,
  ENV_FILE_DIR,
  firstAvailablePort,
  type NamedProcessRecord,
  type ParsedProcessStartInput,
  PORT_ALLOC_KEY,
  type PortAllocation,
  PortAllocationSchema,
  PROC_PREFIX,
  PROCESS_PORT_ALLOC_KEY,
  type ProcessPolicy,
  type ProcessPortReservations,
  ProcessPortReservationsSchema,
  type ProcessRecord,
  ProcessRecordSchema,
  processRecordFromLaunch,
  pruneExpiredProcessPortReservations,
  restartEnvironment,
  shellQuote,
  sleep,
  supervisedProcessCommand,
  timeoutSeconds,
  usedProcessPorts,
  withoutProcessReservation,
} from "./project-sandbox-process-support";
import {
  commandToShellString,
  type ProjectAllocatePortInput,
  ProjectAllocatePortInputSchema,
  type ProjectAllocateProcessPortInput,
  ProjectAllocateProcessPortInputSchema,
  type ProjectExecInput,
  ProjectExecInputSchema,
  type ProjectKillProcessInput,
  ProjectKillProcessInputSchema,
  type ProjectReadDevServerLogsInput,
  ProjectReadDevServerLogsInputSchema,
  type ProjectRunCodeInput,
  ProjectRunCodeInputSchema,
  type ProjectStartProcessInput,
  ProjectStartProcessInputSchema,
} from "./project-sandbox-runtime";

const DEFAULT_EXEC_TIMEOUT_MS = 60_000;

interface ProjectSandboxStatus {
  healthy: boolean;
  ping: string;
  sandboxId: string;
}

export abstract class ProjectSandboxProcesses extends ProjectSandboxLifecycle {
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

  public async runCode(input: ProjectRunCodeInput): Promise<SandboxRunCodeResult> {
    const parsed = ProjectRunCodeInputSchema.parse(input);
    const command =
      parsed.language === "python"
        ? ["python3", "-c", parsed.code]
        : ["node", "--input-type=module", "-e", parsed.code];
    const result = await this.exec({
      command,
      cwd: parsed.cwd ?? WORKSPACE_DIR,
      env: parsed.env,
      timeoutMs: parsed.timeoutMs ?? DEFAULT_EXEC_TIMEOUT_MS,
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
      const result: SandboxExecResult = {
        command,
        durationMs: Date.now() - startedAt,
        exitCode: completed.exitCode,
        stderr: "",
        stdout: completed.result ?? "",
        success: completed.exitCode === 0,
      };
      const processName = sandboxExecProcessName(parsed.command[0] ?? "process");
      await this.writeExecAudit({
        argc: parsed.command.length,
        argv0: processName,
        cwd,
        durationMs: result.durationMs ?? 0,
        exitCode: completed.exitCode,
        processName,
        sandboxId: this.sandboxName(),
        status: result.success ? "completed" : "failed",
        success: result.success,
        timestamp: new Date(startedAt).toISOString(),
        type: "sandbox_exec",
      }).catch((error: unknown) => {
        createLogger().warn("sandbox_exec_audit_failed", {
          error,
          processName,
          sandboxId: this.sandboxName(),
        });
      });
      await recordSandboxUsageBestEffort(await this.meteringContext());
      return result;
    } catch (error) {
      throw this.toUpstreamError(error, "Sandbox command failed.");
    }
  }

  public async startProcess(input: ProjectStartProcessInput): Promise<SandboxProcessResult> {
    const parsed = ProjectStartProcessInputSchema.parse(input);
    assertValidProcessStart(parsed);
    const id = await this.ensureSandbox();
    const name = parsed.processId ?? `process-${crypto.randomUUID()}`;
    const sessionId = `cc-${name}`;
    await this.prepareProcessSlot(id, name, parsed);
    const cwd = parsed.cwd ?? WORKSPACE_DIR;
    const rawCommand = commandToShellString(parsed.command);
    const policy: ProcessPolicy = {
      keepAliveTimeoutMs: parsed.keepAliveTimeoutMs ?? 0,
      maxRestarts: parsed.maxRestarts ?? 0,
      restartOnFailure: parsed.restartOnFailure ?? false,
    };
    const exec = await this.launchSessionProcess(
      id,
      sessionId,
      name,
      cwd,
      supervisedProcessCommand(rawCommand, policy),
      parsed.env,
      parsed.stdin,
    );
    const record = processRecordFromLaunch(parsed, policy, {
      cmdId: exec.cmdId ?? sessionId,
      command: rawCommand,
      cwd,
      sessionId,
    });
    await this.persistStartedProcess(id, name, record, parsed.waitForPort);
    await recordSandboxUsageBestEffort(await this.meteringContext());
    return { command: record.command, id: name, status: "running" };
  }

  public async allocateProjectPort(input: ProjectAllocatePortInput): Promise<number> {
    const parsed = ProjectAllocatePortInputSchema.parse(input);
    const allocation = await this.portAllocation();
    const existing = allocation.ports[parsed.projectId];
    if (existing !== undefined) {
      return existing;
    }
    const used = new Set(Object.values(allocation.ports));
    let candidate = parsed.stack === "mobile" ? allocation.mobileNext : allocation.webNext;
    while (used.has(candidate)) {
      candidate += 1;
    }
    allocation.ports[parsed.projectId] = candidate;
    if (parsed.stack === "mobile") {
      allocation.mobileNext = candidate + 1;
    } else {
      allocation.webNext = candidate + 1;
    }
    await this.ctx.storage.put(PORT_ALLOC_KEY, allocation);
    return candidate;
  }

  public async allocateProcessPort(input: ProjectAllocateProcessPortInput): Promise<number> {
    const parsed = ProjectAllocateProcessPortInputSchema.parse(input);
    const now = Date.now();
    let reservations = await this.processPortReservations();
    const records = await this.ctx.storage.list({ prefix: PROC_PREFIX });
    reservations = pruneExpiredProcessPortReservations(reservations, records, now);
    const used = usedProcessPorts(reservations, records, parsed.processId);
    const existing = reservations[parsed.processId];
    if (
      existing &&
      existing.port >= parsed.minPort &&
      existing.port <= parsed.maxPort &&
      !used.has(existing.port)
    ) {
      reservations[parsed.processId] = { ...existing, reservedAtMs: now };
      await this.ctx.storage.put(PROCESS_PORT_ALLOC_KEY, reservations);
      return existing.port;
    }
    const port = firstAvailablePort(used, parsed.minPort, parsed.maxPort);
    if (port === null) {
      throw new APIError(503, "sandbox_failed_to_start", "No sandbox process port is available.", {
        retriable: true,
      });
    }
    reservations[parsed.processId] = { port, reservedAtMs: now };
    await this.ctx.storage.put(PROCESS_PORT_ALLOC_KEY, reservations);
    return port;
  }

  public async killAllProcesses(): Promise<number> {
    const id = await this.existingSandboxId();
    const records = await this.ctx.storage.list({ prefix: PROC_PREFIX });
    let killed = 0;
    for (const [key, value] of records) {
      const name = key.slice(PROC_PREFIX.length);
      if (id && ProcessRecordSchema.safeParse(value).success) {
        await this.deleteProcessRecord(id, name);
        killed += 1;
      } else {
        await this.ctx.storage.delete(key);
      }
    }
    await this.ctx.storage.delete(PROCESS_PORT_ALLOC_KEY);
    return killed;
  }

  public async killProcess(input: ProjectKillProcessInput): Promise<SandboxKillProcessResult> {
    const parsed = ProjectKillProcessInputSchema.parse(input);
    const record = await this.processRecord(parsed.processId);
    const id = record ? await this.existingSandboxId() : null;
    if (record && id) {
      await this.deleteProcessRecord(id, parsed.processId);
    } else {
      await this.ctx.storage.delete(`${PROC_PREFIX}${parsed.processId}`);
      await this.releaseProcessPort(parsed.processId);
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
      const snapshot = await this.readProcessLogs(id, process, parsed).catch(async (error) => {
        if (isMissingDaytonaProcessError(error)) {
          await this.ctx.storage.delete(`${PROC_PREFIX}${process.name}`);
          await this.releaseProcessPort(process.name);
          return null;
        }
        throw this.toUpstreamError(error, "Sandbox console read failed.");
      });
      if (snapshot) {
        return snapshot;
      }
    }
    return emptyConsoleSnapshot({ stderr: parsed.stderrCursor, stdout: parsed.stdoutCursor });
  }

  protected async isPortAlive(id: string, port: number): Promise<boolean> {
    const probe = await this.client()
      .execute(id, {
        command: `curl -sf -o /dev/null --max-time 3 http://localhost:${port}/`,
        timeout: 5,
      })
      .catch(() => null);
    return probe?.exitCode === 0;
  }

  protected async relaunchDevServer(
    id: string,
    name: string,
    record: ProcessRecord,
    restartEnv?: Record<string, string>,
  ): Promise<void> {
    const sessionId = record.sessionId || `cc-${name}`;
    await this.client()
      .deleteSession(id, sessionId)
      .catch(() => undefined);
    const exec = await this.launchSessionProcess(
      id,
      sessionId,
      name,
      record.cwd,
      supervisedProcessCommand(record.command, record),
      restartEnv ?? restartEnvironment(name, record),
    );
    try {
      await this.ctx.storage.put(`${PROC_PREFIX}${name}`, {
        ...record,
        cmdId: exec.cmdId ?? sessionId,
        startedAtMs: Date.now(),
      } satisfies ProcessRecord);
    } catch (error) {
      await this.cleanupLaunchedProcess(id, sessionId, name);
      throw error;
    }
  }

  protected async waitForPort(
    id: string,
    port: number,
    path: string | undefined,
    timeoutMs: number | undefined,
    process?: { cmdId: string; sessionId: string },
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
      if (probe?.exitCode === 0) {
        return;
      }
      if (process) {
        await this.throwIfProcessExited(id, port, process);
      }
      await sleep(1_500);
    }
    throw new APIError(504, "upstream_timeout_sandbox", "Sandbox process did not become ready.", {
      details: { port, timeoutMs: timeoutMs ?? 120_000, url },
      hint: "Inspect the process command and logs, then retry.",
      retriable: true,
    });
  }

  protected async httpPortReady(
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

  protected async processRecord(name: string): Promise<ProcessRecord | null> {
    const value = await this.ctx.storage.get(`${PROC_PREFIX}${name}`);
    const parsed = ProcessRecordSchema.safeParse(value);
    return parsed.success ? parsed.data : null;
  }

  protected async deleteProcessRecord(
    id: string,
    name: string,
    keepPortReservation = false,
  ): Promise<void> {
    const record = await this.processRecord(name);
    if (record) {
      await this.deleteSessionEnvironment(id, record.sessionId);
      await this.client()
        .deleteSession(id, record.sessionId)
        .catch(() => undefined);
    }
    await this.ctx.storage.delete(`${PROC_PREFIX}${name}`);
    if (!keepPortReservation) {
      await this.releaseProcessPort(name);
    }
  }

  protected async deleteProcessesOnPort(
    id: string,
    port: number,
    exceptName: string,
  ): Promise<void> {
    const records = await this.ctx.storage.list({ prefix: PROC_PREFIX });
    for (const [key, value] of records) {
      const parsed = ProcessRecordSchema.safeParse(value);
      const name = key.slice(PROC_PREFIX.length);
      if (parsed.success && name !== exceptName && parsed.data.port === port) {
        await this.deleteProcessRecord(id, name);
      }
    }
  }

  protected async freeProjectPort(workspaceSlug: string): Promise<void> {
    const allocation = await this.portAllocation();
    if (allocation.ports[workspaceSlug] === undefined) {
      return;
    }
    const ports = Object.fromEntries(
      Object.entries(allocation.ports).filter(([slug]) => slug !== workspaceSlug),
    );
    await this.ctx.storage.put(PORT_ALLOC_KEY, { ...allocation, ports });
  }

  private async prepareProcessSlot(
    id: string,
    name: string,
    input: ParsedProcessStartInput,
  ): Promise<void> {
    if (!input.processId && !input.waitForPort) {
      return;
    }
    await this.deleteProcessRecord(id, name, true);
    if (input.waitForPort) {
      await this.deleteProcessesOnPort(id, input.waitForPort.port, name);
    }
  }

  private async persistStartedProcess(
    id: string,
    name: string,
    record: ProcessRecord,
    waitForPort: ParsedProcessStartInput["waitForPort"],
  ): Promise<void> {
    try {
      await this.ctx.storage.put(`${PROC_PREFIX}${name}`, record);
      if (waitForPort) {
        await this.waitForPort(id, waitForPort.port, waitForPort.path, waitForPort.timeoutMs, {
          cmdId: record.cmdId,
          sessionId: record.sessionId,
        });
      }
    } catch (error) {
      await this.cleanupLaunchedProcess(id, record.sessionId, name);
      throw error;
    }
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
    const envPath = `${ENV_FILE_DIR}/${sessionId}.env`;
    const body = Object.entries(env)
      .map(([key, value]) => `export ${key}=${shellQuote(value)}`)
      .join("\n");
    await this.client().createFolder(id, ENV_FILE_DIR, "0700");
    await this.client().uploadFile(id, envPath, new TextEncoder().encode(`${body}\n`));
    const permissions = await this.client().execute(id, {
      command: `chmod 600 ${shellQuote(envPath)}`,
      timeout: 10,
    });
    if (permissions.exitCode !== 0) {
      throw new Error("Could not secure the transient process environment.");
    }
    return `set -a
. ${shellQuote(envPath)}
env_status=$?
rm -f ${shellQuote(envPath)}
[ "$env_status" -eq 0 ] || exit "$env_status"
set +a
cd ${shellQuote(cwd)} && ${rawCommand}`;
  }

  private async launchSessionProcess(
    id: string,
    sessionId: string,
    name: string,
    cwd: string,
    rawCommand: string,
    env: Record<string, string> | undefined,
    stdin?: string,
  ): Promise<DaytonaSessionExecResponse> {
    try {
      const command = await this.buildSessionCommand(id, sessionId, cwd, rawCommand, env);
      await this.client().createSession(id, sessionId);
      const execution = await this.client().execSessionCommand(id, sessionId, command, true);
      if (stdin !== undefined) {
        if (!execution.cmdId) {
          throw new Error("Sandbox process did not return a command ID for bootstrap input.");
        }
        await this.client().sendSessionCommandInput(id, sessionId, execution.cmdId, stdin);
      }
      return execution;
    } catch (error) {
      await this.deleteSessionEnvironment(id, sessionId);
      await this.client()
        .deleteSession(id, sessionId)
        .catch(() => undefined);
      await this.releaseProcessPort(name);
      throw error;
    }
  }

  private async cleanupLaunchedProcess(id: string, sessionId: string, name: string): Promise<void> {
    await this.deleteSessionEnvironment(id, sessionId);
    await this.client()
      .deleteSession(id, sessionId)
      .catch(() => undefined);
    await this.ctx.storage.delete(`${PROC_PREFIX}${name}`);
    await this.releaseProcessPort(name);
  }

  private async deleteSessionEnvironment(id: string, sessionId: string): Promise<void> {
    await this.client()
      .deleteFilePath(id, `${ENV_FILE_DIR}/${sessionId}.env`, false)
      .catch(() => undefined);
  }

  private async throwIfProcessExited(
    id: string,
    port: number,
    process: { cmdId: string; sessionId: string },
  ): Promise<void> {
    const session = await this.client()
      .getSession(id, process.sessionId)
      .catch(() => null);
    const command = session?.commands.find((candidate) => candidate.id === process.cmdId);
    if (typeof command?.exitCode !== "number") {
      return;
    }
    const logs = await this.client()
      .getSessionCommandLogs(id, process.sessionId, process.cmdId)
      .catch(() => "");
    throw new APIError(502, "sandbox_command_failed", "Sandbox process exited before readiness.", {
      details: { exitCode: command.exitCode, logs: logs.slice(-2_000), port },
      hint: "Inspect the process logs, fix the start command, and retry.",
      retriable: false,
    });
  }

  private async readProcessLogs(
    id: string,
    process: NamedProcessRecord,
    input: ReturnType<typeof ProjectReadDevServerLogsInputSchema.parse>,
  ): Promise<SandboxConsoleSnapshot> {
    const buffer = await this.client().getSessionCommandLogs(
      id,
      process.record.sessionId,
      process.record.cmdId,
    );
    const sliced = sliceProcessLogs({
      lastPid: input.lastPid,
      pid: process.record.cmdId,
      stderrCursor: input.stderrCursor,
      stderrText: "",
      stdoutCursor: input.stdoutCursor,
      stdoutText: buffer,
      tail: input.tail,
    });
    return {
      ...sliced,
      process: {
        command: process.record.command,
        id: process.name,
        pid: process.record.cmdId,
        status: "running",
      },
    };
  }

  private async processRecordsForRead(name: string): Promise<NamedProcessRecord[]> {
    const exact = await this.processRecord(name);
    return exact ? [{ name, record: exact }] : [];
  }

  protected async portAllocation(): Promise<PortAllocation> {
    return PortAllocationSchema.parse((await this.ctx.storage.get(PORT_ALLOC_KEY)) ?? {});
  }

  private async processPortReservations(): Promise<ProcessPortReservations> {
    return ProcessPortReservationsSchema.parse(
      (await this.ctx.storage.get(PROCESS_PORT_ALLOC_KEY)) ?? {},
    );
  }

  private async releaseProcessPort(processId: string): Promise<void> {
    const reservations = await this.processPortReservations();
    if (reservations[processId] === undefined) {
      return;
    }
    await this.ctx.storage.put(
      PROCESS_PORT_ALLOC_KEY,
      withoutProcessReservation(reservations, processId),
    );
  }
}

function isMissingDaytonaProcessError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    (error.status === 404 || error.status === 410)
  );
}
