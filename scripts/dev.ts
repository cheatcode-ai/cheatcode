import { type ChildProcess, spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { localWorkerConfigs, removeLocalWorkerConfigs } from "./dev-worker-config";
import { parseEnvFile, validateLocalEnvironment } from "./local-env-contract";

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

const WEB_CHILD_ENV_KEYS = [
  "CLERK_SECRET_KEY",
  "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY",
  "NEXT_PUBLIC_GATEWAY_URL",
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
    port: "3001",
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

function readEnvFileValues(filePath: string): Record<string, string> {
  try {
    return parseEnvFile(readFileSync(filePath, "utf8"));
  } catch {
    throw new Error(`Missing ${relative(ROOT, filePath)}. Run pnpm dev:setup.`);
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
  validateLocalEnvironment(values, options);
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
