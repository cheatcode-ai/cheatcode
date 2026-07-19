import type { SandboxListFilesResult } from "@cheatcode/sandbox-contracts";
import type { DaytonaClient, DaytonaFileInfo } from "@cheatcode/tools-code";

const MAX_LIST_FILE_ENTRIES = 1_000;

type FileEntry = SandboxListFilesResult["files"][number];

/**
 * Recursive workspace listing over Daytona's single-level `listFiles` (the
 * toolbox `GET /files` returns one level only). Walks `isDir` entries depth-first
 * up to MAX_LIST_FILE_ENTRIES and maps Daytona FileInfo → the SandboxFileEntry
 * contract callers already depend on.
 */
export async function listSandboxFiles({
  client,
  sandboxId,
  includeHidden,
  path,
  recursive,
}: {
  client: DaytonaClient;
  sandboxId: string;
  includeHidden: boolean;
  path: string;
  recursive: boolean;
}): Promise<FileEntry[]> {
  const root = stripTrailingSlash(path);
  const out: FileEntry[] = [];
  await walk(client, sandboxId, root, root, includeHidden, recursive, out);
  return out.slice(0, MAX_LIST_FILE_ENTRIES);
}

async function walk(
  client: DaytonaClient,
  sandboxId: string,
  dir: string,
  root: string,
  includeHidden: boolean,
  recursive: boolean,
  out: FileEntry[],
): Promise<void> {
  if (out.length >= MAX_LIST_FILE_ENTRIES) {
    return;
  }
  const infos = await client.listFiles(sandboxId, dir);
  const entries = infos
    .map((info) => toFileEntry(info, dir, root))
    .filter((entry) => shouldInclude(entry, includeHidden));
  for (const entry of entries) {
    out.push(entry);
  }
  if (!recursive) {
    return;
  }
  for (const entry of entries) {
    if (entry.type === "directory" && out.length < MAX_LIST_FILE_ENTRIES) {
      await walk(client, sandboxId, entry.path, root, includeHidden, recursive, out);
    }
  }
}

function toFileEntry(info: DaytonaFileInfo, parentDir: string, root: string): FileEntry {
  const path = `${stripTrailingSlash(parentDir)}/${info.name}`;
  return {
    name: info.name,
    path,
    relativePath: relativePath(root, path),
    type: info.isDir ? "directory" : "file",
    size: info.size,
    modifiedAt: info.modifiedAt,
  };
}

function shouldInclude(entry: { relativePath: string }, includeHidden: boolean): boolean {
  if (includeHidden) {
    return true;
  }
  return !entry.relativePath.split("/").some((part) => part.startsWith("."));
}

function relativePath(root: string, path: string): string {
  const normalizedRoot = stripTrailingSlash(root);
  if (path === normalizedRoot) {
    return basename(path);
  }
  if (path.startsWith(`${normalizedRoot}/`)) {
    return path.slice(normalizedRoot.length + 1);
  }
  return basename(path);
}

function basename(path: string): string {
  const index = path.lastIndexOf("/");
  return index === -1 ? path : path.slice(index + 1);
}

function stripTrailingSlash(value: string): string {
  return value.length > 1 && value.endsWith("/") ? value.slice(0, -1) : value;
}
