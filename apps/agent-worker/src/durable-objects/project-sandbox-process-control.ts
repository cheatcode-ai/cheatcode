import type { DaytonaSessionExecResponse } from "@cheatcode/agent-core/tools/code";
import { APIError } from "@cheatcode/observability";
import { shellQuote, sleep } from "../sandbox-support";
import { WORKSPACE_DIR } from "./project-sandbox-content-support";
import { projectPackageEnvironment } from "./project-sandbox-package-runtime";
import { SANDBOX_PROCESS_TERMINATION_SCRIPT } from "./project-sandbox-process-cleanup";
import {
  ENV_FILE_DIR,
  MAX_TRACKED_PROCESSES,
  type ParsedProcessStartInput,
  PORT_ALLOC_KEY,
  PortAllocationSchema,
  PROC_PREFIX,
  PROCESS_PORT_ALLOC_KEY,
  ProcessPortReservationsSchema,
  type ProcessRecord,
  ProcessRecordSchema,
  restartEnvironment,
  supervisedProcessCommand,
  timeoutSeconds,
  withoutProcessReservation,
} from "./project-sandbox-process-support";
import type { SandboxRuntime } from "./project-sandbox-runtime-handle";

type ProcessControlRuntime = Pick<SandboxRuntime, "client" | "storage" | "toUpstreamError">;

export interface ProcessControl {
  cleanupLaunchedProcess: (id: string, sessionId: string, name: string) => Promise<void>;
  deleteProcessRecord: (id: string, name: string, keepPortReservation?: boolean) => Promise<void>;
  deleteProcessesOnPort: (id: string, port: number, exceptName: string) => Promise<void>;
  freeProjectPort: (workspaceSlug: string) => Promise<void>;
  httpPortReady: (id: string, port: number, path: string, timeoutMs: number) => Promise<boolean>;
  isPortAlive: (id: string, port: number) => Promise<boolean>;
  launchSessionProcess: (
    id: string,
    sessionId: string,
    name: string,
    cwd: string,
    command: string,
    env: Record<string, string> | undefined,
    stdin?: string,
  ) => Promise<DaytonaSessionExecResponse>;
  persistProcessOwnershipIntent: (name: string, record: ProcessRecord) => Promise<void>;
  persistStartedProcess: (
    id: string,
    name: string,
    record: ProcessRecord,
    waitForPort: ParsedProcessStartInput["waitForPort"],
  ) => Promise<void>;
  prepareProcessSlot: (id: string, name: string, input: ParsedProcessStartInput) => Promise<void>;
  processRecord: (name: string) => Promise<ProcessRecord | null>;
  relaunchDevServer: (
    id: string,
    name: string,
    record: ProcessRecord,
    restartEnv?: Record<string, string>,
  ) => Promise<ProcessRecord>;
  releaseProcessPort: (processId: string) => Promise<void>;
  terminateUntrackedSandboxProcesses: (id: string) => Promise<void>;
  waitForPort: (
    id: string,
    port: number,
    path: string | undefined,
    timeoutMs: number | undefined,
    process?: { cmdId: string; sessionId: string },
  ) => Promise<void>;
}

export function createProcessControl(runtime: ProcessControlRuntime): ProcessControl {
  const control: ProcessControl = {
    cleanupLaunchedProcess: (id, sessionId, name) =>
      cleanupLaunchedProcess(runtime, id, sessionId, name),
    deleteProcessRecord: (id, name, keepPortReservation) =>
      deleteProcessRecord(runtime, id, name, keepPortReservation),
    deleteProcessesOnPort: (id, port, exceptName) =>
      deleteProcessesOnPort(runtime, control, id, port, exceptName),
    freeProjectPort: (workspaceSlug) => freeProjectPort(runtime, workspaceSlug),
    httpPortReady: (id, port, path, timeoutMs) => httpPortReady(runtime, id, port, path, timeoutMs),
    isPortAlive: (id, port) => isPortAlive(runtime, id, port),
    launchSessionProcess: (id, sessionId, name, cwd, command, env, stdin) =>
      launchSessionProcess(runtime, id, sessionId, name, cwd, command, env, stdin),
    persistProcessOwnershipIntent: (name, record) =>
      persistProcessOwnershipIntent(runtime, name, record),
    persistStartedProcess: (id, name, record, waitForPort) =>
      persistStartedProcess(runtime, control, id, name, record, waitForPort),
    prepareProcessSlot: (id, name, input) => prepareProcessSlot(runtime, control, id, name, input),
    processRecord: (name) => processRecord(runtime, name),
    relaunchDevServer: (id, name, record, restartEnv) =>
      relaunchDevServer(runtime, control, id, name, record, restartEnv),
    releaseProcessPort: (processId) => releaseProcessPort(runtime, processId),
    terminateUntrackedSandboxProcesses: (id) => terminateUntrackedSandboxProcesses(runtime, id),
    waitForPort: (id, port, path, timeoutMs, process) =>
      waitForPort(runtime, id, port, path, timeoutMs, process),
  };
  return control;
}

