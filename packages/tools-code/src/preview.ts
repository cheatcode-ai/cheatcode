import { tool } from "ai";
import { z } from "zod";
import { getCodeRuntimeContext } from "./runtime";
import { callSandboxMethod } from "./sandbox-methods";

export const StartDevServerInputSchema = z
  .object({
    command: z.array(z.string().min(1)).min(1).max(128),
    cwd: z.string().min(1).max(500),
    env: z.record(z.string(), z.string()).optional(),
    hostname: z.string().min(1).max(255).default("trycheatcode.com"),
    keepAliveTimeoutMs: z
      .number()
      .int()
      .min(0)
      .max(24 * 60 * 60 * 1000)
      .default(60 * 60 * 1000),
    maxRestarts: z.number().int().min(0).max(25).default(3),
    name: z.string().min(1).max(100).default("preview"),
    port: z.number().int().positive().max(65_535).default(5173),
    restartOnFailure: z.boolean().default(true),
    timeoutMs: z.number().int().positive().max(600_000).default(120_000),
  })
  .strict();

export const StartDevServerOutputSchema = z
  .object({
    processId: z.string(),
    pid: z.number().int().positive().optional(),
    previewUrl: z.string().url(),
    port: z.number().int().positive(),
    status: z.string(),
  })
  .strict();

export type StartDevServerInput = z.input<typeof StartDevServerInputSchema>;
export type StartDevServerOutput = z.infer<typeof StartDevServerOutputSchema>;

export async function executeStartDevServer(
  input: StartDevServerInput,
  runtimeContext: ReturnType<typeof getCodeRuntimeContext>,
): Promise<StartDevServerOutput> {
  const parsedInput = StartDevServerInputSchema.parse(input);
  const process = await callSandboxMethod(runtimeContext.sandbox, "startProcess", {
    command: parsedInput.command,
    cwd: parsedInput.cwd,
    env: { ...parsedInput.env, PORT: String(parsedInput.port) },
    keepAliveTimeoutMs: parsedInput.keepAliveTimeoutMs,
    maxRestarts: parsedInput.maxRestarts,
    restartOnFailure: parsedInput.restartOnFailure,
    timeoutMs: parsedInput.timeoutMs,
    waitForPort: {
      port: parsedInput.port,
      timeoutMs: parsedInput.timeoutMs,
    },
  });
  await clearExistingExposure(runtimeContext, parsedInput.name, parsedInput.port);
  const exposed = await callSandboxMethod(runtimeContext.sandbox, "exposePort", {
    hostname: parsedInput.hostname,
    name: parsedInput.name,
    port: parsedInput.port,
  });
  return StartDevServerOutputSchema.parse({
    processId: process.id,
    pid: process.pid,
    previewUrl: exposed.url,
    port: exposed.port,
    status: process.status,
  });
}

export const startDevServer = tool({
  description:
    "Start a long-running dev server in the sandbox and expose its HTTP port as a preview URL.",
  inputSchema: StartDevServerInputSchema,
  outputSchema: StartDevServerOutputSchema,
  execute: async (input, options: unknown) =>
    executeStartDevServer(input, getCodeRuntimeContext(options)),
});

async function clearExistingExposure(
  runtimeContext: ReturnType<typeof getCodeRuntimeContext>,
  name: string,
  port: number,
): Promise<void> {
  if (!runtimeContext.sandbox.unexposePort) {
    return;
  }
  try {
    await runtimeContext.sandbox.unexposePort({ name, port });
  } catch {
    return;
  }
}
