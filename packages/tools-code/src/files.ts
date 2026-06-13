import { APIError } from "@cheatcode/observability";
import { tool } from "ai";
import { z } from "zod";
import { getCodeRuntimeContext } from "./runtime";
import { callSandboxMethod } from "./sandbox-methods";
import { WorkspaceFilePathSchema, WorkspacePathSchema } from "./workspace-paths";

const EncodingSchema = z.enum(["utf8", "base64"]);

export const ReadFileInputSchema = z
  .object({
    path: WorkspaceFilePathSchema,
    encoding: EncodingSchema.optional(),
  })
  .strict();

export const ReadFileOutputSchema = z
  .object({
    path: z.string(),
    content: z.string(),
    encoding: EncodingSchema,
    size: z.number().int().nonnegative().optional(),
  })
  .strict();

export const WriteFileInputSchema = z
  .object({
    path: WorkspaceFilePathSchema,
    content: z.string().max(2_000_000),
    encoding: EncodingSchema.default("utf8"),
  })
  .strict();

export const WriteFileOutputSchema = z
  .object({
    path: z.string(),
    success: z.boolean(),
  })
  .strict();

export const ListFilesInputSchema = z
  .object({
    path: WorkspacePathSchema,
    includeHidden: z.boolean().default(false),
    recursive: z.boolean().default(false),
  })
  .strict();

export const FileEntrySchema = z
  .object({
    name: z.string(),
    path: z.string(),
    relativePath: z.string(),
    type: z.enum(["file", "directory", "symlink", "other"]),
    size: z.number().int().nonnegative(),
    modifiedAt: z.string(),
  })
  .strict();

export const ListFilesOutputSchema = z
  .object({
    path: z.string(),
    files: z.array(FileEntrySchema),
  })
  .strict();

export const SearchFilesInputSchema = z
  .object({
    path: WorkspacePathSchema,
    query: z.string().min(1).max(500),
    caseSensitive: z.boolean().default(false),
    contextLines: z.number().int().min(0).max(10).default(0),
    excludeDirs: z
      .array(z.string().min(1).max(200))
      .max(25)
      .default(["node_modules", ".git", ".next", ".turbo"]),
    filePattern: z.string().min(1).max(200).optional(),
    maxResults: z.number().int().positive().max(1_000).default(100),
  })
  .strict();

export const SearchFilesMatchSchema = z
  .object({
    column: z.number().int().nonnegative().optional(),
    context: z.string().optional(),
    line: z.number().int().positive(),
    path: z.string(),
    text: z.string(),
  })
  .strict();

export const SearchFilesOutputSchema = z
  .object({
    matches: z.array(SearchFilesMatchSchema),
    query: z.string(),
    total: z.number().int().nonnegative(),
    truncated: z.boolean().optional(),
  })
  .strict();

export const DeleteFileInputSchema = z
  .object({
    path: WorkspaceFilePathSchema.refine(
      (path) => path !== "/workspace/",
      "Delete path must be inside /workspace and not /workspace itself.",
    ),
    recursive: z.boolean().default(false),
  })
  .strict();

export const DeleteFileOutputSchema = z
  .object({
    path: z.string(),
    success: z.boolean(),
  })
  .strict();

export type ReadFileInput = z.input<typeof ReadFileInputSchema>;
export type ReadFileOutput = z.infer<typeof ReadFileOutputSchema>;
export type WriteFileInput = z.input<typeof WriteFileInputSchema>;
export type WriteFileOutput = z.infer<typeof WriteFileOutputSchema>;
export type ListFilesInput = z.input<typeof ListFilesInputSchema>;
export type ListFilesOutput = z.infer<typeof ListFilesOutputSchema>;
export type SearchFilesInput = z.input<typeof SearchFilesInputSchema>;
export type SearchFilesOutput = z.infer<typeof SearchFilesOutputSchema>;
export type DeleteFileInput = z.input<typeof DeleteFileInputSchema>;
export type DeleteFileOutput = z.infer<typeof DeleteFileOutputSchema>;

export async function executeReadFile(
  input: ReadFileInput,
  runtimeContext: ReturnType<typeof getCodeRuntimeContext>,
): Promise<ReadFileOutput> {
  const parsedInput = ReadFileInputSchema.parse(input);
  return ReadFileOutputSchema.parse(
    await callSandboxMethod(runtimeContext.sandbox, "readFile", {
      path: parsedInput.path,
      ...(parsedInput.encoding ? { encoding: parsedInput.encoding } : {}),
    }),
  );
}

