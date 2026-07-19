import { spawnSync } from "node:child_process";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import {
  createSkillTool,
  emitCheatcodeSkillFrontendEvent,
  readProjectSkillRuntimeConfig,
  requestCheatcodeSkillJson,
  stringOption,
} from "@cheatcode/sandbox-skills-runtime";

const SANDBOX_CUSTOM_SKILLS_ROOT = "/workspace/.cheatcode/skills";
const MAX_PERSISTED_FILE_COUNT = 128;
const MAX_PERSISTED_FILE_BYTES = 1024 * 1024;
const MAX_PERSISTED_TOTAL_BYTES = 8 * 1024 * 1024;
const ROOT_TEXT_FILE_NAMES = new Set([".env", ".gitignore", ".npmrc", "LICENSE"]);
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
const SKIPPED_FILE_NAMES = new Set([
  ".cheatcode-package.json",
  "bun.lock",
  "bun.lockb",
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
]);
const SKIPPED_DIRECTORY_NAMES = new Set([
  ".venv",
  "__pycache__",
  "node_modules",
  "dist",
  "build",
  ".next",
  ".turbo",
  "coverage",
  ".git",
  ".cache",
  "venv",
]);

type CustomSkillFilePayload = {
  content: string;
  encoding: "base64" | "utf8";
  path: string;
};

type PersistCustomSkillResponse = {
  skill: {
    slug: string;
    name: string;
    description: string;
    latestRevision: number;
    updatedAt: string;
    archivedAt: string | null;
    signature: string;
  };
  source: "custom";
  saved: boolean;
  created: boolean;
};

type SkillLogger = {
  log(message: string): void;
};

type SaveSkillOptions = {
  skill: string;
  "source-dir"?: string;
};

const SAVE_SKILL_OPTIONS = {
  skill: stringOption({
    description: "Custom tool slug to persist.",
    short: "s",
    required: true,
  }),
  "source-dir": stringOption({
    description:
      "Directory containing the custom skill files. Defaults to /workspace/.cheatcode/skills/<slug>.",
    short: "d",
  }),
};

function normalizeRelativeSkillPath(relativePath: string) {
  return relativePath.split(path.sep).join("/");
}

function skillFileEncoding(relativePath: string): "base64" | "utf8" | null {
  const normalizedPath = normalizeRelativeSkillPath(relativePath);
  const pathSegments = normalizedPath.split("/").filter(Boolean);
  const fileName = pathSegments[pathSegments.length - 1];
  if (!fileName || SKIPPED_FILE_NAMES.has(fileName)) return null;
  if (pathSegments.length === 1 && ROOT_TEXT_FILE_NAMES.has(fileName)) return "utf8";
  const extension = path.extname(fileName).toLowerCase();
  if (TEXT_FILE_EXTENSIONS.has(extension)) return "utf8";
  if (BINARY_FILE_EXTENSIONS.has(extension)) return "base64";
  return null;
}

async function collectPersistableSkillFilePaths(
  rootDirectory: string,
  currentDirectory = rootDirectory,
): Promise<string[]> {
  const entries = await readdir(currentDirectory, { withFileTypes: true });
  const sortedEntries = entries.toSorted((left, right) => left.name.localeCompare(right.name));

  const nestedPaths = await Promise.all(
    sortedEntries.map(async (entry) => {
      const absolutePath = path.join(currentDirectory, entry.name);

      if (entry.isDirectory()) {
        if (SKIPPED_DIRECTORY_NAMES.has(entry.name)) {
          return [];
        }

        return collectPersistableSkillFilePaths(rootDirectory, absolutePath);
      }

      if (!entry.isFile()) {
        return [];
      }

      const relativePath = path.relative(rootDirectory, absolutePath);
      if (!skillFileEncoding(relativePath)) {
        return [];
      }

      return [normalizeRelativeSkillPath(relativePath)];
    }),
  );

  return nestedPaths.flat();
}

