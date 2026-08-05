import { APIError } from "@cheatcode/observability";
import { PROJECT_ARCHIVE_MAX_OUTPUT_BYTES } from "@cheatcode/types/api";
import { shellQuote } from "../sandbox-support";
import {
  type ProjectSearchFilesInput,
  ProjectSearchFilesInputSchema,
} from "./project-sandbox-runtime";

export const PROJECT_ARCHIVE_MAX_BYTES = 512 * 1024 * 1024;
export const PROJECT_ARCHIVE_MAX_FILES = 25_000;
export const WORKSPACE_DIR = "/workspace";
const MANAGED_PROJECT_SOURCE_PATH = /^\/workspace\/[^/]+\/(?:deliverables|uploads)(?:\/|$)/u;
const PROJECT_WORKSPACE_ROOT_PATH = /^\/workspace\/[^/]+\/?$/u;

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

export function assertMutableWorkspacePath(path: string): void {
  if (!MANAGED_PROJECT_SOURCE_PATH.test(path)) {
    return;
  }
  throw new APIError(403, "permission_access_denied", "Referenced project files are read-only", {
    hint: "Read the source file or copy it to another project path before editing it.",
    retriable: false,
  });
}

export function assertDeletableWorkspacePath(path: string): void {
  if (PROJECT_WORKSPACE_ROOT_PATH.test(path)) {
    throw new APIError(
      403,
      "permission_access_denied",
      "Project roots cannot be deleted with file tools",
      {
        hint: "Delete individual generated files or use the project deletion action.",
        retriable: false,
      },
    );
  }
  assertMutableWorkspacePath(path);
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
