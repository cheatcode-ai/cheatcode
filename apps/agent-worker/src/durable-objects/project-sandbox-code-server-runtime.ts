import { APIError, createLogger, toAPIError } from "@cheatcode/observability";
import { ErrorCodeSchema } from "@cheatcode/types";
import { SandboxIdeStartupPhaseSchema, type SandboxIdeStartupStatus } from "@cheatcode/types/api";
import { z } from "zod";
import { shellQuote } from "../sandbox-support";
import { scheduleCodeServerAlarm } from "./project-sandbox-alarm";
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
import { WORKSPACE_DIR } from "./project-sandbox-content-support";
import { DAYTONA_ID_KEY } from "./project-sandbox-lifecycle-support";
import { buildPreviewUrl } from "./project-sandbox-preview";
import type { ProcessRecord } from "./project-sandbox-process-support";
import type { CoordinatedProcessOps, ProcessOps } from "./project-sandbox-processes";
import type { ProjectCodeServerInput } from "./project-sandbox-runtime";
import { ProjectCodeServerInputSchema } from "./project-sandbox-runtime";
import type { SandboxRuntime } from "./project-sandbox-runtime-handle";

const CODE_SERVER_STARTUP_STATE_KEY = "code_server_startup_state_v1";
const CODE_SERVER_STARTUP_VERSION = CODE_SERVER_SETTINGS_MARKER;
const READY_EVIDENCE_TTL_MS = 10_000;
const STARTUP_STALE_MS = 5 * 60_000;
const STARTUP_RETRY_DELAY_MS = 1_500;
const STARTUP_MAX_ATTEMPTS = 2;

const StoredCodeServerStartupSchema = z.strictObject({
  attempt: z.number().int().min(0).max(STARTUP_MAX_ATTEMPTS),
  errorCode: ErrorCodeSchema.optional(),
  nextAttemptAtMs: z.number().int().positive().optional(),
  operationId: z.string().uuid(),
  phase: SandboxIdeStartupPhaseSchema,
  processCmdId: z.string().min(1).max(500).optional(),
  processSessionId: z.string().min(1).max(500).optional(),
  requestedAtMs: z.number().int().positive(),
  retriable: z.boolean().optional(),
  sandboxId: z.string().min(1).max(500).optional(),
  targetVersion: z.string().min(1).max(500),
  updatedAtMs: z.number().int().positive(),
});

type StoredCodeServerStartup = z.infer<typeof StoredCodeServerStartupSchema>;

type CodeServerRuntime = Pick<
  SandboxRuntime,
  "client" | "ensureSandbox" | "previewHostname" | "previewSecret" | "releaseSha" | "storage"
>;

type CodeServerProcessOps = Pick<
  ProcessOps,
  | "deleteProcessRecord"
  | "deleteProcessesOnPort"
  | "httpPortReady"
  | "processRecord"
  | "relaunchDevServer"
  | "waitForPort"
>;

type CodeServerCoordinatedProcessOps = Pick<CoordinatedProcessOps, "startProcess">;

interface CodeServerContext {
  coordinatedProcess: CodeServerCoordinatedProcessOps;
  process: CodeServerProcessOps;
  runtime: CodeServerRuntime;
  startupPromise: Promise<void> | null;
}

interface StartupFence {
  attempt: number;
  operationId: string;
  phase: StoredCodeServerStartup["phase"];
}

export interface CodeServerOps {
  beginCodeServerStartup: () => Promise<SandboxIdeStartupStatus>;
  codeServerStartupStatus: (operationId: string) => Promise<SandboxIdeStartupStatus>;
  continueCodeServerStartup: () => Promise<void>;
  exposeCodeServer: (input: ProjectCodeServerInput) => Promise<{
    expiresAt: string;
    port: number;
    url: string;
    workspacePath: string;
  }>;
}

export function createCodeServerOps(
  runtime: CodeServerRuntime,
  dependencies: {
    coordinatedProcess: CodeServerCoordinatedProcessOps;
    process: CodeServerProcessOps;
  },
): CodeServerOps {
  const context: CodeServerContext = { ...dependencies, runtime, startupPromise: null };
  return {
    beginCodeServerStartup: () => beginCodeServerStartup(context),
    codeServerStartupStatus: (operationId) => codeServerStartupStatus(context, operationId),
    continueCodeServerStartup: () => continueCodeServerStartup(context),
    exposeCodeServer: (input) => exposeCodeServer(context, input),
  };
}

