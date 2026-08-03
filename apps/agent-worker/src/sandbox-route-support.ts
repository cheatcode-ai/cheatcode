import { getProject, getThread, withUserDb } from "@cheatcode/db";
import { APIError } from "@cheatcode/observability";
import { toProjectId, toThreadId, toUserId } from "@cheatcode/types";
import { z } from "zod";
import type { AgentEnv } from "./agent-env";
import { shellQuote } from "./sandbox-support";

export const SANDBOX_WORKSPACE_ROOT = "/workspace";
export const TERMINAL_DISPLAY_WORKSPACE = "/home/user/computer";

const SandboxStateCacheSchema = z.strictObject({
  state: z.string().min(1).max(50),
  updatedAt: z.string().optional(),
});

export async function terminalProjectForThread(
  env: AgentEnv,
  userId: string,
  threadId: string,
): Promise<{ id: string; name: string; workspaceSlug: string } | null> {
  const parsedUserId = toUserId(userId);
  return withUserDb(env, parsedUserId, async ({ transaction }) => {
    return await transaction(async (tx) => {
      const thread = await getThread(tx, { threadId: toThreadId(threadId), userId: parsedUserId });
      if (!thread) {
        throw new APIError(404, "resource_thread_not_found", "Thread not found", {
          retriable: false,
        });
      }
      if (!thread.projectId) {
        return null;
      }
      const project = await getProject(tx, {
        projectId: toProjectId(thread.projectId),
        userId: parsedUserId,
      });
      if (!project) {
        throw new APIError(404, "resource_project_not_found", "Project not found", {
          retriable: false,
        });
      }
      return { id: project.id, name: project.name, workspaceSlug: project.workspaceSlug };
    });
  });
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
