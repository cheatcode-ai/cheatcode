import type { MorphApplyRuntime } from "@cheatcode/morph";
import { APIError } from "@cheatcode/observability";
import type { CodeRuntimeContextFor } from "@cheatcode/sandbox-contracts";
import { sandboxFileEntryShape } from "@cheatcode/types";
import { z } from "zod";
import {
  resolveProjectWorkspacePath,
  WorkspaceFilePathSchema,
  WorkspacePathSchema,
} from "./workspace-paths";

const EncodingSchema = z.enum(["utf8", "base64"]);
const EXISTING_CODE_MARKER = "// ... existing code ...";
const MORPH_APPLY_TIMEOUT_MS = 45_000;

export const ReadFileInputSchema = z.strictObject({
  path: WorkspaceFilePathSchema.describe(
    "Absolute file path under /workspace, for example /workspace/<project>/package.json.",
  ),
  encoding: EncodingSchema.optional().describe("Read text as utf8 or binary data as base64."),
});

export const ReadFileOutputSchema = z.strictObject({
  path: z.string(),
  content: z.string(),
  encoding: EncodingSchema,
  size: z.number().int().nonnegative().optional(),
});

export const WriteFileInputSchema = z.strictObject({
  path: WorkspaceFilePathSchema.describe("Absolute file path under /workspace."),
  content: z.string().max(2_000_000).describe("File contents to write."),
  encoding: EncodingSchema.default("utf8").describe("Write text as utf8 or binary as base64."),
});

export const WriteFileOutputSchema = z.strictObject({
  path: z.string(),
  success: z.boolean(),
});

export const ApplyFileInputSchema = z.strictObject({
  path: WorkspaceFilePathSchema.describe(
    "Absolute path of an existing UTF-8 file under /workspace.",
  ),
  instruction: z
    .string()
    .trim()
    .min(1)
    .max(2_000)
    .describe("A precise first-person description of the intended change."),
  codeEdit: z
    .string()
    .min(1)
    .max(300_000)
    .refine(
      (value) => value.includes(EXISTING_CODE_MARKER),
      `Sparse edits must include ${EXISTING_CODE_MARKER}`,
    )
    .describe("Only changed code with // ... existing code ... marking unchanged regions."),
});

export const ApplyFileOutputSchema = z.strictObject({
  path: z.string(),
  success: z.boolean(),
});

export const ListFilesInputSchema = z.strictObject({
  path: WorkspacePathSchema.describe("Absolute directory path under /workspace."),
  includeHidden: z
    .boolean()
    .default(false)
    .describe("Include dotfiles and dot-directories when true."),
  recursive: z.boolean().default(false).describe("List descendants recursively when true."),
});

const FileEntrySchema = z.strictObject(sandboxFileEntryShape(z.string(), "list-files"));

export const ListFilesOutputSchema = z.strictObject({
  path: z.string(),
  files: z.array(FileEntrySchema),
});

export const SearchFilesInputSchema = z.strictObject({
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
});

const SearchFilesMatchSchema = z.strictObject({
  column: z.number().int().nonnegative().optional(),
  context: z.string().optional(),
  line: z.number().int().positive(),
  path: z.string(),
  text: z.string(),
});

export const SearchFilesOutputSchema = z.strictObject({
  matches: z.array(SearchFilesMatchSchema),
  query: z.string(),
  total: z.number().int().nonnegative(),
  truncated: z.boolean().optional(),
});

export const DeleteFileInputSchema = z.strictObject({
  path: WorkspaceFilePathSchema.refine(
    (path) => path !== "/workspace/",
    "Delete path must be inside /workspace and not /workspace itself.",
  ),
  recursive: z.boolean().default(false),
});

export const DeleteFileOutputSchema = z.strictObject({
  path: z.string(),
  success: z.boolean(),
});

type ReadFileInput = z.input<typeof ReadFileInputSchema>;
type ReadFileOutput = z.infer<typeof ReadFileOutputSchema>;
type WriteFileInput = z.input<typeof WriteFileInputSchema>;
type WriteFileOutput = z.infer<typeof WriteFileOutputSchema>;
type ApplyFileInput = z.input<typeof ApplyFileInputSchema>;
type ApplyFileOutput = z.infer<typeof ApplyFileOutputSchema>;
type ListFilesInput = z.input<typeof ListFilesInputSchema>;
type ListFilesOutput = z.infer<typeof ListFilesOutputSchema>;
type SearchFilesInput = z.input<typeof SearchFilesInputSchema>;
type SearchFilesOutput = z.infer<typeof SearchFilesOutputSchema>;
type DeleteFileInput = z.input<typeof DeleteFileInputSchema>;
type DeleteFileOutput = z.infer<typeof DeleteFileOutputSchema>;

