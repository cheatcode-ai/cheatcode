import { APIError } from "@cheatcode/observability";
import { tool } from "ai";
import { z } from "zod";
import { getCodeRuntimeContext } from "./runtime";
import { callSandboxMethod } from "./sandbox-methods";
import { WorkspacePathSchema } from "./workspace-paths";

export const ShellExecInputSchema = z
  .object({
    command: z.array(z.string().min(1)).min(1).max(128),
    cwd: WorkspacePathSchema.optional(),
    env: z.record(z.string(), z.string()).optional(),
    timeoutMs: z.number().int().positive().max(600_000).optional(),
  })
  .strict();

export const ShellExecOutputSchema = z
  .object({
    command: z.string(),
    stdout: z.string(),
    stderr: z.string(),
    success: z.boolean(),
    exitCode: z.number().int(),
    durationMs: z.number().int().nonnegative().optional(),
  })
  .strict();

export const ShellStartProcessInputSchema = ShellExecInputSchema.extend({
  keepAliveTimeoutMs: z
    .number()
    .int()
    .min(0)
    .max(24 * 60 * 60 * 1000)
    .default(60 * 60 * 1000),
  maxRestarts: z.number().int().min(0).max(25).default(3),
  processId: z.string().min(1).max(200).optional(),
  restartOnFailure: z.boolean().default(true),
  waitForPort: z
    .object({
      port: z.number().int().positive().max(65_535),
      path: z.string().min(1).max(500).optional(),
      timeoutMs: z.number().int().positive().max(600_000).optional(),
    })
    .strict()
    .optional(),
}).strict();

export const ShellProcessOutputSchema = z
  .object({
    command: z.string(),
    id: z.string(),
    pid: z.number().int().positive().optional(),
    status: z.string(),
  })
  .strict();

export const ShellKillProcessInputSchema = z
  .object({
    processId: z.string().min(1).max(200),
  })
  .strict();

export const ShellKillProcessOutputSchema = z
  .object({
    processId: z.string(),
    status: z.string(),
    success: z.boolean(),
  })
  .strict();

export const ShellTerminalInputSchema = z
  .object({
    command: z.string().min(1).max(4_000),
    cwd: WorkspacePathSchema.default("/workspace"),
    timeoutMs: z.number().int().positive().max(600_000).default(120_000),
  })
  .strict();

export type ShellExecInput = z.input<typeof ShellExecInputSchema>;
export type ShellExecOutput = z.infer<typeof ShellExecOutputSchema>;
export type ShellStartProcessInput = z.input<typeof ShellStartProcessInputSchema>;
export type ShellProcessOutput = z.infer<typeof ShellProcessOutputSchema>;
export type ShellKillProcessInput = z.input<typeof ShellKillProcessInputSchema>;
export type ShellKillProcessOutput = z.infer<typeof ShellKillProcessOutputSchema>;
export type ShellTerminalInput = z.input<typeof ShellTerminalInputSchema>;

export async function executeShellExec(
  input: ShellExecInput,
  runtimeContext: ReturnType<typeof getCodeRuntimeContext>,
): Promise<ShellExecOutput> {
  const parsedInput = ShellExecInputSchema.parse(input);
  const result = await callSandboxMethod(runtimeContext.sandbox, "exec", {
    command: parsedInput.command,
    ...(parsedInput.cwd ? { cwd: parsedInput.cwd } : {}),
    ...(parsedInput.env ? { env: parsedInput.env } : {}),
    ...(parsedInput.timeoutMs ? { timeoutMs: parsedInput.timeoutMs } : {}),
  });
  const output = ShellExecOutputSchema.parse(result);
  if (!output.success) {
    throw new APIError(502, "sandbox_command_failed", "Sandbox shell command failed", {
      hint: "Inspect stderr, fix the command or working directory, then retry.",
      retriable: false,
      details: output,
    });
  }
  return output;
}

