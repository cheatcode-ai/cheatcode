import {
  createDb,
  type DatabaseHandle,
  type DirectoryBackupHandle,
  ensureSandboxProject,
  getSandboxProjectById,
  saveProjectBackupById,
  saveSandboxProjectBackup,
  withUserContext,
} from "@cheatcode/db";
import type { createLogger } from "@cheatcode/observability";
import {
  type CodeRuntimeContext,
  executeCreateSnapshot,
  executeRestoreSnapshot,
  executeShellExec,
  executeShellTerminal,
  executeStartDevServer,
  executeWriteFile,
} from "@cheatcode/tools-code";
import { ProjectId, UserId } from "@cheatcode/types";
import type { UIMessageChunk } from "ai";
import { z } from "zod";
import {
  appBuilderGlobalStylesSource,
  appBuilderLayoutSource,
  appBuilderPageSource,
} from "./app-builder-template";

const APP_BUILDER_DIR = "/workspace/app";
const APP_BUILDER_PORT = 5173;
const EXPO_METRO_PORT = 8081;
const DEFAULT_PREVIEW_HOSTNAME = "preview.trycheatcode.com";
const DEFAULT_PROJECT_MODE = "web";
const PreviewHostnameSchema = z.string().trim().min(1).max(255).default(DEFAULT_PREVIEW_HOSTNAME);

type ProjectSandboxStub = CodeRuntimeContext["sandbox"];
type AgentRunLogger = ReturnType<typeof createLogger>;

interface AgentRunAppBuilderEnv {
  HYPERDRIVE: Hyperdrive;
  PREVIEW_HOSTNAME?: string;
}

interface AgentRunAppBuilderInput {
  isFirstRun?: boolean;
  messageText: string;
  projectId: string;
  projectMode?: "app-builder" | "app-builder-mobile" | "general";
  sandboxName: string;
  threadId: string;
  userId: string;
}

function isMobileBuild(input: AgentRunAppBuilderInput): boolean {
  return input.projectMode === "app-builder-mobile";
}

interface RunAppBuilderOptions {
  append: (chunk: UIMessageChunk) => Promise<void>;
  env: AgentRunAppBuilderEnv;
  input: AgentRunAppBuilderInput;
  logger: AgentRunLogger;
  sandbox: ProjectSandboxStub;
}

export async function runAppBuilder({
  append,
  env,
  input,
  logger,
  sandbox,
}: RunAppBuilderOptions): Promise<void> {
  const mobile = isMobileBuild(input);
  await append({
    type: "text-delta",
    id: "answer",
    delta: mobile
      ? "Preparing the Expo workspace and live preview...\n"
      : "Preparing the Next.js workspace and live preview...\n",
  });
  await stopBestEffortProcesses(sandbox, logger);
  const shouldBootstrap = !(await hasExistingAppBuilderWorkspace(sandbox, mobile));
  if (shouldBootstrap) {
    await resetAppBuilderDirectory(sandbox);
    if (mobile) {
      await scaffoldExpoApp(sandbox, logger);
    } else {
      await scaffoldAppBuilder(sandbox, logger);
    }
    await installAppBuilderDependencies(sandbox, logger, mobile);
    if (!mobile) {
      await append({
        type: "text-delta",
        id: "answer",
        delta: "Seeding the app files before the agent customizes them...\n",
      });
      await writeAppBuilderFiles(input, sandbox);
    }
  } else {
    await append({
      type: "text-delta",
      id: "answer",
      delta: "Using the restored app workspace for this follow-up...\n",
    });
    await installAppBuilderDependencies(sandbox, logger, mobile);
  }
  await clearBuildCache(sandbox, mobile);
  await snapshotAppBuilderWorkspace({ env, input, logger, sandbox });
  await append({
    type: "text-delta",
    id: "answer",
    delta: "Starting the dev server and exposing the preview URL...\n",
  });
  const preview = mobile
    ? await startExpoDevServer(env, sandbox)
    : await startAppBuilderDevServer(env, sandbox);
  const previewUrl = clientPreviewUrl(preview.previewUrl, resolvePreviewHostname(env));
  const expoUrl = mobile ? expoUrlFromPreview(preview.previewUrl) : null;
  await append({
    type: "data-sandbox-status",
    data: { v: 1, status: "ready", previewUrl, ...(expoUrl ? { expoUrl } : {}) },
  });
  await append({
    type: "text-delta",
    id: "answer",
    delta: expoUrl
      ? `Preview is running:\n\n${previewUrl}\n\nScan the QR code in the App panel with Expo Go to test on a real device (${expoUrl}).\n\nContinuing with the agent build in ${APP_BUILDER_DIR}...\n`
      : `Preview is running:\n\n${previewUrl}\n\nContinuing with the agent build in ${APP_BUILDER_DIR}...\n`,
  });
}

