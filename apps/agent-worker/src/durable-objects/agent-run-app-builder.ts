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

export { restoreBestEffortSnapshot, snapshotAppBuilderWorkspace };

const APP_BUILDER_DIR = "/workspace/app";
const APP_BUILDER_PORT = 5173;
const EXPO_METRO_PORT = 8081;
const DEFAULT_PREVIEW_HOSTNAME = "trycheatcode.com";
const PreviewHostnameSchema = z.string().trim().min(1).max(255).default(DEFAULT_PREVIEW_HOSTNAME);

type AppendChunk = (chunk: UIMessageChunk) => Promise<void>;

interface GitHubRepoRef {
  host: string;
  owner: string;
  path: string;
  repo: string;
}

function isMobileBuild(input: AgentRunAppBuilderInput): boolean {
  return input.projectMode === "app-builder-mobile";
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

export async function runAppBuilder(
  options: RunAppBuilderOptions,
): Promise<{ agentContextNote?: string }> {
  const { input, logger, sandbox } = options;
  await stopBestEffortProcesses(sandbox, logger);
  // Marker/.git gate runs FIRST: an imported repo (any framework shape) must
  // never fall back into the destructive reset + re-clone scaffold path on a
  // follow-up run. See D7 — the marker, not the template-shape check, is the
  // one-shot guarantee.
  if (await hasImportedAppWorkspace(sandbox)) {
    return restoreImportedWorkspace(options);
  }
  const mobile = isMobileBuild(input);
  const shouldBootstrap = !(await hasExistingAppBuilderWorkspace(sandbox, mobile));
  if (shouldBootstrap && input.importRepoUrl) {
    return importRepoWorkspace({ ...options, repoUrl: input.importRepoUrl });
  }
  return runTemplateAppBuilder({ ...options, mobile, shouldBootstrap });
}

async function runTemplateAppBuilder(
  options: RunAppBuilderOptions & { mobile: boolean; shouldBootstrap: boolean },
): Promise<{ agentContextNote: string }> {
  const { env, input, logger, mobile, sandbox } = options;
  await prepareTemplateWorkspace(options);
  await clearBuildCache(sandbox, mobile);
  await snapshotAppBuilderWorkspace({ env, input, logger, sandbox });
  const preview = await startTemplatePreview(options);
  return { agentContextNote: templateContextNote(mobile, preview) };
}

function templateContextNote(
  mobile: boolean,
  preview: { previewUrl: string; expoUrl: string | null },
): string {
  const stack = mobile ? "Expo Router" : "Next.js";
  const web = mobile
    ? " The preview is the app rendered on web (react-native-web) inside a phone frame, so verify it there in the browser."
    : "";
  const expo = preview.expoUrl
    ? ` The user can also scan the Expo Go QR code shown beside the preview (${preview.expoUrl}) to run it on a real device.`
    : "";
  return `[context] A ${stack} workspace is scaffolded in ${APP_BUILDER_DIR} and its live preview is already running at ${preview.previewUrl}. Build the user's app by editing files under ${APP_BUILDER_DIR}; the preview hot-reloads on save.${web}${expo}`;
}

async function prepareTemplateWorkspace(
  options: RunAppBuilderOptions & { mobile: boolean; shouldBootstrap: boolean },
): Promise<void> {
  const { input, logger, mobile, sandbox, setRunStage, shouldBootstrap } = options;
  setRunStage(mobile ? "Preparing the Expo workspace." : "Preparing the Next.js workspace.");
  if (!shouldBootstrap) {
    setRunStage("Restoring the app workspace.");
    await installAppBuilderDependencies(sandbox, logger, mobile);
    if (mobile) {
      await ensureExpoWebSupport(sandbox, logger);
    }
    return;
  }
  await resetAppBuilderDirectory(sandbox);
  if (mobile) {
    await scaffoldExpoApp(sandbox, logger);
  } else {
    await scaffoldAppBuilder(sandbox, logger);
  }
  await installAppBuilderDependencies(sandbox, logger, mobile);
  if (mobile) {
    await ensureExpoWebSupport(sandbox, logger);
  } else {
    setRunStage("Seeding the starter files.");
    await writeAppBuilderFiles(input, sandbox);
  }
}

async function startTemplatePreview(
  options: RunAppBuilderOptions & { mobile: boolean },
): Promise<{ previewUrl: string; expoUrl: string | null }> {
  const { append, env, mobile, sandbox, setRunStage } = options;
  setRunStage("Starting the dev server.");
  const preview = mobile
    ? await startExpoDevServer(env, sandbox)
    : await startAppBuilderDevServer(env, sandbox);
  const previewUrl = preview.previewUrl;
  const expoUrl = mobile ? expoUrlFromPreview(preview.previewUrl) : null;
  await append({
    type: "data-sandbox-status",
    data: { v: 1, status: "ready", previewUrl, ...(expoUrl ? { expoUrl } : {}) },
  });
  return { previewUrl, expoUrl };
}

// First import run only: clone the public GitHub repo over the empty workspace,
// drop the one-shot marker, best-effort install, and hand control to the agent
// without auto-starting a dev server (framework/port are unknowable). Failure
// throws repo_import_failed, which rides the existing run() failure path.
async function importRepoWorkspace(
  options: RunAppBuilderOptions & { repoUrl: string },
): Promise<{ agentContextNote: string }> {
  const { append, env, input, logger, repoUrl, sandbox, setRunStage } = options;
  const startedAt = Date.now();
  const repoRef = parseGitHubRepo(repoUrl);
  if (!repoRef) {
    logger.error("repo_import_failed", { exitCode: null, repoHost: null, repoPath: null });
    emitImportEvent(env, input, "repo_import_failed");
    throw repoImportError("The import URL must be a public https github.com repository.");
  }
  logger.info("repo_import_started", { repoHost: repoRef.host, repoPath: repoRef.path });
  setRunStage(`Cloning ${repoRef.path}.`);
  await resetAppBuilderDirectory(sandbox);
  await cloneRepoOrThrow({ env, input, logger, repoRef, repoUrl, sandbox });
  await markImportedWorkspace(sandbox);
  const installRan = await installImportedDependencies(sandbox, logger);
  await clearBuildCache(sandbox, isMobileBuild(input));
  await snapshotAppBuilderWorkspace({ env, input, logger, sandbox });
  await emitImportReady(append);
  logger.info("repo_import_succeeded", {
    durationMs: Date.now() - startedAt,
    installRan,
    repoHost: repoRef.host,
    repoPath: repoRef.path,
  });
  emitImportEvent(env, input, "repo_import_succeeded");
  return { agentContextNote: importedContextNote(repoUrl) };
}

// Every follow-up run of an imported project: re-install best-effort and snapshot,
// but NEVER reset, re-clone, or auto-start the template dev server (prior agent
// edits must survive).
async function restoreImportedWorkspace(
  options: RunAppBuilderOptions,
): Promise<{ agentContextNote: string }> {
  const { append, env, input, logger, sandbox, setRunStage } = options;
  setRunStage("Restoring the imported workspace.");
  await installImportedDependencies(sandbox, logger);
  await clearBuildCache(sandbox, isMobileBuild(input));
  await snapshotAppBuilderWorkspace({ env, input, logger, sandbox });
  await append({ type: "data-sandbox-status", data: { v: 1, status: "ready" } });
  return { agentContextNote: importedContextNote(input.importRepoUrl) };
}

async function hasImportedAppWorkspace(sandbox: ProjectSandboxStub): Promise<boolean> {
  const result = await executeShellTerminal(
    {
      command: `test -f ${APP_BUILDER_DIR}/.cheatcode-imported || test -d ${APP_BUILDER_DIR}/.git`,
      cwd: "/workspace",
      timeoutMs: 10_000,
    },
    { sandbox },
  );
  return result.success;
}

async function cloneRepoOrThrow(options: {
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
        command: [
          "git",
          "clone",
          "--depth",
          "1",
          "--single-branch",
          options.repoUrl,
          APP_BUILDER_DIR,
        ],
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

async function markImportedWorkspace(sandbox: ProjectSandboxStub): Promise<void> {
  await executeShellExec(
    {
      command: ["touch", `${APP_BUILDER_DIR}/.cheatcode-imported`],
      cwd: "/workspace",
      timeoutMs: 10_000,
    },
    { sandbox },
  );
}

async function installImportedDependencies(
  sandbox: ProjectSandboxStub,
  logger: AgentRunLogger,
): Promise<boolean> {
  if (!(await pathExists(sandbox, `${APP_BUILDER_DIR}/package.json`))) {
    return false;
  }
  const usesNpm = await pathExists(sandbox, `${APP_BUILDER_DIR}/package-lock.json`);
  const command = usesNpm
    ? ["npm", "install", "--no-audit", "--no-fund"]
    : ["pnpm", "install", "--prefer-offline", "--network-concurrency", "4"];
  try {
    await executeShellExec({ command, cwd: APP_BUILDER_DIR, timeoutMs: 300_000 }, { sandbox });
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

function importedContextNote(repoUrl?: string): string {
  const origin = repoUrl ? ` from ${repoUrl}` : "";
  return `[context] This project was imported${origin} into ${APP_BUILDER_DIR}. Inspect it, complete any setup, and start the dev server on port 5173 with start_dev_server (Expo on 8081 for mobile).`;
}

function repoImportError(message: string): APIError {
  return new APIError(502, "repo_import_failed", message, {
    hint: "Check the URL is a public GitHub repo, then retry.",
    retriable: true,
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
      // `--web` makes the single Metro dev server also serve the react-native-web
      // build as a real web page at `/` (iframe-renderable in the Computer panel),
      // while the SAME server keeps answering exp:// manifests for Expo Go — so we
      // get both the in-panel preview and the QR from one process on port 8081.
      command: [
        "pnpm",
        "exec",
        "expo",
        "start",
        "--web",
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

// Expo web (react-native-web) is what makes `expo start --web` render a real page in
// the Computer panel iframe. The default template ships react-dom + react-native-web
// but NOT @expo/metro-runtime, and the Metro web bundler must be selected — so ensure
// all three deps are present (SDK-matched via `expo install`) and pin web.bundler=metro.
// Idempotent: the dep check short-circuits restores where they're already installed.
async function ensureExpoWebSupport(
  sandbox: ProjectSandboxStub,
  logger: AgentRunLogger,
): Promise<void> {
  const alreadyInstalled = await executeShellTerminal(
    {
      command:
        "test -d node_modules/react-native-web && test -d node_modules/react-dom && test -d node_modules/@expo/metro-runtime",
      cwd: APP_BUILDER_DIR,
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
          cwd: APP_BUILDER_DIR,
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
      cwd: APP_BUILDER_DIR,
      timeoutMs: 15_000,
    },
    { sandbox },
  );
  await ensureMetroForwardedHostFix(sandbox);
}

// The preview proxy chain (gateway → Daytona's multi-hop edge) delivers `X-Forwarded-Host` to
// the sandbox as a COMMA-SEPARATED LIST (e.g. "gateway.trycheatcode.com, 8081-<id>.daytonaproxy01.net").
// Metro's Server._processRequest does `new URL(req.url, "http://" + xForwardedHost)`, and a
// comma-list host is an invalid URL — so every `.bundle` request 500s ("TypeError: Invalid URL")
// and the web preview renders blank. This can't be fixed upstream (the list is assembled inside
// Daytona), so we normalise the header in Metro's own config via `enhanceMiddleware`, which runs
// before `_processRequest`. Wraps any existing metro.config.js; idempotent via the marker grep.
async function ensureMetroForwardedHostFix(sandbox: ProjectSandboxStub): Promise<void> {
  const script = [
    'if [ -f metro.config.js ] && grep -q "x-forwarded-host" metro.config.js; then exit 0; fi',
    "if [ -f metro.config.js ]; then mv metro.config.js metro.config.base.js; fi",
    "cat > metro.config.js <<'METROEOF'",
    METRO_FORWARDED_HOST_CONFIG,
    "METROEOF",
  ].join("\n");
  await executeShellExec(
    { command: ["bash", "-lc", script], cwd: APP_BUILDER_DIR, timeoutMs: 15_000 },
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
