import { APIError } from "@cheatcode/observability";
import { z } from "zod";

export const WorkspacePathSchema = z
  .string()
  .min(1)
  .max(1_000)
  .refine((path) => !path.includes("\0"), "Sandbox paths cannot contain null bytes.")
  .refine((path) => path.startsWith("/"), "Sandbox paths must be absolute.")
  .refine(isSafeWorkspacePath, "Path must stay inside /workspace.");

export const WorkspaceFilePathSchema = WorkspacePathSchema.refine(
  isWorkspaceChildPath,
  "File path must be inside /workspace.",
);

export const WorkspaceRelativePathSchema = z
  .string()
  .min(1)
  .max(500)
  .refine(isSafeWorkspaceRelativePath, "Relative paths must stay inside /workspace.");

function isSafeWorkspacePath(path: string): boolean {
  if (path.includes("\0")) {
    return false;
  }
  const normalized = normalizeWorkspacePath(path);
  return normalized === "/workspace" || normalized.startsWith("/workspace/");
}

function isWorkspaceChildPath(path: string): boolean {
  const normalized = normalizeWorkspacePath(path);
  return normalized.startsWith("/workspace/") && normalized !== "/workspace/";
}

/**
 * Confines a code-tool cwd or path to the run's project folder. A bare `/workspace`
 * maps to the active project root; explicit paths must be that root or a descendant.
 */
export function resolveProjectWorkspacePath(
  value: string | undefined,
  workspaceDir: string | undefined,
): string {
  const projectRoot = canonicalWorkspacePath(workspaceDir ?? "/workspace");
  if (!isSafeWorkspacePath(projectRoot)) {
    throw new APIError(500, "internal_error", "Project workspace is invalid", {
      retriable: false,
    });
  }
  const requested = canonicalWorkspacePath(value ?? projectRoot);
  const resolved = requested === "/workspace" ? projectRoot : requested;
  if (resolved !== projectRoot && !resolved.startsWith(`${projectRoot}/`)) {
    throw new APIError(
      400,
      "tool_validation_failed",
      "Path is outside the active project workspace",
      {
        hint: `Use ${projectRoot} or one of its descendants.`,
        retriable: false,
      },
    );
  }
  return resolved;
}

function isSafeWorkspaceRelativePath(path: string): boolean {
  if (path.startsWith("/") || path.includes("\0")) {
    return false;
  }
  const normalized = normalizeRelativePath(path);
  return normalized.length > 0 && normalized !== "." && !normalized.startsWith("../");
}

function normalizeWorkspacePath(path: string): string {
  const parts: string[] = [];
  for (const part of path.split("/")) {
    if (part.length === 0 || part === ".") {
      continue;
    }
    if (part === "..") {
      parts.pop();
      continue;
    }
    parts.push(part);
  }
  return `/${parts.join("/")}${path.endsWith("/") ? "/" : ""}`;
}

function canonicalWorkspacePath(path: string): string {
  const normalized = normalizeWorkspacePath(path);
  return normalized === "/" ? normalized : normalized.replace(/\/+$/u, "");
}

function normalizeRelativePath(path: string): string {
  const parts: string[] = [];
  for (const part of path.split("/")) {
    if (part.length === 0 || part === ".") {
      continue;
    }
    if (part === "..") {
      if (parts.length === 0) {
        return "../";
      }
      parts.pop();
      continue;
    }
    parts.push(part);
  }
  return parts.join("/");
}
