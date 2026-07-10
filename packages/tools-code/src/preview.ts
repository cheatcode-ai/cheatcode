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
  // A mobile/Expo dev server has exactly one correct invocation: `expo start --web` on the project's
  // own allocated port. The model sometimes emits a broken variant via start_dev_server — a
  // hallucinated `--no-dev-client` that makes expo exit, or a hardcoded `--port 5173` that collides
  // with another project in the shared per-user sandbox — which lands in this project's preview slot
  // and leaves the panel blank. Normalize any `expo start` command (from the model OR the app-builder,
  // where it's a no-op) to the canonical form; web (Next/Vite) commands pass through untouched.
  const isExpo = isExpoStartCommand(parsedInput.command);
  const isMobile = isExpo || parsedInput.isMobile;
  const port = await allocateDevServerPort(runtimeContext, slug, isMobile);
  const command = isExpo ? expoWebCommand(port) : parsedInput.command;
  const process = await callSandboxMethod(runtimeContext.sandbox, "startProcess", {
    command,
    cwd,
    env: { ...parsedInput.env, PORT: String(port) },
    isMobile,
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

// An `expo start …` invocation, however the model spelled it (npx / pnpm exec / bare, any flags).
function isExpoStartCommand(command: readonly string[]): boolean {
  return command.includes("expo") && command.includes("start");
}

// Restore the curated Expo dependency tree onto the project's package.json. The model routinely
// rewrites package.json mid-build — pruning packages Metro needs (react-dom, react-native-web,
// expo-asset) AND downgrading others (e.g. expo-router to a pre-SDK major), which crashes
// `expo start --web`. Re-merge the baked template's deps with the TEMPLATE's versions authoritative
// for shared packages (fixes downgrades + restores removals) while keeping any extra packages the
// app genuinely added. Exit 0 only when something changed, so the caller reinstalls only then —
// keeping wake-from-idle (deps already correct) fast.
const RESTORE_EXPO_DEPS_JS = [
  'const fs=require("fs");',
  'const t=require("/home/node/cheatcode-expo-template/package.json");',
  // Pin the web config to a client-rendered SPA on the Metro bundler. Without output:"single" the
  // Expo web dev server renders per-request and does `new URL(req.url)` behind the preview proxy,
  // which throws `TypeError: Invalid URL`; the model routinely drops this from app.json. Cheap file
  // write, applied every start (Metro reads it on boot), independent of the reinstall decision below.
  "try{",
  'const aj=process.cwd()+"/app.json";const a=require(aj);a.expo=a.expo||{};',
  'a.expo.web=Object.assign({},a.expo.web,{bundler:"metro",output:"single"});',
  'fs.writeFileSync(aj,JSON.stringify(a,null,2)+"\\n");',
  "}catch(e){}",
  'const j=process.cwd()+"/package.json";',
  "const p=require(j);",
  "const before=JSON.stringify([p.dependencies,p.devDependencies,p.main]);",
  "p.dependencies=Object.assign({},p.dependencies||{},t.dependencies);",
  "p.devDependencies=Object.assign({},p.devDependencies||{},t.devDependencies);",
  "p.main=t.main;",
  "const after=JSON.stringify([p.dependencies,p.devDependencies,p.main]);",
  "if(before===after){process.exit(1)}",
  'fs.writeFileSync(j,JSON.stringify(p,null,2)+"\\n");',
].join("");

// The one canonical Expo dev-server command. It first self-heals the dependency tree (see above) and
// reinstalls only if the merge changed anything — so a build that corrupted deps is repaired, while a
// clean start / wake-from-idle skips straight to Metro. Because this is the command PERSISTED in the
// process record, it re-heals on restart and wake too. Then Metro: `-c` clears its cache so a finished
// app re-crawls cleanly; `--web` also answers exp:// manifests for the Expo Go QR; `--host lan` + the
// project's allocated port keep it reachable and collision-free. `exec` hands the slot to Metro.
function expoWebCommand(port: number): string[] {
  const restoreB64 = btoa(RESTORE_EXPO_DEPS_JS);
  const writeScript = `echo ${restoreB64} | base64 -d > /tmp/cc-restore-expo-deps.js`;
  const heal =
    "node /tmp/cc-restore-expo-deps.js && rm -f pnpm-lock.yaml package-lock.json && CI=1 EXPO_NO_TELEMETRY=1 pnpm install --prefer-offline";
  const startMetro = `exec pnpm exec expo start -c --web --host lan --port ${port}`;
  return ["sh", "-lc", `${writeScript}; (${heal}) ; ${startMetro}`];
}

// The project's workspaceSlug = the last non-empty path segment of the cwd (/workspace/<slug>).
// Every run has a project, so the forced cwd is always /workspace/<slug> and yields a slug here.
function deriveWorkspaceSlug(cwd: string): string {
  const segments = cwd.split("/").filter((segment) => segment.length > 0);
  const slug = segments[segments.length - 1];
  if (!slug) {
    throw new Error(`Cannot derive a workspace slug from cwd: ${cwd}`);
  }
  return slug;
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
