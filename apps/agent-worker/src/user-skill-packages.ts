import type { UserSkillRecord } from "@cheatcode/db";
import type { SandboxLike } from "@cheatcode/sandbox-contracts";
import type { UserId } from "@cheatcode/types";
import { z } from "zod";
import {
  serializeUserSkillMarkdown,
  userSkillDirectoryPath,
  userSkillFilePath,
} from "./user-skill-files";

export const MAX_USER_SKILL_PACKAGE_FILES = 128;
export const MAX_USER_SKILL_FILE_BYTES = 1024 * 1024;
export const MAX_USER_SKILL_PACKAGE_BYTES = 8 * 1024 * 1024;
export const MAX_USER_SKILL_PACKAGE_REQUEST_BYTES = 12 * 1024 * 1024;

const MAX_ENCODED_FILE_CHARACTERS = 4 * Math.ceil(MAX_USER_SKILL_FILE_BYTES / 3);
const MIRROR_MANIFEST_FILE = ".cheatcode-package.json";
const BASE64_PATTERN = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u;
const TEXT_FILE_EXTENSIONS = new Set([
  ".css",
  ".csv",
  ".gql",
  ".graphql",
  ".html",
  ".js",
  ".json",
  ".jsonc",
  ".jsx",
  ".md",
  ".mdx",
  ".mjs",
  ".cjs",
  ".py",
  ".scss",
  ".sh",
  ".sql",
  ".svg",
  ".toml",
  ".ts",
  ".tsx",
  ".txt",
  ".xml",
  ".xsd",
  ".yaml",
  ".yml",
]);
const BINARY_FILE_EXTENSIONS = new Set([
  ".docx",
  ".gif",
  ".ico",
  ".jpeg",
  ".jpg",
  ".mp3",
  ".mp4",
  ".otf",
  ".pdf",
  ".png",
  ".pptx",
  ".ttf",
  ".wav",
  ".webm",
  ".webp",
  ".woff",
  ".woff2",
  ".xlsx",
  ".zip",
]);
const ROOT_TEXT_FILES = new Set([".env", ".gitignore", ".npmrc", "LICENSE"]);
const EXCLUDED_FILE_NAMES = new Set([
  MIRROR_MANIFEST_FILE,
  "bun.lock",
  "bun.lockb",
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
]);
const EXCLUDED_DIRECTORY_NAMES = new Set([
  ".cache",
  ".git",
  ".next",
  ".turbo",
  ".venv",
  "__pycache__",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "venv",
]);

const PackageFilePathSchema = z.string().min(1).max(300).superRefine(validatePackageFilePath);
const PackageFileEncodingSchema = z.enum(["utf8", "base64"]);

export const UserSkillPackageFileSchema = z
  .object({
    content: z.string().max(MAX_ENCODED_FILE_CHARACTERS),
    encoding: PackageFileEncodingSchema.default("utf8"),
    path: PackageFilePathSchema,
  })
  .strict()
  .superRefine(validatePackageFile);

const LegacyUserSkillPackageFileSchema = z
  .object({
    content: z.string().max(MAX_USER_SKILL_FILE_BYTES),
    path: PackageFilePathSchema,
  })
  .strict();
const RevisionSchema = z.string().regex(/^[a-f0-9]{64}$/u);
const UserSkillPackageSchema = z
  .object({
    files: z.array(UserSkillPackageFileSchema).min(1).max(MAX_USER_SKILL_PACKAGE_FILES),
    revision: RevisionSchema,
    skillId: z.string().uuid(),
    v: z.literal(2),
  })
  .strict()
  .superRefine(validatePackage);
const LegacyUserSkillPackageSchema = z
  .object({
    files: z.array(LegacyUserSkillPackageFileSchema).min(1).max(20),
    revision: RevisionSchema,
    skillId: z.string().uuid(),
    v: z.literal(1),
  })
  .strict();
const MirrorManifestSchema = z
  .object({
    files: z.array(PackageFilePathSchema).max(MAX_USER_SKILL_PACKAGE_FILES),
    revision: RevisionSchema,
    v: z.literal(1),
  })
  .strict();

