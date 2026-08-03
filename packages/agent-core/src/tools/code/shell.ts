import { APIError } from "@cheatcode/observability";
import {
  type CodeRuntimeContextFor,
  EnvironmentVariablesSchema,
} from "@cheatcode/sandbox-contracts";
import { z } from "zod";
import {
  remapProjectWorkspaceReferences,
  resolveProjectWorkspacePath,
  WorkspacePathSchema,
} from "./workspace-paths";

export const ShellExecInputSchema = z.strictObject({
  command: z
    .array(
      z.string().min(1).max(8_192).describe("One argv element. Do not pass a shell-joined string."),
    )
    .min(1)
    .max(128)
    .describe("Command argv to run inside the sandbox."),
  cwd: WorkspacePathSchema.optional().describe("Absolute working directory under /workspace."),
  env: EnvironmentVariablesSchema.optional().describe(
    "Request-scoped environment variables for this command only.",
  ),
  timeoutMs: z
    .number()
    .int()
    .positive()
    .max(600_000)
    .optional()
    .describe("Maximum command runtime in milliseconds."),
});

export const ShellExecOutputSchema = z.strictObject({
  command: z.string(),
  stdout: z.string(),
  stderr: z.string(),
  success: z.boolean(),
  exitCode: z.number().int(),
  durationMs: z.number().int().nonnegative().optional(),
});

export const ShellStartProcessInputSchema = z.strictObject({
  ...ShellExecInputSchema.shape,
  keepAliveTimeoutMs: z
    .number()
    .int()
    .min(0)
    .max(24 * 60 * 60 * 1000)
    .default(60 * 60 * 1000),
  maxRestarts: z.number().int().min(0).max(25).default(3),
  processId: z
    .string()
    .min(1)
    .max(200)
    .describe("Stable idempotency slot for replacing, inspecting, and stopping the process."),
  restartOnFailure: z.boolean().default(true),
  waitForPort: z
    .strictObject({
      port: z.number().int().positive().max(65_535),
      path: z.string().min(1).max(500).optional(),
      timeoutMs: z.number().int().positive().max(600_000).optional(),
    })

    .optional(),
});

export const ShellProcessOutputSchema = z.strictObject({
  command: z.string(),
  id: z.string(),
  pid: z.number().int().positive().optional(),
  status: z.string(),
});

export const ShellKillProcessInputSchema = z.strictObject({
  processId: z.string().min(1).max(200),
});

export const ShellKillProcessOutputSchema = z.strictObject({
  processId: z.string(),
  status: z.string(),
  success: z.boolean(),
});

export const ShellTerminalInputSchema = z.strictObject({
  command: z.string().min(1).max(4_000),
  cwd: WorkspacePathSchema.default("/workspace"),
  timeoutMs: z.number().int().positive().max(600_000).default(120_000),
});

export type ShellExecInput = z.input<typeof ShellExecInputSchema>;
export type ShellExecOutput = z.infer<typeof ShellExecOutputSchema>;
type ShellStartProcessInput = z.input<typeof ShellStartProcessInputSchema>;
type ShellProcessOutput = z.infer<typeof ShellProcessOutputSchema>;
type ShellKillProcessInput = z.input<typeof ShellKillProcessInputSchema>;
type ShellKillProcessOutput = z.infer<typeof ShellKillProcessOutputSchema>;
export type ShellTerminalInput = z.input<typeof ShellTerminalInputSchema>;

export async function executeShellExec(
  input: ShellExecInput,
  runtimeContext: CodeRuntimeContextFor<"exec">,
): Promise<ShellExecOutput> {
  const parsedInput = ShellExecInputSchema.parse(input);
  const workspaceDir = runtimeContext.workspaceDir;
  const result = await runtimeContext.sandbox.exec({
    command: remapCommandWorkspaceReferences(parsedInput.command, workspaceDir),
    cwd:
      workspaceDir || parsedInput.cwd
        ? resolveProjectWorkspacePath(parsedInput.cwd, workspaceDir)
        : "/tmp",
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
  runtimeContext: CodeRuntimeContextFor<"startProcess">,
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
    await runtimeContext.sandbox.startProcess({
      command: remapCommandWorkspaceReferences(parsedInput.command, runtimeContext.workspaceDir),
      cwd: resolveProjectWorkspacePath(parsedInput.cwd, runtimeContext.workspaceDir),
      ...(parsedInput.env ? { env: parsedInput.env } : {}),
      keepAliveTimeoutMs: parsedInput.keepAliveTimeoutMs,
      maxRestarts: parsedInput.maxRestarts,
      processId: parsedInput.processId,
      restartOnFailure: parsedInput.restartOnFailure,
      ...(parsedInput.timeoutMs ? { timeoutMs: parsedInput.timeoutMs } : {}),
      ...(waitForPort ? { waitForPort } : {}),
    }),
  );
}

export async function executeShellKillProcess(
  input: ShellKillProcessInput,
  runtimeContext: CodeRuntimeContextFor<"killProcess">,
): Promise<ShellKillProcessOutput> {
  const parsedInput = ShellKillProcessInputSchema.parse(input);
  return ShellKillProcessOutputSchema.parse(
    await runtimeContext.sandbox.killProcess({
      processId: parsedInput.processId,
    }),
  );
}

export async function executeShellTerminal(
  input: ShellTerminalInput,
  runtimeContext: CodeRuntimeContextFor<"exec">,
): Promise<ShellExecOutput> {
  const parsedInput = ShellTerminalInputSchema.parse(input);
  return ShellExecOutputSchema.parse(
    await runtimeContext.sandbox.exec({
      command: [
        "sh",
        "-lc",
        remapProjectWorkspaceReferences(parsedInput.command, runtimeContext.workspaceDir),
      ],
      cwd: resolveProjectWorkspacePath(parsedInput.cwd, runtimeContext.workspaceDir),
      timeoutMs: parsedInput.timeoutMs,
    }),
  );
}

function remapCommandWorkspaceReferences(
  command: readonly string[],
  workspaceDir: string | undefined,
): string[] {
  return command.map((argument) => remapProjectWorkspaceReferences(argument, workspaceDir));
}
