import type { SandboxInstance } from "@blaxel/core";
import type { SandboxListFilesResult } from "@cheatcode/tools-code";
import { z } from "zod";

const MAX_LIST_FILE_ENTRIES = 1_000;

const FileListSchema = z
  .object({
    files: z.array(z.unknown()).default([]),
    subdirectories: z.array(z.unknown()).default([]),
  })
  .passthrough();

interface FileEntryCandidate {
  lastModified?: string | undefined;
  modifiedAt?: string | undefined;
  name?: string | undefined;
  path?: string | undefined;
  size?: number | undefined;
  type?: string | undefined;
}

export async function listSandboxFiles({
  includeHidden,
  path,
  recursive,
  sandbox,
}: {
  includeHidden: boolean;
  path: string;
  recursive: boolean;
  sandbox: SandboxInstance;
}): Promise<SandboxListFilesResult["files"]> {
  const entries = await listDirectory({
    includeHidden,
    parentPath: path,
    recursive,
    rootPath: path,
    sandbox,
  });
  return entries.slice(0, MAX_LIST_FILE_ENTRIES);
}

async function listDirectory({
  includeHidden,
  parentPath,
  recursive,
  rootPath,
  sandbox,
}: {
  includeHidden: boolean;
  parentPath: string;
  recursive: boolean;
  rootPath: string;
  sandbox: SandboxInstance;
}): Promise<SandboxListFilesResult["files"]> {
  const listing = FileListSchema.parse(await sandbox.fs.ls(parentPath));
  const directories = listing.subdirectories
    .map((entry) => toFileEntry(entry, parentPath, "directory", rootPath))
    .filter((entry) => shouldIncludeEntry(entry, includeHidden));
  const files = listing.files
    .map((entry) => toFileEntry(entry, parentPath, "file", rootPath))
    .filter((entry) => shouldIncludeEntry(entry, includeHidden));
  if (!recursive) {
    return [...directories, ...files];
  }

  const descendants: SandboxListFilesResult["files"] = [];
  for (const directory of directories) {
    if (descendants.length + directories.length + files.length >= MAX_LIST_FILE_ENTRIES) {
      break;
    }
    descendants.push(
      ...(await listDirectory({
        includeHidden,
        parentPath: directory.path,
        recursive,
        rootPath,
        sandbox,
      })),
    );
  }
  return [...directories, ...files, ...descendants].slice(0, MAX_LIST_FILE_ENTRIES);
}

function toFileEntry(
  value: unknown,
  parentPath: string,
  fallbackType: "file" | "directory",
  rootPath: string,
) {
  const candidate: FileEntryCandidate = z
    .object({
      lastModified: z.string().optional(),
      modifiedAt: z.string().optional(),
      name: z.string().optional(),
      path: z.string().optional(),
      size: z.number().int().nonnegative().optional(),
      type: z.string().optional(),
    })
    .passthrough()
    .parse(value);
  const name = candidate.name ?? basename(candidate.path ?? "");
  const path = candidate.path ?? `${parentPath.replace(/\/$/, "")}/${name}`;
  const relativePath = relativeSandboxPath(rootPath, path);
  return {
    modifiedAt: candidate.modifiedAt ?? candidate.lastModified ?? new Date(0).toISOString(),
    name,
    path,
    relativePath,
    size: candidate.size ?? 0,
    type: normalizeFileType(candidate.type, fallbackType),
  };
}

function normalizeFileType(
  value: string | undefined,
  fallbackType: "file" | "directory",
): "file" | "directory" | "symlink" | "other" {
  if (value === "file" || value === "directory" || value === "symlink" || value === "other") {
    return value;
  }
  return fallbackType;
}

function basename(path: string): string {
  const index = path.lastIndexOf("/");
  return index === -1 ? path : path.slice(index + 1);
}

function shouldIncludeEntry(
  entry: { name: string; relativePath: string },
  includeHidden: boolean,
): boolean {
  if (includeHidden) {
    return true;
  }
  return !entry.relativePath.split("/").some((part) => part.startsWith("."));
}

function relativeSandboxPath(rootPath: string, path: string): string {
  const normalizedRoot = rootPath.replace(/\/$/, "");
  if (path === normalizedRoot) {
    return basename(path);
  }
  if (path.startsWith(`${normalizedRoot}/`)) {
    return path.slice(normalizedRoot.length + 1);
  }
  return basename(path);
}
