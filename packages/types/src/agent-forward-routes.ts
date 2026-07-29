export interface AgentForwardRoute {
  method: "DELETE" | "GET" | "POST";
  path: `/${string}`;
  rateLimitCost: 1 | 3 | 5;
}

/**
 * Canonical Gateway -> Agent pure-forward routes. Create-run and skill-runtime
 * routes are intentionally absent because their boundary behavior is explicit.
 */
export const AGENT_FORWARD_ROUTES = {
  core: {
    deleteUserSkill: {
      method: "DELETE",
      path: "/v1/skills/:skillId",
      rateLimitCost: 3,
    },
    downloadOutput: {
      method: "GET",
      path: "/v1/outputs/:outputId/download",
      rateLimitCost: 1,
    },
    mintOutputDownloadUrl: {
      method: "POST",
      path: "/v1/outputs/:outputId/download-url",
      rateLimitCost: 3,
    },
  },
  piped: {
    browserTakeoverResume: {
      method: "POST",
      path: "/v1/threads/:threadId/browser-takeover/resume",
      rateLimitCost: 3,
    },
    browserTakeoverStart: {
      method: "POST",
      path: "/v1/threads/:threadId/browser-takeover/start",
      rateLimitCost: 3,
    },
    browserTakeoverStatus: {
      method: "GET",
      path: "/v1/threads/:threadId/browser-takeover",
      rateLimitCost: 1,
    },
    cancelRun: {
      method: "POST",
      path: "/v1/runs/:runId/cancel",
      rateLimitCost: 3,
    },
    computerIde: {
      method: "GET",
      path: "/v1/computer/ide",
      rateLimitCost: 5,
    },
    computerTerminal: {
      method: "POST",
      path: "/v1/computer/terminal",
      rateLimitCost: 3,
    },
    computerTerminalContext: {
      method: "GET",
      path: "/v1/computer/terminal/context",
      rateLimitCost: 5,
    },
    openUserSkill: {
      method: "POST",
      path: "/v1/skills/:skillId/open",
      rateLimitCost: 3,
    },
    sandboxConsole: {
      method: "GET",
      path: "/v1/threads/:threadId/sandbox/console",
      rateLimitCost: 5,
    },
    sandboxIde: {
      method: "GET",
      path: "/v1/threads/:threadId/sandbox/ide",
      rateLimitCost: 5,
    },
    sandboxPreviewStatus: {
      method: "GET",
      path: "/v1/threads/:threadId/sandbox/preview/status",
      rateLimitCost: 5,
    },
    sandboxPreviewWake: {
      method: "POST",
      path: "/v1/threads/:threadId/sandbox/preview/wake",
      rateLimitCost: 3,
    },
    sandboxTerminal: {
      method: "POST",
      path: "/v1/threads/:threadId/sandbox/terminal",
      rateLimitCost: 3,
    },
    sandboxTerminalContext: {
      method: "GET",
      path: "/v1/threads/:threadId/sandbox/terminal/context",
      rateLimitCost: 5,
    },
    streamRun: {
      method: "GET",
      path: "/v1/threads/:threadId/runs/stream",
      rateLimitCost: 5,
    },
  },
  project: {
    downloadProject: {
      method: "POST",
      path: "/v1/projects/:projectId/download",
      rateLimitCost: 5,
    },
    listProjectFiles: {
      method: "GET",
      path: "/v1/projects/:projectId/files",
      rateLimitCost: 1,
    },
    uploadProjectFile: {
      method: "POST",
      path: "/v1/projects/:projectId/files",
      rateLimitCost: 3,
    },
  },
} as const satisfies Record<string, Record<string, AgentForwardRoute>>;

export function agentForwardRouteKey(route: AgentForwardRoute): string {
  return `${route.method} ${route.path}`;
}
