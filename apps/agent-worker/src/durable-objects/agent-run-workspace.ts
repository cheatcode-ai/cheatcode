import { entitlementCacheFromValues } from "@cheatcode/billing";
import { materializeThreadProject, withUserDb, workspacePathForSlug } from "@cheatcode/db";
import { APIError, type createLogger } from "@cheatcode/observability";
import type {
  CodeRuntimeContext,
  WorkspaceBinding,
  WorkspaceResolver,
} from "@cheatcode/sandbox-contracts";
import { toThreadId, toUserId } from "@cheatcode/types";
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
  if (result.kind === "thread-not-found") {
    throw new APIError(404, "resource_thread_not_found", "Thread not found", { retriable: false });
  }
  if (result.kind === "project-read-only") {
    throw new APIError(403, "permission_plan_required", "Project is read-only after downgrade", {
      details: { archiveAfter: result.archiveAfter?.toISOString() ?? null },
      retriable: false,
    });
  }
  if (result.kind === "project-limit-reached") {
    throw new APIError(403, "permission_plan_required", "Active project limit reached", {
      details: { limit: result.limit, used: result.used },
      hint: "Upgrade your plan or archive an existing project before creating workspace files.",
      retriable: false,
    });
  }
  const project = result.project;
  input.input.projectId = project.id;
  input.input.workspaceSlug = project.workspaceSlug;
  if (result.kind === "created") {
    await input.append({
      data: { projectId: project.id, projectName: project.name, v: 1 },
      type: "data-project-created",
    });
  }
  await ensureWorkspaceDirectory(input, project.workspaceSlug);
  input.logger.info("agent_workspace_materialized", {
    projectId: project.id,
    workspaceSlug: project.workspaceSlug,
  });
  return binding(project.id, project.workspaceSlug);
}

async function materializeWorkspaceProject(input: WorkspaceResolverInput) {
  const userId = toUserId(input.input.userId);
  return withUserDb(input.env, userId, async ({ transaction }) => {
    return await transaction((tx) =>
      materializeThreadProject(
        tx,
        {
          ...(input.input.projectMode === "general"
            ? {}
            : { projectMode: input.input.projectMode }),
          threadId: toThreadId(input.input.threadId),
          userId,
        },
        (entitlement) => entitlementCacheFromValues(entitlement ?? { tier: "free" }).maxProjects,
      ),
    );
  });
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
    throw new APIError(503, "sandbox_start_failed", "Could not prepare the project workspace", {
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
