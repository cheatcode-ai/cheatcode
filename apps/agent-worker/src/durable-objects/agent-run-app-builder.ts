import {
  type AnalyticsBindings,
  APIError,
  type createLogger,
  emitUserEvent,
} from "@cheatcode/observability";
import type { CodeRuntimeContext } from "@cheatcode/sandbox-contracts";
import {
  executeShellExec,
  executeShellTerminal,
  executeStartDevServer,
} from "@cheatcode/tools-code";
import type { ProjectMode } from "@cheatcode/types";
import type { UIMessageChunk } from "ai";
import {
  ensureExpoWebSupport,
  installAppBuilderDependencies,
  scaffoldAppBuilder,
  scaffoldExpoApp,
  writeAppBuilderFiles,
} from "./agent-run-app-builder-scaffold";

export type ProjectSandboxStub = CodeRuntimeContext["sandbox"];
export type AgentRunLogger = ReturnType<typeof createLogger>;

interface AgentRunAppBuilderEnv extends AnalyticsBindings {
  HYPERDRIVE: Hyperdrive;
}

interface AgentRunAppBuilderInput {
  importRepoUrl?: string | undefined;
  isFirstRun?: boolean;
  messageText: string;
  projectId: string;
  projectMode?: ProjectMode;
  runId?: string | undefined;
  sandboxName: string;
  threadId: string;
  userId: string;
  workspaceSlug: string;
}

// Informational only: the mobile port hint threaded into an imported project's context note. The
// actual Metro port is allocated per-project by the DO, not fixed to this value.
const DEFAULT_MOBILE_PORT = 8081;
// Keep the header-free Expo Go capability short-lived. It is re-minted whenever
// the preview wakes, so a fresh QR is available without leaving a day-long URL live.
const SIGNED_PREVIEW_TTL_SECONDS = 60 * 60;

type AppendChunk = (chunk: UIMessageChunk) => Promise<void>;

interface GitHubRepoRef {
  host: string;
  owner: string;
  path: string;
  repo: string;
}

// The per-project workspace this run builds in: its folder under /workspace, its stable dev-server
// port within the per-user sandbox, and the process slot that keeps it distinct from other
// projects' dev servers (all of which persist side by side — Cheatcode parity).
interface AppBuilderWorkspace {
  dir: string;
  mobile: boolean;
  port: number;
  slot: string;
}

function isMobileBuild(input: AgentRunAppBuilderInput): boolean {
  return input.projectMode === "app-builder-mobile";
}

async function allocateAppPort(
  sandbox: ProjectSandboxStub,
  slug: string,
  mobile: boolean,
  logger: AgentRunLogger,
): Promise<number> {
  // Per-user sandbox: never fall back to a fixed shared port — two projects on the same fixed port
  // would fight over it (a rebuild's deleteProcessesOnPort would kill the other's dev server). If
  // the allocator is unavailable, fail the dev-server start loudly instead of sharing a port.
  if (!sandbox.allocateProjectPort) {
    logger.error("app_port_alloc_missing_method", { slug });
    throw appPortAllocationError(slug);
  }
  try {
    const port = await sandbox.allocateProjectPort({
      projectId: slug,
      stack: mobile ? "mobile" : "web",
    });
    logger.info("app_port_allocated", { mobile, port, slug });
    return port;
  } catch (error) {
    logger.error("app_port_alloc_failed", {
      error,
      slug,
    });
    throw appPortAllocationError(slug);
  }
}

function appPortAllocationError(slug: string): APIError {
  return new APIError(
    502,
    "sandbox_failed_to_start",
    "Could not allocate a per-project dev-server port.",
    {
      details: { slug },
      hint: "Retry the run. If it persists, the project sandbox port allocator is unavailable.",
      retriable: true,
    },
  );
}

