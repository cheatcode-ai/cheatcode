import { spawn, spawnSync } from "node:child_process";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readOption, readRequiredOptionValue } from "./cli-options";
import { isRecord, parseJsoncObject } from "./jsonc";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PRODUCTION_APPROVAL_ENV = "CHEATCODE_PROD_DEPLOY_APPROVED";
const GIT_SHA_PATTERN = /^[0-9a-f]{40}$/u;
const GATEWAY_HEALTH_URL = "https://gateway.trycheatcode.com/health";
const GENERATED_WRANGLER_CONFIG_PREFIX = "wrangler.production";
const HEALTH_MAX_ATTEMPTS = 24;
const HEALTH_POLL_INTERVAL_MS = 5_000;

type WorkerKey = "gateway" | "agent" | "webhooks" | "preview-proxy";
type GatewayReleaseGate = "closed" | "open";
type GatewayBarrierState = "gateway-closed" | "agent-current" | "gateway-open";

interface WorkerSpec {
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

interface DeploymentStep {
  gatewayReleaseGate?: GatewayReleaseGate;
  worker: WorkerKey;
}

interface GatewayHealthObservation {
  body: unknown;
  status: number;
}

const PLAN_ORDER: readonly WorkerKey[] = ["gateway", "agent", "webhooks", "preview-proxy"];
const DEPLOYMENT_STEPS: readonly DeploymentStep[] = [
  { gatewayReleaseGate: "closed", worker: "gateway" },
  { worker: "agent" },
  { gatewayReleaseGate: "open", worker: "gateway" },
  { worker: "webhooks" },
  { worker: "preview-proxy" },
];

const WORKERS: Record<WorkerKey, WorkerSpec> = {
  gateway: {
    packageName: "@cheatcode/gateway-worker",
    workerDir: "apps/gateway-worker",
  },
  agent: {
    packageName: "@cheatcode/agent-worker",
    workerDir: "apps/agent-worker",
  },
  webhooks: {
    packageName: "@cheatcode/webhooks-worker",
    workerDir: "apps/webhooks-worker",
  },
  "preview-proxy": {
    packageName: "@cheatcode/preview-proxy",
    workerDir: "apps/preview-proxy",
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
    "Runs the Cloudflare backend behind a fail-closed gateway release barrier.",
    "Order: gateway closed, agent, gateway open, webhooks, preview-proxy.",
    "The coordinated production workflow deploys the exact same commit to Vercel separately.",
    `Dry-run is the default. Pass --apply and ${PRODUCTION_APPROVAL_ENV}=true to deploy the backend.`,
    "Production applies always include the complete Worker set; --worker is dry-run only.",
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

function run(command: string, args: string[], cwd = ROOT): Promise<void> {
  writeLine(`$ ${[command, ...args].join(" ")}`);
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: process.env,
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

async function buildDeployable(spec: WorkerSpec): Promise<void> {
  await run("pnpm", ["turbo", "build", `--filter=${spec.packageName}`]);
}

async function runDeployCommand(
  step: DeploymentStep,
  spec: WorkerSpec,
  options: DeployOptions,
  releaseSha: string,
): Promise<void> {
  const workerDir = join(ROOT, spec.workerDir);
  const configPath = createDeploymentConfig(step, spec, releaseSha);
  try {
    await runWranglerDeploy(step, options, releaseSha, workerDir, configPath);
  } finally {
    rmSync(configPath, { force: true });
  }
}

async function runWranglerDeploy(
  step: DeploymentStep,
  options: DeployOptions,
  releaseSha: string,
  workerDir: string,
  configPath: string,
): Promise<void> {
  const deployArgs = ["exec", "wrangler", "deploy", "--config", configPath, "--strict"];
  if (!options.apply) {
    deployArgs.push("--dry-run");
  } else {
    deployArgs.push(
      "--tag",
      deploymentTag(step, releaseSha),
      "--message",
      `release ${releaseSha} (${stepDescription(step)})`,
    );
  }

  await run("pnpm", deployArgs, workerDir);
}

function createDeploymentConfig(
  step: DeploymentStep,
  spec: WorkerSpec,
  releaseSha: string,
): string {
  const workerDir = join(ROOT, spec.workerDir);
  const sourcePath = join(workerDir, "wrangler.jsonc");
  const config = parseJsoncObject(readFileSync(sourcePath, "utf8"), sourcePath);
  const vars = config["vars"];
  if (!isRecord(vars) || vars["CHEATCODE_ENVIRONMENT"] !== "production") {
    throw new Error(`${sourcePath} must declare production Worker vars.`);
  }
  const releaseVars: Record<string, unknown> = {
    ...vars,
    CHEATCODE_RELEASE_SHA: releaseSha,
  };
  if (step.worker === "gateway") {
    releaseVars["CHEATCODE_RELEASE_GATE"] = step.gatewayReleaseGate ?? "open";
  }
  const phase = step.gatewayReleaseGate ?? "release";
  const outputPath = join(
    workerDir,
    `${GENERATED_WRANGLER_CONFIG_PREFIX}.${process.pid}.${phase}.generated.json`,
  );
  writeFileSync(outputPath, `${JSON.stringify({ ...config, vars: releaseVars }, null, 2)}\n`, {
    mode: 0o600,
  });
  return outputPath;
}

async function deployStep(
  step: DeploymentStep,
  options: DeployOptions,
  releaseSha: string,
): Promise<void> {
  const spec = WORKERS[step.worker];
  writeLine("");
  writeLine(`== ${stepDescription(step)} ==`);

  await runDeployCommand(step, spec, options, releaseSha);
  if (options.apply) {
    await verifyReleaseBarrier(step, releaseSha);
  }
}

async function deploySelectedSteps(
  steps: DeploymentStep[],
  options: DeployOptions,
  releaseSha: string,
): Promise<void> {
  let isGatewayBarrierActive = false;
  try {
    for (const step of steps) {
      if (options.apply && isGatewayCloseStep(step)) {
        isGatewayBarrierActive = true;
      }
      await deployStep(step, options, releaseSha);
      if (options.apply && isGatewayOpenStep(step)) {
        isGatewayBarrierActive = false;
      }
    }
  } catch (error) {
    if (isGatewayBarrierActive) {
      const recovery = await restoreClosedGateway(releaseSha, options);
      throw closedGatewayReleaseError(error, releaseSha, recovery);
    }
    throw error;
  }
}

interface GatewayCloseRecovery {
  error?: string;
  verified: boolean;
}

async function restoreClosedGateway(
  releaseSha: string,
  options: DeployOptions,
): Promise<GatewayCloseRecovery> {
  const closeStep: DeploymentStep = { gatewayReleaseGate: "closed", worker: "gateway" };
  writeError("Release failed inside the gateway barrier; restoring and verifying the closed gate.");
  try {
    await runDeployCommand(closeStep, WORKERS.gateway, options, releaseSha);
    await waitForGatewayState("gateway-closed", releaseSha);
    return { verified: true };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "Unknown close-gate recovery failure.",
      verified: false,
    };
  }
}

function isGatewayCloseStep(step: DeploymentStep): boolean {
  return step.worker === "gateway" && step.gatewayReleaseGate === "closed";
}

function isGatewayOpenStep(step: DeploymentStep): boolean {
  return step.worker === "gateway" && step.gatewayReleaseGate === "open";
}

function closedGatewayReleaseError(
  error: unknown,
  releaseSha: string,
  recovery: GatewayCloseRecovery,
): Error {
  const cause = error instanceof Error ? error.message : "Unknown deployment failure.";
  const gateState = recovery.verified
    ? `The public gateway was re-deployed and verified CLOSED for ${releaseSha}.`
    : `GATEWAY STATE IS UNCONFIRMED for ${releaseSha}; inspect /health immediately. Close-gate recovery failed: ${recovery.error ?? "unknown failure"}.`;
  return new Error(
    [
      "PRODUCTION RELEASE STOPPED.",
      gateState,
      "Do not manually open it against an unverified agent version.",
      "Recover by rerunning this same immutable release after fixing the cause.",
      "If abandoning the release, keep gateway closed, perform a reviewed rollback of agent if it changed, then roll gateway back to the matching known-good open version and verify /health.",
      `Cause: ${cause}`,
    ].join(" "),
  );
}

async function buildSelectedWorkers(options: DeployOptions): Promise<void> {
  if (options.skipBuild) {
    return;
  }
  for (const worker of options.workers) {
    writeLine("");
    writeLine(`== build ${worker} ==`);
    await buildDeployable(WORKERS[worker]);
  }
}

function selectedDeploymentSteps(options: DeployOptions): DeploymentStep[] {
  return DEPLOYMENT_STEPS.filter((step) => options.workers.includes(step.worker));
}

function stepDescription(step: DeploymentStep): string {
  return step.gatewayReleaseGate
    ? `${step.worker} (release gate ${step.gatewayReleaseGate})`
    : step.worker;
}

function deploymentTag(step: DeploymentStep, releaseSha: string): string {
  const phase = step.gatewayReleaseGate ? `${step.worker}-${step.gatewayReleaseGate}` : step.worker;
  return `${releaseSha}-${phase}`;
}

async function verifyReleaseBarrier(step: DeploymentStep, releaseSha: string): Promise<void> {
  if (step.worker === "gateway" && step.gatewayReleaseGate === "closed") {
    await waitForGatewayState("gateway-closed", releaseSha);
    return;
  }
  if (step.worker === "agent") {
    await waitForGatewayState("agent-current", releaseSha);
    return;
  }
  if (step.worker === "gateway" && step.gatewayReleaseGate === "open") {
    await waitForGatewayState("gateway-open", releaseSha);
  }
}

async function waitForGatewayState(
  expectedState: GatewayBarrierState,
  releaseSha: string,
): Promise<void> {
  for (let attempt = 1; attempt <= HEALTH_MAX_ATTEMPTS; attempt += 1) {
    const observation = await readGatewayHealth();
    if (observation && gatewayStateMatches(observation, expectedState, releaseSha)) {
      writeLine(`Verified ${expectedState} for ${releaseSha}.`);
      return;
    }
    writeLine(
      `Waiting for ${expectedState} (${attempt}/${HEALTH_MAX_ATTEMPTS})${describeObservation(observation)}.`,
    );
    if (attempt < HEALTH_MAX_ATTEMPTS) {
      await delay(HEALTH_POLL_INTERVAL_MS);
    }
  }
  throw new Error(`Gateway did not reach ${expectedState} for ${releaseSha}.`);
}

async function readGatewayHealth(): Promise<GatewayHealthObservation | undefined> {
  try {
    const response = await fetch(GATEWAY_HEALTH_URL, {
      headers: { Accept: "application/json", "Cache-Control": "no-cache" },
      signal: AbortSignal.timeout(15_000),
    });
    return { body: (await response.json()) as unknown, status: response.status };
  } catch {
    return undefined;
  }
}

function gatewayStateMatches(
  observation: GatewayHealthObservation,
  expectedState: GatewayBarrierState,
  releaseSha: string,
): boolean {
  if (expectedState === "gateway-open") {
    const body = observation.body;
    return (
      observation.status === 200 &&
      isRecord(body) &&
      body["ok"] === true &&
      body["releaseSha"] === releaseSha &&
      agentReleaseSha(body["agent"]) === releaseSha
    );
  }
  const details = releaseGateDetails(observation.body);
  if (
    observation.status !== 503 ||
    !details ||
    details["releaseGate"] !== "closed" ||
    details["releaseSha"] !== releaseSha ||
    details["worker"] !== "gateway"
  ) {
    return false;
  }
  return expectedState === "gateway-closed" || agentReleaseSha(details["agent"]) === releaseSha;
}

function releaseGateDetails(body: unknown): Record<string, unknown> | undefined {
  if (!isRecord(body) || !isRecord(body["error"])) {
    return undefined;
  }
  const error = body["error"];
  if (error["code"] !== "unavailable_maintenance" || !isRecord(error["details"])) {
    return undefined;
  }
  return error["details"];
}

function agentReleaseSha(agent: unknown): string | undefined {
  return isRecord(agent) && typeof agent["releaseSha"] === "string"
    ? agent["releaseSha"]
    : undefined;
}

function describeObservation(observation: GatewayHealthObservation | undefined): string {
  if (!observation) {
    return "; health request unavailable";
  }
  const body = isRecord(observation.body) ? observation.body : undefined;
  const details = releaseGateDetails(observation.body);
  const gatewaySha = body?.["releaseSha"] ?? details?.["releaseSha"] ?? "unknown";
  const agentSha = agentReleaseSha(body?.["agent"] ?? details?.["agent"]) ?? "unknown";
  return `; status=${observation.status}, gateway=${String(gatewaySha)}, agent=${agentSha}`;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
}

function resolveReleaseSha(): string {
  const workflowSha = process.env["GITHUB_SHA"]?.trim();
  if (workflowSha) {
    if (!GIT_SHA_PATTERN.test(workflowSha)) {
      throw new Error("GITHUB_SHA must be a full lowercase 40-character Git commit SHA.");
    }
    return workflowSha;
  }
  const result = spawnSync("git", ["rev-parse", "HEAD"], {
    cwd: ROOT,
    encoding: "utf8",
  });
  const localSha = result.stdout.trim();
  if (result.status !== 0 || !GIT_SHA_PATTERN.test(localSha)) {
    throw new Error("Could not resolve a full Git commit SHA for the release metadata.");
  }
  return localSha;
}

function assertImmutableReleaseSource(releaseSha: string): void {
  const head = spawnSync("git", ["rev-parse", "HEAD"], {
    cwd: ROOT,
    encoding: "utf8",
  });
  if (head.status !== 0 || head.stdout.trim() !== releaseSha) {
    throw new Error("Release metadata does not match the checked-out Git commit.");
  }

  const status = spawnSync("git", ["status", "--porcelain=v1", "--untracked-files=all"], {
    cwd: ROOT,
    encoding: "utf8",
  });
  if (status.status !== 0) {
    throw new Error("Could not verify that the release worktree is clean.");
  }
  if (status.stdout.trim()) {
    throw new Error(
      "Refusing to label a dirty worktree as an immutable release. Commit every release file first.",
    );
  }
}

function assertCompleteProductionPlan(options: DeployOptions): void {
  if (
    options.workers.length !== PLAN_ORDER.length ||
    options.workers.some((worker, index) => worker !== PLAN_ORDER[index])
  ) {
    throw new Error(
      "Production deploys require the complete coordinated Worker set; --worker is dry-run only.",
    );
  }
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const releaseSha = resolveReleaseSha();
  if (options.apply && process.env[PRODUCTION_APPROVAL_ENV] !== "true") {
    throw new Error(
      `Refusing production deploy. Set ${PRODUCTION_APPROVAL_ENV}=true only after explicit user approval.`,
    );
  }
  if (options.apply) {
    assertCompleteProductionPlan(options);
    assertImmutableReleaseSource(releaseSha);
  }
  writeLine(options.apply ? "Deploying Cloudflare backend." : "Cloudflare backend dry-run.");
  writeLine(`Release: ${releaseSha}`);
  const steps = selectedDeploymentSteps(options);
  writeLine(`Order: ${steps.map(stepDescription).join(" -> ")}`);

  await buildSelectedWorkers(options);
  await deploySelectedSteps(steps, options, releaseSha);
}

main().catch((error: unknown) => {
  writeError(error instanceof Error ? error.message : "Unknown deploy-phased failure.");
  process.exitCode = 1;
});
