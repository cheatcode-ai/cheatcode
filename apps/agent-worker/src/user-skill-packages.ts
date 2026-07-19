import type { UserSkillRecord } from "@cheatcode/db";
import type { SandboxLike } from "@cheatcode/sandbox-contracts";
import type { UserId } from "@cheatcode/types";
import { z } from "zod";
import {
  serializeUserSkillMarkdown,
  userSkillDirectoryPath,
  userSkillFilePath,
} from "./user-skill-files";

const MAX_PACKAGE_FILES = 20;
const MAX_PACKAGE_BYTES = 1024 * 1024;
const PackageFilePathSchema = z
  .string()
  .min(1)
  .max(240)
  .regex(
    /^(?:SKILL\.md|[^/]+\.md|[^/]+\.ts|(?:[^/]+\/)*(?:[^/]+\.md|[^/]+\.ts)|package\.json|\.env)$/u,
  )
  .refine((value) => !value.split("/").includes(".."), "Skill file paths cannot traverse.");

export const UserSkillPackageFileSchema = z
  .object({
    content: z.string().max(MAX_PACKAGE_BYTES),
    path: PackageFilePathSchema,
  })
  .strict();

export const UserSkillPackageSchema = z
  .object({
    files: z.array(UserSkillPackageFileSchema).min(1).max(MAX_PACKAGE_FILES),
    revision: z.string().regex(/^[a-f0-9]{64}$/u),
    skillId: z.string().uuid(),
    v: z.literal(1),
  })
  .strict()
  .superRefine((value, context) => {
    const paths = new Set<string>();
    let bytes = 0;
    for (const file of value.files) {
      if (paths.has(file.path)) {
        context.addIssue({ code: "custom", message: `Duplicate skill file: ${file.path}` });
      }
      paths.add(file.path);
      bytes += new TextEncoder().encode(file.content).byteLength;
    }
    if (!paths.has("SKILL.md")) {
      context.addIssue({ code: "custom", message: "A skill package must include SKILL.md." });
    }
    if (bytes > MAX_PACKAGE_BYTES) {
      context.addIssue({
        code: "custom",
        message: `Skill package exceeds ${MAX_PACKAGE_BYTES} bytes.`,
      });
    }
  });

export type UserSkillPackage = z.infer<typeof UserSkillPackageSchema>;
export type UserSkillPackageFile = z.infer<typeof UserSkillPackageFileSchema>;

export async function createUserSkillPackage(
  skillId: string,
  files: UserSkillPackageFile[],
): Promise<UserSkillPackage> {
  const normalized = files
    .map((file) => ({ content: file.content.replaceAll("\r\n", "\n"), path: file.path }))
    .sort((left, right) => left.path.localeCompare(right.path));
  const revision = await sha256Hex(JSON.stringify(normalized));
  return UserSkillPackageSchema.parse({ files: normalized, revision, skillId, v: 1 });
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
    customMetadata: { revision: packageValue.revision, skillId },
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
  const parsed = UserSkillPackageSchema.safeParse(await object.json());
  return parsed.success && parsed.data.skillId === skillId ? parsed.data : null;
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
): Promise<UserSkillPackageFile[]> {
  const fallback = [{ content: await serializeUserSkillMarkdown(skill), path: "SKILL.md" }];
  if (!sandbox.listFiles || !sandbox.readFile) {
    return fallback;
  }
  const directory = userSkillDirectoryPath(skill.name);
  const listing = await sandbox
    .listFiles({ includeHidden: true, path: directory, recursive: true })
    .catch(() => null);
  if (!listing) return fallback;
  const candidates = listing.files
    .filter((entry) => entry.type === "file")
    .map((entry) => ({ absolutePath: entry.path, path: entry.relativePath }))
    .filter((entry) => PackageFilePathSchema.safeParse(entry.path).success)
    .sort((left, right) => left.path.localeCompare(right.path))
    .slice(0, MAX_PACKAGE_FILES);
  const files: UserSkillPackageFile[] = [];
  for (const candidate of candidates) {
    const file = await sandbox.readFile({ encoding: "utf8", path: candidate.absolutePath });
    if (file.encoding === "utf8") files.push({ content: file.content, path: candidate.path });
  }
  return files.some((file) => file.path === "SKILL.md") ? files : [...fallback, ...files];
}

export async function writeUserSkillPackageMirror(
  sandbox: SandboxLike,
  skill: Pick<UserSkillRecord, "name">,
  packageValue: UserSkillPackage,
): Promise<string> {
  if (!sandbox.writeFile) throw new Error("Sandbox does not support custom skill packages.");
  const directory = userSkillDirectoryPath(skill.name);
  for (const file of packageValue.files) {
    await sandbox.writeFile({
      content: file.content,
      encoding: "utf8",
      path: `${directory}/${file.path}`,
    });
  }
  return userSkillFilePath(skill.name);
}

function userSkillPackageKey(userId: UserId, skillId: string): string {
  return `${userId}/skills/${skillId}/package.json`;
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
