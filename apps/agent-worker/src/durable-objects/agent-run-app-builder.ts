import { APIError, emitUserEvent } from "@cheatcode/observability";
import {
  executeShellExec,
  executeShellTerminal,
  executeStartDevServer,
  executeWriteFile,
} from "@cheatcode/tools-code";
import type { UIMessageChunk } from "ai";
import { z } from "zod";
import {
  type AgentRunAppBuilderEnv,
  type AgentRunAppBuilderInput,
  type AgentRunLogger,
  type ProjectSandboxStub,
  restoreBestEffortSnapshot,
  snapshotAppBuilderWorkspace,
} from "./app-builder-snapshot";
import {
  appBuilderGlobalStylesSource,
  appBuilderLayoutSource,
  appBuilderPageSource,
} from "./app-builder-template";
import { signedUrlToExpo } from "./project-sandbox-preview";

export { restoreBestEffortSnapshot, snapshotAppBuilderWorkspace };

// Informational only: the mobile port hint threaded into an imported project's context note. The
// actual Metro port is allocated per-project by the DO, not fixed to this value.
const DEFAULT_MOBILE_PORT = 8081;
// 24h is Daytona's max signed-preview TTL; the token rides in the subdomain so Expo Go needs no
// header, and we re-mint on every dev-server (re)start so it never serves an expired manifest URL.
const SIGNED_PREVIEW_TTL_SECONDS = 24 * 60 * 60;
const DEFAULT_PREVIEW_HOSTNAME = "trycheatcode.com";
const PreviewHostnameSchema = z.string().trim().min(1).max(255).default(DEFAULT_PREVIEW_HOSTNAME);

type AppendChunk = (chunk: UIMessageChunk) => Promise<void>;

interface GitHubRepoRef {
  host: string;
  owner: string;
  path: string;
  repo: string;
}

// The per-project workspace this run builds in: its folder under /workspace, its stable dev-server
// port within the per-user sandbox, and the process slot that keeps it distinct from other
// projects' dev servers (all of which persist side by side — bud parity).
interface AppBuilderWorkspace {
  dir: string;
  mobile: boolean;
  port: number;
  slot: string;
}

function isMobileBuild(input: AgentRunAppBuilderInput): boolean {
  return input.projectMode === "app-builder-mobile";
}

function basename(path: string): string {
  const index = path.lastIndexOf("/");
  return index === -1 ? path : path.slice(index + 1);
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
      error: error instanceof Error ? error.message : String(error),
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
  append: AppendChunk;
  env: AgentRunAppBuilderEnv;
  input: AgentRunAppBuilderInput;
  logger: AgentRunLogger;
  sandbox: ProjectSandboxStub;
  // Harness workspace setup runs before the model streams; its progress is status
  // chrome (run stage / Computer panel), never visible answer prose. Anything the
  // model needs to know (e.g. the live preview URL) is handed to it as agentContextNote.
  setRunStage: (stage: string) => void;
}

type WorkspaceOptions = RunAppBuilderOptions & { workspace: AppBuilderWorkspace };

export async function runAppBuilder(
  options: RunAppBuilderOptions,
): Promise<{ agentContextNote?: string }> {
  const { input, logger, sandbox } = options;
  const workspace = await resolveAppWorkspace(sandbox, input, logger);
  // Stop only THIS project's dev server before rebuilding — other projects in the per-user sandbox
  // keep running (bud parity: every project's dev server persists on its own port).
  await stopProjectPreview(sandbox, logger, workspace.slot);
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
  const { env, input, logger, sandbox, workspace } = options;
  await prepareTemplateWorkspace(options);
  await clearBuildCache(sandbox, workspace.dir, workspace.mobile);
  await snapshotAppBuilderWorkspace({ env, input, logger, sandbox });
  const preview = await startTemplatePreview(options);
  return { agentContextNote: templateContextNote(workspace, preview) };
}

