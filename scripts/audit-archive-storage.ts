import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { rm, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

interface CommandResult {
  code: number;
  stderr: string;
  stdout: string;
}

export interface ArchiveObjectIdentity {
  sha256: string;
  sizeBytes: number;
}

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const MAX_ATTEMPTS = 4;

export async function uploadAndVerifyArchive(
  accountId: string,
  bucket: string,
  key: string,
  filePath: string,
  verifyPath: string,
  expected: ArchiveObjectIdentity,
): Promise<void> {
  await runCheckedWithRetry(accountId, "pnpm", [
    "exec",
    "wrangler",
    "r2",
    "object",
    "put",
    `${bucket}/${key}`,
    "--file",
    filePath,
    "--content-type",
    "application/x-ndjson",
    "--content-encoding",
    "gzip",
    "--remote",
    "--force",
  ]);
  await verifyRemoteArchive(accountId, bucket, key, verifyPath, expected);
}

export async function verifyRemoteArchive(
  accountId: string,
  bucket: string,
  key: string,
  verifyPath: string,
  expected: ArchiveObjectIdentity,
): Promise<void> {
  await runCheckedWithRetry(
    accountId,
    "pnpm",
    [
      "exec",
      "wrangler",
      "r2",
      "object",
      "get",
      `${bucket}/${key}`,
      "--file",
      verifyPath,
      "--remote",
    ],
    async () => {
      await rm(verifyPath, { force: true });
    },
  );
  const actual = await archiveObjectIdentity(verifyPath);
  if (actual.sha256 !== expected.sha256 || actual.sizeBytes !== expected.sizeBytes) {
    throw new Error(`R2 verification failed for ${bucket}/${key}.`);
  }
}

export async function archiveObjectIdentity(path: string): Promise<ArchiveObjectIdentity> {
  const file = await stat(path);
  if (!file.isFile()) {
    throw new Error(`${path} is not a file.`);
  }
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) {
    hash.update(chunk);
  }
  return { sha256: hash.digest("hex"), sizeBytes: file.size };
}

function runCheckedWithRetry(
  accountId: string,
  command: string,
  args: readonly string[],
  beforeAttempt?: () => Promise<void>,
): Promise<void> {
  return retry(async () => {
    await beforeAttempt?.();
    const result = await runCommand(accountId, command, args);
    if (result.code !== 0) {
      throw new Error(commandFailure(result));
    }
  });
}

async function retry(operation: () => Promise<void>): Promise<void> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      await operation();
      return;
    } catch (error) {
      lastError = error;
      if (attempt < MAX_ATTEMPTS) {
        await delay(2 ** (attempt - 1) * 1_000);
      }
    }
  }
  throw lastError;
}

function runCommand(
  accountId: string,
  command: string,
  args: readonly string[],
): Promise<CommandResult> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd: ROOT,
      env: { ...process.env, CLOUDFLARE_ACCOUNT_ID: accountId },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr?.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      resolvePromise({ code: code ?? 1, stderr, stdout });
    });
  });
}

function commandFailure(result: CommandResult): string {
  const lines = `${result.stderr}\n${result.stdout}`
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  return lines[0] ?? `command exited with code ${result.code}`;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
}
