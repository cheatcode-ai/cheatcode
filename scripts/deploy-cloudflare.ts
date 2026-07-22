import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { runCapturedBoundedCommand } from "./bounded-command";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const COMMAND_TIMEOUT_MS = 5 * 60 * 1_000;
const MAX_OUTPUT_BYTES = 2 * 1_024 * 1_024;
const RELEASE_SHA_PATTERN = /^[0-9a-f]{40}$/u;
const PNPM = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

interface WorkerTarget {
  configPath: string;
  packageName: string;
}

const AGENT_WORKER = {
  configPath: "apps/agent-worker/wrangler.jsonc",
  packageName: "@cheatcode/agent-worker",
} as const satisfies WorkerTarget;
const WEBHOOKS_WORKER = {
  configPath: "apps/webhooks-worker/wrangler.jsonc",
  packageName: "@cheatcode/webhooks-worker",
} as const satisfies WorkerTarget;
const GATEWAY_WORKER = {
  configPath: "apps/gateway-worker/wrangler.jsonc",
  packageName: "@cheatcode/gateway-worker",
} as const satisfies WorkerTarget;
const PREVIEW_PROXY = {
  configPath: "apps/preview-proxy/wrangler.jsonc",
  packageName: "@cheatcode/preview-proxy",
} as const satisfies WorkerTarget;
const CORE_WORKERS = [AGENT_WORKER, WEBHOOKS_WORKER, GATEWAY_WORKER] as const;
const ALL_WORKERS = [...CORE_WORKERS, PREVIEW_PROXY] as const;
const CORE_PACKAGE_NAMES = new Set(CORE_WORKERS.map((worker) => worker.packageName));

const deploymentsSchema = z.array(
  z.object({
    versions: z.array(
      z.object({
        percentage: z.number(),
        version_id: z.string().min(1),
      }),
    ),
  }),
);
const versionSchema = z.object({
  resources: z.object({
    bindings: z.array(
      z.object({
        name: z.string(),
        text: z.string().optional(),
      }),
    ),
  }),
});
const turboScopeSchema = z.object({ packages: z.array(z.string()) });

function writeLine(line = ""): void {
  process.stdout.write(`${line}\n`);
}

function writeWarning(message: string): void {
  process.stderr.write(`Warning: ${message}\n`);
}

async function run(command: string, args: readonly string[]): Promise<string> {
  const result = await runCapturedBoundedCommand(command, args, {
    cwd: ROOT,
    maxOutputBytes: MAX_OUTPUT_BYTES,
    timeoutMs: COMMAND_TIMEOUT_MS,
  });
  if (result.code !== 0) {
    process.stderr.write(result.output);
    throw new Error(`${command} exited with status ${result.code}.`);
  }
  return result.stdout.trim();
}

async function reviewedReleaseSha(): Promise<string> {
  const status = await run("git", ["status", "--porcelain"]);
  if (status) throw new Error("Cloudflare deployment requires a clean worktree.");

  const head = await run("git", ["rev-parse", "HEAD"]);
  if (!RELEASE_SHA_PATTERN.test(head)) throw new Error("Git returned an invalid release SHA.");
  return head;
}

function latestVersionId(input: unknown): string {
  const deployments = deploymentsSchema.parse(input);
  const deployment = deployments.at(-1);
  const version = deployment?.versions.find((candidate) => candidate.percentage === 100);
  if (!version) throw new Error("Cloudflare returned no fully deployed Worker version.");
  return version.version_id;
}

async function deployedReleaseSha(worker: WorkerTarget): Promise<string | null> {
  try {
    const deployments = JSON.parse(
      await run(PNPM, [
        "exec",
        "wrangler",
        "deployments",
        "list",
        "--config",
        worker.configPath,
        "--json",
      ]),
    );
    const versionId = latestVersionId(deployments);
    const version = versionSchema.parse(
      JSON.parse(
        await run(PNPM, [
          "exec",
          "wrangler",
          "versions",
          "view",
          versionId,
          "--config",
          worker.configPath,
          "--json",
        ]),
      ),
    );
    const releaseSha = version.resources.bindings.find(
      (binding) => binding.name === "CHEATCODE_RELEASE_SHA",
    )?.text;
    return releaseSha && RELEASE_SHA_PATTERN.test(releaseSha) ? releaseSha : null;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    writeWarning(`Could not read ${worker.packageName} release metadata: ${message}`);
    return null;
  }
}