export async function executeShellStartProcess(
  input: ShellStartProcessInput,
  runtimeContext: ReturnType<typeof getCodeRuntimeContext>,
): Promise<ShellProcessOutput> {
  const parsedInput = ShellStartProcessInputSchema.parse(input);
  const waitForPort = parsedInput.waitForPort
    ? {
        ...(parsedInput.waitForPort.path ? { path: parsedInput.waitForPort.path } : {}),
        port: parsedInput.waitForPort.port,
        ...(parsedInput.waitForPort.timeoutMs
          ? { timeoutMs: parsedInput.waitForPort.timeoutMs }
          : {}),
      }
    : undefined;
  return ShellProcessOutputSchema.parse(
    await callSandboxMethod(runtimeContext.sandbox, "startProcess", {
      command: parsedInput.command,
      ...(parsedInput.cwd ? { cwd: parsedInput.cwd } : {}),
      ...(parsedInput.env ? { env: parsedInput.env } : {}),
      keepAliveTimeoutMs: parsedInput.keepAliveTimeoutMs,
      maxRestarts: parsedInput.maxRestarts,
      ...(parsedInput.processId ? { processId: parsedInput.processId } : {}),
      restartOnFailure: parsedInput.restartOnFailure,
      ...(parsedInput.timeoutMs ? { timeoutMs: parsedInput.timeoutMs } : {}),
      ...(waitForPort ? { waitForPort } : {}),
    }),
  );
}

export async function executeShellKillProcess(
  input: ShellKillProcessInput,
  runtimeContext: ReturnType<typeof getCodeRuntimeContext>,
): Promise<ShellKillProcessOutput> {
  const parsedInput = ShellKillProcessInputSchema.parse(input);
  return ShellKillProcessOutputSchema.parse(
    await callSandboxMethod(runtimeContext.sandbox, "killProcess", {
      processId: parsedInput.processId,
    }),
  );
}

export async function executeShellTerminal(
  input: ShellTerminalInput,
  runtimeContext: ReturnType<typeof getCodeRuntimeContext>,
): Promise<ShellExecOutput> {
  const parsedInput = ShellTerminalInputSchema.parse(input);
  return ShellExecOutputSchema.parse(
    await callSandboxMethod(runtimeContext.sandbox, "exec", {
      command: ["sh", "-lc", parsedInput.command],
      cwd: parsedInput.cwd,
      timeoutMs: parsedInput.timeoutMs,
    }),
  );
}

export const shellExec = tool({
  description:
    "Run a shell command under /workspace in the project sandbox using argv form. Use for package installs, builds, static checks, and deterministic CLI work.",
  inputSchema: ShellExecInputSchema,
  outputSchema: ShellExecOutputSchema,
  execute: async (input, options: unknown) =>
    executeShellExec(input, getCodeRuntimeContext(options)),
});

export const shellStartProcess = tool({
  description:
    "Start a long-running sandbox process under /workspace with optional port readiness checks and restart policy.",
  inputSchema: ShellStartProcessInputSchema,
  outputSchema: ShellProcessOutputSchema,
  execute: async (input, options: unknown) =>
    executeShellStartProcess(input, getCodeRuntimeContext(options)),
});

export const shellKillProcess = tool({
  description: "Kill a named long-running sandbox process.",
  inputSchema: ShellKillProcessInputSchema,
  outputSchema: ShellKillProcessOutputSchema,
  execute: async (input, options: unknown) =>
    executeShellKillProcess(input, getCodeRuntimeContext(options)),
});

export const shellTerminal = tool({
  description:
    "Run a short user-style terminal command in /workspace. For automation, prefer shell_exec argv form.",
  inputSchema: ShellTerminalInputSchema,
  outputSchema: ShellExecOutputSchema,
  execute: async (input, options: unknown) =>
    executeShellTerminal(input, getCodeRuntimeContext(options)),
});