async function resolveGitIgnoredSkillPaths(
  rootDirectory: string,
  candidatePaths: readonly string[],
): Promise<Set<string>> {
  if (candidatePaths.length === 0) {
    return new Set();
  }

  try {
    await readFile(path.join(rootDirectory, ".gitignore"), "utf8");
  } catch (error) {
    const isMissingFile = error instanceof Error && "code" in error && error.code === "ENOENT";
    if (isMissingFile) {
      return new Set();
    }
    throw error;
  }

  const gitResult = spawnSync("git", ["check-ignore", "--no-index", "--stdin"], {
    cwd: rootDirectory,
    input: candidatePaths.join("\n"),
    encoding: "utf8",
  });

  if (gitResult.error) {
    throw new Error(
      `Failed to evaluate .gitignore for persisted skill files: ${gitResult.error.message}`,
    );
  }

  if (gitResult.status !== 0 && gitResult.status !== 1) {
    const stderr = gitResult.stderr?.trim();
    throw new Error(
      `Failed to evaluate .gitignore for persisted skill files.${stderr ? ` ${stderr}` : ""}`,
    );
  }

  const ignoredPaths = (gitResult.stdout || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map(normalizeRelativeSkillPath);

  return new Set(ignoredPaths);
}

async function collectSkillFiles(rootDirectory: string): Promise<CustomSkillFilePayload[]> {
  const candidatePaths = await collectPersistableSkillFilePaths(rootDirectory);
  const gitIgnoredPaths = await resolveGitIgnoredSkillPaths(rootDirectory, candidatePaths);
  if (gitIgnoredPaths.has(".env")) {
    throw new Error(
      [
        "The custom skill root .env file is currently excluded by that skill's .gitignore.",
        "Remove the ignore rule for .env before persisting so the skill keeps its secrets after reload.",
      ].join(" "),
    );
  }
  const persistedPaths = candidatePaths.filter(
    (relativePath) => !gitIgnoredPaths.has(relativePath),
  );
  await validateSkillFileStats(rootDirectory, persistedPaths);
  return Promise.all(
    persistedPaths.map((relativePath) => readSkillFile(rootDirectory, relativePath)),
  );
}

async function validateSkillFileStats(
  rootDirectory: string,
  persistedPaths: readonly string[],
): Promise<void> {
  if (persistedPaths.length > MAX_PERSISTED_FILE_COUNT) {
    throw new Error(`A saved custom skill can contain at most ${MAX_PERSISTED_FILE_COUNT} files.`);
  }
  const sizes = await Promise.all(
    persistedPaths.map(async (relativePath) => ({
      relativePath,
      size: (await stat(path.join(rootDirectory, relativePath))).size,
    })),
  );
  const oversized = sizes.find((file) => file.size > MAX_PERSISTED_FILE_BYTES);
  if (oversized) {
    throw new Error(`${oversized.relativePath} exceeds the 1048576-byte file limit.`);
  }
  const totalBytes = sizes.reduce((total, file) => total + file.size, 0);
  if (totalBytes > MAX_PERSISTED_TOTAL_BYTES) {
    throw new Error(
      `The custom skill exceeds the ${MAX_PERSISTED_TOTAL_BYTES}-byte package limit.`,
    );
  }
}

async function readSkillFile(
  rootDirectory: string,
  relativePath: string,
): Promise<CustomSkillFilePayload> {
  const encoding = skillFileEncoding(relativePath);
  if (!encoding) throw new Error(`Unsupported custom skill file: ${relativePath}`);
  const content = await readFile(path.join(rootDirectory, relativePath));
  return {
    content: encoding === "utf8" ? content.toString("utf8") : content.toString("base64"),
    encoding,
    path: relativePath,
  };
}

async function resolveSourceDirectory(params: {
  skillSlug: string;
  requestedSourceDir?: string;
}): Promise<string> {
  const candidateDirectories = params.requestedSourceDir
    ? [path.resolve(params.requestedSourceDir)]
    : [path.join(SANDBOX_CUSTOM_SKILLS_ROOT, params.skillSlug)];

  for (const candidateDirectory of candidateDirectories) {
    try {
      const directoryEntries = await readdir(candidateDirectory);
      if (directoryEntries.length > 0) {
        return candidateDirectory;
      }
    } catch {
      // Missing candidates are expected while resolving the ordered fallback locations.
    }
  }

  throw new Error(
    [
      `No custom skill directory was found for "${params.skillSlug}".`,
      params.requestedSourceDir
        ? `Looked in ${path.resolve(params.requestedSourceDir)}.`
        : `Looked in ${path.join(SANDBOX_CUSTOM_SKILLS_ROOT, params.skillSlug)}.`,
      "Create or edit the custom skill files first, then retry with --source-dir if needed.",
    ].join(" "),
  );
}

function runPersistPreflight(params: {
  skillSlug: string;
  sourceDirectory: string;
  files: CustomSkillFilePayload[];
}) {
  if (params.files.length === 0) {
    throw new Error(
      [
        `No persistable files were found for "${params.skillSlug}".`,
        `Looked in ${params.sourceDirectory}.`,
        "Saved custom skills support source, schema, reference, template, and common binary asset files.",
      ].join(" "),
    );
  }

  const skillMarkdown = params.files.find((file) => file.path === "SKILL.md");
  if (!skillMarkdown?.content.trim()) {
    throw new Error(
      `Custom skill "${params.skillSlug}" must include a non-empty SKILL.md before it can be persisted.`,
    );
  }

  if (params.files.length > MAX_PERSISTED_FILE_COUNT) {
    throw new Error(
      `Custom skill "${params.skillSlug}" has ${params.files.length} persistable files, which exceeds the limit of ${MAX_PERSISTED_FILE_COUNT}.`,
    );
  }

  const totalBytes = params.files.reduce(
    (sum, file) =>
      sum +
      (file.encoding === "utf8"
        ? Buffer.byteLength(file.content, "utf8")
        : Buffer.from(file.content, "base64").byteLength),
    0,
  );
  if (totalBytes > MAX_PERSISTED_TOTAL_BYTES) {
    throw new Error(
      `Custom skill "${params.skillSlug}" is ${totalBytes} bytes, which exceeds the ${MAX_PERSISTED_TOTAL_BYTES}-byte package limit.`,
    );
  }
}

function savedSkillDescription(response: PersistCustomSkillResponse) {
  if (response.created) {
    return "Saved to your custom skills. Open it to review or edit.";
  }
  if (response.saved) {
    return "Updated in your custom skills. Open it to review or edit.";
  }
  return "Already saved in your custom skills. Open it to review or edit.";
}

function savedSkillSummary(response: PersistCustomSkillResponse) {
  if (response.created) {
    return `Created saved custom tool ${response.skill.name} (${response.skill.slug}).`;
  }
  if (response.saved) {
    return `Updated saved custom tool ${response.skill.name} (${response.skill.slug}).`;
  }
  return `Custom tool ${response.skill.name} (${response.skill.slug}) was already up to date.`;
}

async function emitSavedSkillEvent(params: {
  config: Awaited<ReturnType<typeof readProjectSkillRuntimeConfig>>;
  response: PersistCustomSkillResponse;
}) {
  if (!params.config.runId) {
    return;
  }

  try {
    await emitCheatcodeSkillFrontendEvent({
      config: params.config,
      event: {
        type: "coding_agent.custom_skill_saved",
        data: {
          toolCallId: `skill-save:${params.response.skill.slug}:${Date.now()}`,
          kind: "saved_skill",
          skillName: params.response.skill.name,
          skillSlug: params.response.skill.slug,
          description: savedSkillDescription(params.response),
        },
      },
    });
  } catch {
    // Persistence is authoritative; a transient presentation event must not fail the save.
  }
}

async function persistSkill(params: { logger: SkillLogger; options: SaveSkillOptions }) {
  const { logger, options } = params;
  const sourceDirectory = await resolveSourceDirectory({
    skillSlug: options.skill,
    requestedSourceDir: options["source-dir"],
  });
  const files = await collectSkillFiles(sourceDirectory);
  runPersistPreflight({ skillSlug: options.skill, sourceDirectory, files });

  const config = await readProjectSkillRuntimeConfig();
  const response = await requestCheatcodeSkillJson<PersistCustomSkillResponse>({
    config,
    path: "/managed-skills/custom/save",
    method: "POST",
    body: { skillSlug: options.skill, files },
  });
  await emitSavedSkillEvent({ config, response });

  logger.log(
    [
      savedSkillSummary(response),
      `Source directory: ${sourceDirectory}`,
      `Files uploaded: ${files.length}`,
      `Latest revision: ${response.skill.latestRevision}`,
    ].join("\n"),
  );
}

async function main() {
  await createSkillTool({
    name: "save",
    description: "Persist a custom Cheatcode skill to the user's saved tools.",
    help: "Reads a custom skill directory and persists its instructions, source, schemas, references, templates, and common binary assets to the user's saved custom tool list. Use this after a new skill or update has been validated. Built-in and integration tools are rejected by the backend. Lockfiles, dependency directories, caches, and build output are excluded; a root .gitignore can exclude additional files.",
    options: SAVE_SKILL_OPTIONS,
    action: persistSkill,
  }).run();
}

void main().catch((error: unknown) => {
  const message =
    error instanceof Error ? error.message : "Failed to persist the custom Cheatcode tool.";
  console.error(message);
  process.exitCode = 1;
});
