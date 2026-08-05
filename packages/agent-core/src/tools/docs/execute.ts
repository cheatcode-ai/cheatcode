import { APIError } from "@cheatcode/observability";
import type {
  ArtifactKind,
  ArtifactUploadResult,
  CodeRuntimeContext,
} from "@cheatcode/sandbox-contracts";
import { lexer } from "marked";
import { z } from "zod";
import {
  type GenerateDocumentInput,
  GenerateDocumentInputSchema,
  type GenerateDocxOutput,
  GenerateDocxOutputSchema,
  type GenerateMarkdownPdfInput,
  GenerateMarkdownPdfInputSchema,
  type GenerateMarkdownPdfOutput,
  GenerateMarkdownPdfOutputSchema,
  type GeneratePdfOutput,
  GeneratePdfOutputSchema,
  type GenerateSlidesInput,
  GenerateSlidesInputSchema,
  type GenerateSlidesOutput,
  GenerateSlidesOutputSchema,
  type GenerateSpreadsheetInput,
  GenerateSpreadsheetInputSchema,
  type GenerateXlsxOutput,
  GenerateXlsxOutputSchema,
} from "./schemas";
import {
  buildDocxScript,
  buildMarkdownPdfScript,
  buildPdfScript,
  buildSlidesScript,
  buildXlsxScript,
} from "./scripts";

const SandboxArtifactSchema = z.strictObject({
  base64: z.string().min(1),
  filename: z.string().min(1),
  mimeType: z.string().min(1),
});

type SandboxArtifact = z.infer<typeof SandboxArtifactSchema>;

const MAX_WORKSPACE_ARTIFACT_BASE64_CHARS = 2_000_000;
const MAX_STAGED_INPUT_CHARACTERS = 1_900_000;
const WORKSPACE_ROOT = "/workspace";
const ARTIFACT_STAGING_DIRECTORY = ".cheatcode/artifact-inputs";
const ARTIFACT_STDOUT_MARKER = "__CHEATCODE_ARTIFACT__";

export async function executeGenerateSlides(
  input: GenerateSlidesInput,
  runtimeContext: CodeRuntimeContext,
): Promise<GenerateSlidesOutput> {
  const parsed = GenerateSlidesInputSchema.parse(input);
  const filename = normalizeFilename(parsed.filename ?? parsed.title, "pptx");
  const artifact = await runArtifactScript(parsed, runtimeContext, "slide", (inputPath) =>
    buildSlidesScript(inputPath, filename),
  );
  return GenerateSlidesOutputSchema.parse({
    ...artifact,
    kind: "slide",
    slideCount: parsed.slides.length,
  });
}

export async function executeGenerateDocx(
  input: GenerateDocumentInput,
  runtimeContext: CodeRuntimeContext,
): Promise<GenerateDocxOutput> {
  const parsed = GenerateDocumentInputSchema.parse(input);
  const filename = normalizeFilename(parsed.filename ?? parsed.title, "docx");
  const artifact = await runArtifactScript(parsed, runtimeContext, "docx", (inputPath) =>
    buildDocxScript(inputPath, filename),
  );
  return GenerateDocxOutputSchema.parse({
    ...artifact,
    kind: "docx",
    sectionCount: parsed.sections.length,
  });
}

export async function executeGeneratePdf(
  input: GenerateDocumentInput,
  runtimeContext: CodeRuntimeContext,
): Promise<GeneratePdfOutput> {
  const parsed = GenerateDocumentInputSchema.parse(input);
  const filename = normalizeFilename(parsed.filename ?? parsed.title, "pdf");
  const artifact = await runArtifactScript(parsed, runtimeContext, "pdf", (inputPath) =>
    buildPdfScript(inputPath, filename),
  );
  return GeneratePdfOutputSchema.parse({
    ...artifact,
    kind: "pdf",
    sectionCount: parsed.sections.length,
  });
}

export async function executeGenerateMarkdownPdf(
  input: GenerateMarkdownPdfInput,
  runtimeContext: CodeRuntimeContext,
): Promise<GenerateMarkdownPdfOutput> {
  const parsed = GenerateMarkdownPdfInputSchema.parse(input);
  const filename = normalizeFilename(parsed.filename ?? parsed.title ?? "research-report", "pdf");
  const tokens = lexer(parsed.markdown, { gfm: true });
  const artifact = await runArtifactScript(
    { markdown: parsed.markdown, title: parsed.title, tokens },
    runtimeContext,
    "pdf",
    (inputPath) => buildMarkdownPdfScript(inputPath, filename),
  );
  return GenerateMarkdownPdfOutputSchema.parse({
    ...artifact,
    blockCount: tokens.filter((token) => token.type !== "space").length,
    kind: "pdf",
  });
}