async function beginCodeServerStartup(
  context: CodeServerContext,
): Promise<SandboxIdeStartupStatus> {
  const current = await readStartupState(context.runtime.storage);
  if (current && (await canReuseStartupState(context, current))) {
    await scheduleCodeServerAlarm(
      context.runtime.storage,
      isPendingPhase(current.phase) ? (current.nextAttemptAtMs ?? Date.now()) : null,
    );
    return publicStartupStatus(current);
  }
  const now = Date.now();
  const state: StoredCodeServerStartup = {
    attempt: 0,
    operationId: crypto.randomUUID(),
    phase: "queued",
    requestedAtMs: now,
    targetVersion: CODE_SERVER_STARTUP_VERSION,
    updatedAtMs: now,
  };
  await context.runtime.storage.put(CODE_SERVER_STARTUP_STATE_KEY, state);
  await scheduleCodeServerAlarm(context.runtime.storage, now);
  return publicStartupStatus(state);
}

async function codeServerStartupStatus(
  context: CodeServerContext,
  operationId: string,
): Promise<SandboxIdeStartupStatus> {
  const parsedOperationId = z.string().uuid().parse(operationId);
  const state = await readStartupState(context.runtime.storage);
  if (!state || state.operationId !== parsedOperationId) {
    return expiredStartupStatus(parsedOperationId);
  }
  if (isPendingPhase(state.phase) && Date.now() - state.updatedAtMs > STARTUP_STALE_MS) {
    return expiredStartupStatus(parsedOperationId);
  }
  return publicStartupStatus(state);
}

async function continueCodeServerStartup(context: CodeServerContext): Promise<void> {
  const current = await readStartupState(context.runtime.storage);
  if (!current || current.phase === "ready" || current.phase === "failed") {
    await scheduleCodeServerAlarm(context.runtime.storage, null);
    return;
  }
  if (current.nextAttemptAtMs && current.nextAttemptAtMs > Date.now()) {
    await scheduleCodeServerAlarm(context.runtime.storage, current.nextAttemptAtMs);
    return;
  }
  const running = await claimStartupAttempt(context.runtime.storage, current);
  if (!running) return;
  try {
    const sandboxId = await context.runtime.ensureSandbox();
    const preparingFiles = await prepareFilesPhase(context.runtime.storage, running, sandboxId);
    if (!preparingFiles) return;
    await ensureCodeServerSingleFlight(context, sandboxId);
    await markCodeServerReady(context, preparingFiles, sandboxId);
  } catch (error) {
    await handleStartupFailure(context, running.operationId, running.attempt, error);
  }
}

async function claimStartupAttempt(
  storage: DurableObjectStorage,
  current: StoredCodeServerStartup,
): Promise<StoredCodeServerStartup | null> {
  if (current.phase !== "queued") return current;
  if (current.attempt >= STARTUP_MAX_ATTEMPTS) {
    const failed = await updateStartupState(storage, startupFence(current), {
      errorCode: "internal_service_error",
      phase: "failed",
      retriable: true,
    });
    if (failed) await scheduleCodeServerAlarm(storage, null);
    return null;
  }
  return updateStartupState(storage, startupFence(current), {
    attempt: current.attempt + 1,
    phase: "starting_sandbox",
  });
}

async function prepareFilesPhase(
  storage: DurableObjectStorage,
  running: StoredCodeServerStartup,
  sandboxId: string,
): Promise<StoredCodeServerStartup | null> {
  if (running.phase === "starting_files") {
    return updateStartupState(storage, startupFence(running), { sandboxId });
  }
  return updateStartupState(storage, startupFence(running), {
    phase: "starting_files",
    sandboxId,
  });
}

