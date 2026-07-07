import { APIError } from "@cheatcode/observability";
import type { ArtifactKind, ArtifactUploadResult, CodeRuntimeContext } from "@cheatcode/tools-code";
import { z } from "zod";
import {
  type GenerateDocumentInput,
  GenerateDocumentInputSchema,
  type GenerateDocxOutput,
  GenerateDocxOutputSchema,
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
import { buildDocxScript, buildPdfScript, buildSlidesScript, buildXlsxScript } from "./scripts";

const SandboxArtifactSchema = z
  .object({
    base64: z.string().min(1),
    filename: z.string().min(1),
    mimeType: z.string().min(1),
  })
  .strict();

type SandboxArtifact = z.infer<typeof SandboxArtifactSchema>;

const MAX_WORKSPACE_ARTIFACT_BASE64_CHARS = 2_000_000;
const WORKSPACE_ROOT = "/workspace";

export async function executeGenerateSlides(
  input: GenerateSlidesInput,
  runtimeContext: CodeRuntimeContext,
): Promise<GenerateSlidesOutput> {
  const parsed = GenerateSlidesInputSchema.parse(input);
  const filename = normalizeFilename(parsed.filename ?? parsed.title, "pptx");
  const artifact = await runArtifactScript(
    buildSlidesScript(parsed, filename),
    runtimeContext,
    "slide",
    { slideCount: parsed.slides.length, theme: parsed.theme },
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
  const artifact = await runArtifactScript(
    buildDocxScript(parsed, filename),
    runtimeContext,
    "docx",
    { sectionCount: parsed.sections.length },
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
  const artifact = await runArtifactScript(
    buildPdfScript(parsed, filename),
    runtimeContext,
    "pdf",
    { sectionCount: parsed.sections.length },
  );
  return GeneratePdfOutputSchema.parse({
    ...artifact,
    kind: "pdf",
    sectionCount: parsed.sections.length,
  });
}

export async function executeGenerateXlsx(
  input: GenerateSpreadsheetInput,
  runtimeContext: CodeRuntimeContext,
): Promise<GenerateXlsxOutput> {
  const parsed = GenerateSpreadsheetInputSchema.parse(input);
  const filename = normalizeFilename(parsed.filename ?? parsed.title, "xlsx");
  const artifact = await runArtifactScript(
    buildXlsxScript(parsed, filename),
    runtimeContext,
    "xlsx",
    { sheetCount: parsed.sheets.length },
  );
  return GenerateXlsxOutputSchema.parse({
    ...artifact,
    kind: "xlsx",
    sheetCount: parsed.sheets.length,
  });
}

async function runArtifactScript(
  code: string,
  runtimeContext: CodeRuntimeContext,
  kind: ArtifactKind,
  metadata: Record<string, unknown>,
): Promise<ArtifactUploadResult> {
  if (!runtimeContext.artifacts) {
    throw new APIError(500, "internal_error", "Artifact storage is unavailable", {
      retriable: true,
    });
  }

  const result = await runtimeContext.sandbox.runCode({
    code,
    language: "javascript",
  });
  if (result.success !== true) {
    throw new APIError(502, "upstream_sandbox_failed", "Document generation failed", {
      details: {
        stderrBytes: (result.stderr ?? "").length,
        stdoutBytes: (result.stdout ?? "").length,
      },
      retriable: false,
    });
  }

  const generated = parseSandboxArtifact(result.stdout ?? "");
  await writeWorkspaceArtifact(runtimeContext, generated);
  return runtimeContext.artifacts.put({
    contentType: generated.mimeType,
    data: base64ToBytes(generated.base64),
    filename: generated.filename,
    kind,
    metadata,
  });
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
    const directory = await resolveWorkspaceArtifactDirectory(runtimeContext);
    await runtimeContext.sandbox.writeFile({
      content: artifact.base64,
      encoding: "base64",
      path: `${directory}/${artifact.filename}`,
    });
  } catch {
    // Artifact storage is the durable deliverable path; workspace writes are a live-files convenience.
  }
}

async function resolveWorkspaceArtifactDirectory(
  runtimeContext: CodeRuntimeContext,
): Promise<string> {
  if (!runtimeContext.sandbox.listFiles) {
    return WORKSPACE_ROOT;
  }
  const result = await runtimeContext.sandbox.listFiles({
    includeHidden: false,
    path: WORKSPACE_ROOT,
  });
  const directories = result.files
    .filter((file) => file.type === "directory" && isLikelyProjectDirectory(file.relativePath))
    .toSorted(compareWorkspaceDirectoryPreference);
  return directories[0]?.path ?? WORKSPACE_ROOT;
}

function isLikelyProjectDirectory(path: string): boolean {
  const name = path.toLowerCase();
  return name !== "node_modules" && name !== ".git" && name !== "data";
}

function compareWorkspaceDirectoryPreference(
  left: { relativePath: string },
  right: { relativePath: string },
): number {
  const leftScore = workspaceDirectoryPreferenceScore(left.relativePath);
  const rightScore = workspaceDirectoryPreferenceScore(right.relativePath);
  if (leftScore !== rightScore) {
    return leftScore - rightScore;
  }
  return left.relativePath.localeCompare(right.relativePath);
}

function workspaceDirectoryPreferenceScore(path: string): number {
  const name = path.toLowerCase();
  if (name === "app" || name.endsWith("-app")) {
    return 0;
  }
  if (name.includes("dashboard") || name.includes("site") || name.includes("web")) {
    return 1;
  }
  return 2;
}

function parseSandboxArtifact(stdout: string): SandboxArtifact {
  try {
    return SandboxArtifactSchema.parse(JSON.parse(stdout.trim()));
  } catch (error) {
    throw new APIError(
      502,
      "upstream_sandbox_failed",
      "Sandbox returned invalid artifact metadata",
      {
        details: { error: error instanceof Error ? error.message : "Unknown parse error" },
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
