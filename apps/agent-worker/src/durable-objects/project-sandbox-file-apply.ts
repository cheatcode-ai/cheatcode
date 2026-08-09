import { APIError } from "@cheatcode/observability";
import type {
  SandboxCompareAndSwapFileResult,
  SandboxWriteFileResult,
} from "@cheatcode/sandbox-contracts";
import { decodeBase64, dirname, shellQuote } from "../sandbox-support";
import { assertMutableWorkspacePath, WORKSPACE_DIR } from "./project-sandbox-content-support";
import { timeoutSeconds } from "./project-sandbox-process-support";
import {
  type ProjectCompareAndSwapFileInput,
  ProjectCompareAndSwapFileInputSchema,
  type ProjectWriteFileInput,
  ProjectWriteFileInputSchema,
} from "./project-sandbox-runtime";
import type { SandboxRuntime } from "./project-sandbox-runtime-handle";

const COMPARE_AND_SWAP_MISMATCH_EXIT = 73;
const COMPARE_AND_SWAP_FILE_SCRIPT = `
import hashlib
import os
import stat
import sys

target = sys.argv[1]
candidate = sys.argv[2]
expected = sys.argv[3]
digest = hashlib.sha256()
descriptor = os.open(target, os.O_RDONLY | os.O_NOFOLLOW)
with os.fdopen(descriptor, "rb") as source:
    metadata = os.fstat(source.fileno())
    if not stat.S_ISREG(metadata.st_mode):
        raise RuntimeError("Edit target is not a regular file")
    for chunk in iter(lambda: source.read(1024 * 1024), b""):
        digest.update(chunk)
if digest.hexdigest() != expected:
    raise SystemExit(${COMPARE_AND_SWAP_MISMATCH_EXIT})
os.chmod(candidate, stat.S_IMODE(metadata.st_mode))
with open(candidate, "rb") as pending:
    os.fsync(pending.fileno())
os.replace(candidate, target)
`;

type FileApplyRuntime = Pick<SandboxRuntime, "client" | "ensureSandbox">;

export async function writeFile(
  runtime: FileApplyRuntime,
  input: ProjectWriteFileInput,
): Promise<SandboxWriteFileResult> {
  const parsed = ProjectWriteFileInputSchema.parse(input);
  assertMutableWorkspacePath(parsed.path);
  const id = await runtime.ensureSandbox();
  await runtime.client().createFolder(id, dirname(parsed.path));
  const bytes =
    parsed.encoding === "base64"
      ? decodeBase64(parsed.content)
      : new TextEncoder().encode(parsed.content);
  await runtime.client().uploadFile(id, parsed.path, bytes);
  return { path: parsed.path, success: true };
}

export async function compareAndSwapFile(
  runtime: FileApplyRuntime,
  input: ProjectCompareAndSwapFileInput,
): Promise<SandboxCompareAndSwapFileResult> {
  const parsed = ProjectCompareAndSwapFileInputSchema.parse(input);
  assertMutableWorkspacePath(parsed.path);
  const id = await runtime.ensureSandbox();
  const stagingDir = `${WORKSPACE_DIR}/.cheatcode/runtime`;
  const candidatePath = `${stagingDir}/file-apply-${crypto.randomUUID()}`;
  await runtime.client().createFolder(id, stagingDir);
  await runtime.client().uploadFile(id, candidatePath, new TextEncoder().encode(parsed.content));
  try {
    await executeCompareAndSwap(runtime, id, parsed, candidatePath);
    return { path: parsed.path, success: true };
  } finally {
    await runtime
      .client()
      .deleteFilePath(id, candidatePath, false)
      .catch(() => undefined);
  }
}

async function executeCompareAndSwap(
  runtime: FileApplyRuntime,
  sandboxId: string,
  input: ProjectCompareAndSwapFileInput,
  candidatePath: string,
): Promise<void> {
  const completed = await runtime.client().execute(sandboxId, {
    command: [
      "python3",
      "-c",
      COMPARE_AND_SWAP_FILE_SCRIPT,
      input.path,
      candidatePath,
      input.expectedSha256,
    ]
      .map(shellQuote)
      .join(" "),
    cwd: WORKSPACE_DIR,
    timeout: timeoutSeconds(30_000),
  });
  assertCompareAndSwapSucceeded(completed.exitCode, completed.result);
}

function assertCompareAndSwapSucceeded(exitCode: number, result: string | null | undefined): void {
  if (exitCode === 0) {
    return;
  }
  if (exitCode === COMPARE_AND_SWAP_MISMATCH_EXIT) {
    throw new APIError(409, "conflict_state_invalid", "File changed while the edit was prepared", {
      hint: "Read the latest file and retry the edit.",
      retriable: true,
    });
  }
  throw new APIError(502, "sandbox_command_failed", "Sandbox file edit failed", {
    hint: result?.trim().slice(-300) || "Check that the target is a regular workspace file.",
    retriable: false,
  });
}
