import type { UserSkillRecord } from "@cheatcode/db";
import { createLogger } from "@cheatcode/observability";
import type { SandboxLike } from "@cheatcode/sandbox-contracts";
import { z } from "zod";
import { SANDBOX_WORKSPACE_ROOT } from "./sandbox-route-helpers";

const USER_SKILLS_DIRECTORY = `${SANDBOX_WORKSPACE_ROOT}/.cheatcode/skills`;

const RevisionSchema = z.string().regex(/^[a-f0-9]{64}$/u);
const MirroredSkillSchema = z
  .object({
    body: z.string().trim().min(1).max(40_000),
    category: z.string().trim().min(1).max(80),
    description: z.string().trim().min(1).max(400),
    name: z.string().trim().min(1).max(80),
    registryRevision: RevisionSchema.nullable(),
    skillId: z.string().uuid(),
    tags: z.array(z.string().trim().min(1).max(40)).max(12),
  })
  .strict();

const PortableSkillSchema = z
  .object({
    body: z.string().trim().min(1).max(40_000),
    category: z.enum(["Builder & Apps", "Research & Docs", "Data & Media"]),
    description: z.string().trim().min(1).max(400),
    name: z.string().trim().min(1).max(80),
    tags: z.array(z.string().trim().min(1).max(40)).max(12),
  })
  .strict();

type MirroredUserSkill = z.infer<typeof MirroredSkillSchema>;

export type UserSkillMirrorResolution =
  | { kind: "registry" }
  | { kind: "promote"; mirror: MirroredUserSkill }
  | { kind: "conflict"; reason: string };

export function userSkillSlug(name: string): string {
  const slug = name
    .normalize("NFKD")
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/gu, "-")
    .replaceAll(/^-+|-+$/gu, "")
    .slice(0, 80);
  return slug || "custom-skill";
}

export function userSkillFilePath(name: string): string {
  return `${USER_SKILLS_DIRECTORY}/${userSkillSlug(name)}/SKILL.md`;
}

export function userSkillDirectoryPath(name: string): string {
  return `${USER_SKILLS_DIRECTORY}/${userSkillSlug(name)}`;
}

export async function writeUserSkillMirror(
  sandbox: SandboxLike,
  skill: UserSkillRecord,
): Promise<string> {
  if (typeof sandbox.writeFile !== "function") {
    throw new Error("Sandbox does not support custom skill mirrors.");
  }
  const path = userSkillFilePath(skill.name);
  await sandbox.writeFile({
    content: await serializeUserSkillMarkdown(skill),
    encoding: "utf8",
    path,
  });
  return path;
}

export async function resolveUserSkillMirror(
  sandbox: SandboxLike,
  skill: UserSkillRecord,
): Promise<UserSkillMirrorResolution> {
  const currentRevision = await userSkillRevision(skill);
  const markdown = await readUserSkillMirror(sandbox, skill.name);
  if (markdown === null) {
    await writeMirrorBestEffort(sandbox, skill, "user_skill_mirror_missing_write_failed");
    return { kind: "registry" };
  }
  const parsed = parseUserSkillMarkdown(markdown);
  if (!parsed.success) {
    logMirrorConflict(skill, "invalid_mirror");
    return { kind: "conflict", reason: "invalid_mirror" };
  }
  if (parsed.data.skillId !== skill.id || parsed.data.name !== skill.name) {
    logMirrorConflict(skill, "identity_mismatch");
    return { kind: "conflict", reason: "identity_mismatch" };
  }
  const mirrorRevision = await userSkillRevision({ ...skill, ...parsed.data });
  const storedRevision = parsed.data.registryRevision;
  if (storedRevision === null) {
    return mirrorRevision === currentRevision
      ? normalizeRegistryMirror(sandbox, skill)
      : { kind: "promote", mirror: parsed.data };
  }
  if (mirrorRevision === storedRevision) {
    return currentRevision === storedRevision
      ? { kind: "registry" }
      : normalizeRegistryMirror(sandbox, skill);
  }
  if (currentRevision === storedRevision) {
    return { kind: "promote", mirror: parsed.data };
  }
  logMirrorConflict(skill, "concurrent_edit");
  return { kind: "conflict", reason: "concurrent_edit" };
}

function parseUserSkillMarkdown(
  markdown: string,
): ReturnType<typeof MirroredSkillSchema.safeParse> {
  const normalized = markdown.replaceAll("\r\n", "\n").trim();
  if (!normalized.startsWith("---\n")) {
    return MirroredSkillSchema.safeParse({});
  }
  const end = normalized.indexOf("\n---\n", 4);
  if (end === -1) {
    return MirroredSkillSchema.safeParse({});
  }
  const values = parseFrontmatter(normalized.slice(4, end));
  return MirroredSkillSchema.safeParse({
    body: normalized.slice(end + 5).trim(),
    category: values.get("category"),
    description: values.get("description"),
    name: values.get("name"),
    registryRevision: values.get("registry-revision") ?? null,
    skillId: values.get("skill-id"),
    tags: parseTags(values.get("tags")),
  });
}

