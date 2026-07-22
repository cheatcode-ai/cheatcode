import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runCapturedBoundedCommand } from "./bounded-command";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const COMMAND_TIMEOUT_MS = 5 * 60 * 1_000;
const MAX_OUTPUT_BYTES = 2 * 1_024 * 1_024;
const RELEASE_SHA_PATTERN = /^[0-9a-f]{40}$/u;
const WORKERS = [
  "apps/agent-worker/wrangler.jsonc",
  "apps/webhooks-worker/wrangler.jsonc",
  "apps/preview-proxy/wrangler.jsonc",
  "apps/gateway-worker/wrangler.jsonc",
] as const;

function writeLine(line = ""): void {
  process.stdout.write(`${line}\n`);
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

  const branch = await run("git", ["branch", "--show-current"]);
  if (branch !== "main") throw new Error("Cloudflare deployment is allowed only from main.");

  await run("git", ["fetch", "--quiet", "origin", "main"]);
  const [head, remoteMain] = await Promise.all([
    run("git", ["rev-parse", "HEAD"]),
    run("git", ["rev-parse", "origin/main"]),
  ]);
  if (head !== remoteMain) throw new Error("Local main must exactly match origin/main.");
  if (!RELEASE_SHA_PATTERN.test(head)) throw new Error("Git returned an invalid release SHA.");
  return head;
}

async function deployWorker(configPath: string, releaseSha: string): Promise<void> {
  writeLine(`Deploying ${configPath} at ${releaseSha}.`);
  const output = await run(process.platform === "win32" ? "pnpm.cmd" : "pnpm", [
    "exec",
    "wrangler",
    "deploy",
    "--config",
    configPath,
    "--var",
    `CHEATCODE_RELEASE_SHA:${releaseSha}`,
  ]);
  writeLine(output);
}

async function main(): Promise<void> {
  const releaseSha = await reviewedReleaseSha();
  for (const configPath of WORKERS) {
    await deployWorker(configPath, releaseSha);
  }
  writeLine(`Cloudflare Workers are deployed at ${releaseSha}.`);
}

await main();
