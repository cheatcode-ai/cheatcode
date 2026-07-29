import { z } from "zod";

const SandboxFileEntryShape = {
  modifiedAt: z.string(),
  name: z.string(),
  path: z.string(),
  relativePath: z.string(),
  size: z.number().int().nonnegative(),
  type: z.enum(["file", "directory", "symlink", "other"]),
} satisfies z.ZodRawShape;

type SandboxFileEntryShapeWithPath<PathSchema extends z.ZodType<string>> = Omit<
  typeof SandboxFileEntryShape,
  "path"
> & {
  path: PathSchema;
};

/**
 * Builds every sandbox file-entry schema from one field definition. The list
 * order option preserves the existing code-tool JSON Schema serialization.
 */
export function sandboxFileEntryShape<PathSchema extends z.ZodType<string>>(
  path: PathSchema,
  order: "canonical" | "list-files" = "canonical",
): SandboxFileEntryShapeWithPath<PathSchema> {
  const shape = { ...SandboxFileEntryShape, path };
  if (order === "canonical") {
    return shape;
  }
  const { modifiedAt, size, type, ...leadingFields } = shape;
  return { ...leadingFields, type, size, modifiedAt };
}

const SandboxExecResultBaseShape = {
  command: z.string(),
  durationMs: z.number().int().nonnegative().optional(),
  exitCode: z.number().int(),
  stderr: z.string(),
  stdout: z.string(),
  success: z.boolean(),
} satisfies z.ZodRawShape;

const SandboxExecResultBaseSchema = z.object(SandboxExecResultBaseShape).strict();

export type SandboxExecResultBase = z.infer<typeof SandboxExecResultBaseSchema>;

/**
 * Extends the canonical exec-result base while preserving the terminal wire
 * schema's existing placement of `cwd` immediately after `command`.
 */
export function extendSandboxExecResultShape<Extension extends z.ZodRawShape>(
  extension: Extension,
): typeof SandboxExecResultBaseShape & Extension {
  const { command, ...remainingBase } = SandboxExecResultBaseShape;
  return { command, ...extension, ...remainingBase };
}
