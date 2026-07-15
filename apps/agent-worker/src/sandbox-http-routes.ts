import type { Hono } from "hono";
import type { AgentEnv } from "./agent-env";
import { registerSandboxFileHttpRoutes } from "./sandbox-file-http-routes";
import { registerSandboxPreviewHttpRoutes } from "./sandbox-preview-http-routes";
import { registerSandboxTerminalHttpRoutes } from "./sandbox-terminal-http-routes";

export function registerSandboxHttpRoutes(app: Hono<{ Bindings: AgentEnv }>): void {
  registerSandboxFileHttpRoutes(app);
  registerSandboxPreviewHttpRoutes(app);
  registerSandboxTerminalHttpRoutes(app);
}