async function isPortAlive(
  runtime: ProcessControlRuntime,
  id: string,
  port: number,
): Promise<boolean> {
  const probe = await runtime
    .client()
    .execute(id, {
      command: `curl -sf -o /dev/null --max-time 3 http://localhost:${port}/`,
      timeout: 5,
    })
    .catch(() => null);
  return probe?.exitCode === 0;
}

async function relaunchDevServer(
  runtime: ProcessControlRuntime,
  control: ProcessControl,
  id: string,
  name: string,
  record: ProcessRecord,
  restartEnv?: Record<string, string>,
): Promise<ProcessRecord> {
  const sessionId = record.sessionId || `cc-${name}`;
  await runtime.client().deleteSession(id, sessionId);
  const exec = await control.launchSessionProcess(
    id,
    sessionId,
    name,
    record.cwd,
    supervisedProcessCommand(record.command, record),
    projectPackageEnvironment(record.cwd, restartEnv ?? restartEnvironment(name, record)),
  );
  const relaunched = {
    ...record,
    cmdId: exec.cmdId ?? sessionId,
    startedAtMs: Date.now(),
  } satisfies ProcessRecord;
  try {
    await runtime.storage.put(`${PROC_PREFIX}${name}`, relaunched);
  } catch (error) {
    await control.cleanupLaunchedProcess(id, sessionId, name);
    throw error;
  }
  return relaunched;
}

async function waitForPort(
  runtime: ProcessControlRuntime,
  id: string,
  port: number,
  path: string | undefined,
  timeoutMs: number | undefined,
  process?: { cmdId: string; sessionId: string },
): Promise<void> {
  const deadline = Date.now() + (timeoutMs ?? 120_000);
  const url = `http://localhost:${port}${path ?? "/"}`;
  while (Date.now() < deadline) {
    const probe = await runtime
      .client()
      .execute(id, {
        command: `curl -sf -o /dev/null --max-time 3 ${shellQuote(url)}`,
        timeout: 5,
      })
      .catch(() => null);
    if (probe?.exitCode === 0) return;
    if (process) {
      await throwIfProcessExited(runtime, id, port, process);
    }
    await sleep(1_500);
  }
  throw new APIError(504, "upstream_sandbox_timeout", "Sandbox process did not become ready.", {
    details: { port, timeoutMs: timeoutMs ?? 120_000, url },
    hint: "Inspect the process command and logs, then retry.",
    retriable: true,
  });
}

