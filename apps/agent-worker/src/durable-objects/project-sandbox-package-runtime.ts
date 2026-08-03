const APP_RUNTIME_ROOT = "/home/node/.cheatcode/app-runtimes";
const PROJECT_LOCAL_ROOT = "/home/node/.cheatcode/projects";
const BASE_NODE_PATH = [
  "/opt/cheatcode-doc-runtime/node_modules",
  "/opt/cheatcode-skill-runtime/node_modules",
];
const WORKSPACE_PROJECT_PATH = /^\/workspace\/([a-z0-9]+(?:-[a-z0-9]+)*)(?:\/|$)/u;

export const NEXT_RUNTIME_BIN = `${APP_RUNTIME_ROOT}/next/node_modules/.bin/next`;
export const EXPO_RUNTIME_BIN = `${APP_RUNTIME_ROOT}/expo/node_modules/.bin/expo`;
export const NEXT_TEMPLATE_DIR = "/home/node/cheatcode-next-template";
export const EXPO_TEMPLATE_DIR = "/home/node/cheatcode-expo-template";

export function projectLocalModulesDir(workspaceSlug: string): string {
  return `${projectLocalRuntimeDir(workspaceSlug)}/node_modules`;
}

export function projectLocalCacheDir(workspaceSlug: string): string {
  return `${projectLocalRuntimeDir(workspaceSlug)}/cache`;
}

export function projectLocalRuntimeDir(workspaceSlug: string): string {
  return `${PROJECT_LOCAL_ROOT}/${workspaceSlug}`;
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
    CHEATCODE_NEXT_DIST_DIR: `../../home/node/.cheatcode/projects/${workspaceSlug}/cache/next`,
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