export type UserSkillPackage = z.infer<typeof UserSkillPackageSchema>;
export type UserSkillPackageFile = z.infer<typeof UserSkillPackageFileSchema>;

async function createUserSkillPackage(
  skillId: string,
  files: UserSkillPackageFile[],
): Promise<UserSkillPackage> {
  const normalized = files.map(normalizePackageFile).sort(comparePackageFiles);
  const revision = await sha256Hex(JSON.stringify(normalized));
  return UserSkillPackageSchema.parse({ files: normalized, revision, skillId, v: 2 });
}

export async function persistUserSkillPackage(
  bucket: R2Bucket,
  userId: UserId,
  skillId: string,
  files: UserSkillPackageFile[],
): Promise<UserSkillPackage> {
  const packageValue = await createUserSkillPackage(skillId, files);
  await bucket.put(userSkillPackageKey(userId, skillId), JSON.stringify(packageValue), {
    httpMetadata: { contentType: "application/json; charset=utf-8" },
    customMetadata: { revision: packageValue.revision, skillId, version: "2" },
  });
  return packageValue;
}

export async function readUserSkillPackage(
  bucket: R2Bucket,
  userId: UserId,
  skillId: string,
): Promise<UserSkillPackage | null> {
  const object = await bucket.get(userSkillPackageKey(userId, skillId));
  if (!object) return null;
  const value: unknown = await object.json();
  const current = UserSkillPackageSchema.safeParse(value);
  if (current.success && current.data.skillId === skillId) return current.data;
  const legacy = LegacyUserSkillPackageSchema.safeParse(value);
  if (!legacy.success || legacy.data.skillId !== skillId) return null;
  return migrateLegacyPackage(legacy.data);
}

export async function deleteUserSkillPackage(
  bucket: R2Bucket,
  userId: UserId,
  skillId: string,
): Promise<void> {
  await bucket.delete(userSkillPackageKey(userId, skillId));
}

export async function collectUserSkillPackageFromSandbox(
  sandbox: SandboxLike,
  skill: UserSkillRecord,
  sourceSlug?: string,
): Promise<UserSkillPackageFile[]> {
  const fallback: UserSkillPackageFile = {
    content: await serializeUserSkillMarkdown(skill),
    encoding: "utf8",
    path: "SKILL.md",
  };
  if (!sandbox.listFiles || !sandbox.readFile) return [fallback];
  const directory = sourceSlug
    ? `/workspace/.cheatcode/skills/${sourceSlug}`
    : userSkillDirectoryPath(skill.name);
  const listing = await sandbox
    .listFiles({ includeHidden: true, path: directory, recursive: true })
    .catch(() => null);
  if (!listing) return [fallback];
  const candidates = packageCandidates(listing.files);
  validateCandidateBounds(candidates);
  const files = await readPackageCandidates(sandbox, candidates);
  return files.some((file) => file.path === "SKILL.md") ? files : [fallback, ...files];
}

export async function writeUserSkillPackageMirror(
  sandbox: SandboxLike,
  skill: Pick<UserSkillRecord, "name">,
  packageValue: UserSkillPackage,
): Promise<string> {
  if (!sandbox.writeFile) throw new Error("Sandbox does not support custom skill packages.");
  const directory = userSkillDirectoryPath(skill.name);
  const previous = await readMirrorManifest(sandbox, directory);
  if (previous?.revision === packageValue.revision) return userSkillFilePath(skill.name);
  await deleteStalePackageFiles(sandbox, directory, previous, packageValue);
  for (const file of packageValue.files) {
    await sandbox.writeFile({
      content: file.content,
      encoding: file.encoding,
      path: `${directory}/${file.path}`,
    });
  }
  await writeMirrorManifest(sandbox, directory, packageValue);
  return userSkillFilePath(skill.name);
}