async function resolveAppWorkspace(
  sandbox: ProjectSandboxStub,
  input: AgentRunAppBuilderInput,
  logger: AgentRunLogger,
): Promise<AppBuilderWorkspace> {
  const mobile = isMobileBuild(input);
  const dir = `/workspace/${input.workspaceSlug}`;
  // Slot + port key off the project's workspaceSlug so the mobile path matches the start_dev_server
  // tool + wakePreview (all keyed by slug, not projectId).
  const slug = input.workspaceSlug;
  const slot = `app-preview:${slug}`;
  const port = await allocateAppPort(sandbox, slug, mobile, logger);
  return { dir, mobile, port, slot };
}

interface RunAppBuilderOptions {
  abortSignal: AbortSignal;
  append: AppendChunk;
  env: AgentRunAppBuilderEnv;
  input: AgentRunAppBuilderInput;
  logger: AgentRunLogger;
  sandbox: ProjectSandboxStub;
  // Harness workspace setup runs before the model streams; its progress is status
  // chrome (run stage / Computer panel), never visible answer prose. Anything the
  // model needs to know is handed to it as agentContextNote.
  setRunStage: (stage: string) => void;
}

type WorkspaceOptions = RunAppBuilderOptions & { workspace: AppBuilderWorkspace };

export async function runAppBuilder(
  options: RunAppBuilderOptions,
): Promise<{ agentContextNote?: string }> {
  const { input, logger, sandbox } = options;
  throwIfRunCanceled(options.abortSignal);
  const workspace = await resolveAppWorkspace(sandbox, input, logger);
  // Stop only THIS project's dev server before rebuilding — other projects in the per-user sandbox
  // keep running (Cheatcode parity: every project's dev server persists on its own port).
  await stopProjectPreview(sandbox, logger, workspace.slot);
  throwIfRunCanceled(options.abortSignal);
  const workspaceOptions: WorkspaceOptions = { ...options, workspace };
  // Marker/.git gate runs FIRST: an imported repo (any framework shape) must
  // never fall back into the destructive reset + re-clone scaffold path on a
  // follow-up run. See D7 — the marker, not the template-shape check, is the
  // one-shot guarantee.
  if (await hasImportedAppWorkspace(sandbox, workspace.dir)) {
    return restoreImportedWorkspace(workspaceOptions);
  }
  const shouldBootstrap = !(await hasExistingAppBuilderWorkspace(
    sandbox,
    workspace.dir,
    workspace.mobile,
  ));
  if (shouldBootstrap && input.importRepoUrl) {
    return importRepoWorkspace({ ...workspaceOptions, repoUrl: input.importRepoUrl });
  }
  return runTemplateAppBuilder({ ...workspaceOptions, shouldBootstrap });
}

async function runTemplateAppBuilder(
  options: WorkspaceOptions & { shouldBootstrap: boolean },
): Promise<{ agentContextNote: string }> {
  const { sandbox, workspace } = options;
  throwIfRunCanceled(options.abortSignal);
  await prepareTemplateWorkspace(options);
  throwIfRunCanceled(options.abortSignal);
  await clearBuildCache(sandbox, workspace.dir, workspace.mobile);
  throwIfRunCanceled(options.abortSignal);
  await startTemplatePreview(options);
  return { agentContextNote: templateContextNote(workspace) };
}

function templateContextNote(workspace: AppBuilderWorkspace): string {
  const stack = workspace.mobile ? "Expo Router" : "Next.js";
  const mobile = workspace.mobile
    ? " For this mobile build, that internal address renders the react-native-web preview."
    : "";
  return `[context] A ${stack} workspace is scaffolded in ${workspace.dir}, and its managed dev server is running internally at http://localhost:${workspace.port}. Build the user's app by editing files under ${workspace.dir}; it hot-reloads on save. Verify it with the sandbox's headed browser at that internal localhost address.${mobile} Never request or paste an external preview or Expo URL.`;
}