export async function executeWriteFile(
  input: WriteFileInput,
  runtimeContext: ReturnType<typeof getCodeRuntimeContext>,
): Promise<WriteFileOutput> {
  const parsedInput = WriteFileInputSchema.parse(input);
  const output = WriteFileOutputSchema.parse(
    await callSandboxMethod(runtimeContext.sandbox, "writeFile", {
      path: parsedInput.path,
      content: parsedInput.content,
      encoding: parsedInput.encoding,
    }),
  );
  if (!output.success) {
    throw new APIError(502, "sandbox_command_failed", "Sandbox file write failed", {
      hint: "Check that the target path is writable and under the project workspace.",
      retriable: false,
      details: output,
    });
  }
  return output;
}

export async function executeListFiles(
  input: ListFilesInput,
  runtimeContext: ReturnType<typeof getCodeRuntimeContext>,
): Promise<ListFilesOutput> {
  const parsedInput = ListFilesInputSchema.parse(input);
  return ListFilesOutputSchema.parse(
    await callSandboxMethod(runtimeContext.sandbox, "listFiles", {
      path: parsedInput.path,
      includeHidden: parsedInput.includeHidden,
      recursive: parsedInput.recursive,
    }),
  );
}

export async function executeSearchFiles(
  input: SearchFilesInput,
  runtimeContext: ReturnType<typeof getCodeRuntimeContext>,
): Promise<SearchFilesOutput> {
  const parsedInput = SearchFilesInputSchema.parse(input);
  return SearchFilesOutputSchema.parse(
    await callSandboxMethod(runtimeContext.sandbox, "searchFiles", {
      caseSensitive: parsedInput.caseSensitive,
      contextLines: parsedInput.contextLines,
      excludeDirs: parsedInput.excludeDirs,
      ...(parsedInput.filePattern ? { filePattern: parsedInput.filePattern } : {}),
      maxResults: parsedInput.maxResults,
      path: parsedInput.path,
      query: parsedInput.query,
    }),
  );
}

export async function executeDeleteFile(
  input: DeleteFileInput,
  runtimeContext: ReturnType<typeof getCodeRuntimeContext>,
): Promise<DeleteFileOutput> {
  const parsedInput = DeleteFileInputSchema.parse(input);
  const output = DeleteFileOutputSchema.parse(
    await callSandboxMethod(runtimeContext.sandbox, "deleteFile", {
      path: parsedInput.path,
      recursive: parsedInput.recursive,
    }),
  );
  if (!output.success) {
    throw new APIError(502, "sandbox_command_failed", "Sandbox file delete failed", {
      hint: "Check that the target path exists and is inside the project workspace.",
      retriable: false,
      details: output,
    });
  }
  return output;
}

export const readFile = tool({
  description:
    "Read a UTF-8 text file or base64-encoded binary file under /workspace in the project sandbox.",
  inputSchema: ReadFileInputSchema,
  outputSchema: ReadFileOutputSchema,
  execute: async (input, options: unknown) =>
    executeReadFile(input, getCodeRuntimeContext(options)),
});

export const writeFile = tool({
  description:
    "Write a UTF-8 text file or base64-encoded binary file under /workspace in the project sandbox.",
  inputSchema: WriteFileInputSchema,
  outputSchema: WriteFileOutputSchema,
  execute: async (input, options: unknown) =>
    executeWriteFile(input, getCodeRuntimeContext(options)),
});

export const listFiles = tool({
  description: "List files under /workspace in the project sandbox, optionally recursively.",
  inputSchema: ListFilesInputSchema,
  outputSchema: ListFilesOutputSchema,
  execute: async (input, options: unknown) =>
    executeListFiles(input, getCodeRuntimeContext(options)),
});

export const searchFiles = tool({
  description:
    "Search file contents under /workspace in the project sandbox using Blaxel's optimized grep API.",
  inputSchema: SearchFilesInputSchema,
  outputSchema: SearchFilesOutputSchema,
  execute: async (input, options: unknown) =>
    executeSearchFiles(input, getCodeRuntimeContext(options)),
});

export const deleteFile = tool({
  description: "Delete a file or directory inside /workspace in the project sandbox.",
  inputSchema: DeleteFileInputSchema,
  outputSchema: DeleteFileOutputSchema,
  execute: async (input, options: unknown) =>
    executeDeleteFile(input, getCodeRuntimeContext(options)),
});
