import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

interface WorkerBudget {
  directory: string;
  gzipKiB: number;
}

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const WORKER_BUDGETS: readonly WorkerBudget[] = [
  { directory: "apps/agent-worker", gzipKiB: 2_600 },
  { directory: "apps/artifact-worker", gzipKiB: 240 },
  { directory: "apps/gateway-worker", gzipKiB: 475 },
  { directory: "apps/preview-proxy", gzipKiB: 150 },
  { directory: "apps/webhooks-worker", gzipKiB: 475 },
];
const AGENT_STARTUP_BUDGET_MS = 900;

for (const budget of WORKER_BUDGETS) {
  const output = runWrangler(budget.directory, ["deploy", "--dry-run"]);
  const gzipKiB = parseGzipKiB(output, budget.directory);
  if (gzipKiB > budget.gzipKiB) {
    throw new Error(
      `${budget.directory} gzip upload ${gzipKiB.toFixed(2)} KiB exceeds ${budget.gzipKiB} KiB`,
    );
  }
  console.info(`${budget.directory}: ${gzipKiB.toFixed(2)} / ${budget.gzipKiB} KiB gzip`);
}

const profileDirectory = mkdtempSync(join(tmpdir(), "cheatcode-worker-startup-"));
try {
  const profilePath = join(profileDirectory, "agent.cpuprofile");
  runWrangler("apps/agent-worker", ["check", "startup", "--outfile", profilePath]);
  const startupMs = readProfileDurationMs(profilePath);
  if (startupMs > AGENT_STARTUP_BUDGET_MS) {
    throw new Error(
      `apps/agent-worker local startup profile ${startupMs.toFixed(2)} ms exceeds ${AGENT_STARTUP_BUDGET_MS} ms`,
    );
  }
  console.info(
    `apps/agent-worker: ${startupMs.toFixed(2)} / ${AGENT_STARTUP_BUDGET_MS} ms local startup profile`,
  );
} finally {
  rmSync(profileDirectory, { force: true, recursive: true });
}

function runWrangler(directory: string, args: readonly string[]): string {
  const result = spawnSync("pnpm", ["exec", "wrangler", ...args], {
    cwd: resolve(ROOT, directory),
    encoding: "utf8",
    env: process.env,
    maxBuffer: 32 * 1024 * 1024,
  });
  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  if (result.status !== 0) {
    throw new Error(`${directory} wrangler ${args.join(" ")} failed\n${output}`);
  }
  return output;
}

function parseGzipKiB(output: string, directory: string): number {
  const match = /Total Upload:\s+[\d.]+\s+KiB\s+\/\s+gzip:\s+([\d.]+)\s+KiB/u.exec(output);
  const value = match?.[1] ? Number(match[1]) : Number.NaN;
  if (!Number.isFinite(value)) {
    throw new Error(`Could not read Wrangler gzip size for ${directory}`);
  }
  return value;
}

function readProfileDurationMs(path: string): number {
  const profile = JSON.parse(readFileSync(path, "utf8")) as unknown;
  if (!isRecord(profile)) {
    throw new Error("Wrangler startup profile is not an object");
  }
  const startTime = profile["startTime"];
  const endTime = profile["endTime"];
  if (typeof startTime !== "number" || typeof endTime !== "number" || endTime < startTime) {
    throw new Error("Wrangler startup profile is missing valid timestamps");
  }
  return (endTime - startTime) / 1_000;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
