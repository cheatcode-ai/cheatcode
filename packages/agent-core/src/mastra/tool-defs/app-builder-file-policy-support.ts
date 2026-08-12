import { APIError } from "@cheatcode/observability";
import { CONTEXT } from "../context";
import { requestContextFromToolContext } from "./tool-runtime-context";

const FRAMEWORK_MANIFESTS = new Set([
  "app.json",
  "babel.config.js",
  "babel.config.mjs",
  "metro.config.js",
  "metro.config.mjs",
  "next.config.js",
  "next.config.mjs",
  "next.config.ts",
  "package-lock.json",
  "package.json",
  "pnpm-lock.yaml",
  "postcss.config.js",
  "postcss.config.mjs",
  "tsconfig.json",
  "yarn.lock",
]);
const INCOMPATIBLE_TEMPLATE_ENTRYPOINT =
  /(?:^|\/)(?:index\.html|src\/main\.[cm]?[jt]sx?|vite\.config\.[cm]?[jt]s)$/u;

/** Keeps the managed Next.js or Expo runtime immutable while source files remain fully editable. */
export function assertManagedAppFrameworkFileMutable(context: unknown, path: string): void {
  const requestContext = requestContextFromToolContext(context);
  if (requestContext.get(CONTEXT.appBuilderManagedPreview) !== true) return;
  if (!isManagedFrameworkPath(requestContext.get(CONTEXT.promptWorkspaceDir), path)) return;
  throw new APIError(
    422,
    "tool_validation_failed",
    "The managed app framework cannot be replaced or bypassed.",
    {
      hint: "Edit the existing Next.js or Expo app/ source files. Use pnpm add or pnpm remove when dependencies need to change.",
      retriable: false,
    },
  );
}

function isManagedFrameworkPath(workspaceDir: unknown, path: string): boolean {
  const normalized = path.replace(/\/+$/u, "");
  const workspace = typeof workspaceDir === "string" ? workspaceDir.replace(/\/+$/u, "") : null;
  const filename = normalized.slice(normalized.lastIndexOf("/") + 1);
  if (FRAMEWORK_MANIFESTS.has(filename)) return true;
  const relativePath =
    workspace && normalized.startsWith(`${workspace}/`)
      ? normalized.slice(workspace.length + 1)
      : normalized.startsWith("/workspace/")
        ? normalized.slice("/workspace/".length)
        : normalized;
  return INCOMPATIBLE_TEMPLATE_ENTRYPOINT.test(relativePath);
}
