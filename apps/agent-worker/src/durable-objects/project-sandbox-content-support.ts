import { PROJECT_ARCHIVE_MAX_OUTPUT_BYTES, type SandboxFilePreview } from "@cheatcode/types";
import { shellQuote } from "./project-sandbox-process-support";
import {
  type ProjectSearchFilesInput,
  ProjectSearchFilesInputSchema,
} from "./project-sandbox-runtime";

// Base64 expands by one third; keep the encoded JSON response below the web
// client's 8 MiB file-response boundary and the Worker's isolate memory budget.
export const MAX_PREVIEW_BYTES = 5 * 1024 * 1024;
export const PREVIEW_DIR = "/workspace/.cheatcode-previews";
export const PROJECT_ARCHIVE_MAX_BYTES = 512 * 1024 * 1024;
export const PROJECT_ARCHIVE_MAX_FILES = 25_000;
export const WORKSPACE_DIR = "/workspace";

export const PROJECT_ARCHIVE_SCRIPT = `
import os
import stat
import sys
import zipfile

root = os.path.realpath(sys.argv[1])
output = sys.argv[2]
max_bytes = int(sys.argv[3])
max_files = int(sys.argv[4])
max_output_bytes = int(sys.argv[5])
excluded_dirs = {
    ".cache", ".expo", ".git", ".next", ".parcel-cache", ".turbo", ".vite",
    ".wrangler", "build", "coverage", "dist", "node_modules", "out",
}
safe_env_templates = {".env.example", ".env.sample", ".env.template"}
secret_names = {
    ".dev.vars", ".netrc", ".npmrc", ".pypirc", "credentials.json",
    "secrets.json", "service-account.json",
}

if not os.path.isdir(root):
    raise FileNotFoundError(f"Project workspace does not exist: {root}")

def excluded(relative_path):
    parts = relative_path.split(os.sep)
    name = parts[-1]
    is_secret_env = name == ".env" or (
        name.startswith(".env.") and name not in safe_env_templates
    )
    return (
        any(part in excluded_dirs for part in parts)
        or name == ".DS_Store"
        or name in secret_names
        or is_secret_env
        or name.endswith(".log")
    )

file_count = 0
total_bytes = 0
with zipfile.ZipFile(
    output,
    mode="w",
    compression=zipfile.ZIP_DEFLATED,
    compresslevel=6,
    allowZip64=True,
) as archive:
    for current, directories, filenames in os.walk(root, followlinks=False):
        relative_dir = os.path.relpath(current, root)
        directories[:] = sorted(
            directory
            for directory in directories
            if not excluded(os.path.normpath(os.path.join(relative_dir, directory)))
            and not os.path.islink(os.path.join(current, directory))
        )
        for filename in sorted(filenames):
            absolute_path = os.path.join(current, filename)
            relative_path = os.path.relpath(absolute_path, root)
            if excluded(relative_path) or os.path.islink(absolute_path):
                continue
            descriptor = os.open(absolute_path, os.O_RDONLY | os.O_NOFOLLOW)
            with os.fdopen(descriptor, "rb") as source:
                metadata = os.fstat(source.fileno())
                opened_path = os.path.realpath(f"/proc/self/fd/{source.fileno()}")
                if os.path.commonpath([root, opened_path]) != root:
                    raise RuntimeError("Project file escaped the workspace during archive creation")
                if not stat.S_ISREG(metadata.st_mode):
                    continue
                file_count += 1
                if file_count > max_files:
                    raise RuntimeError("Project is too large to download as one archive")
                archive_info = zipfile.ZipInfo(relative_path)
                archive_info.compress_type = zipfile.ZIP_DEFLATED
                archive_info.create_system = 3
                archive_info.external_attr = stat.S_IMODE(metadata.st_mode) << 16
                with archive.open(archive_info, mode="w", force_zip64=True) as destination:
                    while True:
                        chunk = source.read(1024 * 1024)
                        if not chunk:
                            break
                        total_bytes += len(chunk)
                        if total_bytes > max_bytes:
                            raise RuntimeError("Project is too large to download as one archive")
                        destination.write(chunk)

archive_size = os.path.getsize(output)
if archive_size > max_output_bytes:
    os.remove(output)
    raise RuntimeError("Final project archive exceeds the download size limit")
`;