function templateContextNote(
  workspace: AppBuilderWorkspace,
  preview: { previewUrl: string; expoUrl: string | null },
): string {
  const stack = workspace.mobile ? "Expo Router" : "Next.js";
  const web = workspace.mobile
    ? " The preview is the app rendered on web (react-native-web) inside a phone frame, so verify it there in the browser."
    : "";
  const expo = preview.expoUrl
    ? ` The user can also scan the Expo Go QR code shown beside the preview (${preview.expoUrl}) to run it on a real device.`
    : "";
  return `[context] A ${stack} workspace is scaffolded in ${workspace.dir} and its live preview is already running at ${preview.previewUrl}. Build the user's app by editing files under ${workspace.dir}; the preview hot-reloads on save.${web}${expo}`;
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
      await ensureExpoWebSupport(sandbox, logger, workspace.dir);
    }
    return;
  }
  await resetAppBuilderDirectory(sandbox, workspace.dir);
  if (mobile) {
    await scaffoldExpoApp(sandbox, logger, workspace.dir);
  } else {
    await scaffoldAppBuilder(sandbox, logger, workspace.dir);
  }
  await installAppBuilderDependencies(sandbox, logger, workspace.dir, mobile);
  if (mobile) {
    await ensureExpoWebSupport(sandbox, logger, workspace.dir);
  } else {
    setRunStage("Seeding the starter files.");
    await writeAppBuilderFiles(input, sandbox, workspace.dir);
  }
}

async function startTemplatePreview(
  options: WorkspaceOptions,
): Promise<{ previewUrl: string; expoUrl: string | null }> {
  const { append, env, logger, sandbox, setRunStage, workspace } = options;
  setRunStage("Starting the dev server.");
  const preview = workspace.mobile
    ? await startExpoDevServer(env, sandbox, logger, workspace)
    : { ...(await startAppBuilderDevServer(env, sandbox, workspace)), expoUrl: null };
  const { expoUrl, previewUrl } = preview;
  await append({
    type: "data-sandbox-status",
    data: { v: 1, status: "ready", previewUrl, ...(expoUrl ? { expoUrl } : {}) },
  });
  return { previewUrl, expoUrl };
}

