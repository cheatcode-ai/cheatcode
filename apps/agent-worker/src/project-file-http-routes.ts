import { APIError, readBoundedRequestBytes } from "@cheatcode/observability";
import {
  PROJECT_FILE_MAX_BYTES,
  ProjectFileListSchema,
  ProjectFileUploadResponseSchema,
} from "@cheatcode/types";
import type { Context, Hono } from "hono";
import { z } from "zod";
import type { AgentEnv } from "./agent-env";
import { requireProjectAccess, sandboxForUser } from "./agent-routing";
import { readGatewayUserId } from "./tenancy";

const ProjectIdParamSchema = z.string().uuid().toLowerCase();
const FilenameQuerySchema = z.string().trim().min(1).max(255);
const TEXT_EXTENSIONS = new Map<string, string>([
  [".c", "text/x-c"],
  [".cpp", "text/x-c++"],
  [".css", "text/css"],
  [".csv", "text/csv"],
  [".go", "text/x-go"],
  [".h", "text/x-c"],
  [".html", "text/html"],
  [".java", "text/x-java-source"],
  [".js", "text/javascript"],
  [".json", "application/json"],
  [".jsonl", "application/x-ndjson"],
  [".jsx", "text/jsx"],
  [".log", "text/plain"],
  [".md", "text/markdown"],
  [".markdown", "text/markdown"],
  [".py", "text/x-python"],
  [".rb", "text/x-ruby"],
  [".rs", "text/x-rust"],
  [".sql", "application/sql"],
  [".toml", "application/toml"],
  [".ts", "text/typescript"],
  [".tsv", "text/tab-separated-values"],
  [".tsx", "text/tsx"],
  [".txt", "text/plain"],
  [".xml", "application/xml"],
  [".yaml", "application/yaml"],
  [".yml", "application/yaml"],
]);
const BINARY_TYPES = new Map<string, { mime: string; signature: BinarySignature }>([
  [
    ".docx",
    {
      mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      signature: "zip",
    },
  ],
  [".gif", { mime: "image/gif", signature: "gif" }],
  [".jpeg", { mime: "image/jpeg", signature: "jpeg" }],
  [".jpg", { mime: "image/jpeg", signature: "jpeg" }],
  [".pdf", { mime: "application/pdf", signature: "pdf" }],
  [".png", { mime: "image/png", signature: "png" }],
  [
    ".pptx",
    {
      mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      signature: "zip",
    },
  ],
  [".webp", { mime: "image/webp", signature: "webp" }],
  [
    ".xlsx",
    { mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", signature: "zip" },
  ],
]);

type AgentContext = Context<{ Bindings: AgentEnv }>;
type BinarySignature = "gif" | "jpeg" | "pdf" | "png" | "webp" | "zip";

export function registerProjectFileHttpRoutes(app: Hono<{ Bindings: AgentEnv }>): void {
  app.get("/v1/projects/:projectId/files", listProjectFiles);
  app.post("/v1/projects/:projectId/files", uploadProjectFile);
}

async function listProjectFiles(c: AgentContext): Promise<Response> {
  const userId = readGatewayUserId(c.req.raw.headers);
  const projectId = parseProjectId(c.req.param("projectId"));
  await requireProjectAccess(c.env, userId, projectId, false);
  const sandbox = await sandboxForUser(c.env, userId);
  return c.json(ProjectFileListSchema.parse(await sandbox.listUploadedFiles({ projectId })));
}

async function uploadProjectFile(c: AgentContext): Promise<Response> {
  const userId = readGatewayUserId(c.req.raw.headers);
  const projectId = parseProjectId(c.req.param("projectId"));
  const project = await requireProjectAccess(c.env, userId, projectId, true);
  const name = sanitizeFilename(FilenameQuerySchema.parse(c.req.query("filename")));
  const bytes = await readBoundedRequestBytes(
    c.req.raw,
    PROJECT_FILE_MAX_BYTES,
    "Project file upload",
  );
  const contentType = validateProjectFile(name, bytes);
  const sandbox = await sandboxForUser(c.env, userId);
  const result = await uploadToProjectWorkspace(sandbox, {
    bytes,
    contentType,
    name,
    path: `uploads/${name}`,
    projectId,
    workspaceSlug: project.workspaceSlug,
  });
  return c.json(ProjectFileUploadResponseSchema.parse(result), 201);
}

async function uploadToProjectWorkspace(
  sandbox: Awaited<ReturnType<typeof sandboxForUser>>,
  input: Parameters<typeof sandbox.uploadProjectFile>[0],
) {
  try {
    return await sandbox.uploadProjectFile(input);
  } catch (error) {
    if (isMaintenanceRpcError(error)) {
      throw new APIError(
        503,
        "unavailable_maintenance",
        "Project files are temporarily unavailable while this computer is being updated.",
        {
          hint: "Try the upload again after workspace maintenance completes.",
          retriable: false,
        },
      );
    }
    throw error;
  }
}

function isMaintenanceRpcError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const value = error as Record<string, unknown>;
  return value["status"] === 503 && value["code"] === "unavailable_maintenance";
}

