const APP_RUNTIME_ROOT = "/home/node/.cheatcode/app-runtimes";
const PROJECT_LOCAL_ROOT = "/home/node/.cheatcode/projects";
const BASE_NODE_PATH = [
  "/opt/cheatcode-doc-runtime/node_modules",
  "/opt/cheatcode-skill-runtime/node_modules",
];
const WORKSPACE_PROJECT_PATH = /^\/workspace\/([a-z0-9]+(?:-[a-z0-9]+)*)(?:\/|$)/u;
const UNSUPPORTED_PACKAGE_MANAGERS = new Set(["npm", "npx", "yarn", "yarnpkg"]);
const SHELL_EXECUTABLES = new Set(["bash", "sh", "zsh"]);
const SHELL_PACKAGE_MANAGER_COMMAND =
  /(?:^|&&|\|\||;|\n|\()\s*(?:(?:[A-Za-z_][A-Za-z0-9_]*=[^\s;&|()]+)\s+)*(?:command\s+)?(?:sudo\s+)?(?:[^\s;&|()]+\/)?(npm|npx|yarn|yarnpkg)(?=\s|$)/u;

export const NEXT_RUNTIME_BIN = `${APP_RUNTIME_ROOT}/next/node_modules/.bin/next`;
export const EXPO_RUNTIME_BIN = `${APP_RUNTIME_ROOT}/expo/node_modules/.bin/expo`;
export const NEXT_TEMPLATE_DIR = "/home/node/cheatcode-next-template";
export const EXPO_TEMPLATE_DIR = "/home/node/cheatcode-expo-template";

export function projectLocalModulesDir(workspaceSlug: string): string {
  return `${projectLocalRuntimeDir(workspaceSlug)}/node_modules`;
}

export function projectLocalSourceDir(workspaceSlug: string): string {
  return `${projectLocalRuntimeDir(workspaceSlug)}/source`;
}

export function projectLocalCacheDir(workspaceSlug: string): string {
  return `${projectLocalRuntimeDir(workspaceSlug)}/cache`;
}

export function projectLocalRuntimeDir(workspaceSlug: string): string {
  return `${PROJECT_LOCAL_ROOT}/${workspaceSlug}`;
}

/** Prevents package managers that place dependency trees on persistent FUSE. */
export function unsupportedProjectPackageManager(
  cwd: string,
  command: readonly string[],
): string | null {
  if (!WORKSPACE_PROJECT_PATH.test(cwd)) return null;
  const executable = basename(command[0]);
  if (UNSUPPORTED_PACKAGE_MANAGERS.has(executable)) return executable;
  if (!SHELL_EXECUTABLES.has(executable)) return null;
  const commandFlag = command.findIndex((argument) => /^-[a-z]*c[a-z]*$/u.test(argument));
  const shellCommand = commandFlag < 0 ? undefined : command[commandFlag + 1];
  return shellCommand?.match(SHELL_PACKAGE_MANAGER_COMMAND)?.[1] ?? null;
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
  const preferredRuntime = requested?.["CHEATCODE_APP_RUNTIME"] === "expo" ? "expo" : "next";
  const fallbackRuntime = preferredRuntime === "expo" ? "next" : "expo";
  return {
    ...requested,
    CHEATCODE_NEXT_DIST_DIR: `${projectLocalCacheDir(workspaceSlug)}/next`,
    NODE_PATH: [
      modulesDir,
      `${APP_RUNTIME_ROOT}/${preferredRuntime}/node_modules`,
      `${APP_RUNTIME_ROOT}/${fallbackRuntime}/node_modules`,
      ...BASE_NODE_PATH,
      requestedNodePath,
    ]
      .filter(Boolean)
      .join(":"),
    npm_config_modules_dir: modulesDir,
  };
}

function basename(path: string | undefined): string {
  if (!path) return "";
  return path.slice(path.lastIndexOf("/") + 1);
}