function validatePackageFilePath(value: string, context: z.RefinementCtx): void {
  const segments = value.split("/");
  const fileName = segments.at(-1) ?? "";
  if (value.startsWith("/") || value.includes("\\") || value.includes("\0")) {
    context.addIssue({ code: "custom", message: "Skill file paths must be safe and relative." });
  }
  if (segments.some((segment) => segment.length === 0 || segment === "." || segment === "..")) {
    context.addIssue({ code: "custom", message: "Skill file paths cannot traverse." });
  }
  if (segments.some((segment) => EXCLUDED_DIRECTORY_NAMES.has(segment))) {
    context.addIssue({ code: "custom", message: "Generated skill directories are not persisted." });
  }
  if (!packageFileEncoding(value) || EXCLUDED_FILE_NAMES.has(fileName)) {
    context.addIssue({ code: "custom", message: `Unsupported skill package file: ${value}` });
  }
}

function validatePackageFile(
  file: { content: string; encoding: "utf8" | "base64"; path: string },
  context: z.RefinementCtx,
): void {
  const expectedEncoding = packageFileEncoding(file.path);
  if (expectedEncoding && file.encoding !== expectedEncoding) {
    context.addIssue({ code: "custom", message: `${file.path} must use ${expectedEncoding}.` });
  }
  if (file.encoding === "base64" && !BASE64_PATTERN.test(file.content)) {
    context.addIssue({ code: "custom", message: `${file.path} is not valid base64.` });
    return;
  }
  if (packageFileBytes(file) > MAX_USER_SKILL_FILE_BYTES) {
    context.addIssue({
      code: "custom",
      message: `${file.path} exceeds the ${MAX_USER_SKILL_FILE_BYTES}-byte file limit.`,
    });
  }
}

function validatePackage(
  value: { files: Array<z.infer<typeof UserSkillPackageFileSchema>> },
  context: z.RefinementCtx,
): void {
  const paths = new Set<string>();
  let bytes = 0;
  for (const file of value.files) {
    if (paths.has(file.path)) {
      context.addIssue({ code: "custom", message: `Duplicate skill file: ${file.path}` });
    }
    paths.add(file.path);
    bytes += packageFileBytes(file);
  }
  const skillMarkdown = value.files.find((file) => file.path === "SKILL.md");
  if (skillMarkdown?.encoding !== "utf8") {
    context.addIssue({ code: "custom", message: "A skill package must include text SKILL.md." });
  }
  if (bytes > MAX_USER_SKILL_PACKAGE_BYTES) {
    context.addIssue({
      code: "custom",
      message: `Skill package exceeds ${MAX_USER_SKILL_PACKAGE_BYTES} bytes.`,
    });
  }
}

function packageFileEncoding(path: string): "utf8" | "base64" | null {
  const fileName = path.split("/").at(-1) ?? "";
  if (!path.includes("/") && ROOT_TEXT_FILES.has(fileName)) return "utf8";
  const dot = fileName.lastIndexOf(".");
  const extension = dot === -1 ? "" : fileName.slice(dot).toLowerCase();
  if (TEXT_FILE_EXTENSIONS.has(extension)) return "utf8";
  if (BINARY_FILE_EXTENSIONS.has(extension)) return "base64";
  return null;
}

function packageFileBytes(file: { content: string; encoding: "utf8" | "base64" }): number {
  if (file.encoding === "utf8") return new TextEncoder().encode(file.content).byteLength;
  if (file.content.length === 0) return 0;
  const padding = file.content.endsWith("==") ? 2 : file.content.endsWith("=") ? 1 : 0;
  return (file.content.length / 4) * 3 - padding;
}

function normalizePackageFile(file: UserSkillPackageFile): UserSkillPackageFile {
  return {
    content: file.encoding === "utf8" ? file.content.replaceAll("\r\n", "\n") : file.content,
    encoding: file.encoding,
    path: file.path,
  };
}

function comparePackageFiles(left: UserSkillPackageFile, right: UserSkillPackageFile): number {
  return left.path.localeCompare(right.path);
}