async function exposeCodeServer(
  context: CodeServerContext,
  input: ProjectCodeServerInput,
): Promise<{ expiresAt: string; port: number; url: string; workspacePath: string }> {
  const parsed = ProjectCodeServerInputSchema.parse(input);
  const ready = await freshReadyState(context);
  const sandboxId = ready?.sandboxId ?? (await ensureAndRecordCodeServer(context));
  const displayFolder =
    parsed.workspacePath === WORKSPACE_DIR
      ? await ensureCodeServerDisplayFolder(context.runtime, sandboxId, parsed.workspacePath)
      : parsed.workspacePath;
  const built = await buildPreviewUrl({
    hostname: context.runtime.previewHostname(),
    port: CODE_SERVER_PORT,
    sandboxId,
    secret: await context.runtime.previewSecret(),
    useSubdomain: true,
  });
  return {
    expiresAt: built.expiresAt,
    port: CODE_SERVER_PORT,
    url: codeServerFolderUrl(
      built.url,
      displayFolder,
      context.runtime.releaseSha(),
      parsed.initialFilePath,
    ),
    workspacePath: parsed.workspacePath,
  };
}

async function ensureAndRecordCodeServer(context: CodeServerContext): Promise<string> {
  const intent = await synchronousStartupIntent(context.runtime.storage);
  try {
    const sandboxId = await context.runtime.ensureSandbox();
    const preparingFiles = await prepareFilesPhase(context.runtime.storage, intent, sandboxId);
    await ensureCodeServerSingleFlight(context, sandboxId);
    if (preparingFiles) {
      await markCodeServerReady(context, preparingFiles, sandboxId);
    }
    return sandboxId;
  } catch (error) {
    await handleStartupFailure(context, intent.operationId, intent.attempt, error);
    throw error;
  }
}

async function synchronousStartupIntent(
  storage: DurableObjectStorage,
): Promise<StoredCodeServerStartup> {
  const current = await readStartupState(storage);
  if (current && isPendingPhase(current.phase)) return current;
  const now = Date.now();
  const intent: StoredCodeServerStartup = {
    attempt: 1,
    operationId: crypto.randomUUID(),
    phase: "starting_sandbox",
    requestedAtMs: now,
    targetVersion: CODE_SERVER_STARTUP_VERSION,
    updatedAtMs: now,
  };
  await storage.put(CODE_SERVER_STARTUP_STATE_KEY, intent);
  return intent;
}

function ensureCodeServerSingleFlight(
  context: CodeServerContext,
  sandboxId: string,
): Promise<void> {
  if (context.startupPromise !== null) return context.startupPromise;
  const startup = ensureCodeServer(context, sandboxId);
  const tracked = startup.finally(() => {
    if (context.startupPromise === tracked) context.startupPromise = null;
  });
  context.startupPromise = tracked;
  return tracked;
}

async function ensureCodeServer(context: CodeServerContext, sandboxId: string): Promise<void> {
  const [isPortReady, hasCurrentSettings] = await Promise.all([
    context.process.httpPortReady(sandboxId, CODE_SERVER_PORT, "/", 5_000),
    hasCodeServerSettingsMarker(context.runtime, sandboxId),
  ]);
  if (isPortReady && hasCurrentSettings) return;
  const tracked = await context.process.processRecord(CODE_SERVER_PROCESS_ID);
  if (hasCurrentSettings && tracked?.port === CODE_SERVER_PORT) {
    await relaunchTrackedCodeServer(context, sandboxId, tracked);
    return;
  }
  if (!(await hasCodeServerRuntime(context.runtime, sandboxId))) {
    throw new APIError(502, "sandbox_start_failed", "code-server is not installed", {
      hint: "Start a new project sandbox from the current Daytona snapshot to use the Files viewer.",
      retriable: false,
    });
  }
  await context.process.deleteProcessRecord(sandboxId, CODE_SERVER_PROCESS_ID);
  await context.process.deleteProcessesOnPort(sandboxId, CODE_SERVER_PORT, CODE_SERVER_PROCESS_ID);
  await context.runtime
    .client()
    .execute(sandboxId, { command: "pkill -f code-server || true", timeout: 5 })
    .catch(() => null);
  await startCodeServer(context);
  if (!(await context.process.httpPortReady(sandboxId, CODE_SERVER_PORT, "/", 5_000))) {
    throw new APIError(502, "sandbox_start_failed", "Unable to start code-server", {
      hint: "Rebuild the Daytona sandbox snapshot with code-server, then retry the Files tab.",
      retriable: true,
    });
  }
}