export function expoUrlFromPreview(previewUrl: string): null | string {
  const parsed = new URL(previewUrl);
  if (parsed.hostname.endsWith(".localhost")) {
    return null;
  }
  const scheme = parsed.protocol === "https:" ? "exps" : "exp";
  return `${scheme}://${parsed.host}${parsed.pathname === "/" ? "" : parsed.pathname}`;
}

export async function snapshotAppBuilderWorkspace({
  env,
  input,
  logger,
  sandbox,
}: {
  env: AgentRunAppBuilderEnv;
  input: AgentRunAppBuilderInput;
  logger: AgentRunLogger;
  sandbox: ProjectSandboxStub;
}): Promise<void> {
  await createBestEffortSnapshot({ env, input, logger, sandbox });
}

export async function restoreBestEffortSnapshot(
  input: AgentRunAppBuilderInput,
  sandbox: ProjectSandboxStub,
  env: AgentRunAppBuilderEnv,
  logger: AgentRunLogger,
): Promise<void> {
  const backup = await ensureProjectRecord(input, env, logger);
  if (!backup) {
    return;
  }

  try {
    await executeRestoreSnapshot({ backup }, { sandbox });
    logger.info("sandbox_snapshot_restored", { backupId: backup.id });
  } catch (error) {
    logger.warn("sandbox_snapshot_restore_failed", {
      backupId: backup.id,
      error: error instanceof Error ? error.message : "Unknown snapshot restore error",
    });
  }
}

export async function warmSandbox(
  sandbox: ProjectSandboxStub,
  logger: AgentRunLogger,
): Promise<void> {
  const result = await sandbox.runCode({
    code: "print('ready')",
    language: "python",
  });
  const stdout = result.stdout ?? result.output ?? "";
  logger.info("sandbox_warmed", {
    success: result.success === true,
    stdoutBytes: stdout.length,
  });
}

function writeAppBuilderFiles(
  input: AgentRunAppBuilderInput,
  sandbox: ProjectSandboxStub,
): Promise<void> {
  return Promise.all([
    executeWriteFile(
      {
        path: `${APP_BUILDER_DIR}/src/app/layout.tsx`,
        content: appBuilderLayoutSource(),
      },
      { sandbox },
    ),
    executeWriteFile(
      {
        path: `${APP_BUILDER_DIR}/src/app/globals.css`,
        content: appBuilderGlobalStylesSource(),
      },
      { sandbox },
    ),
    executeWriteFile(
      {
        path: `${APP_BUILDER_DIR}/src/app/page.tsx`,
        content: appBuilderPageSource(input.messageText),
      },
      { sandbox },
    ),
  ]).then(() => undefined);
}

async function startExpoDevServer(
  env: AgentRunAppBuilderEnv,
  sandbox: ProjectSandboxStub,
): Promise<{ previewUrl: string }> {
  return executeStartDevServer(
    {
      command: [
        "pnpm",
        "exec",
        "expo",
        "start",
        "--host",
        "lan",
        "--port",
        String(EXPO_METRO_PORT),
      ],
      cwd: APP_BUILDER_DIR,
      env: {
        CI: "1",
        EXPO_NO_TELEMETRY: "1",
      },
      hostname: resolvePreviewHostname(env),
      name: "app-preview",
      port: EXPO_METRO_PORT,
      timeoutMs: 180_000,
    },
    { sandbox },
  );
}

async function startAppBuilderDevServer(
  env: AgentRunAppBuilderEnv,
  sandbox: ProjectSandboxStub,
): Promise<{ previewUrl: string }> {
  return executeStartDevServer(
    {
      command: [
        "pnpm",
        "exec",
        "next",
        "dev",
        "--webpack",
        "--hostname",
        "0.0.0.0",
        "--port",
        String(APP_BUILDER_PORT),
      ],
      cwd: APP_BUILDER_DIR,
      env: {
        CHOKIDAR_USEPOLLING: "true",
        WATCHPACK_POLLING: "1000",
      },
      hostname: resolvePreviewHostname(env),
      name: "app-preview",
      port: APP_BUILDER_PORT,
      timeoutMs: 180_000,
    },
    { sandbox },
  );
}

