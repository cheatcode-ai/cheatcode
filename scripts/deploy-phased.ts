import { spawn } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readOption, readRequiredOptionValue } from "./cli-options";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PRODUCTION_GATEWAY_URL = "https://gateway.trycheatcode.com";
const PRODUCTION_APPROVAL_ENV = "CHEATCODE_PROD_DEPLOY_APPROVED";
const WEB_PUBLIC_ENV_KEYS = [
  "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY",
  "NEXT_PUBLIC_POLAR_PRO_MONTHLY_PRODUCT_ID",
] as const;

type WorkerKey = "web" | "gateway" | "webhooks" | "agent";
type DeployKind = "opennext" | "wrangler";
type CommandEnv = Readonly<Record<string, string>>;

interface WorkerSpec {
  deployKind: DeployKind;
  packageName: string;
  workerDir: string;
}

interface DeployOptions {
  apply: boolean;
  skipBuild: boolean;
  workers: WorkerKey[];
}

interface DeployArgState {
  apply: boolean;
  rawWorkers?: string;
  skipBuild: boolean;
}

const PLAN_ORDER: readonly WorkerKey[] = ["agent", "gateway", "web", "webhooks"];

const WORKERS: Record<WorkerKey, WorkerSpec> = {
  web: {
    deployKind: "opennext",
    packageName: "@cheatcode/web",
    workerDir: "apps/web",
  },
  gateway: {
    deployKind: "wrangler",
    packageName: "@cheatcode/gateway-worker",
    workerDir: "apps/gateway-worker",
  },
  webhooks: {
    deployKind: "wrangler",
    packageName: "@cheatcode/webhooks-worker",
    workerDir: "apps/webhooks-worker",
  },
  agent: {
    deployKind: "wrangler",
    packageName: "@cheatcode/agent-worker",
    workerDir: "apps/agent-worker",
  },
};

function writeLine(line = ""): void {
  process.stdout.write(`${line}\n`);
}

function writeError(line: string): void {
  process.stderr.write(`${line}\n`);
}

function usage(): string {
  return [
    "Usage: pnpm deploy:workers -- [--worker <name>[,<name>]] [--apply] [--skip-build]",
    "",
    "Runs Cloudflare deployables in the plan.md first-time order: agent, gateway, web, webhooks.",
    `Dry-run is the default. Pass --apply and ${PRODUCTION_APPROVAL_ENV}=true to deploy to Cloudflare.`,
  ].join("\n");
}

function workerFromRaw(raw: string): WorkerKey {
  const normalized = raw.trim().replace(/-worker$/, "");
  if (normalized in WORKERS) {
    return normalized as WorkerKey;
  }
  throw new Error(`Unknown worker "${raw}". Expected one of: ${PLAN_ORDER.join(", ")}.`);
}

function parseWorkers(raw: string | undefined): WorkerKey[] {
  if (!raw) {
    return [...PLAN_ORDER];
  }

  const selected = raw
    .split(",")
    .map(workerFromRaw)
    .filter((worker, index, workers) => workers.indexOf(worker) === index);
  return PLAN_ORDER.filter((worker) => selected.includes(worker));
}

function parseArgs(argv: string[]): DeployOptions {
  const state: DeployArgState = {
    apply: false,
    skipBuild: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const option = readOption(argv, index);
    index = applyOption(argv, index, option, state);
  }

  return {
    apply: state.apply,
    skipBuild: state.skipBuild,
    workers: parseWorkers(state.rawWorkers),
  };
}

function applyOption(
  argv: string[],
  index: number,
  option: ReturnType<typeof readOption>,
  state: DeployArgState,
): number {
  switch (option.name) {
    case "--":
      return index;
    case "--apply":
      state.apply = true;
      return index;
    case "--skip-build":
      state.skipBuild = true;
      return index;
    case "--help":
    case "-h":
      writeLine(usage());
      return process.exit(0);
    case "--worker":
      return applyWorkerOption(argv, index, option, state);
    default:
      throw new Error(`Unknown argument: ${option.name}`);
  }
}

function applyWorkerOption(
  argv: string[],
  index: number,
  option: ReturnType<typeof readOption>,
  state: DeployArgState,
): number {
  const parsed = readRequiredOptionValue(argv, index, option, "a worker name.");
  state.rawWorkers = parsed.value;
  return parsed.nextIndex;
}

function run(command: string, args: string[], cwd = ROOT, env?: CommandEnv): Promise<void> {
  writeLine(`$ ${[command, ...args].join(" ")}`);
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: env ? { ...process.env, ...env } : process.env,
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

function webProductionEnv(): CommandEnv {
  const env: Record<string, string> = {
    NEXT_PUBLIC_GATEWAY_URL: PRODUCTION_GATEWAY_URL,
  };
  for (const key of WEB_PUBLIC_ENV_KEYS) {
    const value = process.env[key]?.trim();
    if (!value) {
      throw new Error(`${key} must be set before building or deploying cheatcode-web.`);
    }
    env[key] = value;
  }
  return env;
}

async function buildDeployable(spec: WorkerSpec): Promise<void> {
  if (spec.deployKind === "opennext") {
    await run("pnpm", ["--filter", spec.packageName, "build"], ROOT, webProductionEnv());
    return;
  }

  await run("pnpm", ["turbo", "build", `--filter=${spec.packageName}`]);
}

async function runDeployCommand(spec: WorkerSpec, options: DeployOptions): Promise<void> {
  const workerDir = join(ROOT, spec.workerDir);
  if (spec.deployKind === "opennext") {
    await runOpenNextDeploy(options, workerDir);
    return;
  }

  await runWranglerDeploy(options, workerDir);
}

async function runOpenNextDeploy(options: DeployOptions, workerDir: string): Promise<void> {
  const env = webProductionEnv();
  if (options.apply) {
    await run("pnpm", ["exec", "opennextjs-cloudflare", "deploy"], workerDir, env);
    return;
  }

  await run(
    "pnpm",
    ["exec", "wrangler", "deploy", "--config", "wrangler.jsonc", "--strict", "--dry-run"],
    workerDir,
    env,
  );
}

async function runWranglerDeploy(options: DeployOptions, workerDir: string): Promise<void> {
  const deployArgs = ["exec", "wrangler", "deploy", "--config", "wrangler.jsonc", "--strict"];
  if (!options.apply) {
    deployArgs.push("--dry-run");
  }

  await run("pnpm", deployArgs, workerDir);
}

async function deployWorker(worker: WorkerKey, options: DeployOptions): Promise<void> {
  const spec = WORKERS[worker];
  writeLine("");
  writeLine(`== ${worker} ==`);

  if (!options.skipBuild) {
    await buildDeployable(spec);
  }

  await runDeployCommand(spec, options);
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  if (options.apply && process.env[PRODUCTION_APPROVAL_ENV] !== "true") {
    throw new Error(
      `Refusing production deploy. Set ${PRODUCTION_APPROVAL_ENV}=true only after explicit user approval.`,
    );
  }
  writeLine(options.apply ? "Deploying Workers to Cloudflare." : "Workers deploy dry-run.");
  writeLine(`Order: ${options.workers.join(" -> ")}`);

  for (const worker of options.workers) {
    await deployWorker(worker, options);
  }
}

main().catch((error: unknown) => {
  writeError(error instanceof Error ? error.message : "Unknown deploy-phased failure.");
  process.exitCode = 1;
});
