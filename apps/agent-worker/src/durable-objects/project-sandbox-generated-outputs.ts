import type { SandboxWriteFileResult } from "@cheatcode/sandbox-contracts";
import { projectDeliverableRelativePath } from "@cheatcode/types/api";
import { dirname } from "../sandbox-support";
import { WORKSPACE_DIR } from "./project-sandbox-content-support";
import {
  type ProjectRestoreGeneratedOutputInput,
  ProjectRestoreGeneratedOutputInputSchema,
} from "./project-sandbox-runtime";
import type { SandboxRuntime } from "./project-sandbox-runtime-handle";

type GeneratedOutputRuntime = Pick<SandboxRuntime, "client" | "ensureSandbox">;

export interface GeneratedOutputOps {
  restoreGeneratedOutput: (
    input: ProjectRestoreGeneratedOutputInput,
  ) => Promise<SandboxWriteFileResult>;
}

export function createGeneratedOutputOps(runtime: GeneratedOutputRuntime): GeneratedOutputOps {
  return {
    restoreGeneratedOutput: (input) => restoreGeneratedOutput(runtime, input),
  };
}

async function restoreGeneratedOutput(
  runtime: GeneratedOutputRuntime,
  input: ProjectRestoreGeneratedOutputInput,
): Promise<SandboxWriteFileResult> {
  const parsed = ProjectRestoreGeneratedOutputInputSchema.parse(input);
  const relativePath = projectDeliverableRelativePath(parsed.outputId, parsed.filename);
  const path = `${WORKSPACE_DIR}/${parsed.workspaceSlug}/${relativePath}`;
  const id = await runtime.ensureSandbox();
  await runtime.client().createFolder(id, dirname(path));
  await runtime.client().uploadFile(id, path, parsed.bytes);
  return { path, success: true };
}
