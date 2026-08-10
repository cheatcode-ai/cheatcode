import {
  executeShellExec,
  executeShellTerminal,
  executeWriteFile,
} from "@cheatcode/agent-core/tools/code";
import { APIError, type createLogger } from "@cheatcode/observability";
import type { CodeRuntimeContext } from "@cheatcode/sandbox-contracts";
import {
  appBuilderGlobalStylesSource,
  appBuilderLayoutSource,
  appBuilderPageSource,
  appBuilderTypeScriptConfigSource,
} from "./app-builder-template";
import { metroForwardedHostFixScript } from "./expo-metro-forwarded-host";
import {
  EXPO_RUNTIME_BIN,
  EXPO_RUNTIME_CONFIG_BIN,
  EXPO_RUNTIME_DIR,
  EXPO_TEMPLATE_DIR,
  NEXT_RUNTIME_BIN,
  NEXT_TEMPLATE_DIR,
  projectLocalModulesDir,
} from "./project-sandbox-package-runtime";

type ProjectSandboxStub = CodeRuntimeContext["sandbox"];
type AgentRunLogger = ReturnType<typeof createLogger>;

interface AppBuilderSeedInput {
  messageText: string;
  workspaceSlug: string;
}

export function writeAppBuilderFiles(
  input: AppBuilderSeedInput,
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
    executeWriteFile(
      {
        path: `${dir}/tsconfig.json`,
        content: appBuilderTypeScriptConfigSource(input.workspaceSlug),
      },
      { sandbox },
    ),
  ]).then(() => undefined);
}

export async function scaffoldExpoApp(
  sandbox: ProjectSandboxStub,
  logger: AgentRunLogger,
  dir: string,
): Promise<void> {
  // Copy the template CONTENTS (`src/.` → `dst/`), never `cp -R src dst`: the latter nests as
  // `dst/cheatcode-expo-template/` when `dst` already exists (the run-start `mkdir -p` of the
  // workspace dir can win the race), silently yielding a project with no package.json at its root.
  // `test -f` verifies the baked, lockfile-backed layout. A missing template means the immutable
  // snapshot is corrupt and must fail explicitly instead of fetching a mutable generator output.
  if (await copyTemplateContents(sandbox, EXPO_TEMPLATE_DIR, dir)) {
    logger.info("sandbox_expo_template_copied", { targetDir: dir });
    return;
  }
  logger.warn("sandbox_expo_template_copy_failed", { targetDir: dir });
  throw missingBakedTemplateError("Expo");
}

export async function scaffoldAppBuilder(
  sandbox: ProjectSandboxStub,
  logger: AgentRunLogger,
  dir: string,
): Promise<void> {
  // Copy template CONTENTS into the project dir (see scaffoldExpoApp): `cp -R src dst` nests as
  // `dst/cheatcode-next-template/` when `dst` already exists, leaving no package.json at the root.
  if (await copyTemplateContents(sandbox, NEXT_TEMPLATE_DIR, dir)) {
    logger.info("sandbox_next_template_copied", { targetDir: dir });
    return;
  }
  logger.warn("sandbox_next_template_copy_failed", { targetDir: dir });
  throw missingBakedTemplateError("Next.js");
}

export async function installAppBuilderDependencies(
  sandbox: ProjectSandboxStub,
  logger: AgentRunLogger,
  dir: string,
  mobile = false,
): Promise<void> {
  const installTimeoutMs = mobile ? 300_000 : 120_000;
  try {
    await executeShellExec(
      {
        command: ["pnpm", "install", "--frozen-lockfile", "--offline"],
        cwd: dir,
        timeoutMs: installTimeoutMs,
      },
      { sandbox },
    );
    return;
  } catch (error) {
    logger.warn("sandbox_offline_install_failed", {
      error,
    });
  }
  await executeShellExec(
    {
      command: [
        "pnpm",
        "install",
        "--frozen-lockfile",
        "--prefer-offline",
        "--network-concurrency",
        "4",
      ],
      cwd: dir,
      timeoutMs: installTimeoutMs,
    },
    { sandbox },
  );
}