// Metro (mobile) starts BEFORE the model edits files, and its file-watcher never observes the
// agent's Daytona uploadFile writes in the sandbox container (no watchman + unreliable inotify —
// the same reason the Next.js path force-polls). So its in-memory file-map keeps bundling the
// scaffold even after the counter lands on disk, and a browser hard-refresh just re-bundles from
// that stale map. Restarting the dev server once the edit stream completes makes a fresh Metro
// process re-crawl the workspace and bundle the finished app. startProcess reuses this project's
// dev-server slot (it kills the old process + frees its port), and the port + preview URL are
// stable, so the restart is transparent to the client. Mobile only — web/Next.js hot-reloads via
// polling.
export async function restartMobilePreview(
  options: Pick<
    RunAppBuilderOptions,
    "append" | "env" | "input" | "logger" | "sandbox" | "setRunStage"
  >,
): Promise<void> {
  const { append, env, input, logger, sandbox, setRunStage } = options;
  setRunStage("Reloading the preview.");
  const workspace = await resolveAppWorkspace(sandbox, input, logger);
  const { expoUrl, previewUrl } = await startExpoDevServer(env, sandbox, logger, workspace);
  await append({
    type: "data-sandbox-status",
    data: { v: 1, status: "ready", previewUrl, ...(expoUrl ? { expoUrl } : {}) },
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
  await cloneRepoOrThrow({ dir: workspace.dir, env, input, logger, repoRef, repoUrl, sandbox });
  await markImportedWorkspace(sandbox, workspace.dir);
  const installRan = await installImportedDependencies(sandbox, logger, workspace.dir);
  await clearBuildCache(sandbox, workspace.dir, workspace.mobile);
  await snapshotAppBuilderWorkspace({ env, input, logger, sandbox });
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

// Every follow-up run of an imported project: re-install best-effort and snapshot,
// but NEVER reset, re-clone, or auto-start the template dev server (prior agent
// edits must survive).
async function restoreImportedWorkspace(
  options: WorkspaceOptions,
): Promise<{ agentContextNote: string }> {
  const { append, env, input, logger, sandbox, setRunStage, workspace } = options;
  setRunStage("Restoring the imported workspace.");
  await installImportedDependencies(sandbox, logger, workspace.dir);
  await clearBuildCache(sandbox, workspace.dir, workspace.mobile);
  await snapshotAppBuilderWorkspace({ env, input, logger, sandbox });
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
    const detail = cloneFailureDetail(error);
    options.logger.error("repo_import_failed", {
      exitCode: detail.exitCode,
      repoHost: options.repoRef.host,
      repoPath: options.repoRef.path,
      stderr: detail.stderr,
    });
    emitImportEvent(options.env, options.input, "repo_import_failed");
    throw repoImportError("Could not clone the repository.");
  }
}

function cloneFailureDetail(error: unknown): { exitCode: number | null; stderr: string } {
  if (error instanceof APIError) {
    const details = error.opts.details;
    const exitCode = details?.["exitCode"];
    const stderr = details?.["stderr"];
    return {
      exitCode: typeof exitCode === "number" ? exitCode : null,
      stderr: typeof stderr === "string" ? stderr.slice(0, 500) : "",
    };
  }
  return { exitCode: null, stderr: error instanceof Error ? error.message.slice(0, 500) : "" };
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
      error: error instanceof Error ? error.message : "Unknown install error",
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
  const stdout = result.stdout ?? result.output ?? "";
  logger.info("sandbox_warmed", {
    success: result.success === true,
    stdoutBytes: stdout.length,
  });
}

function writeAppBuilderFiles(
  input: AgentRunAppBuilderInput,
  sandbox: ProjectSandboxStub,
  dir: string,
): Promise<void> {
  return Promise.all([
    executeWriteFile(
      {
        path: `${dir}/src/app/layout.tsx`,
        content: appBuilderLayoutSource(),
      },
      { sandbox },
    ),
    executeWriteFile(
      {
        path: `${dir}/src/app/globals.css`,
        content: appBuilderGlobalStylesSource(),
      },
      { sandbox },
    ),
    executeWriteFile(
      {
        path: `${dir}/src/app/page.tsx`,
        content: appBuilderPageSource(input.messageText),
      },
      { sandbox },
    ),
  ]).then(() => undefined);
}

async function startExpoDevServer(
  env: AgentRunAppBuilderEnv,
  sandbox: ProjectSandboxStub,
  logger: AgentRunLogger,
  workspace: AppBuilderWorkspace,
): Promise<{ previewUrl: string; expoUrl: string | null }> {
  // Mint the signed Metro URL BEFORE starting the server: Expo Go reaches the manifest via this
  // header-free URL, and Metro must know its public host (EXPO_PACKAGER_PROXY_URL) so the manifest's
  // launchAsset/bundle URLs point at the signed host instead of 127.0.0.1 (which Expo Go can't hit).
  const signedUrl = await getSignedMetroUrl(sandbox, logger, workspace.port);
  const preview = await executeStartDevServer(
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
      hostname: resolvePreviewHostname(env),
      isMobile: true,
      name: workspace.slot,
      port: workspace.port,
      timeoutMs: 180_000,
    },
    { sandbox },
  );
  return {
    previewUrl: preview.previewUrl,
    expoUrl: signedUrl ? signedUrlToExpo(signedUrl) : null,
  };
}

// Best-effort: a Daytona-signed preview URL for the Metro port (token in the subdomain). Null when
// the sandbox stub can't sign (older stub) or the call fails — the run still proceeds without a QR.
async function getSignedMetroUrl(
  sandbox: ProjectSandboxStub,
  logger: AgentRunLogger,
  port: number,
): Promise<string | null> {
  if (!sandbox.getSignedPreviewUrl) {
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
      error: error instanceof Error ? error.message : "Unknown signed preview URL error",
    });
    return null;
  }
}

async function startAppBuilderDevServer(
  env: AgentRunAppBuilderEnv,
  sandbox: ProjectSandboxStub,
  workspace: AppBuilderWorkspace,
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
        String(workspace.port),
      ],
      cwd: workspace.dir,
      env: {
        CHOKIDAR_USEPOLLING: "true",
        WATCHPACK_POLLING: "1000",
      },
      hostname: resolvePreviewHostname(env),
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
      error: error instanceof Error ? error.message : "Unknown process cleanup error",
    });
  }
}