async function relaunchTrackedCodeServer(
  context: CodeServerContext,
  sandboxId: string,
  record: ProcessRecord,
): Promise<void> {
  const relaunched = await context.process.relaunchDevServer(
    sandboxId,
    CODE_SERVER_PROCESS_ID,
    record,
    codeServerEnvironment(context.runtime.previewHostname()),
  );
  await context.process.waitForPort(
    sandboxId,
    CODE_SERVER_PORT,
    "/",
    CODE_SERVER_START_TIMEOUT_MS,
    { cmdId: relaunched.cmdId, sessionId: relaunched.sessionId },
  );
}

async function startCodeServer(context: CodeServerContext): Promise<void> {
  await context.coordinatedProcess.startProcess({
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

async function hasCodeServerRuntime(
  runtime: CodeServerRuntime,
  sandboxId: string,
): Promise<boolean> {
  const probe = await runtime
    .client()
    .execute(sandboxId, { command: "command -v code-server >/dev/null", timeout: 5 })
    .catch(() => null);
  return probe?.exitCode === 0;
}

async function hasCodeServerSettingsMarker(
  runtime: CodeServerRuntime,
  sandboxId: string,
): Promise<boolean> {
  const probe = await runtime
    .client()
    .execute(sandboxId, {
      command: `test -f ${shellQuote(CODE_SERVER_SETTINGS_MARKER)}`,
      timeout: 5,
    })
    .catch(() => null);
  return probe?.exitCode === 0;
}

async function ensureCodeServerDisplayFolder(
  runtime: CodeServerRuntime,
  sandboxId: string,
  workspacePath: string,
): Promise<string> {
  const probe = await runtime
    .client()
    .execute(sandboxId, {
      command: `ln -sfn ${shellQuote(workspacePath)} ${shellQuote(CODE_SERVER_DISPLAY_DIR)} && test -d ${shellQuote(CODE_SERVER_DISPLAY_DIR)}`,
      timeout: 10,
    })
    .catch(() => null);
  return probe?.exitCode === 0 ? CODE_SERVER_DISPLAY_DIR : workspacePath;
}

async function handleStartupFailure(
  context: CodeServerContext,
  operationId: string,
  attempt: number,
  error: unknown,
): Promise<void> {
  const apiError = toAPIError(error);
  createLogger().warn("code_server_startup_failed", { error: apiError, operationId });
  const current = await readStartupState(context.runtime.storage);
  if (
    !current ||
    current.operationId !== operationId ||
    current.attempt !== attempt ||
    !isPendingPhase(current.phase)
  ) {
    return;
  }
  if (apiError.retriable && attempt < STARTUP_MAX_ATTEMPTS) {
    const retryAt = Date.now() + STARTUP_RETRY_DELAY_MS;
    const queued = await updateStartupState(context.runtime.storage, startupFence(current), {
      attempt,
      errorCode: apiError.code,
      nextAttemptAtMs: retryAt,
      phase: "queued",
      retriable: true,
    });
    if (queued) await scheduleCodeServerAlarm(context.runtime.storage, retryAt);
    return;
  }
  const failed = await updateStartupState(context.runtime.storage, startupFence(current), {
    errorCode: apiError.code,
    phase: "failed",
    retriable: apiError.retriable,
  });
  if (failed) await scheduleCodeServerAlarm(context.runtime.storage, null);
}

async function canReuseStartupState(
  context: CodeServerContext,
  state: StoredCodeServerStartup,
): Promise<boolean> {
  if (state.targetVersion !== CODE_SERVER_STARTUP_VERSION) return false;
  if (isPendingPhase(state.phase)) {
    return Date.now() - state.updatedAtMs <= STARTUP_STALE_MS;
  }
  return state.phase === "ready" && (await isReadyEvidenceFresh(context, state));
}

async function freshReadyState(
  context: CodeServerContext,
): Promise<StoredCodeServerStartup | null> {
  const state = await readStartupState(context.runtime.storage);
  return state?.phase === "ready" && (await isReadyEvidenceFresh(context, state)) ? state : null;
}

async function isReadyEvidenceFresh(
  context: CodeServerContext,
  state: StoredCodeServerStartup,
): Promise<boolean> {
  if (
    !state.sandboxId ||
    !state.processCmdId ||
    !state.processSessionId ||
    state.targetVersion !== CODE_SERVER_STARTUP_VERSION ||
    Date.now() - state.updatedAtMs > READY_EVIDENCE_TTL_MS
  ) {
    return false;
  }
  const [sandboxId, process] = await Promise.all([
    context.runtime.storage.get(DAYTONA_ID_KEY),
    context.process.processRecord(CODE_SERVER_PROCESS_ID),
  ]);
  return (
    sandboxId === state.sandboxId &&
    process?.cmdId === state.processCmdId &&
    process.sessionId === state.processSessionId
  );
}

async function markCodeServerReady(
  context: CodeServerContext,
  running: StoredCodeServerStartup,
  sandboxId: string,
): Promise<void> {
  const process = await context.process.processRecord(CODE_SERVER_PROCESS_ID);
  const ready = await updateStartupState(context.runtime.storage, startupFence(running), {
    phase: "ready",
    ...(process ? { processCmdId: process.cmdId, processSessionId: process.sessionId } : {}),
    sandboxId,
  });
  if (ready) await scheduleCodeServerAlarm(context.runtime.storage, null);
}

async function updateStartupState(
  storage: DurableObjectStorage,
  fence: StartupFence,
  patch: Partial<StoredCodeServerStartup>,
): Promise<StoredCodeServerStartup | null> {
  const current = await readStartupState(storage);
  if (
    !current ||
    current.operationId !== fence.operationId ||
    current.attempt !== fence.attempt ||
    current.phase !== fence.phase
  ) {
    return null;
  }
  const next = StoredCodeServerStartupSchema.parse({
    attempt: current.attempt,
    operationId: current.operationId,
    ...patch,
    phase: patch.phase ?? current.phase,
    requestedAtMs: current.requestedAtMs,
    ...(patch.sandboxId === undefined && current.sandboxId ? { sandboxId: current.sandboxId } : {}),
    targetVersion: current.targetVersion,
    updatedAtMs: Date.now(),
  });
  await storage.put(CODE_SERVER_STARTUP_STATE_KEY, next);
  return next;
}

async function readStartupState(
  storage: DurableObjectStorage,
): Promise<StoredCodeServerStartup | null> {
  const raw = await storage.get(CODE_SERVER_STARTUP_STATE_KEY);
  if (raw === undefined) return null;
  const parsed = StoredCodeServerStartupSchema.safeParse(raw);
  if (parsed.success) return parsed.data;
  await storage.delete(CODE_SERVER_STARTUP_STATE_KEY);
  return null;
}

function startupFence(state: StoredCodeServerStartup): StartupFence {
  return {
    attempt: state.attempt,
    operationId: state.operationId,
    phase: state.phase,
  };
}

function publicStartupStatus(state: StoredCodeServerStartup): SandboxIdeStartupStatus {
  const retryAfterMs = isPendingPhase(state.phase)
    ? Math.max(250, Math.min(10_000, (state.nextAttemptAtMs ?? Date.now() + 1_000) - Date.now()))
    : undefined;
  return {
    ...(state.errorCode ? { errorCode: state.errorCode } : {}),
    ...(state.phase === "failed" ? { message: "Files couldn't start. Try again." } : {}),
    operationId: state.operationId,
    phase: state.phase,
    ...(state.retriable === undefined ? {} : { retriable: state.retriable }),
    ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
    updatedAt: new Date(state.updatedAtMs).toISOString(),
  };
}

function expiredStartupStatus(operationId: string): SandboxIdeStartupStatus {
  return {
    message: "This Files startup expired. Open Files again.",
    operationId,
    phase: "failed",
    retriable: true,
    updatedAt: new Date().toISOString(),
  };
}

function isPendingPhase(phase: StoredCodeServerStartup["phase"]): boolean {
  return phase === "queued" || phase === "starting_sandbox" || phase === "starting_files";
}