export async function executeReadFile(
  input: ReadFileInput,
  runtimeContext: CodeRuntimeContextFor<"readFile">,
): Promise<ReadFileOutput> {
  const parsedInput = ReadFileInputSchema.parse(input);
  return ReadFileOutputSchema.parse(
    await runtimeContext.sandbox.readFile({
      path: resolveProjectWorkspacePath(parsedInput.path, runtimeContext.workspaceDir),
      ...(parsedInput.encoding ? { encoding: parsedInput.encoding } : {}),
    }),
  );
}

export async function executeWriteFile(
  input: WriteFileInput,
  runtimeContext: CodeRuntimeContextFor<"writeFile">,
): Promise<WriteFileOutput> {
  const parsedInput = WriteFileInputSchema.parse(input);
  const output = WriteFileOutputSchema.parse(
    await runtimeContext.sandbox.writeFile({
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

export async function executeApplyFile(
  input: ApplyFileInput,
  runtimeContext: CodeRuntimeContextFor<"compareAndSwapFile" | "readFile">,
  morph: MorphApplyRuntime,
): Promise<ApplyFileOutput> {
  const parsedInput = ApplyFileInputSchema.parse(input);
  const path = resolveProjectWorkspacePath(parsedInput.path, runtimeContext.workspaceDir);
  const existing = await runtimeContext.sandbox.readFile({ encoding: "utf8", path });
  assertEditableText(existing.content);
  const expectedSha256 = await sha256(existing.content);
  const applied = await morph.applyEdit(
    {
      codeEdit: parsedInput.codeEdit,
      instruction: parsedInput.instruction,
      originalCode: existing.content,
    },
    MORPH_APPLY_TIMEOUT_MS,
  );
  assertValidAppliedFile(existing.content, applied.mergedCode);
  const output = ApplyFileOutputSchema.parse(
    await runtimeContext.sandbox.compareAndSwapFile({
      content: applied.mergedCode,
      expectedSha256,
      path,
    }),
  );
  if (!output.success) {
    throw new APIError(502, "sandbox_command_failed", "Sandbox file edit failed", {
      retriable: true,
    });
  }
  return output;
}

function assertEditableText(content: string): void {
  if (content.includes("\u0000") || content.includes("\uFFFD")) {
    throw new APIError(422, "tool_validation_failed", "FastApply requires a UTF-8 text file", {
      hint: "Use fs_write with base64 for binary files.",
      retriable: false,
    });
  }
}

function assertValidAppliedFile(original: string, merged: string): void {
  const byteLength = new TextEncoder().encode(merged).byteLength;
  if (merged.length === 0 || byteLength > 2_000_000) {
    throw new APIError(502, "upstream_provider_outage", "FastApply returned an invalid file", {
      hint: "Retry with a smaller edit or use fs_write for an intentional full replacement.",
      retriable: true,
    });
  }
  if (original.length >= 10_000 && merged.length < original.length / 10) {
    throw new APIError(502, "upstream_provider_outage", "FastApply truncated the source file", {
      hint: "Retry the sparse edit. Use fs_write only for an intentional full replacement.",
      retriable: true,
    });
  }
}

async function sha256(content: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(content));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function executeListFiles(
  input: ListFilesInput,
  runtimeContext: CodeRuntimeContextFor<"listFiles">,
): Promise<ListFilesOutput> {
  const parsedInput = ListFilesInputSchema.parse(input);
  return ListFilesOutputSchema.parse(
    await runtimeContext.sandbox.listFiles({
      path: resolveProjectWorkspacePath(parsedInput.path, runtimeContext.workspaceDir),
      includeHidden: parsedInput.includeHidden,
      recursive: parsedInput.recursive,
    }),
  );
}

export async function executeSearchFiles(
  input: SearchFilesInput,
  runtimeContext: CodeRuntimeContextFor<"searchFiles">,
): Promise<SearchFilesOutput> {
  const parsedInput = SearchFilesInputSchema.parse(input);
  return SearchFilesOutputSchema.parse(
    await runtimeContext.sandbox.searchFiles({
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
  runtimeContext: CodeRuntimeContextFor<"deleteFile">,
): Promise<DeleteFileOutput> {
  const parsedInput = DeleteFileInputSchema.parse(input);
  const output = DeleteFileOutputSchema.parse(
    await runtimeContext.sandbox.deleteFile({
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
