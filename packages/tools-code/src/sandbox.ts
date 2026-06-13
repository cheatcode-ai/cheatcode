import { APIError } from "@cheatcode/observability";
import { tool } from "ai";
import { z } from "zod";
import { getCodeRuntimeContext } from "./runtime";

export const SandboxCreateInputSchema = z.object({}).strict();

export const SandboxCreateOutputSchema = z
  .object({
    healthy: z.boolean(),
    ping: z.string(),
    sandboxId: z.string(),
  })
  .strict();

export const SandboxDestroyInputSchema = z.object({}).strict();

export const SandboxDestroyOutputSchema = z
  .object({
    deleted: z.boolean(),
    sandboxId: z.string(),
  })
  .strict();

export type SandboxCreateInput = z.input<typeof SandboxCreateInputSchema>;
export type SandboxCreateOutput = z.infer<typeof SandboxCreateOutputSchema>;
export type SandboxDestroyInput = z.input<typeof SandboxDestroyInputSchema>;
export type SandboxDestroyOutput = z.infer<typeof SandboxDestroyOutputSchema>;

export async function executeSandboxCreate(
  input: SandboxCreateInput,
  runtimeContext: ReturnType<typeof getCodeRuntimeContext>,
): Promise<SandboxCreateOutput> {
  SandboxCreateInputSchema.parse(input);
  if (!runtimeContext.sandbox.ensureReady) {
    throw missingSandboxLifecycleMethod("ensureReady");
  }
  return SandboxCreateOutputSchema.parse(await runtimeContext.sandbox.ensureReady());
}

export async function executeSandboxDestroy(
  input: SandboxDestroyInput,
  runtimeContext: ReturnType<typeof getCodeRuntimeContext>,
): Promise<SandboxDestroyOutput> {
  SandboxDestroyInputSchema.parse(input);
  if (!runtimeContext.sandbox.destroySandbox) {
    throw missingSandboxLifecycleMethod("destroySandbox");
  }
  return SandboxDestroyOutputSchema.parse(await runtimeContext.sandbox.destroySandbox());
}

export const sandboxCreate = tool({
  description: "Create or wake the project sandbox and return its readiness status.",
  inputSchema: SandboxCreateInputSchema,
  outputSchema: SandboxCreateOutputSchema,
  execute: async (input, options: unknown) =>
    executeSandboxCreate(input, getCodeRuntimeContext(options)),
});

export const sandboxDestroy = tool({
  description: "Delete the project sandbox. Use only for explicit project cleanup.",
  inputSchema: SandboxDestroyInputSchema,
  outputSchema: SandboxDestroyOutputSchema,
  execute: async (input, options: unknown) =>
    executeSandboxDestroy(input, getCodeRuntimeContext(options)),
});

function missingSandboxLifecycleMethod(method: string): APIError {
  return new APIError(
    500,
    "validation_tool_not_registered",
    `Sandbox method ${method} is missing`,
    {
      hint: "Update the ProjectSandbox Durable Object before using this sandbox lifecycle tool.",
      retriable: false,
    },
  );
}