function parseProjectId(value: string | undefined): string {
  const parsed = ProjectIdParamSchema.safeParse(value);
  if (parsed.success) return parsed.data;
  throw new APIError(400, "invalid_path_param", "Invalid project id", { retriable: false });
}

function sanitizeFilename(source: string): string {
  const normalized = source.normalize("NFC").replaceAll("/", "-").replaceAll("\\", "-").trim();
  const withoutControls = Array.from(normalized, (character) =>
    isControlCharacter(character) ? "-" : character,
  ).join("");
  const collapsed = withoutControls.replace(/\s+/gu, " ").replace(/^\.+/u, "").trim();
  if (!collapsed || collapsed === "." || collapsed === "..") {
    throw invalidProjectFile("Choose a file with a valid name.");
  }
  const extension = extensionOf(collapsed);
  if (collapsed.length <= 200) return collapsed;
  if (extension.length > 20) return collapsed.slice(0, 200);
  const maxBaseLength = Math.max(1, 200 - extension.length);
  const base = collapsed.slice(0, collapsed.length - extension.length).slice(0, maxBaseLength);
  return `${base}${extension}`.trim();
}

function validateProjectFile(name: string, bytes: Uint8Array): string {
  if (bytes.byteLength === 0) {
    throw invalidProjectFile(`${name} is empty.`);
  }
  const extension = extensionOf(name);
  const textType = TEXT_EXTENSIONS.get(extension);
  if (textType) {
    assertUtf8Text(name, bytes);
    return textType;
  }
  const binaryType = BINARY_TYPES.get(extension);
  if (
    !binaryType ||
    !matchesSignature(bytes, binaryType.signature) ||
    !matchesOfficeContainer(extension, bytes)
  ) {
    throw invalidProjectFile(
      binaryType
        ? `${name} does not match its file type.`
        : `${name} is not a supported document, data, code, or image file.`,
    );
  }
  return binaryType.mime;
}

function matchesOfficeContainer(extension: string, bytes: Uint8Array): boolean {
  if (extension === ".docx") return containsAscii(bytes, "word/");
  if (extension === ".xlsx") return containsAscii(bytes, "xl/");
  if (extension === ".pptx") return containsAscii(bytes, "ppt/");
  return true;
}

function assertUtf8Text(name: string, bytes: Uint8Array): void {
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw invalidProjectFile(`${name} must be valid UTF-8 text.`);
  }
  if (bytes.includes(0)) {
    throw invalidProjectFile(`${name} contains binary data that does not match its file type.`);
  }
}

function matchesSignature(bytes: Uint8Array, signature: BinarySignature): boolean {
  if (signature === "pdf") return hasAsciiPrefix(bytes, "%PDF-");
  if (signature === "png") return hasBytes(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (signature === "jpeg") return hasBytes(bytes, [0xff, 0xd8, 0xff]);
  if (signature === "gif")
    return hasAsciiPrefix(bytes, "GIF87a") || hasAsciiPrefix(bytes, "GIF89a");
  if (signature === "webp") {
    return hasAsciiPrefix(bytes, "RIFF") && hasAsciiPrefix(bytes.subarray(8), "WEBP");
  }
  return (
    hasBytes(bytes, [0x50, 0x4b, 0x03, 0x04]) ||
    hasBytes(bytes, [0x50, 0x4b, 0x05, 0x06]) ||
    hasBytes(bytes, [0x50, 0x4b, 0x07, 0x08])
  );
}

function hasAsciiPrefix(bytes: Uint8Array, prefix: string): boolean {
  return hasBytes(bytes, Array.from(new TextEncoder().encode(prefix)));
}

function containsAscii(bytes: Uint8Array, value: string): boolean {
  const needle = new TextEncoder().encode(value);
  const lastStart = bytes.byteLength - needle.byteLength;
  for (let start = 0; start <= lastStart; start += 1) {
    if (bytes[start] !== needle[0]) continue;
    let matches = true;
    for (let offset = 1; offset < needle.byteLength; offset += 1) {
      if (bytes[start + offset] !== needle[offset]) {
        matches = false;
        break;
      }
    }
    if (matches) return true;
  }
  return false;
}

function hasBytes(bytes: Uint8Array, expected: number[]): boolean {
  return expected.every((byte, index) => bytes[index] === byte);
}

function extensionOf(name: string): string {
  const index = name.lastIndexOf(".");
  return index <= 0 ? "" : name.slice(index).toLowerCase();
}

function isControlCharacter(character: string): boolean {
  const codePoint = character.codePointAt(0) ?? 0;
  return codePoint < 32 || codePoint === 127;
}

function invalidProjectFile(message: string): APIError {
  return new APIError(422, "invalid_request_body", message, {
    hint: "Upload a supported file up to 20 MB and try again.",
    retriable: false,
  });
}
