import { APIError } from "@cheatcode/observability";
import type {
  ArtifactKind,
  ArtifactUploadResult,
  CodeRuntimeContextFor,
} from "@cheatcode/sandbox-contracts";
import { GENERATED_OUTPUT_MAX_BYTES } from "@cheatcode/types/artifacts";
import { z } from "zod";
import { resolveProjectWorkspacePath, WorkspaceFilePathSchema } from "./workspace-paths";

interface DeliverableType {
  contentType: string;
  kind: ArtifactKind;
}

const DELIVERABLE_TYPES: Readonly<Record<string, DeliverableType>> = {
  csv: { contentType: "text/csv", kind: "file" },
  docx: {
    contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    kind: "docx",
  },
  gif: { contentType: "image/gif", kind: "image" },
  gz: { contentType: "application/gzip", kind: "file" },
  html: { contentType: "text/html", kind: "file" },
  jpeg: { contentType: "image/jpeg", kind: "image" },
  jpg: { contentType: "image/jpeg", kind: "image" },
  json: { contentType: "application/json", kind: "file" },
  md: { contentType: "text/markdown", kind: "file" },
  mp4: { contentType: "video/mp4", kind: "video" },
  pdf: { contentType: "application/pdf", kind: "pdf" },
  png: { contentType: "image/png", kind: "image" },
  pptx: {
    contentType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    kind: "slide",
  },
  svg: { contentType: "image/svg+xml", kind: "image" },
  tar: { contentType: "application/x-tar", kind: "file" },
  tsv: { contentType: "text/tab-separated-values", kind: "file" },
  txt: { contentType: "text/plain", kind: "file" },
  webm: { contentType: "video/webm", kind: "video" },
  webp: { contentType: "image/webp", kind: "image" },
  xlsx: {
    contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    kind: "xlsx",
  },
  zip: { contentType: "application/zip", kind: "file" },
};

export const PublishDeliverableInputSchema = z.strictObject({
  filename: z
    .string()
    .trim()
    .min(1)
    .max(255)
    .refine((value) => !value.includes("/") && !value.includes("\\"), {
      message: "Deliverable filename cannot contain a path.",
    })
    .optional()
    .describe("Optional download filename. Defaults to the source file name."),
  path: WorkspaceFilePathSchema.describe(
    "Absolute path of the finished file under /workspace to publish as a Deliverable.",
  ),
});

export const PublishDeliverableOutputSchema = z.strictObject({
  filename: z.string().min(1),
  kind: z.enum(["docx", "file", "image", "pdf", "slide", "video", "xlsx"]),
  mimeType: z.string().min(1),
  outputId: z.string().uuid(),
  sizeBytes: z.number().int().positive(),
});

type PublishDeliverableInput = z.input<typeof PublishDeliverableInputSchema>;
type PublishDeliverableOutput = z.output<typeof PublishDeliverableOutputSchema>;

/** Publishes one already-finished workspace file through the durable artifact boundary. */
export async function executePublishDeliverable(
  input: PublishDeliverableInput,
  runtimeContext: CodeRuntimeContextFor<"readFile">,
): Promise<PublishDeliverableOutput> {
  const parsed = PublishDeliverableInputSchema.parse(input);
  if (!runtimeContext.artifacts) {
    throw new APIError(500, "internal_service_error", "Artifact storage is unavailable", {
      retriable: true,
    });
  }
  const sourcePath = resolveProjectWorkspacePath(parsed.path, runtimeContext.workspaceDir);
  const sourceName = sourceFilename(sourcePath);
  const sourceType = typeForFilename(sourceName);
  const filename = parsed.filename ?? sourceName;
  const deliverableType = typeForFilename(filename);
  if (deliverableType.contentType !== sourceType.contentType) {
    throw new APIError(
      422,
      "tool_validation_failed",
      "Deliverable filename must keep the source file type",
      {
        hint: `Use a ${sourceName.split(".").at(-1)?.toLowerCase()} filename or convert the source file first.`,
        retriable: false,
      },
    );
  }
  const file = await runtimeContext.sandbox.readFile({ encoding: "base64", path: sourcePath });
  const data = decodeBase64(file.content);
  if (data.byteLength === 0 || data.byteLength > GENERATED_OUTPUT_MAX_BYTES) {
    throw new APIError(422, "tool_validation_failed", "Deliverable file size is unsupported", {
      details: { maximumBytes: GENERATED_OUTPUT_MAX_BYTES, sizeBytes: data.byteLength },
      retriable: false,
    });
  }
  const result: ArtifactUploadResult = await runtimeContext.artifacts.put({
    contentType: deliverableType.contentType,
    data,
    exposure: "deliverable",
    filename,
    kind: deliverableType.kind,
  });
  return PublishDeliverableOutputSchema.parse(result);
}

function sourceFilename(path: string): string {
  const filename = path.split("/").at(-1)?.trim();
  if (!filename) {
    throw new APIError(400, "tool_validation_failed", "Deliverable path has no filename", {
      retriable: false,
    });
  }
  return filename;
}

function typeForFilename(filename: string): DeliverableType {
  const extension = filename.split(".").at(-1)?.toLowerCase();
  const match = extension ? DELIVERABLE_TYPES[extension] : undefined;
  if (!match) {
    throw new APIError(422, "tool_validation_failed", "Deliverable file type is unsupported", {
      hint: `Use one of: ${Object.keys(DELIVERABLE_TYPES).join(", ")}.`,
      retriable: false,
    });
  }
  return match;
}

function decodeBase64(value: string): Uint8Array {
  try {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
  } catch (error) {
    throw new APIError(502, "upstream_sandbox_failed", "Sandbox returned invalid file data", {
      cause: error,
      retriable: false,
    });
  }
}
