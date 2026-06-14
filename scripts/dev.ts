import { type ChildProcess, spawn } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const GATEWAY_WORKER_DIR = join(ROOT, "apps/gateway-worker");
const AGENT_WORKER_DEV_VARS = "apps/agent-worker/.dev.vars";
const WRANGLER_INSPECTOR_PORT = "9239";

interface DevOptions {
  dryRun: boolean;
  port: string;
  skipSandboxCheck: boolean;
  webOnly: boolean;
  workersOnly: boolean;
}

interface CommandSpec {
  args: string[];
  command: string;
  name: string;
}

type ConfigRecord = Record<string, unknown>;
type BooleanOption = "dryRun" | "skipSandboxCheck" | "webOnly" | "workersOnly";

const WORKER_CONFIGS = [
  "wrangler.jsonc",
  "../agent-worker/wrangler.jsonc",
  "../webhooks-worker/wrangler.jsonc",
] as const;

const LOCAL_CLERK_SECRET_FILES = [
  ".env.local",
  "apps/gateway-worker/.dev.vars",
  "apps/webhooks-worker/.dev.vars",
] as const;

const REQUIRED_AGENT_WORKER_SECRETS = [
  "DAYTONA_API_KEY",
  "PREVIEW_TOKEN_SECRET",
  "INTERNAL_MAINTENANCE_SECRET",
  "OUTPUT_DOWNLOAD_SIGNING_SECRET",
] as const;

const SKIPPABLE_SANDBOX_SECRETS = new Set(["DAYTONA_API_KEY", "PREVIEW_TOKEN_SECRET"]);

const BOOLEAN_FLAGS: ReadonlyMap<string, BooleanOption> = new Map([
  ["--dry-run", "dryRun"],
  ["--skip-daytona-check", "skipSandboxCheck"],
  ["--skip-sandbox-check", "skipSandboxCheck"],
  ["--web-only", "webOnly"],
  ["--workers-only", "workersOnly"],
]);

function writeLine(line = ""): void {
  process.stdout.write(`${line}\n`);
}

function writeError(line: string): void {
  process.stderr.write(`${line}\n`);
}

function isRecord(value: unknown): value is ConfigRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function usage(): string {
  return [
    "Usage: pnpm dev -- [--port <next-port>] [--web-only] [--workers-only] [--dry-run] [--skip-sandbox-check]",
    "",
    "Starts apps/web plus one chained Wrangler dev process for all Workers.",
    "The gateway Worker is the only HTTP entrypoint; other Workers are service-bound.",
  ].join("\n");
}

