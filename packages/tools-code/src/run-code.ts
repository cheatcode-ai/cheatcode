import { APIError } from "@cheatcode/observability";
import { tool } from "ai";
import { z } from "zod";
import { getCodeRuntimeContext } from "./runtime";

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
    exitCode: z.number().int().nullable(),
  })
  .strict();

export type RunCodeInput = z.infer<typeof RunCodeInputSchema>;
export type RunCodeOutput = z.infer<typeof RunCodeOutputSchema>;

export async function executeRunCode(
  input: RunCodeInput,
  runtimeContext: ReturnType<typeof getCodeRuntimeContext>,
): Promise<RunCodeOutput> {
  const result = await runtimeContext.sandbox.runCode({
    language: input.language,
    code: input.code,
  });

  const output = {
    stdout: result.stdout ?? result.output ?? "",
    stderr: result.stderr ?? "",
    success: result.success ?? result.exitCode === 0,
    exitCode: result.exitCode ?? null,
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

export const runCode = tool({
  description:
    "Run Python or JavaScript code in the project sandbox. Use for deterministic code execution and data work.",
  inputSchema: RunCodeInputSchema,
  outputSchema: RunCodeOutputSchema,
  execute: async (input, options: unknown) => executeRunCode(input, getCodeRuntimeContext(options)),
});