async function hasExistingAppBuilderWorkspace(
  sandbox: ProjectSandboxStub,
  mobile: boolean,
): Promise<boolean> {
  const appDir = mobile ? "app" : "src/app";
  const result = await executeShellTerminal(
    {
      command: `test -f ${APP_BUILDER_DIR}/package.json && test -d ${APP_BUILDER_DIR}/${appDir}`,
      cwd: "/workspace",
      timeoutMs: 10_000,
    },
    { sandbox },
  );
  return result.success;
}

async function resetAppBuilderDirectory(sandbox: ProjectSandboxStub): Promise<void> {
  await executeShellExec(
    { command: ["rm", "-rf", APP_BUILDER_DIR], cwd: "/workspace", timeoutMs: 120_000 },
    { sandbox },
  );
}

async function clearBuildCache(sandbox: ProjectSandboxStub, mobile: boolean): Promise<void> {
  const cacheDir = mobile ? ".expo" : ".next";
  await executeShellExec(
    {
      command: ["rm", "-rf", `${APP_BUILDER_DIR}/${cacheDir}`],
      cwd: "/workspace",
      timeoutMs: 120_000,
    },
    { sandbox },
  );
}

async function createBestEffortSnapshot({
  env,
  input,
  logger,
  sandbox,
}: {
  env: AgentRunAppBuilderEnv;
  input: AgentRunAppBuilderInput;
  logger: AgentRunLogger;
  sandbox: ProjectSandboxStub;
}): Promise<void> {
  try {
    const backup = await executeCreateSnapshot(
      {
        dir: "/workspace",
        name: "app-preview",
      },
      { sandbox },
    );
    await persistBestEffortSnapshot(input, backup, env, logger);
    logger.info("sandbox_snapshot_created", { backupId: backup.id });
  } catch (error) {
    logger.warn("sandbox_snapshot_failed", {
      error: error instanceof Error ? error.message : "Unknown snapshot error",
    });
  }
}

async function ensureProjectRecord(
  input: AgentRunAppBuilderInput,
  env: AgentRunAppBuilderEnv,
  logger: AgentRunLogger,
): Promise<DirectoryBackupHandle | null> {
  const dbHandle = createDb(env.HYPERDRIVE);
  const userId = UserId(input.userId);
  try {
    if (isUuid(input.projectId)) {
      const project = await withUserContext(dbHandle.db, userId, (db) =>
        getSandboxProjectById(db, {
          projectId: ProjectId(input.projectId),
          userId,
        }),
      );
      logger.info("sandbox_project_resolved", {
        projectId: input.projectId,
        sandboxId: input.sandboxName,
      });
      return project?.containerBackup ?? null;
    }
    const project = await withUserContext(dbHandle.db, userId, (db) =>
      ensureSandboxProject(db, {
        mode: DEFAULT_PROJECT_MODE,
        name: projectNameFromThreadId(input.threadId),
        sandboxId: input.projectId,
        userId,
      }),
    );
    logger.info("sandbox_project_resolved", {
      projectId: project.id,
      sandboxId: input.projectId,
    });
    return project.containerBackup;
  } catch (error) {
    logger.warn("sandbox_project_resolve_failed", {
      error: error instanceof Error ? error.message : "Unknown project lookup error",
      sandboxId: input.projectId,
    });
    return null;
  } finally {
    await closeDatabase(dbHandle, logger);
  }
}

async function persistBestEffortSnapshot(
  input: AgentRunAppBuilderInput,
  backup: DirectoryBackupHandle,
  env: AgentRunAppBuilderEnv,
  logger: AgentRunLogger,
): Promise<void> {
  const dbHandle = createDb(env.HYPERDRIVE);
  const userId = UserId(input.userId);
  try {
    await withUserContext(dbHandle.db, userId, async (db) => {
      if (isUuid(input.projectId)) {
        await saveProjectBackupById(db, {
          backup,
          projectId: ProjectId(input.projectId),
          userId,
        });
        return;
      }
      await ensureSandboxProject(db, {
        mode: DEFAULT_PROJECT_MODE,
        name: projectNameFromThreadId(input.threadId),
        sandboxId: input.projectId,
        userId,
      });
      await saveSandboxProjectBackup(db, {
        backup,
        sandboxId: input.projectId,
        userId,
      });
    });
    logger.info("sandbox_snapshot_persisted", {
      backupId: backup.id,
      sandboxId: input.sandboxName,
    });
  } catch (error) {
    logger.warn("sandbox_snapshot_persist_failed", {
      backupId: backup.id,
      error: error instanceof Error ? error.message : "Unknown snapshot persistence error",
      sandboxId: input.sandboxName,
    });
  } finally {
    await closeDatabase(dbHandle, logger);
  }
}