// Populate `dir` with the CONTENTS of a baked template (`src/.` copies dotfiles too), then verify a
// package.json landed at the root. Returns false instead of throwing so callers fall back to a
// generator only on a genuine failure. `dir` is a filesystem-safe /workspace/<slug> path (no shell
// metacharacters), so the interpolation is safe; the whole script is shell-quoted by the exec layer.
async function copyTemplateContents(
  sandbox: ProjectSandboxStub,
  templateDir: string,
  dir: string,
): Promise<boolean> {
  const copied = await executeShellTerminal(
    {
      command: `mkdir -p ${dir} && cp -a ${templateDir}/. ${dir}/ && test -f ${dir}/package.json`,
      cwd: "/workspace",
      timeoutMs: 120_000,
    },
    { sandbox },
  );
  return copied.success;
}

async function scaffoldExpoApp(
  sandbox: ProjectSandboxStub,
  logger: AgentRunLogger,
  dir: string,
): Promise<void> {
  // Copy the template CONTENTS (`src/.` → `dst/`), never `cp -a src dst`: the latter nests as
  // `dst/cheatcode-expo-template/` when `dst` already exists (the run-start `mkdir -p` of the
  // workspace dir can win the race), silently yielding a project with no package.json at its root.
  // `test -f` verifies the layout so we only fall back to a bare create-expo-app — which lacks
  // expo-router and the web deps (react-dom/react-native-web) that `expo start --web` needs — on a
  // genuine copy failure, not on the nesting race.
  if (await copyTemplateContents(sandbox, "/home/node/cheatcode-expo-template", dir)) {
    logger.info("sandbox_expo_template_copied", { targetDir: dir });
    return;
  }
  logger.warn("sandbox_expo_template_copy_failed", { targetDir: dir });

  await executeShellExec(
    {
      command: [
        "npx",
        "--yes",
        "create-expo-app@latest",
        basename(dir),
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
  dir: string,
): Promise<void> {
  // Copy template CONTENTS into the project dir (see scaffoldExpoApp): `cp -a src dst` nests as
  // `dst/cheatcode-next-template/` when `dst` already exists, leaving no package.json at the root.
  if (await copyTemplateContents(sandbox, "/home/node/cheatcode-next-template", dir)) {
    logger.info("sandbox_next_template_copied", { targetDir: dir });
    return;
  }
  logger.warn("sandbox_next_template_copy_failed", { targetDir: dir });

  await executeShellExec(
    {
      command: [
        "npx",
        "create-next-app@16.2.6",
        basename(dir),
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
  dir: string,
  mobile = false,
): Promise<void> {
  const networkTimeoutMs = mobile ? 300_000 : 120_000;
  try {
    await executeShellExec(
      { command: ["pnpm", "install", "--offline"], cwd: dir, timeoutMs: 120_000 },
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
      cwd: dir,
      timeoutMs: networkTimeoutMs,
    },
    { sandbox },
  );
}

// Expo web (react-native-web) is what makes `expo start --web` render a real page in
// the Computer panel iframe. The default template ships react-dom + react-native-web
// but NOT @expo/metro-runtime, and the Metro web bundler must be selected — so ensure
// all three deps are present (SDK-matched via `expo install`) and pin web.bundler=metro.
// Idempotent: the dep check short-circuits restores where they're already installed.
async function ensureExpoWebSupport(
  sandbox: ProjectSandboxStub,
  logger: AgentRunLogger,
  dir: string,
): Promise<void> {
  const alreadyInstalled = await executeShellTerminal(
    {
      command:
        "test -d node_modules/react-native-web && test -d node_modules/react-dom && test -d node_modules/@expo/metro-runtime",
      cwd: dir,
      timeoutMs: 10_000,
    },
    { sandbox },
  );
  if (!alreadyInstalled.success) {
    try {
      await executeShellExec(
        {
          command: [
            "pnpm",
            "exec",
            "expo",
            "install",
            "react-dom",
            "react-native-web",
            "@expo/metro-runtime",
          ],
          cwd: dir,
          env: { CI: "1", EXPO_NO_TELEMETRY: "1" },
          timeoutMs: 240_000,
        },
        { sandbox },
      );
      logger.info("sandbox_expo_web_deps_installed", {});
    } catch (error) {
      logger.warn("sandbox_expo_web_deps_failed", {
        error: error instanceof Error ? error.message : "Unknown expo web dependency error",
      });
    }
  }
  // Force the Metro web bundler + single-page output for Expo Router web. `output:"single"`
  // serves a client-rendered SPA (one index.html) instead of per-request server rendering,
  // which does `new URL(req.url)` behind the proxy and throws. Best-effort: a no-op when the
  // project uses app.config.* instead of app.json. (The client-side base path is handled by
  // serving mobile previews under a clean subdomain URL — see buildPreviewUrl — because the
  // Expo dev server ignores experiments.baseUrl / EXPO_BASE_URL.)
  await executeShellExec(
    {
      command: [
        "node",
        "-e",
        'const fs=require("fs");try{const j=JSON.parse(fs.readFileSync("app.json","utf8"));j.expo=j.expo||{};j.expo.web={...(j.expo.web||{}),bundler:"metro",output:"single"};fs.writeFileSync("app.json",JSON.stringify(j,null,2));}catch(e){}',
      ],
      cwd: dir,
      timeoutMs: 15_000,
    },
    { sandbox },
  );
  await ensureMetroForwardedHostFix(sandbox, dir);
}

// The preview proxy chain (gateway → Daytona's multi-hop edge) delivers `X-Forwarded-Host` to
// the sandbox as a COMMA-SEPARATED LIST (e.g. "gateway.trycheatcode.com, 8081-<id>.daytonaproxy01.net").
// Metro's Server._processRequest does `new URL(req.url, "http://" + xForwardedHost)`, and a
// comma-list host is an invalid URL — so every `.bundle` request 500s ("TypeError: Invalid URL")
// and the web preview renders blank. This can't be fixed upstream (the list is assembled inside
// Daytona), so we normalise the header in Metro's own config via `enhanceMiddleware`, which runs
// before `_processRequest`. Wraps any existing metro.config.js; idempotent via the marker grep.
async function ensureMetroForwardedHostFix(
  sandbox: ProjectSandboxStub,
  dir: string,
): Promise<void> {
  const script = [
    'if [ -f metro.config.js ] && grep -q "x-forwarded-host" metro.config.js; then exit 0; fi',
    "if [ -f metro.config.js ]; then mv metro.config.js metro.config.base.js; fi",
    "cat > metro.config.js <<'METROEOF'",
    METRO_FORWARDED_HOST_CONFIG,
    "METROEOF",
  ].join("\n");
  await executeShellExec(
    { command: ["bash", "-lc", script], cwd: dir, timeoutMs: 15_000 },
    { sandbox },
  );
}

const METRO_FORWARDED_HOST_CONFIG = `// Cheatcode: normalise the comma-separated X-Forwarded-Host the preview proxy chain injects so
// Metro's Server can parse the request URL. Wraps the project's base config (or Expo's default).
let config;
try {
  config = require("./metro.config.base.js");
} catch (e) {
  config = require("expo/metro-config").getDefaultConfig(__dirname);
}
const baseEnhance = config.server && config.server.enhanceMiddleware;
config.server = Object.assign({}, config.server, {
  enhanceMiddleware: (middleware, server) => {
    const inner = baseEnhance ? baseEnhance(middleware, server) : middleware;
    return (req, res, next) => {
      const xfh = req.headers["x-forwarded-host"];
      if (typeof xfh === "string" && xfh.indexOf(",") !== -1) {
        req.headers["x-forwarded-host"] = xfh.split(",")[0].trim();
      }
      return inner(req, res, next);
    };
  },
});
module.exports = config;
`;

function resolvePreviewHostname(env: AgentRunAppBuilderEnv): string {
  return PreviewHostnameSchema.parse(env.PREVIEW_HOSTNAME);
}
