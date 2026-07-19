import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { rm, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { type CapturedCommandResult, runCapturedBoundedCommand } from "./bounded-command";
import { timeoutBeforeDeadline } from "./operation-deadline";

export interface ArchiveObjectIdentity {
  sha256: string;
  sizeBytes: number;
}

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const MAX_ATTEMPTS = 4;
const MAX_COMMAND_OUTPUT_BYTES = 2 * 1024 * 1024;
const R2_COMMAND_TIMEOUT_MS = 15 * 60 * 1_000;

export async function uploadAndVerifyArchive(
  accountId: string,
  bucket: string,
  key: string,
  filePath: string,
  verifyPath: string,
  expected: ArchiveObjectIdentity,
  deadline: number,
): Promise<void> {
  await runCheckedWithRetry(
    accountId,
    "pnpm",
    [
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
    ],
    deadline,
  );
  await verifyRemoteArchive(accountId, bucket, key, verifyPath, expected, deadline);
}

export async function verifyRemoteArchive(
  accountId: string,
  bucket: string,
  key: string,
  verifyPath: string,
  expected: ArchiveObjectIdentity,
  deadline: number,
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
    deadline,
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
  deadline: number,
  beforeAttempt?: () => Promise<void>,
): Promise<void> {
  return retry(async () => {
    await beforeAttempt?.();
    const result = await runCommand(accountId, command, args, deadline);
    if (result.code !== 0) {
      throw new Error(commandFailure(result));
    }
  }, deadline);
}

async function retry(operation: () => Promise<void>, deadline: number): Promise<void> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      await operation();
      return;
    } catch (error) {
      lastError = error;
      if (attempt < MAX_ATTEMPTS) {
        await delay(
          timeoutBeforeDeadline(2 ** (attempt - 1) * 1_000, deadline, "R2 archive retry"),
        );
      }
    }
  }
  throw lastError;
}

function runCommand(
  accountId: string,
  command: string,
  args: readonly string[],
  deadline: number,
): Promise<CapturedCommandResult> {
  return runCapturedBoundedCommand(command, args, {
    cwd: ROOT,
    env: { ...process.env, CLOUDFLARE_ACCOUNT_ID: accountId },
    maxOutputBytes: MAX_COMMAND_OUTPUT_BYTES,
    timeoutMs: timeoutBeforeDeadline(R2_COMMAND_TIMEOUT_MS, deadline, "R2 archive command"),
  });
}

function commandFailure(result: CapturedCommandResult): string {
  const lines = `${result.stderr}\n${result.stdout}`
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  return lines[0] ?? `command exited with code ${result.code}`;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
}
