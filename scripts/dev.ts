import { type ChildProcess, spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { localWorkerConfigs, removeLocalWorkerConfigs } from "./dev-worker-config";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const LOCAL_ENV_FILE = join(ROOT, ".env.local");
const WRANGLER_INSPECTOR_PORT = "9239";

const TOOLCHAIN_ENV_KEYS = [
  "CI",
  "COLORTERM",
  "COREPACK_HOME",
  "HOME",
  "LANG",
  "LC_ALL",
  "LOGNAME",
  "PATH",
  "PNPM_HOME",
  "SHELL",
  "TEMP",
  "TERM",
  "TMP",
  "TMPDIR",
  "USER",
  "XDG_CACHE_HOME",
  "XDG_CONFIG_HOME",
  "XDG_DATA_HOME",
] as const;

interface DevOptions {
  bindAddress: string;
  dryRun: boolean;
  port: string;
  skipInitialBuild: boolean;
  webOnly: boolean;
  workersOnly: boolean;
}

interface CommandSpec {
  args: string[];
  command: string;
  envKeys: readonly string[];
  name: string;
}

type BooleanOption = "dryRun" | "skipInitialBuild" | "webOnly" | "workersOnly";

const REQUIRED_WORKER_ENV = [
  "CLERK_SECRET_KEY",
  "DAYTONA_API_KEY",
  "DAYTONA_API_URL",
  "DAYTONA_SANDBOX_SNAPSHOT",
  "DAYTONA_TARGET",
  "DAYTONA_WORKSPACE_VOLUME",
  "DAYTONA_WEBHOOK_SIGNING_SECRET",
  "DATABASE_CONTEXT_SIGNING_SECRET_AGENT",
  "DATABASE_CONTEXT_SIGNING_SECRET_GATEWAY",
  "DATABASE_CONTEXT_SIGNING_SECRET_WEBHOOKS",
  "GATEWAY_TO_WEBHOOKS_RESOURCE_DELETION_SECRET",
  "INTERNAL_WEBHOOK_REPLAY_SECRET",
  "PREVIEW_TOKEN_SECRET",
  "SUPABASE_AGENT_DATABASE_URL",
  "SUPABASE_GATEWAY_DATABASE_URL",
  "SUPABASE_WEBHOOKS_DATABASE_URL",
  "OUTPUT_DOWNLOAD_SIGNING_SECRET",
  "RELEASE_DATABASE_READINESS_SECRET",
  "SKILL_RUNTIME_BASE_URL",
  "SKILL_RUNTIME_TOKEN_SECRET",
  "WEBHOOKS_TO_AGENT_LIFECYCLE_SECRET",
] as const;

const DISTINCT_LOCAL_SECRET_GROUPS = [
  [
    "DATABASE_CONTEXT_SIGNING_SECRET_AGENT",
    "DATABASE_CONTEXT_SIGNING_SECRET_GATEWAY",
    "DATABASE_CONTEXT_SIGNING_SECRET_WEBHOOKS",
  ],
  [
    "GATEWAY_TO_WEBHOOKS_RESOURCE_DELETION_SECRET",
    "WEBHOOKS_TO_AGENT_LIFECYCLE_SECRET",
    "INTERNAL_WEBHOOK_REPLAY_SECRET",
    "RELEASE_DATABASE_READINESS_SECRET",
  ],
  ["PREVIEW_TOKEN_SECRET", "OUTPUT_DOWNLOAD_SIGNING_SECRET", "SKILL_RUNTIME_TOKEN_SECRET"],
] as const;

const REQUIRED_WEB_ENV = [
  "CLERK_SECRET_KEY",
  "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY",
  "NEXT_PUBLIC_GATEWAY_URL",
  "NEXT_PUBLIC_PREVIEW_HOSTNAME",
  "NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA",
] as const;

const WEB_CHILD_ENV_KEYS = [
  "CLERK_SECRET_KEY",
  "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY",
  "NEXT_PUBLIC_GATEWAY_URL",
  "NEXT_PUBLIC_PREVIEW_HOSTNAME",
  "NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA",
] as const;

const FORBIDDEN_LOCAL_ENV = [
  "ANTHROPIC_API_KEY",
  "CLOUDFLARE_ACCOUNT_ID",
  "CLOUDFLARE_ANALYTICS_API_TOKEN",
  "CLOUDFLARE_API_TOKEN",
  "CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE",
  "DATABASE_URL",
  "GOOGLE_API_KEY",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "NEXT_PUBLIC_SUPABASE_URL",
  "TURBO_TEAM",
  "TURBO_TOKEN",
  "VERCEL_TOKEN",
] as const;

const BOOLEAN_FLAGS: ReadonlyMap<string, BooleanOption> = new Map([
  ["--dry-run", "dryRun"],
  ["--skip-initial-build", "skipInitialBuild"],
  ["--web-only", "webOnly"],
  ["--workers-only", "workersOnly"],
]);

function writeLine(line = ""): void {
  process.stdout.write(`${line}\n`);
}

function writeError(line: string): void {
  process.stderr.write(`${line}\n`);
}

function usage(): string {
  return [
    "Usage: pnpm dev:services -- [--port <next-port>] [--bind <address>] [--web-only] [--workers-only] [--skip-initial-build] [--dry-run]",
    "",
    "Builds/watches shared packages, starts apps/web, and runs one chained Worker process.",
    "The gateway Worker is the only HTTP entrypoint; other Workers are service-bound.",
  ].join("\n");
}

function defaultOptions(): DevOptions {
  return {
    bindAddress: "127.0.0.1",
    dryRun: false,
    port: "3000",
    skipInitialBuild: false,
    webOnly: false,
    workersOnly: false,
  };
}

function readOptionValue(argv: string[], index: number, flag: string): string {
  const value = argv[index + 1];
  if (!value) {
    throw new Error(`${flag} requires a value.`);
  }
  return value;
}

function unquoteEnvValue(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length < 2) {
    return trimmed;
  }
  const quote = trimmed[0];
  const last = trimmed.at(-1);
  if ((quote !== '"' && quote !== "'") || quote !== last) {
    return trimmed;
  }
  return trimmed.slice(1, -1);
}

