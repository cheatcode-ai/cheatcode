import {
  createDb,
  materializeThreadProject,
  withUserContext,
  workspacePathForSlug,
} from "@cheatcode/db";
import { APIError, type createLogger } from "@cheatcode/observability";
import type {
  CodeRuntimeContext,
  WorkspaceBinding,
  WorkspaceResolver,
} from "@cheatcode/sandbox-contracts";
import { ThreadId, UserId } from "@cheatcode/types";
import type { UIMessageChunk } from "ai";
import type { AgentRunEnv } from "./agent-run-env";
import type { StartRunInput } from "./agent-run-schemas";

interface WorkspaceResolverInput {
  append: (chunk: UIMessageChunk) => Promise<void>;
  env: AgentRunEnv;
  input: StartRunInput;
  logger: ReturnType<typeof createLogger>;
  sandbox: CodeRuntimeContext["sandbox"];
}

/** Request-scoped resolver shared by every workspace-backed tool in one agent run. */
export function createRunWorkspaceResolver(input: WorkspaceResolverInput): WorkspaceResolver {
  let pending: Promise<WorkspaceBinding> | null = null;
  return () => {
    pending ??= resolveWorkspace(input).catch((error: unknown) => {
      pending = null;
      throw error;
    });
    return pending;
  };
}

async function resolveWorkspace(input: WorkspaceResolverInput): Promise<WorkspaceBinding> {
  if (input.input.projectId && input.input.workspaceSlug) {
    await ensureWorkspaceDirectory(input, input.input.workspaceSlug);
    return binding(input.input.projectId, input.input.workspaceSlug);
  }
  const result = await materializeWorkspaceProject(input);
  if (result.type === "thread-not-found") {
    throw new APIError(404, "not_found_thread", "Thread not found", { retriable: false });
  }
  if (result.type === "project-read-only") {
    throw new APIError(403, "permission_plan_required", "Project is read-only after downgrade", {
      details: { archiveAfter: result.archiveAfter?.toISOString() ?? null },
      retriable: false,
    });
  }
  if (result.type === "project-limit-reached") {
    throw new APIError(403, "permission_plan_required", "Active project limit reached", {
      details: { limit: result.limit, used: result.used },
      hint: "Upgrade your plan or archive an existing project before creating workspace files.",
      retriable: false,
    });
  }
  const project = result.project;
  input.input.projectId = project.id;
  input.input.workspaceSlug = project.workspaceSlug;
  await ensureWorkspaceDirectory(input, project.workspaceSlug);
  if (result.type === "created") {
    await input.append({
      data: { projectId: project.id, projectName: project.name, v: 1 },
      type: "data-project-created",
    });
  }
  input.logger.info("agent_workspace_materialized", {
    projectId: project.id,
    workspaceSlug: project.workspaceSlug,
  });
  return binding(project.id, project.workspaceSlug);
}

async function materializeWorkspaceProject(input: WorkspaceResolverInput) {
  const userId = UserId(input.input.userId);
  const { db, close } = createDb(input.env.HYPERDRIVE, {
    audience: "app_agent",
    signingSecret: input.env.DATABASE_CONTEXT_SIGNING_SECRET_AGENT,
  });
  try {
    return await withUserContext(db, userId, (tx) =>
      materializeThreadProject(tx, {
        threadId: ThreadId(input.input.threadId),
        userId,
      }),
    );
  } finally {
    await close();
  }
}

async function ensureWorkspaceDirectory(
  input: WorkspaceResolverInput,
  workspaceSlug: string,
): Promise<void> {
  if (!input.sandbox.exec) {
    return;
  }
  const result = await input.sandbox.exec({
    command: ["mkdir", "-p", workspacePathForSlug(workspaceSlug)],
    timeoutMs: 15_000,
  });
  if (!result.success) {
    throw new APIError(503, "sandbox_failed_to_start", "Could not prepare the project workspace", {
      retriable: true,
    });
  }
}

function binding(projectId: string, workspaceSlug: string): WorkspaceBinding {
  return {
    projectId,
    workspaceDir: workspacePathForSlug(workspaceSlug),
    workspaceSlug,
  };
}