export { PROJECT_ARCHIVE_MAX_OUTPUT_BYTES };

export function isSingleWorkspaceSegment(slug: string): boolean {
  return slug.length > 0 && !slug.includes("/") && slug !== "." && slug !== "..";
}

export function lowercaseExtension(path: string): string {
  const filename = basename(path).toLowerCase();
  const dot = filename.lastIndexOf(".");
  return dot === -1 ? "" : filename.slice(dot);
}

export function imageMimeType(extension: string): string | null {
  const mimeTypes: Record<string, string> = {
    ".gif": "image/gif",
    ".jpeg": "image/jpeg",
    ".jpg": "image/jpeg",
    ".png": "image/png",
    ".svg": "image/svg+xml",
    ".webp": "image/webp",
  };
  return mimeTypes[extension] ?? null;
}

const OFFICE_PREVIEW_EXTENSIONS = new Set([
  ".doc",
  ".docx",
  ".odp",
  ".ods",
  ".odt",
  ".pot",
  ".potx",
  ".pps",
  ".ppsx",
  ".ppt",
  ".pptx",
  ".xls",
  ".xlsx",
]);

export function isOfficePreviewExtension(extension: string): boolean {
  return OFFICE_PREVIEW_EXTENSIONS.has(extension);
}

export function unsupportedPreview(path: string, error: string): SandboxFilePreview {
  return {
    content: null,
    encoding: null,
    error,
    kind: "unsupported",
    mimeType: null,
    path,
    previewPath: null,
  };
}

export function conversionErrorMessage(output: string): string {
  const trimmed = output.trim();
  if (!trimmed) {
    return "Office preview conversion failed.";
  }
  return trimmed.length > 1_000 ? `${trimmed.slice(0, 997)}...` : trimmed;
}

export function withoutExtension(filename: string): string {
  const dot = filename.lastIndexOf(".");
  return dot <= 0 ? filename : filename.slice(0, dot);
}

export function buildGrepCommand(input: ProjectSearchFilesInput): string {
  const parsed = ProjectSearchFilesInputSchema.parse(input);
  const flags = ["-rnI"];
  if (!parsed.caseSensitive) {
    flags.push("-i");
  }
  for (const dir of parsed.excludeDirs) {
    flags.push(`--exclude-dir=${shellQuote(dir)}`);
  }
  if (parsed.filePattern) {
    flags.push(`--include=${shellQuote(parsed.filePattern)}`);
  }
  const grep = `grep ${flags.join(" ")} -e ${shellQuote(parsed.query)} ${shellQuote(parsed.path)}`;
  return `${grep} | head -n ${parsed.maxResults}`;
}

export function parseGrepOutput(
  output: string,
  maxResults: number,
): Array<{ line: number; path: string; text: string }> {
  const matches: Array<{ line: number; path: string; text: string }> = [];
  for (const line of output.split("\n")) {
    if (matches.length >= maxResults) {
      break;
    }
    const match = /^(.*?):(\d+):(.*)$/u.exec(line);
    if (match?.[1] && match[2] && match[3] !== undefined) {
      matches.push({ line: Number(match[2]), path: match[1], text: match[3] });
    }
  }
  return matches;
}

export function dirname(path: string): string {
  const index = path.lastIndexOf("/");
  return index <= 0 ? "/" : path.slice(0, index);
}

export function basename(path: string): string {
  const index = path.lastIndexOf("/");
  return index === -1 ? path : path.slice(index + 1);
}

export function encodeBase64(bytes: Uint8Array): string {
  const chunkSize = 24 * 1024;
  const encoded: string[] = [];
  for (let offset = 0; offset < bytes.byteLength; offset += chunkSize) {
    const chunk = bytes.subarray(offset, offset + chunkSize);
    encoded.push(btoa(String.fromCharCode(...chunk)));
  }
  return encoded.join("");
}

export function decodeBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}