function readEnvFileValues(filePath: string): Record<string, string> {
  const values: Record<string, string> = {};
  let content: string;
  try {
    content = readFileSync(filePath, "utf8").replace(/^\uFEFF/, "");
  } catch {
    throw new Error(`Missing ${relative(ROOT, filePath)}. Copy .env.example to .env.local.`);
  }

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }
    const delimiterIndex = line.indexOf("=");
    if (delimiterIndex === -1) {
      continue;
    }
    const key = line.slice(0, delimiterIndex).trim();
    if (/^[A-Z0-9_]+$/.test(key)) {
      values[key] = unquoteEnvValue(line.slice(delimiterIndex + 1));
    }
  }
  return values;
}

function validateLocalClerkSecrets(values: Record<string, string>): void {
  const publishableKey = values["NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY"];
  const secretKey = values["CLERK_SECRET_KEY"];
  if (publishableKey && !publishableKey.startsWith("pk_test_")) {
    throw new Error(".env.local must use a Clerk pk_test_ publishable key.");
  }
  if (secretKey && !secretKey.startsWith("sk_test_")) {
    throw new Error(".env.local must use a Clerk sk_test_ secret key.");
  }
}

function validateDistinctLocalSecretGroups(values: Record<string, string>): void {
  for (const names of DISTINCT_LOCAL_SECRET_GROUPS) {
    const secrets = names.map((name) => values[name] ?? "");
    if (secrets.some((secret) => new TextEncoder().encode(secret).byteLength < 32)) {
      throw new Error(
        `Local HMAC secrets must contain at least 32 UTF-8 bytes: ${names.join(", ")}.`,
      );
    }
    if (new Set(secrets).size !== secrets.length) {
      throw new Error(`Local HMAC secrets must be distinct: ${names.join(", ")}.`);
    }
  }
}

