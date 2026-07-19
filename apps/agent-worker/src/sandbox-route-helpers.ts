import { createDb, getProject, getThread, withUserContext } from "@cheatcode/db";
import { APIError } from "@cheatcode/observability";
import { ProjectId, type SandboxFileEntry, ThreadId, UserId } from "@cheatcode/types";
import { z } from "zod";
import type { AgentEnv } from "./agent-env";

export const SANDBOX_WORKSPACE_ROOT = "/workspace";
export const TERMINAL_DISPLAY_WORKSPACE = "/home/user/computer";

const APP_ENTRY_FILE_NAMES = new Set([
  "app.js",
  "index.html",
  "next.config.js",
  "package.json",
  "vite.config.js",
]);
const CODE_SERVER_IGNORED_SEGMENTS = new Set([
  ".git",
  ".next",
  ".turbo",
  "dist",
  "node_modules",
  "out",
]);
const CODE_SERVER_DELIVERABLE_EXTENSIONS = new Set([
  ".doc",
  ".docx",
  ".odp",
  ".ods",
  ".odt",
  ".pdf",
  ".ppt",
  ".pptx",
  ".xls",
  ".xlsx",
]);
const CODE_SERVER_ENTRY_RELATIVE_PATHS = [
  "index.html",
  "package.json",
  "src/app/page.tsx",
  "src/app/page.jsx",
  "src/App.tsx",
  "src/App.jsx",
  "src/main.tsx",
  "src/main.jsx",
  "app.js",
  "main.py",
  "README.md",
];
const SandboxStateCacheSchema = z
  .object({ state: z.string().min(1).max(50), updatedAt: z.string().optional() })
  .strict();

export async function terminalProjectForThread(
  env: AgentEnv,
  userId: string,
  threadId: string,
): Promise<{ id: string; name: string; workspaceSlug: string } | null> {
  const parsedUserId = UserId(userId);
  const { db, close } = createDb(env.HYPERDRIVE, {
    audience: "app_agent",
    signingSecret: env.DATABASE_CONTEXT_SIGNING_SECRET_AGENT,
  });
  try {
    return await withUserContext(db, parsedUserId, async (tx) => {
      const thread = await getThread(tx, { threadId: ThreadId(threadId), userId: parsedUserId });
      if (!thread) {
        throw new APIError(404, "not_found_thread", "Thread not found", { retriable: false });
      }
      if (!thread.projectId) {
        return null;
      }
      const project = await getProject(tx, {
        projectId: ProjectId(thread.projectId),
        userId: parsedUserId,
      });
      if (!project) {
        throw new APIError(404, "not_found_project", "Project not found", { retriable: false });
      }
      return { id: project.id, name: project.name, workspaceSlug: project.workspaceSlug };
    });
  } finally {
    await close();
  }
}

export function selectInitialCodeServerFile(
  files: SandboxFileEntry[],
  workspacePath: string,
): string | undefined {
  const candidates = files
    .filter((file) => file.type === "file" && isCodeServerCandidate(file.path, workspacePath))
    .sort(
      (left, right) =>
        codeServerFileScore(right, workspacePath) - codeServerFileScore(left, workspacePath),
    );
  return candidates[0]?.path;
}

function isCodeServerCandidate(path: string, workspacePath: string): boolean {
  if (!path.startsWith(`${workspacePath}/`)) {
    return false;
  }
  const relativePath = path.slice(workspacePath.length + 1);
  return !relativePath.split("/").some((segment) => CODE_SERVER_IGNORED_SEGMENTS.has(segment));
}

function codeServerFileScore(file: SandboxFileEntry, workspacePath: string): number {
  const relativePath = file.path.slice(workspacePath.length + 1);
  const extension = extensionOf(file.name);
  if (CODE_SERVER_DELIVERABLE_EXTENSIONS.has(extension)) {
    return 1_000 - relativePath.split("/").length;
  }
  const entryIndex = CODE_SERVER_ENTRY_RELATIVE_PATHS.indexOf(relativePath);
  if (entryIndex !== -1) {
    return 900 - entryIndex;
  }
  if (APP_ENTRY_FILE_NAMES.has(file.name)) {
    return 800;
  }
  if (isLikelySourceExtension(extension)) {
    return 500 - relativePath.split("/").length;
  }
  return 100 - relativePath.length / 1_000;
}

function extensionOf(filename: string): string {
  const dotIndex = filename.lastIndexOf(".");
  return dotIndex <= 0 ? "" : filename.slice(dotIndex).toLowerCase();
}

function isLikelySourceExtension(extension: string): boolean {
  return [".css", ".html", ".js", ".jsx", ".json", ".md", ".py", ".ts", ".tsx"].includes(extension);
}

export function terminalDisplayCwd(cwd: string): string {
  if (cwd === SANDBOX_WORKSPACE_ROOT) {
    return TERMINAL_DISPLAY_WORKSPACE;
  }
  if (cwd.startsWith(`${SANDBOX_WORKSPACE_ROOT}/`)) {
    return `${TERMINAL_DISPLAY_WORKSPACE}/${cwd.slice(SANDBOX_WORKSPACE_ROOT.length + 1)}`;
  }
  return cwd;
}

const sandboxStateCacheKey = (daytonaId: string): string => `sbx:${daytonaId}`;

// Read the webhook-fed sandbox lifecycle state (written by webhooks-worker on
// Daytona sandbox.state.updated). Returns null when unbound, absent, or malformed.
export async function readSandboxStateCache(
  env: AgentEnv,
  daytonaId: string,
): Promise<z.infer<typeof SandboxStateCacheSchema> | null> {
  if (!env.SANDBOX_STATE) {
    return null;
  }
  const raw = await env.SANDBOX_STATE.get(sandboxStateCacheKey(daytonaId)).catch(() => null);
  if (!raw) {
    return null;
  }
  try {
    const parsed = SandboxStateCacheSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function withTerminalCwdMarker(command: string, marker: string): string {
  return `${command}
__cc_terminal_status=$?
printf '\n%s%s\n' ${shellQuote(marker)} "$PWD"
exit "$__cc_terminal_status"`;
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

export function extractTerminalCwd(
  stdout: string,
  marker: string,
): { cwd?: string; stdout: string } {
  const lines = stdout.split(/\r?\n/u);
  const keptLines: string[] = [];
  let cwd: string | undefined;
  for (const line of lines) {
    if (line.startsWith(marker)) {
      const nextCwd = line.slice(marker.length).trim();
      if (nextCwd.length > 0) {
        cwd = nextCwd;
      }
      continue;
    }
    keptLines.push(line);
  }
  return {
    ...(cwd === undefined ? {} : { cwd }),
    stdout: keptLines.join("\n"),
  };
}