async function closeDatabase(dbHandle: DatabaseHandle, logger: AgentRunLogger): Promise<void> {
  try {
    await dbHandle.close();
  } catch (error) {
    logger.warn("db_close_failed", {
      error: error instanceof Error ? error.message : "Unknown database close error",
    });
  }
}

async function stopBestEffortProcesses(
  sandbox: ProjectSandboxStub,
  logger: AgentRunLogger,
): Promise<void> {
  try {
    const killed = await sandbox.killAllProcesses?.();
    logger.info("sandbox_processes_stopped", { killed: killed ?? 0 });
  } catch (error) {
    logger.warn("sandbox_process_stop_failed", {
      error: error instanceof Error ? error.message : "Unknown process cleanup error",
    });
  }
}

async function scaffoldExpoApp(sandbox: ProjectSandboxStub, logger: AgentRunLogger): Promise<void> {
  try {
    await executeShellExec(
      {
        command: ["cp", "-a", "/home/node/cheatcode-expo-template", APP_BUILDER_DIR],
        cwd: "/workspace",
        timeoutMs: 120_000,
      },
      { sandbox },
    );
    logger.info("sandbox_expo_template_copied", { targetDir: APP_BUILDER_DIR });
    return;
  } catch (error) {
    logger.warn("sandbox_expo_template_copy_failed", {
      error: error instanceof Error ? error.message : "Unknown template copy error",
    });
  }

  await executeShellExec(
    {
      command: [
        "npx",
        "--yes",
        "create-expo-app@latest",
        "app",
        "--template",
        "default",
        "--no-install",
      ],
      cwd: "/workspace",
      env: { CI: "1", EXPO_NO_TELEMETRY: "1" },
      timeoutMs: 180_000,
    },
    { sandbox },
  );
}

async function scaffoldAppBuilder(
  sandbox: ProjectSandboxStub,
  logger: AgentRunLogger,
): Promise<void> {
  try {
    await executeShellExec(
      {
        command: ["cp", "-a", "/home/node/cheatcode-next-template", APP_BUILDER_DIR],
        cwd: "/workspace",
        timeoutMs: 120_000,
      },
      { sandbox },
    );
    logger.info("sandbox_next_template_copied", { targetDir: APP_BUILDER_DIR });
    return;
  } catch (error) {
    logger.warn("sandbox_next_template_copy_failed", {
      error: error instanceof Error ? error.message : "Unknown template copy error",
    });
  }

  await executeShellExec(
    {
      command: [
        "npx",
        "create-next-app@16.2.6",
        "app",
        "--yes",
        "--ts",
        "--tailwind",
        "--eslint",
        "--app",
        "--src-dir",
        "--use-pnpm",
        "--skip-install",
        "--disable-git",
      ],
      cwd: "/workspace",
      timeoutMs: 120_000,
    },
    { sandbox },
  );
}

async function installAppBuilderDependencies(
  sandbox: ProjectSandboxStub,
  logger: AgentRunLogger,
  mobile = false,
): Promise<void> {
  const networkTimeoutMs = mobile ? 300_000 : 120_000;
  try {
    await executeShellExec(
      { command: ["pnpm", "install", "--offline"], cwd: APP_BUILDER_DIR, timeoutMs: 120_000 },
      { sandbox },
    );
    return;
  } catch (error) {
    logger.warn("sandbox_offline_install_failed", {
      error: error instanceof Error ? error.message : "Unknown install error",
    });
  }
  await executeShellExec(
    {
      command: ["pnpm", "install", "--prefer-offline", "--network-concurrency", "4"],
      cwd: APP_BUILDER_DIR,
      timeoutMs: networkTimeoutMs,
    },
    { sandbox },
  );
}

function projectNameFromThreadId(threadId: string): string {
  return threadId.replaceAll("-", " ").slice(0, 60) || "Cheatcode Project";
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value);
}

function resolvePreviewHostname(env: AgentRunAppBuilderEnv): string {
  return PreviewHostnameSchema.parse(env.PREVIEW_HOSTNAME);
}

export function clientPreviewUrl(previewUrl: string, previewHostname: string): string {
  if (previewHostname !== "localhost:8787") {
    return previewUrl;
  }
  const parsed = new URL(previewUrl);
  if (!parsed.hostname.endsWith(".localhost")) {
    return previewUrl;
  }
  const encodedHost = btoa(parsed.host)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
  return `http://localhost:8787/__sandbox/${encodedHost}${parsed.pathname}${parsed.search}${parsed.hash}`;
}