async function httpPortReady(
  runtime: ProcessControlRuntime,
  id: string,
  port: number,
  path: string,
  timeoutMs: number,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  const url = `http://localhost:${port}${path}`;
  while (Date.now() < deadline) {
    const probe = await runtime
      .client()
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

async function processRecord(
  runtime: ProcessControlRuntime,
  name: string,
): Promise<ProcessRecord | null> {
  const value = await runtime.storage.get(`${PROC_PREFIX}${name}`);
  const parsed = ProcessRecordSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

async function deleteProcessRecord(
  runtime: ProcessControlRuntime,
  id: string,
  name: string,
  keepPortReservation = false,
): Promise<void> {
  const record = await processRecord(runtime, name);
  if (record) {
    await runtime.client().deleteSession(id, record.sessionId);
    await deleteSessionEnvironment(runtime, id, record.sessionId);
  }
  if (!keepPortReservation) {
    await releaseProcessPort(runtime, name);
  }
  await runtime.storage.delete(`${PROC_PREFIX}${name}`);
}

async function terminateUntrackedSandboxProcesses(
  runtime: ProcessControlRuntime,
  id: string,
): Promise<void> {
  const result = await runtime
    .client()
    .execute(id, {
      command: `python3 -c ${shellQuote(SANDBOX_PROCESS_TERMINATION_SCRIPT)}`,
      cwd: WORKSPACE_DIR,
      timeout: timeoutSeconds(15_000),
    })
    .catch((error: unknown) => {
      throw runtime.toUpstreamError(error, "Sandbox process termination failed.");
    });
  if (result.exitCode !== 0) {
    throw new APIError(
      502,
      "upstream_sandbox_failed",
      "Sandbox processes could not be terminated.",
      {
        details: { output: (result.result ?? "").slice(-1_000) },
        retriable: true,
      },
    );
  }
}

async function deleteProcessesOnPort(
  runtime: ProcessControlRuntime,
  control: ProcessControl,
  id: string,
  port: number,
  exceptName: string,
): Promise<void> {
  const records = await runtime.storage.list({ prefix: PROC_PREFIX });
  for (const [key, value] of records) {
    const parsed = ProcessRecordSchema.safeParse(value);
    const name = key.slice(PROC_PREFIX.length);
    if (parsed.success && name !== exceptName && parsed.data.port === port) {
      await control.deleteProcessRecord(id, name);
    }
  }
}

async function freeProjectPort(
  runtime: ProcessControlRuntime,
  workspaceSlug: string,
): Promise<void> {
  await runtime.storage.transaction(async (transaction) => {
    const allocation = PortAllocationSchema.parse((await transaction.get(PORT_ALLOC_KEY)) ?? {});
    if (allocation.ports[workspaceSlug] === undefined) return;
    const ports = Object.fromEntries(
      Object.entries(allocation.ports).filter(([slug]) => slug !== workspaceSlug),
    );
    await transaction.put(PORT_ALLOC_KEY, { ...allocation, ports });
  });
}

async function prepareProcessSlot(
  runtime: ProcessControlRuntime,
  control: ProcessControl,
  id: string,
  name: string,
  input: ParsedProcessStartInput,
): Promise<void> {
  await control.deleteProcessRecord(id, name, true);
  await ensureProcessCapacity(runtime, control, id);
  if (input.waitForPort) {
    await control.deleteProcessesOnPort(id, input.waitForPort.port, name);
  }
}

async function ensureProcessCapacity(
  runtime: ProcessControlRuntime,
  control: ProcessControl,
  id: string,
): Promise<void> {
  let records = await runtime.storage.list({ prefix: PROC_PREFIX });
  if (records.size < MAX_TRACKED_PROCESSES) return;
  await pruneCompletedProcessRecords(runtime, control, id, records);
  records = await runtime.storage.list({ prefix: PROC_PREFIX });
  if (records.size >= MAX_TRACKED_PROCESSES) {
    throw new APIError(
      429,
      "sandbox_process_limit_reached",
      "The sandbox has no available managed process slot.",
      {
        hint: "Stop an existing managed process or reuse its stable process ID.",
        retriable: false,
      },
    );
  }
}

async function pruneCompletedProcessRecords(
  runtime: ProcessControlRuntime,
  control: ProcessControl,
  id: string,
  records: Map<string, unknown>,
): Promise<void> {
  for (const [key, value] of records) {
    const parsed = ProcessRecordSchema.safeParse(value);
    if (!parsed.success) {
      await control.deleteProcessRecord(id, key.slice(PROC_PREFIX.length));
      continue;
    }
    const session = await runtime.client().getSession(id, parsed.data.sessionId);
    const command = session?.commands.find((candidate) => candidate.id === parsed.data.cmdId);
    if (session === null || typeof command?.exitCode === "number") {
      await control.deleteProcessRecord(id, key.slice(PROC_PREFIX.length));
    }
  }
}

async function persistStartedProcess(
  runtime: ProcessControlRuntime,
  control: ProcessControl,
  id: string,
  name: string,
  record: ProcessRecord,
  waitForPort: ParsedProcessStartInput["waitForPort"],
): Promise<void> {
  try {
    await runtime.storage.put(`${PROC_PREFIX}${name}`, record);
    if (waitForPort) {
      await control.waitForPort(id, waitForPort.port, waitForPort.path, waitForPort.timeoutMs, {
        cmdId: record.cmdId,
        sessionId: record.sessionId,
      });
    }
  } catch (error) {
    await control.cleanupLaunchedProcess(id, record.sessionId, name);
    throw error;
  }
}

async function persistProcessOwnershipIntent(
  runtime: ProcessControlRuntime,
  name: string,
  record: ProcessRecord,
): Promise<void> {
  try {
    await runtime.storage.put(`${PROC_PREFIX}${name}`, record);
  } catch (error) {
    await releaseProcessPort(runtime, name);
    throw error;
  }
}

async function buildSessionCommand(
  runtime: ProcessControlRuntime,
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
  await runtime.client().createFolder(id, ENV_FILE_DIR, "700");
  await runtime.client().uploadFile(id, envPath, new TextEncoder().encode(`${body}\n`));
  const permissions = await runtime.client().execute(id, {
    command: `chmod 600 ${shellQuote(envPath)}`,
    timeout: 10,
  });
  if (permissions.exitCode !== 0) {
    throw new Error("Could not secure the transient process environment.");
  }
  return processShellCommand(envPath, cwd, rawCommand);
}

function processShellCommand(envPath: string, cwd: string, rawCommand: string): string {
  return `set -a
. ${shellQuote(envPath)}
env_status=$?
rm -f ${shellQuote(envPath)}
[ "$env_status" -eq 0 ] || exit "$env_status"
set +a
cd ${shellQuote(cwd)} && ${rawCommand}`;
}

async function launchSessionProcess(
  runtime: ProcessControlRuntime,
  id: string,
  sessionId: string,
  name: string,
  cwd: string,
  rawCommand: string,
  env: Record<string, string> | undefined,
  stdin?: string,
): Promise<DaytonaSessionExecResponse> {
  try {
    const command = await buildSessionCommand(runtime, id, sessionId, cwd, rawCommand, env);
    await runtime.client().createSession(id, sessionId);
    const execution = await runtime.client().execSessionCommand(id, sessionId, command, true);
    if (stdin !== undefined) {
      await sendBootstrapInput(runtime, id, sessionId, execution, stdin);
    }
    return execution;
  } catch (error) {
    await runtime.client().deleteSession(id, sessionId);
    await deleteSessionEnvironment(runtime, id, sessionId);
    await releaseProcessPort(runtime, name);
    throw error;
  }
}

async function sendBootstrapInput(
  runtime: ProcessControlRuntime,
  id: string,
  sessionId: string,
  execution: DaytonaSessionExecResponse,
  stdin: string,
): Promise<void> {
  if (!execution.cmdId) {
    throw new Error("Sandbox process did not return a command ID for bootstrap input.");
  }
  await runtime.client().sendSessionCommandInput(id, sessionId, execution.cmdId, stdin);
}

async function cleanupLaunchedProcess(
  runtime: ProcessControlRuntime,
  id: string,
  sessionId: string,
  name: string,
): Promise<void> {
  await runtime.client().deleteSession(id, sessionId);
  await deleteSessionEnvironment(runtime, id, sessionId);
  await releaseProcessPort(runtime, name);
  await runtime.storage.delete(`${PROC_PREFIX}${name}`);
}

async function deleteSessionEnvironment(
  runtime: ProcessControlRuntime,
  id: string,
  sessionId: string,
): Promise<void> {
  await runtime.client().deleteFilePath(id, `${ENV_FILE_DIR}/${sessionId}.env`, false);
}

async function throwIfProcessExited(
  runtime: ProcessControlRuntime,
  id: string,
  port: number,
  process: { cmdId: string; sessionId: string },
): Promise<void> {
  const session = await runtime
    .client()
    .getSession(id, process.sessionId)
    .catch(() => null);
  const command = session?.commands.find((candidate) => candidate.id === process.cmdId);
  if (typeof command?.exitCode !== "number") return;
  const logs = await runtime
    .client()
    .getSessionCommandLogs(id, process.sessionId, process.cmdId)
    .catch(() => "");
  throw new APIError(502, "sandbox_command_failed", "Sandbox process exited before readiness.", {
    details: { exitCode: command.exitCode, logs: logs.slice(-2_000), port },
    hint: "Inspect the process logs, fix the start command, and retry.",
    retriable: false,
  });
}

async function releaseProcessPort(
  runtime: ProcessControlRuntime,
  processId: string,
): Promise<void> {
  await runtime.storage.transaction(async (transaction) => {
    const reservations = ProcessPortReservationsSchema.parse(
      (await transaction.get(PROCESS_PORT_ALLOC_KEY)) ?? {},
    );
    if (reservations[processId] === undefined) return;
    await transaction.put(
      PROCESS_PORT_ALLOC_KEY,
      withoutProcessReservation(reservations, processId),
    );
  });
}