function migrateLegacyPackage(
  value: z.infer<typeof LegacyUserSkillPackageSchema>,
): UserSkillPackage {
  return UserSkillPackageSchema.parse({
    files: value.files.map((file) => ({ ...file, encoding: "utf8" as const })),
    revision: value.revision,
    skillId: value.skillId,
    v: 2,
  });
}

function packageCandidates(
  files: Array<{ path: string; relativePath: string; size: number; type: string }>,
) {
  return files
    .filter((entry) => entry.type === "file")
    .map((entry) => ({ absolutePath: entry.path, path: entry.relativePath, size: entry.size }))
    .filter((entry) => PackageFilePathSchema.safeParse(entry.path).success)
    .sort((left, right) => left.path.localeCompare(right.path));
}

function validateCandidateBounds(candidates: Array<{ path: string; size: number }>): void {
  if (candidates.length > MAX_USER_SKILL_PACKAGE_FILES) {
    throw new Error(`Skill package exceeds ${MAX_USER_SKILL_PACKAGE_FILES} files.`);
  }
  for (const candidate of candidates) {
    if (candidate.size > MAX_USER_SKILL_FILE_BYTES) {
      throw new Error(
        `${candidate.path} exceeds the ${MAX_USER_SKILL_FILE_BYTES}-byte file limit.`,
      );
    }
  }
  const bytes = candidates.reduce((total, candidate) => total + candidate.size, 0);
  if (bytes > MAX_USER_SKILL_PACKAGE_BYTES) {
    throw new Error(`Skill package exceeds ${MAX_USER_SKILL_PACKAGE_BYTES} bytes.`);
  }
}

async function readPackageCandidates(
  sandbox: SandboxLike,
  candidates: Array<{ absolutePath: string; path: string }>,
): Promise<UserSkillPackageFile[]> {
  if (!sandbox.readFile) return [];
  const files: UserSkillPackageFile[] = [];
  for (const candidate of candidates) {
    const encoding = packageFileEncoding(candidate.path);
    if (!encoding) continue;
    const file = await sandbox.readFile({ encoding, path: candidate.absolutePath });
    files.push(
      UserSkillPackageFileSchema.parse({
        content: file.content,
        encoding: file.encoding,
        path: candidate.path,
      }),
    );
  }
  return files;
}

async function readMirrorManifest(
  sandbox: SandboxLike,
  directory: string,
): Promise<z.infer<typeof MirrorManifestSchema> | null> {
  if (!sandbox.readFile) return null;
  const file = await sandbox
    .readFile({ encoding: "utf8", path: `${directory}/${MIRROR_MANIFEST_FILE}` })
    .catch(() => null);
  if (file?.encoding !== "utf8") return null;
  let value: unknown;
  try {
    value = JSON.parse(file.content) as unknown;
  } catch {
    return null;
  }
  const parsed = MirrorManifestSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

async function deleteStalePackageFiles(
  sandbox: SandboxLike,
  directory: string,
  previous: z.infer<typeof MirrorManifestSchema> | null,
  next: UserSkillPackage,
): Promise<void> {
  if (!sandbox.deleteFile || !previous) return;
  const nextPaths = new Set(next.files.map((file) => file.path));
  for (const path of previous.files) {
    if (!nextPaths.has(path)) {
      await sandbox.deleteFile({ path: `${directory}/${path}`, recursive: false });
    }
  }
}

async function writeMirrorManifest(
  sandbox: SandboxLike,
  directory: string,
  packageValue: UserSkillPackage,
): Promise<void> {
  if (!sandbox.writeFile) return;
  await sandbox.writeFile({
    content: `${JSON.stringify(
      {
        files: packageValue.files.map((file) => file.path),
        revision: packageValue.revision,
        v: 1,
      },
      null,
      2,
    )}\n`,
    encoding: "utf8",
    path: `${directory}/${MIRROR_MANIFEST_FILE}`,
  });
}

function userSkillPackageKey(userId: UserId, skillId: string): string {
  return `${userId}/skills/${skillId}/package.json`;
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
