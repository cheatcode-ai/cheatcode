import { APIError, createLogger } from "@cheatcode/observability";
import {
  callSandboxMethod,
  EnvironmentVariablesSchema,
  type getCodeRuntimeContext,
  type SandboxStartProcessInput,
} from "@cheatcode/sandbox-contracts";
import { z } from "zod";
import { resolveProjectWorkspacePath, WorkspacePathSchema } from "./workspace-paths";

const StartDevServerInputSchema = z
  .object({
    command: z.array(z.string().min(1).max(8_192)).min(1).max(128),
    cwd: WorkspacePathSchema,
    env: EnvironmentVariablesSchema.optional(),
    // Mobile (Expo Metro) dev server: threads through to the ProcessRecord so the authenticated
    // wake path can mint the correct browser and Expo sessions without exposing them to the model.
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

const StartDevServerOutputSchema = z
  .object({
    processId: z.string(),
    pid: z.number().int().positive().optional(),
    port: z.number().int().positive(),
    status: z.string(),
  })
  .strict();

export type StartDevServerInput = z.input<typeof StartDevServerInputSchema>;
export type StartDevServerOutput = z.infer<typeof StartDevServerOutputSchema>;

export interface PreparedStartDevServer {
  mayUseNetwork: boolean;
  port: number;
  process: SandboxStartProcessInput & {
    cwd: string;
    env: Record<string, string>;
  };
}

// Per-project dev-server slot prefix. Each project's dev server occupies proc:app-preview:<slug>
// so multiple projects' servers persist side by side in the one per-user sandbox (Cheatcode parity).
const APP_PREVIEW_SLOT_PREFIX = "app-preview:";

export async function executeStartDevServer(
  input: StartDevServerInput,
  runtimeContext: ReturnType<typeof getCodeRuntimeContext>,
): Promise<StartDevServerOutput> {
  return executePreparedStartDevServer(
    await prepareStartDevServer(input, runtimeContext),
    runtimeContext,
  );
}

/** Resolves dynamic port allocation and command normalization before execution. */
export async function prepareStartDevServer(
  input: StartDevServerInput,
  runtimeContext: ReturnType<typeof getCodeRuntimeContext>,
): Promise<PreparedStartDevServer> {
  const parsedInput = StartDevServerInputSchema.parse(input);
  const cwd = resolveProjectWorkspacePath(parsedInput.cwd, runtimeContext.workspaceDir);
  const slug = deriveWorkspaceSlug(cwd);
  const isExpo = isExpoStartCommand(parsedInput.command);
  const isMobile = isExpo || parsedInput.isMobile;
  const port = await allocateDevServerPort(runtimeContext, slug, isMobile);
  return {
    mayUseNetwork: isExpo,
    port,
    process: {
      command: isExpo ? expoWebCommand(port) : parsedInput.command,
      cwd,
      env: { ...parsedInput.env, PORT: String(port) },
      isMobile,
      keepAliveTimeoutMs: parsedInput.keepAliveTimeoutMs,
      maxRestarts: parsedInput.maxRestarts,
      processId: `${APP_PREVIEW_SLOT_PREFIX}${slug}`,
      restartOnFailure: parsedInput.restartOnFailure,
      timeoutMs: parsedInput.timeoutMs,
      waitForPort: { port, timeoutMs: parsedInput.timeoutMs },
    },
  };
}

/** Executes only the fully resolved process plan. */
export async function executePreparedStartDevServer(
  prepared: PreparedStartDevServer,
  runtimeContext: ReturnType<typeof getCodeRuntimeContext>,
): Promise<StartDevServerOutput> {
  const process = await callSandboxMethod(runtimeContext.sandbox, "startProcess", prepared.process);
  return StartDevServerOutputSchema.parse({
    processId: process.id,
    pid: process.pid,
    port: prepared.port,
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
