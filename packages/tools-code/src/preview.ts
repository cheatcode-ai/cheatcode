import { APIError, createLogger } from "@cheatcode/observability";
import { tool } from "ai";
import { z } from "zod";
import { getCodeRuntimeContext } from "./runtime";
import { callSandboxMethod } from "./sandbox-methods";

export const StartDevServerInputSchema = z
  .object({
    command: z.array(z.string().min(1)).min(1).max(128),
    cwd: z.string().min(1).max(500),
    env: z.record(z.string(), z.string()).optional(),
    hostname: z.string().min(1).max(255).optional(),
    // Mobile (Expo Metro) dev server: threads through to the ProcessRecord + preview URL so the
    // wake path and clean-subdomain routing key off the stack, not the (now per-project) port.
    isMobile: z.boolean().default(false),
    keepAliveTimeoutMs: z
      .number()
      .int()
      .min(0)
      .max(24 * 60 * 60 * 1000)
      .default(60 * 60 * 1000),
    maxRestarts: z.number().int().min(0).max(25).default(3),
    name: z.string().min(1).max(100).default("app-preview"),
    port: z.number().int().positive().max(65_535).default(5173),
    restartOnFailure: z.boolean().default(true),
    timeoutMs: z.number().int().positive().max(600_000).default(120_000),
  })
  .strict();

export const StartDevServerOutputSchema = z
  .object({
    processId: z.string(),
    pid: z.number().int().positive().optional(),
    previewUrl: z.string().url(),
    port: z.number().int().positive(),
    status: z.string(),
  })
  .strict();

export type StartDevServerInput = z.input<typeof StartDevServerInputSchema>;
export type StartDevServerOutput = z.infer<typeof StartDevServerOutputSchema>;

// Per-project dev-server slot prefix. Each project's dev server occupies proc:app-preview:<slug>
// so multiple projects' servers persist side by side in the one per-user sandbox (bud parity).
const APP_PREVIEW_SLOT_PREFIX = "app-preview:";

export async function executeStartDevServer(
  input: StartDevServerInput,
  runtimeContext: ReturnType<typeof getCodeRuntimeContext>,
): Promise<StartDevServerOutput> {
  const parsedInput = StartDevServerInputSchema.parse(input);
  // The dev server is SYSTEM-confined to the run's project folder: cwd is forced to the run's
  // workspaceDir (/workspace/<slug>) regardless of what the model passed, and the port + process
  // slot both key off the LAST path segment of that forced cwd. This is what stops every general
  // project's dev server from running in /workspace root and colliding on 5173/app-preview:workspace
  // in the shared per-user sandbox — each project persists on its own stable port + slot (bud parity).
  const cwd = runtimeContext.workspaceDir ?? parsedInput.cwd;
  const slug = deriveWorkspaceSlug(cwd);
  const name = `${APP_PREVIEW_SLOT_PREFIX}${slug}`;
  const port = await allocateDevServerPort(runtimeContext, slug, parsedInput.isMobile);
  const process = await callSandboxMethod(runtimeContext.sandbox, "startProcess", {
    command: parsedInput.command,
    cwd,
    env: { ...parsedInput.env, PORT: String(port) },
    isMobile: parsedInput.isMobile,
    keepAliveTimeoutMs: parsedInput.keepAliveTimeoutMs,
    maxRestarts: parsedInput.maxRestarts,
    processId: name,
    restartOnFailure: parsedInput.restartOnFailure,
    timeoutMs: parsedInput.timeoutMs,
    waitForPort: {
      port,
      timeoutMs: parsedInput.timeoutMs,
    },
  });
  await clearExistingExposure(runtimeContext, name, port);
  const exposed = await callSandboxMethod(runtimeContext.sandbox, "exposePort", {
    ...(parsedInput.hostname ? { hostname: parsedInput.hostname } : {}),
    isMobile: parsedInput.isMobile,
    name,
    port,
  });
  return StartDevServerOutputSchema.parse({
    processId: process.id,
    pid: process.pid,
    previewUrl: exposed.url,
    port: exposed.port,
    status: process.status,
  });
}

// The project's workspaceSlug = the last non-empty path segment of the cwd (/workspace/<slug>).
// Falls back to "app" for a slug-less cwd, matching the app-builder fallback dir basename.
function deriveWorkspaceSlug(cwd: string): string {
  const segments = cwd.split("/").filter((segment) => segment.length > 0);
  return segments[segments.length - 1] ?? "app";
}

// Get-or-assign this project's stable dev-server port from the sandbox's per-project allocator
// (keyed by slug). In the per-user sandbox there is NO fixed-port fallback — two projects sharing
// one port would kill each other's dev server via deleteProcessesOnPort — so if the allocator is
// unavailable or errors, fail the dev-server start loudly instead of returning a shared port.
async function allocateDevServerPort(
  runtimeContext: ReturnType<typeof getCodeRuntimeContext>,
  slug: string,
  isMobile: boolean,
): Promise<number> {
  const logger = createLogger();
  if (!runtimeContext.sandbox.allocateProjectPort) {
    logger.error("dev_server_port_alloc_missing", { slug });
    throw devServerPortAllocationError(slug);
  }
  try {
    const port = await runtimeContext.sandbox.allocateProjectPort({
      projectId: slug,
      stack: isMobile ? "mobile" : "web",
    });
    logger.info("dev_server_port_allocated", { port, slug });
    return port;
  } catch (error) {
    logger.error("dev_server_port_alloc_error", {
      error: error instanceof Error ? error.message : String(error),
      slug,
    });
    throw devServerPortAllocationError(slug);
  }
}

function devServerPortAllocationError(slug: string): APIError {
  return new APIError(
    502,
    "sandbox_failed_to_start",
    "Could not allocate a per-project dev-server port.",
    {
      details: { slug },
      hint: "Retry. If it persists, the project sandbox port allocator is unavailable.",
      retriable: true,
    },
  );
}

export const startDevServer = tool({
  description:
    "Start a long-running dev server in the sandbox and expose its HTTP port as a preview URL.",
  inputSchema: StartDevServerInputSchema,
  outputSchema: StartDevServerOutputSchema,
  execute: async (input, options: unknown) =>
    executeStartDevServer(input, getCodeRuntimeContext(options)),
});

async function clearExistingExposure(
  runtimeContext: ReturnType<typeof getCodeRuntimeContext>,
  name: string,
  port: number,
): Promise<void> {
  if (!runtimeContext.sandbox.unexposePort) {
    return;
  }
  try {
    await runtimeContext.sandbox.unexposePort({ name, port });
  } catch {
    return;
  }
}