async function prepareTemplateWorkspace(
  options: WorkspaceOptions & { shouldBootstrap: boolean },
): Promise<void> {
  const { input, logger, sandbox, setRunStage, shouldBootstrap, workspace } = options;
  const mobile = workspace.mobile;
  setRunStage(mobile ? "Preparing the Expo workspace." : "Preparing the Next.js workspace.");
  if (!shouldBootstrap) {
    setRunStage("Restoring the app workspace.");
    await installAppBuilderDependencies(sandbox, logger, workspace.dir, mobile);
    if (mobile) {
      await ensureExpoWebSupport(sandbox, workspace.dir);
    }
    return;
  }
  await resetAppBuilderDirectory(sandbox, workspace.dir);
  throwIfRunCanceled(options.abortSignal);
  if (mobile) {
    await scaffoldExpoApp(sandbox, logger, workspace.dir);
  } else {
    await scaffoldAppBuilder(sandbox, logger, workspace.dir);
  }
  await installAppBuilderDependencies(sandbox, logger, workspace.dir, mobile);
  throwIfRunCanceled(options.abortSignal);
  if (mobile) {
    await ensureExpoWebSupport(sandbox, workspace.dir);
  } else {
    setRunStage("Seeding the starter files.");
    await writeAppBuilderFiles(input, sandbox, workspace.dir);
  }
}

async function startTemplatePreview(options: WorkspaceOptions): Promise<void> {
  const { append, logger, sandbox, setRunStage, workspace } = options;
  setRunStage("Starting the dev server.");
  if (workspace.mobile) {
    await startExpoDevServer(sandbox, logger, workspace);
  } else {
    await startAppBuilderDevServer(sandbox, workspace);
  }
  await append({
    type: "data-sandbox-status",
    data: { v: 1, status: "ready" },
  });
}

// Metro (mobile) starts BEFORE the model edits files, and its file-watcher never observes the
// agent's Daytona uploadFile writes in the sandbox container (no watchman + unreliable inotify —
// the same reason the Next.js path force-polls). So its in-memory file-map keeps bundling the
// scaffold even after the counter lands on disk, and a browser hard-refresh just re-bundles from
// that stale map. Restarting the dev server once the edit stream completes makes a fresh Metro
// process re-crawl the workspace and bundle the finished app. startProcess reuses this project's
// dev-server slot (it kills the old process + frees its port), so the restart is transparent to
// the authenticated preview wake path. Mobile only — web/Next.js hot-reloads via polling.
export async function restartMobilePreview(
  options: Pick<RunAppBuilderOptions, "append" | "input" | "logger" | "sandbox" | "setRunStage">,
): Promise<void> {
  const { append, input, logger, sandbox, setRunStage } = options;
  setRunStage("Reloading the preview.");
  const workspace = await resolveAppWorkspace(sandbox, input, logger);
  await startExpoDevServer(sandbox, logger, workspace);
  await append({
    type: "data-sandbox-status",
    data: { v: 1, status: "ready" },
  });
}

// First import run only: clone the public GitHub repo over the empty workspace,
// drop the one-shot marker, best-effort install, and hand control to the agent
// without auto-starting a dev server (framework/port are unknowable). Failure
// throws repo_import_failed, which rides the existing run() failure path.
async function importRepoWorkspace(
  options: WorkspaceOptions & { repoUrl: string },
): Promise<{ agentContextNote: string }> {
  const { append, env, input, logger, repoUrl, sandbox, setRunStage, workspace } = options;
  const startedAt = Date.now();
  const repoRef = parseGitHubRepo(repoUrl);
  if (!repoRef) {
    logger.error("repo_import_failed", { exitCode: null, repoHost: null, repoPath: null });
    emitImportEvent(env, input, "repo_import_failed");
    throw repoImportError("The import URL must be a public https github.com repository.");
  }
  logger.info("repo_import_started", { repoHost: repoRef.host, repoPath: repoRef.path });
  setRunStage(`Cloning ${repoRef.path}.`);
  await resetAppBuilderDirectory(sandbox, workspace.dir);
  throwIfRunCanceled(options.abortSignal);
  await cloneRepoOrThrow({ dir: workspace.dir, env, input, logger, repoRef, repoUrl, sandbox });
  throwIfRunCanceled(options.abortSignal);
  await markImportedWorkspace(sandbox, workspace.dir);
  const installRan = await installImportedDependencies(sandbox, logger, workspace.dir);
  await clearBuildCache(sandbox, workspace.dir, workspace.mobile);
  await emitImportReady(append);
  logger.info("repo_import_succeeded", {
    durationMs: Date.now() - startedAt,
    installRan,
    repoHost: repoRef.host,
    repoPath: repoRef.path,
  });
  emitImportEvent(env, input, "repo_import_succeeded");
  return { agentContextNote: importedContextNote(workspace, repoUrl) };
}