async function isAncestor(baseSha: string, headSha: string): Promise<boolean> {
  const result = await runCapturedBoundedCommand(
    "git",
    ["merge-base", "--is-ancestor", baseSha, headSha],
    { cwd: ROOT, maxOutputBytes: MAX_OUTPUT_BYTES, timeoutMs: COMMAND_TIMEOUT_MS },
  );
  if (result.code === 0) return true;
  if (result.code === 1) return false;
  process.stderr.write(result.output);
  throw new Error(`git merge-base exited with status ${result.code}.`);
}

async function changedFiles(baseSha: string, headSha: string): Promise<readonly string[]> {
  const output = await run("git", ["diff", "--name-only", "--diff-filter=ACMR", baseSha, headSha]);
  return output ? output.split("\n") : [];
}

function turboFilters(files: readonly string[], baseSha: string, headSha: string): string[] {
  const filters = [`--filter=...[${baseSha}...${headSha}]`];
  const hasSkillSourceChange = files.some(
    (file) => file.startsWith("skills/") || file === "scripts/build-skills.ts",
  );
  if (hasSkillSourceChange) filters.push("--filter=...@cheatcode/skills");
  return filters;
}

async function affectedPackages(baseSha: string, headSha: string): Promise<Set<string> | null> {
  if (!(await isAncestor(baseSha, headSha))) return null;
  const files = await changedFiles(baseSha, headSha);
  const output = await run(PNPM, [
    "exec",
    "turbo",
    "run",
    "build",
    ...turboFilters(files, baseSha, headSha),
    "--dry-run=json",
  ]);
  const scope = turboScopeSchema.parse(JSON.parse(output));
  return new Set(scope.packages.filter((packageName) => packageName !== "//"));
}

function sharedCoreBaseline(releases: ReadonlyMap<string, string | null>): string | null {
  const values = CORE_WORKERS.map((worker) => releases.get(worker.packageName) ?? null);
  const first = values[0];
  return first && values.every((value) => value === first) ? first : null;
}

async function shouldDeploy(
  baselineSha: string | null,
  releaseSha: string,
  packageNames: ReadonlySet<string>,
): Promise<boolean> {
  if (!baselineSha) return true;
  const packages = await affectedPackages(baselineSha, releaseSha);
  if (!packages) return true;
  return [...packageNames].some((packageName) => packages.has(packageName));
}

async function deployWorker(worker: WorkerTarget, releaseSha: string): Promise<void> {
  writeLine(`Deploying ${worker.packageName} at ${releaseSha}.`);
  const output = await run(PNPM, [
    "exec",
    "wrangler",
    "deploy",
    "--config",
    worker.configPath,
    "--var",
    `CHEATCODE_RELEASE_SHA:${releaseSha}`,
  ]);
  writeLine(output);
}

async function deploymentPlan(releaseSha: string): Promise<readonly WorkerTarget[]> {
  const deployedEntries = await Promise.all(
    ALL_WORKERS.map(
      async (worker) => [worker.packageName, await deployedReleaseSha(worker)] as const,
    ),
  );
  const releases = new Map(deployedEntries);
  const deployCore = await shouldDeploy(
    sharedCoreBaseline(releases),
    releaseSha,
    CORE_PACKAGE_NAMES,
  );
  const previewBaseline = releases.get(PREVIEW_PROXY.packageName) ?? null;
  const deployPreview = await shouldDeploy(
    previewBaseline,
    releaseSha,
    new Set([PREVIEW_PROXY.packageName]),
  );

  if (deployCore && deployPreview)
    return [AGENT_WORKER, WEBHOOKS_WORKER, PREVIEW_PROXY, GATEWAY_WORKER];
  if (deployCore) return CORE_WORKERS;
  if (deployPreview) return [PREVIEW_PROXY];
  return [];
}

async function main(): Promise<void> {
  const releaseSha = await reviewedReleaseSha();
  const workers = await deploymentPlan(releaseSha);
  if (workers.length === 0) {
    writeLine(
      `No Cloudflare Worker changes since the deployed releases; ${releaseSha} is a no-op.`,
    );
    return;
  }
  for (const worker of workers) await deployWorker(worker, releaseSha);
  writeLine(`Deployed ${workers.length} affected Cloudflare Worker(s) at ${releaseSha}.`);
}

await main();
