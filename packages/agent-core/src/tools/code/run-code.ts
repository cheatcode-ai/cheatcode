import { APIError } from "@cheatcode/observability";
import type { CodeRuntimeContextFor } from "@cheatcode/sandbox-contracts";
import { z } from "zod";
import { remapProjectWorkspaceReferences, resolveProjectWorkspacePath } from "./workspace-paths";

export const RunCodeInputSchema = z.strictObject({
  language: z
    .enum(["python", "javascript"])
    .describe("Language to execute inside the project sandbox."),
  code: z.string().min(1).max(100_000).describe("Source code to execute."),
});

export const RunCodeOutputSchema = z.strictObject({
  stdout: z.string(),
  stderr: z.string(),
  success: z.boolean(),
  exitCode: z.number().int(),
});

export type RunCodeInput = z.infer<typeof RunCodeInputSchema>;
export type RunCodeOutput = z.infer<typeof RunCodeOutputSchema>;

export async function executeRunCode(
  input: RunCodeInput,
  runtimeContext: CodeRuntimeContextFor<"runCode">,
): Promise<RunCodeOutput> {
  const parsedInput = RunCodeInputSchema.parse(input);
  const workspaceDir = runtimeContext.workspaceDir;
  const result = await runtimeContext.sandbox.runCode({
    language: parsedInput.language,
    code: remapProjectWorkspaceReferences(parsedInput.code, workspaceDir),
    cwd: workspaceDir ? resolveProjectWorkspacePath(undefined, workspaceDir) : "/tmp",
  });

  const output = {
    stdout: result.stdout,
    stderr: result.stderr,
    success: result.success,
    exitCode: result.exitCode,
  };

  if (!output.success) {
    throw new APIError(502, "sandbox_command_failed", "Sandbox code execution failed", {
      hint: "Inspect stderr, fix the code, then retry the code_run tool.",
      retriable: false,
      details: output,
    });
  }

  return output;
}
