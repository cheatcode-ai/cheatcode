import { tool } from "ai";
import { z } from "zod";
import { getCodeRuntimeContext } from "./runtime";
import { callSandboxMethod } from "./sandbox-methods";
import { WorkspacePathSchema } from "./workspace-paths";

export const CreateSnapshotInputSchema = z
  .object({
    dir: WorkspacePathSchema.default("/workspace"),
    name: z.string().min(1).max(200).optional(),
    ttl: z
      .number()
      .int()
      .positive()
      .max(90 * 24 * 60 * 60)
      .default(30 * 24 * 60 * 60),
  })
  .strict();

const InternalCreateSnapshotInputSchema = CreateSnapshotInputSchema.extend({
  localBucket: z.boolean().optional(),
}).strict();

export const SnapshotHandleSchema = z
  .object({
    id: z.string().min(1),
    dir: z.string().min(1),
    localBucket: z.boolean().optional(),
  })
  .strict();

export const RestoreSnapshotInputSchema = z
  .object({
    backup: SnapshotHandleSchema,
  })
  .strict();

export const RestoreSnapshotOutputSchema = z
  .object({
    id: z.string().min(1),
    dir: z.string().min(1),
    success: z.boolean(),
  })
  .strict();

export type CreateSnapshotInput = z.input<typeof CreateSnapshotInputSchema>;
type InternalCreateSnapshotInput = z.input<typeof InternalCreateSnapshotInputSchema>;
export type SnapshotHandle = z.infer<typeof SnapshotHandleSchema>;
export type RestoreSnapshotInput = z.input<typeof RestoreSnapshotInputSchema>;
export type RestoreSnapshotOutput = z.infer<typeof RestoreSnapshotOutputSchema>;

export async function executeCreateSnapshot(
  input: InternalCreateSnapshotInput,
  runtimeContext: ReturnType<typeof getCodeRuntimeContext>,
): Promise<SnapshotHandle> {
  const parsedInput = InternalCreateSnapshotInputSchema.parse(input);
  return SnapshotHandleSchema.parse(
    await callSandboxMethod(runtimeContext.sandbox, "createBackup", {
      dir: parsedInput.dir,
      ttl: parsedInput.ttl,
      ...(parsedInput.localBucket === undefined ? {} : { localBucket: parsedInput.localBucket }),
      ...(parsedInput.name ? { name: parsedInput.name } : {}),
    }),
  );
}

export async function executeRestoreSnapshot(
  input: RestoreSnapshotInput,
  runtimeContext: ReturnType<typeof getCodeRuntimeContext>,
): Promise<RestoreSnapshotOutput> {
  const parsedInput = RestoreSnapshotInputSchema.parse(input);
  return RestoreSnapshotOutputSchema.parse(
    await callSandboxMethod(runtimeContext.sandbox, "restoreBackup", {
      backup: {
        id: parsedInput.backup.id,
        dir: parsedInput.backup.dir,
        ...(parsedInput.backup.localBucket === undefined
          ? {}
          : { localBucket: parsedInput.backup.localBucket }),
      },
    }),
  );
}

export const createSnapshot = tool({
  description:
    "Return the persistent Daytona sandbox handle for the workspace so future runs can recover project state.",
  inputSchema: CreateSnapshotInputSchema,
  outputSchema: SnapshotHandleSchema,
  execute: async (input, options: unknown) =>
    executeCreateSnapshot(input, getCodeRuntimeContext(options)),
});

export const restoreSnapshot = tool({
  description:
    "Reconnect to a previously returned Daytona sandbox handle for the project workspace.",
  inputSchema: RestoreSnapshotInputSchema,
  outputSchema: RestoreSnapshotOutputSchema,
  execute: async (input, options: unknown) =>
    executeRestoreSnapshot(input, getCodeRuntimeContext(options)),
});