export function missingLocalEnvValues(
  values: Record<string, string>,
  required: readonly string[],
): string[] {
  return required.filter((key) => !values[key]);
}

function validateLocalEnv(values: Record<string, string>, options: DevOptions): void {
  const forbidden = FORBIDDEN_LOCAL_ENV.filter((key) => values[key]);
  if (forbidden.length > 0) {
    throw new Error(`Remove cloud-only or unused values from .env.local: ${forbidden.join(", ")}.`);
  }

  validateLocalClerkSecrets(values);
  const required = [
    ...(options.workersOnly ? [] : REQUIRED_WEB_ENV),
    ...(options.webOnly ? [] : REQUIRED_WORKER_ENV),
  ];
  const missing = missingLocalEnvValues(values, required);
  if (missing.length > 0) {
    throw new Error(`.env.local is missing required local values: ${missing.join(", ")}.`);
  }
  if (!options.webOnly) {
    validateDistinctLocalSecretGroups(values);
  }
  if (!options.webOnly && values["POLAR_SERVER"] !== "sandbox") {
    throw new Error(".env.local must set POLAR_SERVER=sandbox for local development.");
  }
  if (
    !options.webOnly &&
    values["DAYTONA_WORKSPACE_VOLUME"] !== "cheatcode-workspaces-development"
  ) {
    throw new Error(
      ".env.local must set DAYTONA_WORKSPACE_VOLUME=cheatcode-workspaces-development.",
    );
  }
}

function applyBooleanFlag(options: DevOptions, arg: string): boolean {
  const key = BOOLEAN_FLAGS.get(arg);
  if (!key) {
    return false;
  }
  options[key] = true;
  return true;
}

function applyPortOption(options: DevOptions, argv: string[], index: number): number | undefined {
  const arg = argv[index];
  if (!arg) {
    return undefined;
  }
  if (arg === "--port") {
    options.port = readOptionValue(argv, index, arg);
    return index + 1;
  }
  if (arg.startsWith("--port=")) {
    options.port = arg.slice("--port=".length);
    return index;
  }
  return undefined;
}

function applyBindOption(options: DevOptions, argv: string[], index: number): number | undefined {
  const arg = argv[index];
  if (!arg) {
    return undefined;
  }
  if (arg === "--bind") {
    options.bindAddress = readOptionValue(argv, index, arg);
    return index + 1;
  }
  if (arg.startsWith("--bind=")) {
    options.bindAddress = arg.slice("--bind=".length);
    return index;
  }
  return undefined;
}

function parseArgs(argv: string[]): DevOptions {
  const options = defaultOptions();
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg) {
      throw new Error(`Missing argument at index ${index}.`);
    }
    const portIndex = applyPortOption(options, argv, index);
    const bindIndex = applyBindOption(options, argv, index);
    if (arg === "--" || applyBooleanFlag(options, arg)) {
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      writeLine(usage());
      process.exit(0);
    }
    if (portIndex !== undefined) {
      index = portIndex;
      continue;
    }
    if (bindIndex !== undefined) {
      index = bindIndex;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  validateOptions(options);
  return options;
}

function validateOptions(options: DevOptions): void {
  if (options.webOnly && options.workersOnly) {
    throw new Error("--web-only and --workers-only cannot be combined.");
  }
  if (options.bindAddress !== "127.0.0.1" && options.bindAddress !== "0.0.0.0") {
    throw new Error("--bind must be 127.0.0.1 or 0.0.0.0.");
  }
}