// Every follow-up run of an imported project: re-install best-effort, but NEVER
// reset, re-clone, or auto-start the template dev server (prior agent
// edits must survive).
async function restoreImportedWorkspace(
  options: WorkspaceOptions,
): Promise<{ agentContextNote: string }> {
  const { append, input, logger, sandbox, setRunStage, workspace } = options;
  setRunStage("Restoring the imported workspace.");
  await installImportedDependencies(sandbox, logger, workspace.dir);
  throwIfRunCanceled(options.abortSignal);
  await clearBuildCache(sandbox, workspace.dir, workspace.mobile);
  await append({ type: "data-sandbox-status", data: { v: 1, status: "ready" } });
  return { agentContextNote: importedContextNote(workspace, input.importRepoUrl) };
}

async function hasImportedAppWorkspace(sandbox: ProjectSandboxStub, dir: string): Promise<boolean> {
  const result = await executeShellTerminal(
    {
      command: `test -f ${dir}/.cheatcode-imported || test -d ${dir}/.git`,
      cwd: "/workspace",
      timeoutMs: 10_000,
    },
    { sandbox },
  );
  return result.success;
}

function throwIfRunCanceled(signal: AbortSignal): void {
  if (!signal.aborted) {
    return;
  }
  throw signal.reason instanceof Error ? signal.reason : new Error("run canceled");
}

async function cloneRepoOrThrow(options: {
  dir: string;
  env: AgentRunAppBuilderEnv;
  input: AgentRunAppBuilderInput;
  logger: AgentRunLogger;
  repoRef: GitHubRepoRef;
  repoUrl: string;
  sandbox: ProjectSandboxStub;
}): Promise<void> {
  try {
    await executeShellExec(
      {
        command: ["git", "clone", "--depth", "1", "--single-branch", options.repoUrl, options.dir],
        cwd: "/workspace",
        timeoutMs: 300_000,
      },
      { sandbox: options.sandbox },
    );
  } catch (error) {
    options.logger.error("repo_import_failed", {
      exitCode: cloneFailureExitCode(error),
      repoHost: options.repoRef.host,
      repoPath: options.repoRef.path,
    });
    emitImportEvent(options.env, options.input, "repo_import_failed");
    throw repoImportError("Could not clone the repository.");
  }
}

function cloneFailureExitCode(error: unknown): number | null {
  if (error instanceof APIError) {
    const exitCode = error.opts.details?.["exitCode"];
    return typeof exitCode === "number" ? exitCode : null;
  }
  return null;
}

async function markImportedWorkspace(sandbox: ProjectSandboxStub, dir: string): Promise<void> {
  await executeShellExec(
    {
      command: ["touch", `${dir}/.cheatcode-imported`],
      cwd: "/workspace",
      timeoutMs: 10_000,
    },
    { sandbox },
  );
}

