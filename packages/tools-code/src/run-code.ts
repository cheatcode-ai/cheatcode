import { APIError } from "@cheatcode/observability";
import type { getCodeRuntimeContext } from "@cheatcode/sandbox-contracts";
import { z } from "zod";
import { resolveProjectWorkspacePath } from "./workspace-paths";

export const RunCodeInputSchema = z
  .object({
    language: z
      .enum(["python", "javascript"])
      .describe("Language to execute inside the project sandbox."),
    code: z.string().min(1).max(100_000).describe("Source code to execute."),
  })
  .strict();

export const RunCodeOutputSchema = z
  .object({
    stdout: z.string(),
    stderr: z.string(),
    success: z.boolean(),
    exitCode: z.number().int(),
  })
  .strict();

export type RunCodeInput = z.infer<typeof RunCodeInputSchema>;
export type RunCodeOutput = z.infer<typeof RunCodeOutputSchema>;

export async function executeRunCode(
  input: RunCodeInput,
  runtimeContext: ReturnType<typeof getCodeRuntimeContext>,
): Promise<RunCodeOutput> {
  const parsedInput = RunCodeInputSchema.parse(input);
  const result = await runtimeContext.sandbox.runCode({
    language: parsedInput.language,
    code: parsedInput.code,
    cwd: resolveProjectWorkspacePath(undefined, runtimeContext.workspaceDir),
  });

  const output = {
    stdout: result.stdout,
    stderr: result.stderr,
    success: result.success,
    exitCode: result.exitCode,
  };

  if (!output.success) {
    throw new APIError(502, "sandbox_command_failed", "Sandbox code execution failed", {
      hint: "Inspect stderr, fix the code, then retry the runCode tool.",
      retriable: false,
      details: output,
    });
  }

  return output;
}