export async function executeGenerateXlsx(
  input: GenerateSpreadsheetInput,
  runtimeContext: CodeRuntimeContext,
): Promise<GenerateXlsxOutput> {
  const parsed = GenerateSpreadsheetInputSchema.parse(input);
  const filename = normalizeFilename(parsed.filename ?? parsed.title, "xlsx");
  const artifact = await runArtifactScript(parsed, runtimeContext, "xlsx", (inputPath) =>
    buildXlsxScript(inputPath, filename),
  );
  return GenerateXlsxOutputSchema.parse({
    ...artifact,
    kind: "xlsx",
    sheetCount: parsed.sheets.length,
  });
}

async function runArtifactScript(
  input: unknown,
  runtimeContext: CodeRuntimeContext,
  kind: ArtifactKind,
  buildScript: (inputPath: string) => string,
): Promise<ArtifactUploadResult> {
  if (!runtimeContext.artifacts) {
    throw new APIError(500, "internal_service_error", "Artifact storage is unavailable", {
      retriable: true,
    });
  }

  const staging = stagedArtifactInput(input, runtimeContext.workspaceDir ?? WORKSPACE_ROOT);
  try {
    await runtimeContext.sandbox.writeFile({ content: staging.content, path: staging.path });
    const result = await runtimeContext.sandbox.runCode({
      code: buildScript(staging.path),
      cwd: runtimeContext.workspaceDir ?? WORKSPACE_ROOT,
      language: "javascript",
    });
    if (!result.success) {
      throw new APIError(502, "upstream_sandbox_failed", "Document generation failed", {
        details: {
          inputCharacters: staging.content.length,
          stderrBytes: result.stderr.length,
          stdoutBytes: result.stdout.length,
        },
        retriable: false,
      });
    }

    const generated = parseSandboxArtifact(result.stdout);
    await writeWorkspaceArtifact(runtimeContext, generated);
    return await runtimeContext.artifacts.put({
      contentType: generated.mimeType,
      data: base64ToBytes(generated.base64),
      filename: generated.filename,
      kind,
    });
  } finally {
    await runtimeContext.sandbox.deleteFile({ path: staging.path }).catch(() => undefined);
  }
}

function stagedArtifactInput(
  input: unknown,
  workspaceDir: string,
): { content: string; path: string } {
  const content = JSON.stringify(input);
  if (content.length > MAX_STAGED_INPUT_CHARACTERS) {
    throw new APIError(422, "tool_validation_failed", "Document input is too large", {
      details: { inputCharacters: content.length },
      retriable: false,
    });
  }
  return {
    content,
    path: `${workspaceDir}/${ARTIFACT_STAGING_DIRECTORY}/${crypto.randomUUID()}.json`,
  };
}

async function writeWorkspaceArtifact(
  runtimeContext: CodeRuntimeContext,
  artifact: SandboxArtifact,
): Promise<void> {
  if (!runtimeContext.sandbox.writeFile) {
    return;
  }
  if (artifact.base64.length > MAX_WORKSPACE_ARTIFACT_BASE64_CHARS) {
    return;
  }
  try {
    // The run's own project folder is authoritative in the shared per-user sandbox — write the
    // live file there so it shows in THIS project's Files/Computer tab instead of leaking into a
    // sibling project's /workspace/<slug> (matches the code tool's resolveWorkspaceDir).
    const directory = runtimeContext.workspaceDir ?? WORKSPACE_ROOT;
    await runtimeContext.sandbox.writeFile({
      content: artifact.base64,
      encoding: "base64",
      path: `${directory}/${artifact.filename}`,
    });
  } catch {
    // Artifact storage is the durable deliverable path; workspace writes are a live-files convenience.
  }
}

function parseSandboxArtifact(stdout: string): SandboxArtifact {
  try {
    const markerIndex = stdout.lastIndexOf(ARTIFACT_STDOUT_MARKER);
    const payload =
      markerIndex === -1
        ? stdout.trim()
        : stdout.slice(markerIndex + ARTIFACT_STDOUT_MARKER.length).trim();
    return SandboxArtifactSchema.parse(JSON.parse(payload));
  } catch (error) {
    throw new APIError(
      502,
      "upstream_sandbox_failed",
      "Sandbox returned invalid artifact metadata",
      {
        cause: error,
        retriable: false,
      },
    );
  }
}

function normalizeFilename(value: string, extension: string): string {
  const base = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 96);
  const safeBase = base.length > 0 ? base : "cheatcode-output";
  return safeBase.endsWith(`.${extension}`) ? safeBase : `${safeBase}.${extension}`;
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}