async function installImportedDependencies(
  sandbox: ProjectSandboxStub,
  logger: AgentRunLogger,
  dir: string,
): Promise<boolean> {
  if (!(await pathExists(sandbox, `${dir}/package.json`))) {
    return false;
  }
  const usesNpm = await pathExists(sandbox, `${dir}/package-lock.json`);
  const command = usesNpm
    ? ["npm", "install", "--no-audit", "--no-fund"]
    : ["pnpm", "install", "--prefer-offline", "--network-concurrency", "4"];
  try {
    await executeShellExec({ command, cwd: dir, timeoutMs: 300_000 }, { sandbox });
    return true;
  } catch (error) {
    logger.warn("repo_import_install_failed", {
      error,
    });
    return false;
  }
}

async function pathExists(sandbox: ProjectSandboxStub, path: string): Promise<boolean> {
  const result = await executeShellTerminal(
    { command: `test -e ${path}`, cwd: "/workspace", timeoutMs: 10_000 },
    { sandbox },
  );
  return result.success;
}

async function emitImportReady(append: AppendChunk): Promise<void> {
  // The import outcome is handed to the model via agentContextNote (importedContextNote),
  // so it narrates the next steps itself — only the sandbox-ready chrome is emitted here.
  await append({ type: "data-sandbox-status", data: { v: 1, status: "ready" } });
}

function emitImportEvent(
  env: AgentRunAppBuilderEnv,
  input: AgentRunAppBuilderInput,
  eventName: "repo_import_failed" | "repo_import_succeeded",
): void {
  emitUserEvent(env, {
    eventName,
    userId: input.userId,
    ...(input.runId ? { runId: input.runId } : {}),
  });
}

function parseGitHubRepo(url: string): GitHubRepoRef | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:") {
    return null;
  }
  if (parsed.username !== "" || parsed.password !== "") {
    return null;
  }
  if (parsed.hostname !== "github.com" && parsed.hostname !== "www.github.com") {
    return null;
  }
  const segments = parsed.pathname.split("/").filter(Boolean);
  const owner = segments[0];
  const rawRepo = segments[1];
  if (!owner || !rawRepo) {
    return null;
  }
  const repo = rawRepo.replace(/\.git$/u, "");
  return { host: parsed.hostname, owner, path: `${owner}/${repo}`, repo };
}

function importedContextNote(workspace: AppBuilderWorkspace, repoUrl?: string): string {
  const origin = repoUrl ? ` from ${repoUrl}` : "";
  const mobilePort = DEFAULT_MOBILE_PORT;
  return `[context] This project was imported${origin} into ${workspace.dir}. Inspect it, complete any setup, and start the dev server on port ${workspace.port} with start_dev_server (Expo on ${mobilePort} for mobile).`;
}

function repoImportError(message: string): APIError {
  return new APIError(502, "repo_import_failed", message, {
    hint: "Check the URL is a public GitHub repo, then retry.",
    retriable: true,
  });
}

export async function warmSandbox(
  sandbox: ProjectSandboxStub,
  logger: AgentRunLogger,
): Promise<void> {
  const result = await sandbox.runCode({
    code: "print('ready')",
    language: "python",
  });
  const stdout = result.stdout;
  logger.info("sandbox_warmed", {
    success: result.success,
    stdoutBytes: stdout.length,
  });
}

