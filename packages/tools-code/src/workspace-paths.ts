import { z } from "zod";

export const WorkspacePathSchema = z
  .string()
  .min(1)
  .max(1_000)
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

export function isSafeWorkspacePath(path: string): boolean {
  const normalized = normalizeWorkspacePath(path);
  return normalized === "/workspace" || normalized.startsWith("/workspace/");
}

export function isWorkspaceChildPath(path: string): boolean {
  const normalized = normalizeWorkspacePath(path);
  return normalized.startsWith("/workspace/") && normalized !== "/workspace/";
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