/** Parses an authored, portable SKILL.md before registry identity is assigned. */
export function parsePortableSkillMarkdown(
  markdown: string,
  fallbackSlug: string,
): ReturnType<typeof PortableSkillSchema.safeParse> {
  const normalized = markdown.replaceAll("\r\n", "\n").trim();
  const parts = portableSkillParts(normalized);
  const values = parsePortableFrontmatter(parts.frontmatter);
  const fallbackName = titleCaseSlug(fallbackSlug);
  return PortableSkillSchema.safeParse({
    body: parts.body,
    category: values.get("category") ?? "Builder & Apps",
    description: values.get("description") ?? `Custom Cheatcode skill: ${fallbackName}.`,
    name: values.get("name") ?? fallbackName,
    tags: parseTags(values.get("tags")),
  });
}

export async function serializeUserSkillMarkdown(skill: UserSkillRecord): Promise<string> {
  const revision = await userSkillRevision(skill);
  return [
    "---",
    `skill-id: ${JSON.stringify(skill.id)}`,
    `name: ${JSON.stringify(skill.name)}`,
    `description: ${JSON.stringify(skill.description)}`,
    `category: ${JSON.stringify(skill.category)}`,
    `tags: ${JSON.stringify(skill.tags)}`,
    `registry-revision: ${JSON.stringify(revision)}`,
    "---",
    "",
    skill.body.trim(),
    "",
  ].join("\n");
}

async function userSkillRevision(
  skill: Pick<UserSkillRecord, "body" | "category" | "description" | "id" | "name" | "tags">,
): Promise<string> {
  const canonical = JSON.stringify({
    body: skill.body.trim(),
    category: skill.category.trim(),
    description: skill.description.trim(),
    id: skill.id,
    name: skill.name.trim(),
    tags: skill.tags,
  });
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function readUserSkillMirror(sandbox: SandboxLike, name: string): Promise<string | null> {
  if (typeof sandbox.readFile !== "function") return null;
  const file = await sandbox
    .readFile({ encoding: "utf8", path: userSkillFilePath(name) })
    .catch(() => null);
  return file?.encoding === "utf8" ? file.content : null;
}

function parseFrontmatter(frontmatter: string): Map<string, string> {
  const values = new Map<string, string>();
  for (const line of frontmatter.split("\n")) {
    const separator = line.indexOf(":");
    if (separator === -1) continue;
    const key = line.slice(0, separator).trim();
    const raw = line.slice(separator + 1).trim();
    values.set(key, parseScalar(raw));
  }
  return values;
}

function portableSkillParts(markdown: string): { body: string; frontmatter: string } {
  if (!markdown.startsWith("---\n")) {
    return { body: markdown, frontmatter: "" };
  }
  const end = markdown.indexOf("\n---\n", 4);
  return end === -1
    ? { body: markdown, frontmatter: "" }
    : { body: markdown.slice(end + 5).trim(), frontmatter: markdown.slice(4, end) };
}

function parsePortableFrontmatter(frontmatter: string): Map<string, string> {
  const values = new Map<string, string>();
  const lines = frontmatter.split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const separator = line.indexOf(":");
    if (separator === -1 || /^\s/u.test(line)) continue;
    const key = line.slice(0, separator).trim();
    const raw = line.slice(separator + 1).trim();
    if (raw === ">" || raw === ">-" || raw === "|") {
      const folded = collectIndentedValue(lines, index + 1);
      values.set(key, folded.value);
      index = folded.lastIndex;
      continue;
    }
    values.set(key, parseScalar(raw));
  }
  return values;
}

function collectIndentedValue(
  lines: string[],
  startIndex: number,
): { lastIndex: number; value: string } {
  const content: string[] = [];
  let lastIndex = startIndex - 1;
  for (let index = startIndex; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    if (line && !/^\s/u.test(line)) break;
    content.push(line.trim());
    lastIndex = index;
  }
  return { lastIndex, value: content.filter(Boolean).join(" ") };
}

function titleCaseSlug(slug: string): string {
  return slug
    .split(/[-_]+/u)
    .filter(Boolean)
    .map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1)}`)
    .join(" ")
    .slice(0, 80);
}

function parseScalar(raw: string): string {
  if (!raw.startsWith('"')) return raw;
  try {
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === "string" ? parsed : raw;
  } catch {
    return raw;
  }
}

function parseTags(raw: string | undefined): unknown {
  if (raw === undefined) return [];
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return raw
      .replace(/^\[|\]$/gu, "")
      .split(",")
      .map((tag) => tag.trim())
      .filter(Boolean);
  }
}

async function normalizeRegistryMirror(
  sandbox: SandboxLike,
  skill: UserSkillRecord,
): Promise<UserSkillMirrorResolution> {
  await writeMirrorBestEffort(sandbox, skill, "user_skill_mirror_normalize_failed");
  return { kind: "registry" };
}

async function writeMirrorBestEffort(
  sandbox: SandboxLike,
  skill: UserSkillRecord,
  event: string,
): Promise<void> {
  await writeUserSkillMirror(sandbox, skill).catch((error: unknown) => {
    createLogger().warn(event, { error, skillId: skill.id });
  });
}

function logMirrorConflict(skill: UserSkillRecord, reason: string): void {
  createLogger().warn("user_skill_mirror_conflict", {
    reason,
    skillId: skill.id,
    userId: skill.userId,
  });
}
