const APP_RUNTIME_ROOT = "/home/node/.cheatcode/app-runtimes";
const PROJECT_LOCAL_ROOT = "/home/node/.cheatcode/projects";
const BASE_NODE_PATH = [
  "/opt/cheatcode-doc-runtime/node_modules",
  "/opt/cheatcode-skill-runtime/node_modules",
];
const WORKSPACE_PROJECT_PATH = /^\/workspace\/([a-z0-9]+(?:-[a-z0-9]+)*)(?<suffix>\/.*)?$/u;
const PNPM_EXECUTABLES = new Set(["pnpm", "pnpx"]);
const UNSUPPORTED_PACKAGE_MANAGERS = new Set(["bun", "bunx", "npm", "npx", "yarn", "yarnpkg"]);
const SHELL_EXECUTABLES = new Set(["bash", "sh", "zsh"]);
const SHELL_PACKAGE_MANAGER_COMMAND =
  /(?:^|&&|\|\||;|\n|\()\s*(?:(?:[A-Za-z_][A-Za-z0-9_]*=[^\s;&|()]+)\s+)*(?:command\s+)?(?:sudo\s+)?(?:[^\s;&|()]+\/)?(bun|bunx|npm|npx|pnpm|pnpx|yarn|yarnpkg)(?=\s|$)/u;

export const NEXT_RUNTIME_BIN = `${APP_RUNTIME_ROOT}/next/node_modules/.bin/next`;
export const EXPO_RUNTIME_BIN = `${APP_RUNTIME_ROOT}/expo/node_modules/.bin/expo`;
export const NEXT_TEMPLATE_DIR = "/home/node/cheatcode-next-template";
export const EXPO_TEMPLATE_DIR = "/home/node/cheatcode-expo-template";

export function projectLocalModulesDir(workspaceSlug: string): string {
  return `${projectLocalSourceDir(workspaceSlug)}/node_modules`;
}

function projectLocalSourceDir(workspaceSlug: string): string {
  return `${projectLocalRuntimeDir(workspaceSlug)}/source`;
}

export function projectLocalCacheDir(workspaceSlug: string): string {
  return `${projectLocalRuntimeDir(workspaceSlug)}/cache`;
}

export function projectLocalRuntimeDir(workspaceSlug: string): string {
  return `${PROJECT_LOCAL_ROOT}/${workspaceSlug}`;
}

export interface ProjectLocalRuntime {
  localCwd: string;
  localSourceDir: string;
  runtimeDir: string;
  workspaceDir: string;
  workspaceSlug: string;
}

/** Maps a durable project cwd to the same path inside its disposable native-disk mirror. */
export function resolveProjectLocalRuntime(cwd: string): ProjectLocalRuntime | null {
  const match = WORKSPACE_PROJECT_PATH.exec(cwd);
  const workspaceSlug = match?.[1];
  if (!workspaceSlug) return null;
  const suffix = match.groups?.["suffix"] ?? "";
  const runtimeDir = projectLocalRuntimeDir(workspaceSlug);
  const localSourceDir = projectLocalSourceDir(workspaceSlug);
  return {
    localCwd: `${localSourceDir}${suffix}`,
    localSourceDir,
    runtimeDir,
    workspaceDir: `/workspace/${workspaceSlug}`,
    workspaceSlug,
  };
}

/** Returns the native-disk target only for a direct pnpm argv invocation. */
export function projectPnpmRuntime(
  cwd: string,
  command: readonly string[],
): ProjectLocalRuntime | null {
  if (!PNPM_EXECUTABLES.has(basename(command[0]))) return null;
  return resolveProjectLocalRuntime(cwd);
}

/** Rewrites explicit durable project paths before pnpm receives its native-disk cwd. */
export function localizeProjectPackageCommand(
  runtime: ProjectLocalRuntime,
  command: readonly string[],
): string[] {
  return command.map((argument) =>
    argument.replaceAll(runtime.workspaceDir, runtime.localSourceDir),
  );
}

/** Prevents package-manager forms that cannot use the transactional native-disk runtime. */
export function unsupportedProjectPackageManager(
  cwd: string,
  command: readonly string[],
): string | null {
  if (!WORKSPACE_PROJECT_PATH.test(cwd)) return null;
  const executable = basename(command[0]);
  if (UNSUPPORTED_PACKAGE_MANAGERS.has(executable)) return executable;
  const wrappedManager = wrappedPackageManager(executable, command.slice(1));
  if (wrappedManager) return wrappedManager;
  if (!SHELL_EXECUTABLES.has(executable)) return null;
  const commandFlag = command.findIndex((argument) => /^-[a-z]*c[a-z]*$/u.test(argument));
  const shellCommand = commandFlag < 0 ? undefined : command[commandFlag + 1];
  return shellCommand?.match(SHELL_PACKAGE_MANAGER_COMMAND)?.[1] ?? null;
}

function wrappedPackageManager(executable: string, args: readonly string[]): string | null {
  if (executable === "corepack") {
    return packageManagerName(args.find((argument) => !argument.startsWith("-")));
  }
  if (executable !== "env" && executable !== "sudo") return null;
  const candidate = args.find(
    (argument) =>
      argument !== "--" && !argument.startsWith("-") && !/^[A-Za-z_][A-Za-z0-9_]*=/u.test(argument),
  );
  return packageManagerName(candidate);
}

function packageManagerName(value: string | undefined): string | null {
  const executable = basename(value);
  return PNPM_EXECUTABLES.has(executable) || UNSUPPORTED_PACKAGE_MANAGERS.has(executable)
    ? executable
    : null;
}

/** Keeps generated dependencies and caches off persistent object-store FUSE. */
export function projectPackageEnvironment(
  cwd: string,
  requested: Record<string, string> | undefined,
): Record<string, string> | undefined {
  const workspaceSlug = WORKSPACE_PROJECT_PATH.exec(cwd)?.[1];
  if (!workspaceSlug) return requested;
  const modulesDir = projectLocalModulesDir(workspaceSlug);
  const requestedNodePath = requested?.["NODE_PATH"];
  const requestedNextDistDir = requested?.["CHEATCODE_NEXT_DIST_DIR"];
  const preferredRuntime = requested?.["CHEATCODE_APP_RUNTIME"] === "expo" ? "expo" : "next";
  const fallbackRuntime = preferredRuntime === "expo" ? "next" : "expo";
  return {
    ...requested,
    CHEATCODE_NEXT_DIST_DIR: requestedNextDistDir ?? `${projectLocalCacheDir(workspaceSlug)}/next`,
    NODE_PATH: [
      modulesDir,
      `${APP_RUNTIME_ROOT}/${preferredRuntime}/node_modules`,
      `${APP_RUNTIME_ROOT}/${fallbackRuntime}/node_modules`,
      ...BASE_NODE_PATH,
      requestedNodePath,
    ]
      .filter(Boolean)
      .join(":"),
  };
}

function basename(path: string | undefined): string {
  if (!path) return "";
  return path.slice(path.lastIndexOf("/") + 1);
}