async function startExpoDevServer(
  sandbox: ProjectSandboxStub,
  logger: AgentRunLogger,
  workspace: AppBuilderWorkspace,
): Promise<void> {
  // Mint the signed Metro URL BEFORE starting the server: Expo Go reaches the manifest via this
  // header-free URL, and Metro must know its public host (EXPO_PACKAGER_PROXY_URL) so the manifest's
  // launchAsset/bundle URLs point at the signed host instead of 127.0.0.1 (which Expo Go can't hit).
  const signedUrl = await getSignedMetroUrl(sandbox, logger, workspace.port);
  await executeStartDevServer(
    {
      // `--web` makes the single Metro dev server also serve the react-native-web
      // build as a real web page at `/` (iframe-renderable in the Computer panel),
      // while the SAME server keeps answering exp:// manifests for Expo Go — so we
      // get both the in-panel preview and the QR from one process on the project port.
      // `-c` clears Metro's transform/file-map cache on start (boolean flag, order-
      // independent among the other flags): harmless on the initial boot, and what
      // makes the post-edit restart (restartMobilePreview) re-crawl from a clean slate.
      command: [
        "pnpm",
        "exec",
        "expo",
        "start",
        "-c",
        "--web",
        "--host",
        "lan",
        "--port",
        String(workspace.port),
      ],
      cwd: workspace.dir,
      env: {
        CI: "1",
        EXPO_NO_TELEMETRY: "1",
        ...(signedUrl ? { EXPO_PACKAGER_PROXY_URL: signedUrl } : {}),
      },
      isMobile: true,
      name: workspace.slot,
      port: workspace.port,
      timeoutMs: 180_000,
    },
    { sandbox },
  );
}

// Best-effort Metro bootstrap capability. It is passed only to the live process so Metro emits
// externally reachable asset URLs; process environments are never persisted or returned to the
// model/UI. The authenticated wake endpoint independently mints the user's ephemeral Expo link.
async function getSignedMetroUrl(
  sandbox: ProjectSandboxStub,
  logger: AgentRunLogger,
  port: number,
): Promise<string | null> {
  if (!sandbox.getSignedPreviewUrl) {
    logger.warn("expo_signed_preview_unavailable");
    return null;
  }
  try {
    const signed = await sandbox.getSignedPreviewUrl({
      expiresInSeconds: SIGNED_PREVIEW_TTL_SECONDS,
      port,
    });
    return signed.url;
  } catch (error) {
    logger.warn("expo_signed_preview_url_failed", {
      error,
    });
    return null;
  }
}

async function startAppBuilderDevServer(
  sandbox: ProjectSandboxStub,
  workspace: AppBuilderWorkspace,
): Promise<void> {
  await executeStartDevServer(
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
        String(workspace.port),
      ],
      cwd: workspace.dir,
      env: {
        CHOKIDAR_USEPOLLING: "true",
        WATCHPACK_POLLING: "1000",
      },
      isMobile: false,
      name: workspace.slot,
      port: workspace.port,
      timeoutMs: 180_000,
    },
    { sandbox },
  );
}

async function hasExistingAppBuilderWorkspace(
  sandbox: ProjectSandboxStub,
  dir: string,
  mobile: boolean,
): Promise<boolean> {
  const appDir = mobile ? "app" : "src/app";
  const result = await executeShellTerminal(
    {
      command: `test -f ${dir}/package.json && test -d ${dir}/${appDir}`,
      cwd: "/workspace",
      timeoutMs: 10_000,
    },
    { sandbox },
  );
  return result.success;
}

async function resetAppBuilderDirectory(sandbox: ProjectSandboxStub, dir: string): Promise<void> {
  await executeShellExec(
    { command: ["rm", "-rf", dir], cwd: "/workspace", timeoutMs: 120_000 },
    { sandbox },
  );
}

async function clearBuildCache(
  sandbox: ProjectSandboxStub,
  dir: string,
  mobile: boolean,
): Promise<void> {
  const cacheDir = mobile ? ".expo" : ".next";
  await executeShellExec(
    {
      command: ["rm", "-rf", `${dir}/${cacheDir}`],
      cwd: "/workspace",
      timeoutMs: 120_000,
    },
    { sandbox },
  );
}

async function stopProjectPreview(
  sandbox: ProjectSandboxStub,
  logger: AgentRunLogger,
  slot: string,
): Promise<void> {
  try {
    await sandbox.killProcess?.({ processId: slot });
    logger.info("sandbox_project_preview_stopped", { slot });
  } catch (error) {
    logger.warn("sandbox_process_stop_failed", {
      error,
    });
  }
}