export async function ensureAppBuilderRuntime(
  sandbox: ProjectSandboxStub,
  mobile: boolean,
): Promise<void> {
  const runtimeBin = mobile ? EXPO_RUNTIME_BIN : NEXT_RUNTIME_BIN;
  const checked = await executeShellTerminal(
    {
      command: `test -x ${runtimeBin}`,
      cwd: "/workspace",
      timeoutMs: 10_000,
    },
    { sandbox },
  );
  if (checked.success) return;
  throw missingBakedRuntimeError(mobile ? "Expo" : "Next.js");
}

// Expo web (react-native-web) is what makes `expo start --web` render a real page in
// the Computer panel iframe. The default template ships react-dom + react-native-web
// but NOT @expo/metro-runtime, and the Metro web bundler must be selected — so ensure
// all three deps are present (SDK-matched via `expo install`) and pin web.bundler=metro.
// Idempotent: the dep check short-circuits restores where they're already installed.
export async function ensureExpoWebSupport(
  sandbox: ProjectSandboxStub,
  dir: string,
  workspaceSlug: string,
): Promise<void> {
  try {
    await executeShellExec(
      {
        command: [
          "node",
          "-e",
          'for(const name of ["react-native-web","react-dom","@expo/metro-runtime"])require.resolve(name)',
        ],
        cwd: dir,
        env: { CHEATCODE_APP_RUNTIME: "expo" },
        timeoutMs: 10_000,
      },
      { sandbox },
    );
  } catch {
    throw missingBakedRuntimeError("Expo");
  }
  await executeShellExec(
    {
      command: [
        EXPO_RUNTIME_CONFIG_BIN,
        projectLocalModulesDir(workspaceSlug),
        `${EXPO_RUNTIME_DIR}/node_modules`,
      ],
      cwd: dir,
      timeoutMs: 15_000,
    },
    { sandbox },
  );
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

// Populate `dir` with the CONTENTS of a baked template (`src/.` copies dotfiles too), then verify a
// package.json landed at the root. `/workspace` is Daytona's object-store FUSE mount: recursive copy
// is intentional because archive mode tries to preserve ownership, modes, and timestamps that the
// mount does not support, making a tiny source-only scaffold hang until its timeout. Immutable
// dependencies remain on the snapshot-local filesystem. `dir` is a filesystem-safe
// /workspace/<slug> path (no shell metacharacters), so interpolation is safe; the whole script is
// shell-quoted by the exec layer.
async function copyTemplateContents(
  sandbox: ProjectSandboxStub,
  templateDir: string,
  dir: string,
): Promise<boolean> {
  const copied = await executeShellTerminal(
    {
      command: `mkdir -p ${dir} && cp -R -- ${templateDir}/. ${dir}/ && test -f ${dir}/package.json`,
      cwd: "/workspace",
      timeoutMs: 60_000,
    },
    { sandbox },
  );
  return copied.success;
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
  await executeShellExec(
    {
      command: ["bash", "-lc", metroForwardedHostFixScript()],
      cwd: dir,
      timeoutMs: 15_000,
    },
    { sandbox },
  );
}

function missingBakedTemplateError(template: "Expo" | "Next.js"): APIError {
  return new APIError(
    503,
    "service_maintenance_unavailable",
    `${template} sandbox template is unavailable`,
    {
      hint: "Rebuild and publish the pinned Daytona snapshot before accepting app-builder runs.",
      retriable: false,
    },
  );
}

function missingBakedRuntimeError(runtime: "Expo" | "Next.js"): APIError {
  return new APIError(
    503,
    "service_maintenance_unavailable",
    `${runtime} sandbox runtime is unavailable`,
    {
      hint: "Rebuild and publish the pinned Daytona snapshot before accepting app-builder runs.",
      retriable: false,
    },
  );
}