function defaultOptions(): DevOptions {
  return {
    dryRun: false,
    port: "3000",
    skipSandboxCheck: false,
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

function readEnvFileValues(relativePath: string): Record<string, string> {
  const filePath = join(ROOT, relativePath);
  const values: Record<string, string> = {};
  let content: string;
  try {
    content = readFileSync(filePath, "utf8").replace(/^\uFEFF/, "");
  } catch {
    return values;
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

function validateLocalClerkSecrets(): void {
  for (const file of LOCAL_CLERK_SECRET_FILES) {
    const values = readEnvFileValues(file);
    const publishableKey = values["NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY"];
    const secretKey = values["CLERK_SECRET_KEY"];
    if (publishableKey && !publishableKey.startsWith("pk_test_")) {
      throw new Error(`${file} must use a Clerk dev publishable key for pnpm dev.`);
    }
    if (secretKey && !secretKey.startsWith("sk_test_")) {
      throw new Error(`${file} must use a Clerk dev secret key for pnpm dev.`);
    }
  }
}

export function missingLocalAgentWorkerSecrets(
  values: Record<string, string>,
  options: { requireSandbox: boolean },
): string[] {
  return REQUIRED_AGENT_WORKER_SECRETS.filter(
    (key) => (options.requireSandbox || !SKIPPABLE_SANDBOX_SECRETS.has(key)) && !values[key],
  );
}

function validateLocalAgentWorkerSecrets(options: { requireSandbox: boolean }): void {
  const values = readEnvFileValues(AGENT_WORKER_DEV_VARS);
  const missing = missingLocalAgentWorkerSecrets(values, options);
  if (missing.length === 0) {
    return;
  }

  throw new Error(
    [
      `${AGENT_WORKER_DEV_VARS} is missing required local Worker secrets: ${missing.join(", ")}.`,
      options.requireSandbox
        ? "Set DAYTONA_API_KEY + PREVIEW_TOKEN_SECRET (and the maintenance/signing secrets) in the ignored .dev.vars, or pass --skip-sandbox-check."
        : "Set INTERNAL_MAINTENANCE_SECRET and OUTPUT_DOWNLOAD_SIGNING_SECRET before starting local Workers.",
    ].join(" "),
  );
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

function parseArgs(argv: string[]): DevOptions {
  const options = defaultOptions();
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg) {
      throw new Error(`Missing argument at index ${index}.`);
    }
    const portIndex = applyPortOption(options, argv, index);
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
    throw new Error(`Unknown argument: ${arg}`);
  }

  if (options.webOnly && options.workersOnly) {
    throw new Error("--web-only and --workers-only cannot be combined.");
  }
  return options;
}

function createLocalWorkerConfig(configPath: string): string {
  const absolutePath = resolve(GATEWAY_WORKER_DIR, configPath);
  const parsed = JSON.parse(readFileSync(absolutePath, "utf8")) as unknown;
  if (!isRecord(parsed)) {
    throw new Error(`${configPath} must parse to a JSON object.`);
  }

  const { secrets_store_secrets: _secretsStoreSecrets, ...localConfig } = parsed;
  const localDevConfig = applyLocalWorkerOverrides(configPath, localConfig);

  const outputDir = dirname(absolutePath);
  mkdirSync(outputDir, { recursive: true });
  const outputPath = join(outputDir, "wrangler.local-dev.generated.jsonc");
  writeFileSync(outputPath, `${JSON.stringify(localDevConfig, null, 2)}\n`);
  return relative(GATEWAY_WORKER_DIR, outputPath);
}

function applyLocalWorkerOverrides(configPath: string, config: ConfigRecord): ConfigRecord {
  if (configPath !== "../agent-worker/wrangler.jsonc") {
    return config;
  }
  const existingVars = isRecord(config["vars"]) ? config["vars"] : {};
  return {
    ...config,
    vars: {
      ...existingVars,
      PREVIEW_HOSTNAME: "localhost:8787",
    },
  };
}

function localWorkerConfigs(): string[] {
  return WORKER_CONFIGS.map(createLocalWorkerConfig);
}

function commandsFor(options: DevOptions): CommandSpec[] {
  const commands: CommandSpec[] = [];
  if (!options.workersOnly) {
    commands.push({
      name: "web",
      command: "pnpm",
      args: ["--dir", "apps/web", "exec", "next", "dev", "--webpack", "--port", options.port],
    });
  }
  if (!options.webOnly) {
    const workerConfigs = localWorkerConfigs();
    commands.push({
      name: "workers",
      command: "pnpm",
      args: [
        "--dir",
        "apps/gateway-worker",
        "exec",
        "wrangler",
        "dev",
        "--port",
        "8787",
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
    const child = spawn(command, args, { cwd: ROOT, stdio: "inherit" });
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

function spawnPersistent(spec: CommandSpec): ChildProcess {
  writeLine(`$ ${[spec.command, ...spec.args].join(" ")}`);
  return spawn(spec.command, spec.args, {
    cwd: ROOT,
    env: { ...process.env, FORCE_COLOR: "1" },
    stdio: "inherit",
  });
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
  const commands = commandsFor(options);

  await runOneShot("pnpm", ["turbo", "skills:build"]);
  if (!options.webOnly) {
    validateLocalClerkSecrets();
    validateLocalAgentWorkerSecrets({ requireSandbox: !options.skipSandboxCheck });
  }

  if (options.dryRun) {
    for (const command of commands) {
      writeLine(`$ ${[command.command, ...command.args].join(" ")}`);
    }
    return;
  }

  const children = commands.map(spawnPersistent);
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
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    writeError(error instanceof Error ? error.message : "Unknown dev runner failure.");
    process.exitCode = 1;
  });
}