function commandsFor(options: DevOptions, values: Record<string, string>): CommandSpec[] {
  const commands: CommandSpec[] = [
    {
      name: "packages",
      command: "pnpm",
      envKeys: [],
      args: ["turbo", "watch", "build", "--filter=./packages/*"],
    },
  ];
  if (!options.workersOnly) {
    commands.push({
      name: "web",
      command: "pnpm",
      envKeys: WEB_CHILD_ENV_KEYS,
      args: [
        "--dir",
        "apps/web",
        "exec",
        "next",
        "dev",
        "--turbopack",
        "--hostname",
        options.bindAddress,
        "--port",
        options.port,
      ],
    });
  }
  if (!options.webOnly) {
    const workerConfigs = localWorkerConfigs(options.port, values);
    commands.push({
      name: "workers",
      command: "pnpm",
      envKeys: [],
      args: [
        "--dir",
        "apps/gateway-worker",
        "exec",
        "wrangler",
        "dev",
        "--local",
        "--env-file",
        LOCAL_ENV_FILE,
        "--ip",
        options.bindAddress,
        "--port",
        "8787",
        "--inspector-ip",
        options.bindAddress,
        "--inspector-port",
        WRANGLER_INSPECTOR_PORT,
        ...workerConfigs.flatMap((config) => ["--config", config]),
      ],
    });
  }
  return commands;
}

function runOneShot(command: string, args: string[]): Promise<void> {
  writeLine(`$ ${[command, ...args].join(" ")}`);
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd: ROOT,
      env: toolchainEnvironment(),
      stdio: "inherit",
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolvePromise();
        return;
      }
      reject(new Error(`${command} exited with code ${code ?? "unknown"}.`));
    });
  });
}

function spawnPersistent(spec: CommandSpec, values: Record<string, string>): ChildProcess {
  writeLine(`$ ${[spec.command, ...spec.args].join(" ")}`);
  return spawn(spec.command, spec.args, {
    cwd: ROOT,
    env: childEnvironment(spec.envKeys, values),
    stdio: "inherit",
  });
}

function childEnvironment(
  allowedLocalKeys: readonly string[],
  values: Record<string, string>,
): NodeJS.ProcessEnv {
  const env = toolchainEnvironment();
  for (const key of allowedLocalKeys) {
    const value = values[key];
    if (value) {
      env[key] = value;
    }
  }
  env["FORCE_COLOR"] = "1";
  return env;
}

function toolchainEnvironment(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const key of TOOLCHAIN_ENV_KEYS) {
    const value = process.env[key];
    if (value) {
      env[key] = value;
    }
  }
  env["CLOUDFLARE_INCLUDE_PROCESS_ENV"] = "false";
  // Wrangler gates even an explicit --env-file behind this switch. The dev
  // command always supplies the one root .env.local path, so enabling the
  // loader cannot fall back to per-package files or the ambient environment.
  env["CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV"] = "true";
  env["FORCE_COLOR"] = "1";
  return env;
}

function stopChildren(children: ChildProcess[]): void {
  for (const child of children) {
    if (!child.killed) {
      child.kill("SIGTERM");
    }
  }
}

function waitForChildren(children: ChildProcess[]): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    let settled = false;
    for (const child of children) {
      child.on("error", reject);
      child.on("exit", (code, signal) => {
        if (settled) {
          return;
        }
        settled = true;
        stopChildren(children);
        if (code === 0 || signal === "SIGTERM" || signal === "SIGINT") {
          resolvePromise();
          return;
        }
        reject(new Error("A dev process exited unexpectedly."));
      });
    }
  });
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const values = readEnvFileValues(LOCAL_ENV_FILE);
  validateLocalEnv(values, options);
  try {
    const commands = commandsFor(options, values);
    if (!options.skipInitialBuild) {
      await runOneShot("pnpm", ["turbo", "build", "--filter=./packages/*"]);
    }

    if (options.dryRun) {
      for (const command of commands) {
        writeLine(`$ ${[command.command, ...command.args].join(" ")}`);
      }
      return;
    }

    const children = commands.map((command) => spawnPersistent(command, values));
    const stop = () => {
      stopChildren(children);
    };
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
    try {
      await waitForChildren(children);
    } finally {
      stopChildren(children);
    }
  } finally {
    removeLocalWorkerConfigs();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    writeError(error instanceof Error ? error.message : "Unknown dev runner failure.");
    process.exitCode = 1;
  });
}
