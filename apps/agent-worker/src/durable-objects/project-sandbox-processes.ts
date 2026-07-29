import { APIError, createLogger } from "@cheatcode/observability";
import type {
  SandboxExecResult,
  SandboxKillProcessResult,
  SandboxProcessResult,
  SandboxRunCodeResult,
} from "@cheatcode/sandbox-contracts";
import type { SandboxConsoleSnapshot } from "@cheatcode/types";
import { sandboxExecProcessName } from "./project-sandbox-audit";
import { WORKSPACE_DIR } from "./project-sandbox-content-support";
import { recordSandboxUsageBestEffort } from "./project-sandbox-metering";
import { createProcessControl, type ProcessControl } from "./project-sandbox-process-control";
import { emptyConsoleSnapshot, sliceProcessLogs } from "./project-sandbox-process-logs";
import {
  assertValidProcessStart,
  ENV_FILE_DIR,
  firstAvailablePort,
  type ParsedProcessStartInput,
  PORT_ALLOC_KEY,
  PortAllocationSchema,
  PROC_PREFIX,
  PROCESS_PORT_ALLOC_KEY,
  ProcessMutationQueue,
  type ProcessPolicy,
  ProcessPortReservationsSchema,
  type ProcessRecord,
  ProcessRecordSchema,
  processRecordFromLaunch,
  pruneExpiredProcessPortReservations,
  supervisedProcessCommand,
  timeoutSeconds,
  usedProcessPorts,
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
import type { SandboxRuntime } from "./project-sandbox-runtime-handle";

const DEFAULT_EXEC_TIMEOUT_MS = 60_000;

export interface ProjectSandboxStatus {
  healthy: boolean;
  ping: string;
  sandboxId: string;
}

export type ProcessOps = ProcessControl & {
  allocateProcessPort: (input: ProjectAllocateProcessPortInput) => Promise<number>;
  allocateProjectPort: (input: ProjectAllocatePortInput) => Promise<number>;
  ensureReady: () => Promise<ProjectSandboxStatus>;
  exec: (input: ProjectExecInput) => Promise<SandboxExecResult>;
  getStatus: () => Promise<ProjectSandboxStatus>;
  killAllProcesses: () => Promise<number>;
  killProcess: (input: ProjectKillProcessInput) => Promise<SandboxKillProcessResult>;
  readDevServerLogs: (input: ProjectReadDevServerLogsInput) => Promise<SandboxConsoleSnapshot>;
  runCode: (input: ProjectRunCodeInput) => Promise<SandboxRunCodeResult>;
  startProcess: (input: ProjectStartProcessInput) => Promise<SandboxProcessResult>;
};

export interface CoordinatedProcessOps {
  allocateProcessPort: (input: ProjectAllocateProcessPortInput) => Promise<number>;
  ensureReady: () => Promise<ProjectSandboxStatus>;
  exec: (input: ProjectExecInput) => Promise<SandboxExecResult>;
  killProcess: (input: ProjectKillProcessInput) => Promise<SandboxKillProcessResult>;
  runCode: (input: ProjectRunCodeInput) => Promise<SandboxRunCodeResult>;
  startProcess: (input: ProjectStartProcessInput) => Promise<SandboxProcessResult>;
}

type ProcessRuntime = Pick<
  SandboxRuntime,
  | "client"
  | "ensureSandbox"
  | "existingSandboxId"
  | "meteringContext"
  | "sandboxName"
  | "storage"
  | "toUpstreamError"
  | "writeExecAudit"
>;

interface ProcessContext {
  control: ProcessControl;
  coordinated: CoordinatedProcessOps;
  mutations: ProcessMutationQueue;
  runtime: ProcessRuntime;
}

export function createProcessOps(
  runtime: ProcessRuntime,
  coordinated: CoordinatedProcessOps,
): ProcessOps {
  const control = createProcessControl(runtime);
  const context: ProcessContext = {
    control,
    coordinated,
    mutations: new ProcessMutationQueue(),
    runtime,
  };
  return {
    ...control,
    allocateProcessPort: (input) => allocateProcessPort(runtime, input),
    allocateProjectPort: (input) => allocateProjectPort(runtime, input),
    ensureReady: () => ensureReady(context),
    exec: (input) => exec(runtime, input),
    getStatus: () => coordinated.ensureReady(),
    killAllProcesses: () => context.mutations.run(() => killAllProcesses(context)),
    killProcess: (input) => killProcess(context, input),
    readDevServerLogs: (input) => readDevServerLogs(context, input),
    runCode: (input) => runCode(context, input),
    startProcess: (input) => context.mutations.run(() => startProcess(context, input)),
  };
}

async function ensureReady(context: ProcessContext): Promise<ProjectSandboxStatus> {
  const result = await context.coordinated.runCode({
    code: "print('ready')",
    language: "python",
  });
  return {
    healthy: result.success,
    ping: result.stdout.trim(),
    sandboxId: context.runtime.sandboxName(),
  };
}

async function runCode(
  context: ProcessContext,
  input: ProjectRunCodeInput,
): Promise<SandboxRunCodeResult> {
  const parsed = ProjectRunCodeInputSchema.parse(input);
  const command =
    parsed.language === "python"
      ? ["python3", "-c", parsed.code]
      : ["node", "--input-type=module", "-e", parsed.code];
  const result = await context.coordinated.exec({
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

async function exec(runtime: ProcessRuntime, input: ProjectExecInput): Promise<SandboxExecResult> {
  const parsed = ProjectExecInputSchema.parse(input);
  const id = await runtime.ensureSandbox();
  const startedAt = Date.now();
  const command = commandToShellString(parsed.command);
  const cwd = parsed.cwd ?? WORKSPACE_DIR;
  const timeoutMs = parsed.timeoutMs ?? DEFAULT_EXEC_TIMEOUT_MS;
  try {
    const completed = await runtime.client().execute(id, {
      command,
      cwd,
      timeout: timeoutSeconds(timeoutMs),
      ...(parsed.env === undefined ? {} : { env: parsed.env }),
    });
    const result = execResult(command, completed, startedAt);
    await recordExecAudit(runtime, parsed.command, cwd, result, completed.exitCode, startedAt);
    await recordSandboxUsageBestEffort(await runtime.meteringContext());
    return result;
  } catch (error) {
    throw runtime.toUpstreamError(error, "Sandbox command failed.");
  }
}

function execResult(
  command: string,
  completed: { exitCode: number; result?: string | null | undefined },
  startedAt: number,
): SandboxExecResult {
  return {
    command,
    durationMs: Date.now() - startedAt,
    exitCode: completed.exitCode,
    stderr: "",
    stdout: completed.result ?? "",
    success: completed.exitCode === 0,
  };
}

async function recordExecAudit(
  runtime: ProcessRuntime,
  argv: string[],
  cwd: string,
  result: SandboxExecResult,
  exitCode: number,
  startedAt: number,
): Promise<void> {
  const processName = sandboxExecProcessName(argv[0] ?? "process");
  await runtime
    .writeExecAudit({
      argc: argv.length,
      argv0: processName,
      cwd,
      durationMs: result.durationMs ?? 0,
      exitCode,
      processName,
      sandboxId: runtime.sandboxName(),
      status: result.success ? "completed" : "failed",
      success: result.success,
      timestamp: new Date(startedAt).toISOString(),
      type: "sandbox_exec",
    })
    .catch((error: unknown) => {
      createLogger().warn("sandbox_exec_audit_failed", {
        error,
        processName,
        sandboxId: runtime.sandboxName(),
      });
    });
}

async function startProcess(
  context: ProcessContext,
  input: ProjectStartProcessInput,
): Promise<SandboxProcessResult> {
  const parsed = ProjectStartProcessInputSchema.parse(input);
  assertValidProcessStart(parsed);
  const id = await context.runtime.ensureSandbox();
  const name = parsed.processId;
  const sessionId = `cc-${name}`;
  await context.control.prepareProcessSlot(id, name, parsed);
  const cwd = parsed.cwd ?? WORKSPACE_DIR;
  const rawCommand = commandToShellString(parsed.command);
  const policy = processPolicy(parsed);
  const provisional = processRecordFromLaunch(parsed, policy, {
    cmdId: sessionId,
    command: rawCommand,
    cwd,
    sessionId,
  });
  await context.control.persistProcessOwnershipIntent(name, provisional);
  const record = await launchProcess(context, id, name, sessionId, parsed, provisional);
  await context.control.persistStartedProcess(id, name, record, parsed.waitForPort);
  await recordSandboxUsageBestEffort(await context.runtime.meteringContext());
  return { command: record.command, id: name, status: "running" };
}

function processPolicy(input: ParsedProcessStartInput): ProcessPolicy {
  return {
    keepAliveTimeoutMs: input.keepAliveTimeoutMs ?? 0,
    maxRestarts: input.maxRestarts ?? 0,
    restartOnFailure: input.restartOnFailure ?? false,
  };
}

async function launchProcess(
  context: ProcessContext,
  id: string,
  name: string,
  sessionId: string,
  input: ParsedProcessStartInput,
  provisional: ProcessRecord,
): Promise<ProcessRecord> {
  try {
    const execution = await context.control.launchSessionProcess(
      id,
      sessionId,
      name,
      provisional.cwd,
      supervisedProcessCommand(provisional.command, provisional),
      input.env,
      input.stdin,
    );
    return { ...provisional, cmdId: execution.cmdId ?? sessionId };
  } catch (error) {
    await context.control.cleanupLaunchedProcess(id, sessionId, name);
    throw error;
  }
}

async function allocateProjectPort(
  runtime: ProcessRuntime,
  input: ProjectAllocatePortInput,
): Promise<number> {
  const parsed = ProjectAllocatePortInputSchema.parse(input);
  return runtime.storage.transaction(async (transaction) => {
    const allocation = PortAllocationSchema.parse((await transaction.get(PORT_ALLOC_KEY)) ?? {});
    const existing = allocation.ports[parsed.projectId];
    if (existing !== undefined) return existing;
    const used = new Set(Object.values(allocation.ports));
    let candidate = parsed.stack === "mobile" ? allocation.mobileNext : allocation.webNext;
    while (used.has(candidate)) {
      candidate += 1;
    }
    allocation.ports[parsed.projectId] = candidate;
    if (parsed.stack === "mobile") allocation.mobileNext = candidate + 1;
    else allocation.webNext = candidate + 1;
    await transaction.put(PORT_ALLOC_KEY, allocation);
    return candidate;
  });
}

async function allocateProcessPort(
  runtime: ProcessRuntime,
  input: ProjectAllocateProcessPortInput,
): Promise<number> {
  const parsed = ProjectAllocateProcessPortInputSchema.parse(input);
  return runtime.storage.transaction(async (transaction) => {
    const now = Date.now();
    let reservations = ProcessPortReservationsSchema.parse(
      (await transaction.get(PROCESS_PORT_ALLOC_KEY)) ?? {},
    );
    const records = await transaction.list({ prefix: PROC_PREFIX });
    reservations = pruneExpiredProcessPortReservations(reservations, records, now);
    const used = usedProcessPorts(reservations, records, parsed.processId);
    const existing = reservations[parsed.processId];
    if (isReusableReservation(existing, used, parsed.minPort, parsed.maxPort)) {
      reservations[parsed.processId] = { ...existing, reservedAtMs: now };
      await transaction.put(PROCESS_PORT_ALLOC_KEY, reservations);
      return existing.port;
    }
    const port = firstAvailablePort(used, parsed.minPort, parsed.maxPort);
    if (port === null) throw noProcessPortAvailable();
    reservations[parsed.processId] = { port, reservedAtMs: now };
    await transaction.put(PROCESS_PORT_ALLOC_KEY, reservations);
    return port;
  });
}

function isReusableReservation(
  reservation: { port: number; reservedAtMs: number } | undefined,
  used: Set<number>,
  minPort: number,
  maxPort: number,
): reservation is { port: number; reservedAtMs: number } {
  return (
    reservation !== undefined &&
    reservation.port >= minPort &&
    reservation.port <= maxPort &&
    !used.has(reservation.port)
  );
}

function noProcessPortAvailable(): APIError {
  return new APIError(503, "sandbox_failed_to_start", "No sandbox process port is available.", {
    retriable: true,
  });
}

async function killAllProcesses(context: ProcessContext): Promise<number> {
  const id = await context.runtime.existingSandboxId();
  const records = await context.runtime.storage.list({ prefix: PROC_PREFIX });
  let killed = 0;
  for (const [key, value] of records) {
    const name = key.slice(PROC_PREFIX.length);
    if (id && ProcessRecordSchema.safeParse(value).success) {
      await context.control.deleteProcessRecord(id, name);
      killed += 1;
    } else {
      await context.runtime.storage.delete(key);
    }
  }
  if (id) {
    await context.runtime.client().deleteFilePath(id, ENV_FILE_DIR, true);
  }
  await context.runtime.storage.delete(PROCESS_PORT_ALLOC_KEY);
  return killed;
}

async function killProcess(
  context: ProcessContext,
  input: ProjectKillProcessInput,
): Promise<SandboxKillProcessResult> {
  const parsed = ProjectKillProcessInputSchema.parse(input);
  return context.mutations.run(() => killProcessExclusive(context, parsed.processId));
}

async function killProcessExclusive(
  context: ProcessContext,
  processId: string,
): Promise<SandboxKillProcessResult> {
  const record = await context.control.processRecord(processId);
  const id = record ? await context.runtime.existingSandboxId() : null;
  if (record && id) {
    await context.control.deleteProcessRecord(id, processId);
  } else {
    await context.runtime.storage.delete(`${PROC_PREFIX}${processId}`);
    await context.control.releaseProcessPort(processId);
  }
  return { processId, status: "killed", success: true };
}

async function readDevServerLogs(
  context: ProcessContext,
  input: ProjectReadDevServerLogsInput,
): Promise<SandboxConsoleSnapshot> {
  const parsed = ProjectReadDevServerLogsInputSchema.parse(input);
  const id = await context.runtime.existingSandboxId();
  const record = await context.control.processRecord(parsed.processId);
  if (id === null || !record) {
    return emptyConsoleSnapshot({ stderr: parsed.stderrCursor, stdout: parsed.stdoutCursor });
  }
  try {
    return await readProcessLogs(context, id, parsed.processId, record, parsed);
  } catch (error) {
    if (isMissingDaytonaProcessError(error)) {
      await context.runtime.storage.delete(`${PROC_PREFIX}${parsed.processId}`);
      await context.control.releaseProcessPort(parsed.processId);
      return emptyConsoleSnapshot({ stderr: parsed.stderrCursor, stdout: parsed.stdoutCursor });
    }
    throw context.runtime.toUpstreamError(error, "Sandbox console read failed.");
  }
}

async function readProcessLogs(
  context: ProcessContext,
  id: string,
  name: string,
  record: ProcessRecord,
  input: ReturnType<typeof ProjectReadDevServerLogsInputSchema.parse>,
): Promise<SandboxConsoleSnapshot> {
  const buffer = await context.runtime
    .client()
    .getSessionCommandLogs(id, record.sessionId, record.cmdId);
  const sliced = sliceProcessLogs({
    lastPid: input.lastPid,
    pid: record.cmdId,
    stderrCursor: input.stderrCursor,
    stderrText: "",
    stdoutCursor: input.stdoutCursor,
    stdoutText: buffer,
    tail: input.tail,
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
}

function isMissingDaytonaProcessError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    (error.status === 404 || error.status === 410)
  );
}
