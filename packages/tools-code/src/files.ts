import { APIError } from "@cheatcode/observability";
import { callSandboxMethod, type getCodeRuntimeContext } from "@cheatcode/sandbox-contracts";
import { z } from "zod";
import {
  resolveProjectWorkspacePath,
  WorkspaceFilePathSchema,
  WorkspacePathSchema,
} from "./workspace-paths";

const EncodingSchema = z.enum(["utf8", "base64"]);

export const ReadFileInputSchema = z
  .object({
    path: WorkspaceFilePathSchema.describe(
      "Absolute file path under /workspace, for example /workspace/<project>/package.json.",
    ),
    encoding: EncodingSchema.optional().describe("Read text as utf8 or binary data as base64."),
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
    path: WorkspaceFilePathSchema.describe("Absolute file path under /workspace."),
    content: z.string().max(2_000_000).describe("File contents to write."),
    encoding: EncodingSchema.default("utf8").describe("Write text as utf8 or binary as base64."),
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
    path: WorkspacePathSchema.describe("Absolute directory path under /workspace."),
    includeHidden: z
      .boolean()
      .default(false)
      .describe("Include dotfiles and dot-directories when true."),
    recursive: z.boolean().default(false).describe("List descendants recursively when true."),
  })
  .strict();

const FileEntrySchema = z
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

const SearchFilesMatchSchema = z
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

type ReadFileInput = z.input<typeof ReadFileInputSchema>;
type ReadFileOutput = z.infer<typeof ReadFileOutputSchema>;
export type WriteFileInput = z.input<typeof WriteFileInputSchema>;
export type WriteFileOutput = z.infer<typeof WriteFileOutputSchema>;
type ListFilesInput = z.input<typeof ListFilesInputSchema>;
type ListFilesOutput = z.infer<typeof ListFilesOutputSchema>;
type SearchFilesInput = z.input<typeof SearchFilesInputSchema>;
type SearchFilesOutput = z.infer<typeof SearchFilesOutputSchema>;
type DeleteFileInput = z.input<typeof DeleteFileInputSchema>;
type DeleteFileOutput = z.infer<typeof DeleteFileOutputSchema>;

export async function executeReadFile(
  input: ReadFileInput,
  runtimeContext: ReturnType<typeof getCodeRuntimeContext>,
): Promise<ReadFileOutput> {
  const parsedInput = ReadFileInputSchema.parse(input);
  return ReadFileOutputSchema.parse(
    await callSandboxMethod(runtimeContext.sandbox, "readFile", {
      path: resolveProjectWorkspacePath(parsedInput.path, runtimeContext.workspaceDir),
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
      path: resolveProjectWorkspacePath(parsedInput.path, runtimeContext.workspaceDir),
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
      path: resolveProjectWorkspacePath(parsedInput.path, runtimeContext.workspaceDir),
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
      path: resolveProjectWorkspacePath(parsedInput.path, runtimeContext.workspaceDir),
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
      path: resolveProjectWorkspacePath(parsedInput.path, runtimeContext.workspaceDir),
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
