import { APIError } from "@cheatcode/observability";
import type {
  SandboxCompareAndSwapFileResult,
  SandboxWriteFileResult,
} from "@cheatcode/sandbox-contracts";
import { decodeBase64, dirname } from "../sandbox-support";
import { assertMutableWorkspacePath } from "./project-sandbox-content-support";
import {
  type ProjectCompareAndSwapFileInput,
  ProjectCompareAndSwapFileInputSchema,
  type ProjectWriteFileInput,
  ProjectWriteFileInputSchema,
} from "./project-sandbox-runtime";
import type { SandboxRuntime } from "./project-sandbox-runtime-handle";

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
  const current = await runtime.client().downloadFile(id, parsed.path);
  if ((await sha256(current)) !== parsed.expectedSha256) {
    throw new APIError(409, "conflict_state_invalid", "File changed while the edit was prepared", {
      hint: "Read the latest file and retry the edit.",
      retriable: true,
    });
  }
  await runtime.client().uploadFile(id, parsed.path, new TextEncoder().encode(parsed.content));
  return { path: parsed.path, success: true };
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const stableBytes = new Uint8Array(bytes.byteLength);
  stableBytes.set(bytes);
  const digest = await crypto.subtle.digest("SHA-256", stableBytes.buffer);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
