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

/** Keeps the managed Next.js or Expo runtime immutable while source files remain fully editable. */
export function assertManagedAppFrameworkFileMutable(context: unknown, path: string): void {
  const requestContext = requestContextFromToolContext(context);
  if (requestContext.get(CONTEXT.appBuilderManagedPreview) !== true) return;
  if (!isProjectRootFrameworkManifest(requestContext.get(CONTEXT.promptWorkspaceDir), path)) return;
  throw new APIError(
    422,
    "tool_validation_failed",
    "The managed app framework manifest cannot be replaced or deleted.",
    {
      hint: "Edit application source files. Use pnpm add or pnpm remove when dependencies need to change.",
      retriable: false,
    },
  );
}

function isProjectRootFrameworkManifest(workspaceDir: unknown, path: string): boolean {
  const normalized = path.replace(/\/+$/u, "");
  const filename = normalized.slice(normalized.lastIndexOf("/") + 1);
  if (!FRAMEWORK_MANIFESTS.has(filename)) return false;
  const parent = normalized.slice(0, normalized.lastIndexOf("/")) || "/";
  return parent === "/workspace" || (typeof workspaceDir === "string" && parent === workspaceDir);
}
