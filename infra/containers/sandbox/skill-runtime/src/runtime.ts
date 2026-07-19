import { readFile } from "node:fs/promises";
import path from "node:path";

import type {
  CheatcodeSkillFrontendEvent,
  CheatcodeSkillRequestMethod,
  RuntimeBoundSkillRequester,
  SkillRuntimeConfig,
} from "./types";

const DEFAULT_RUNTIME_CONFIG_PATH =
  "/workspace/.cheatcode/runtime/skill-runtime-config.json";
const DEFAULT_PROJECT_ROOT = "/workspace";
const DEFAULT_SKILLS_HOME = "/home/node/.cheatcode";
const DEFAULT_CUSTOM_SKILLS_ROOT = "/workspace/.cheatcode/skills";
const CUSTOM_SKILL_ENV_BASENAME = ".env";
const PROJECT_ENV_FILE_BASENAMES = [".env", ".env.local"] as const;
const PROJECT_ROOT_ENV_NAME = "CHEATCODE_SKILL_PROJECT_ROOT";
const SKILLS_HOME_ENV_NAME = "CHEATCODE_SKILLS_HOME";
let loadedRuntimeEnvCacheKey: string | null = null;

function resolveProjectRoot(): string {
  const configuredProjectRoot = process.env[PROJECT_ROOT_ENV_NAME]?.trim() || null;
  if (configuredProjectRoot) {
    return path.resolve(configuredProjectRoot);
  }

  const currentWorkingDirectory = process.cwd();
  if (currentWorkingDirectory.startsWith(DEFAULT_SKILLS_HOME)) {
    return DEFAULT_PROJECT_ROOT;
  }

  return currentWorkingDirectory;
}

function resolveSkillsHome(): string {
  const configuredSkillsHome = process.env[SKILLS_HOME_ENV_NAME]?.trim() || null;
  return configuredSkillsHome ? path.resolve(configuredSkillsHome) : DEFAULT_SKILLS_HOME;
}

function resolveCurrentSkillRoot(): string | null {
  const customSkillsRoot =
    process.env.CHEATCODE_CUSTOM_SKILLS_ROOT?.trim() || DEFAULT_CUSTOM_SKILLS_ROOT;
  const runtimeCandidates = [process.argv[1], process.cwd()];

  for (const candidate of runtimeCandidates) {
    const normalizedCandidate = candidate?.trim();
    if (!normalizedCandidate) {
      continue;
    }

    const resolvedCandidate = path.resolve(normalizedCandidate);
    const relativePath = path.relative(customSkillsRoot, resolvedCandidate);
    if (
      !relativePath ||
      relativePath === ".." ||
      relativePath.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relativePath)
    ) {
      continue;
    }

    const [skillSlug] = relativePath.split(path.sep).filter(Boolean);
    if (!skillSlug) {
      continue;
    }

    return path.join(customSkillsRoot, skillSlug);
  }

  return null;
}

function buildProjectEnvFilePaths(projectRoot: string): string[] {
  const nodeEnv = process.env.NODE_ENV?.trim() || null;
  const envSpecificBasenames =
    nodeEnv && /^[a-z0-9_-]+$/i.test(nodeEnv)
      ? [`.env.${nodeEnv}`, `.env.${nodeEnv}.local`]
      : [];

  return [...PROJECT_ENV_FILE_BASENAMES, ...envSpecificBasenames].map((basename) =>
    path.join(projectRoot, basename),
  );
}

function parseProjectEnvContent(content: string): Record<string, string> {
  const normalizedLines = content.replace(/\r\n/g, "\n").split("\n");
  const parsedValues: Record<string, string> = {};

  for (const rawLine of normalizedLines) {
    const trimmedLine = rawLine.trim();
    if (!trimmedLine || trimmedLine.startsWith("#")) {
      continue;
    }

    const normalizedLine = trimmedLine.startsWith("export ")
      ? trimmedLine.slice("export ".length).trim()
      : trimmedLine;
    const separatorIndex = normalizedLine.indexOf("=");
    if (separatorIndex <= 0) {
      continue;
    }

    const key = normalizedLine.slice(0, separatorIndex).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
      continue;
    }

    let value = normalizedLine.slice(separatorIndex + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      const quote = value[0];
      value = value.slice(1, -1);
      if (quote === '"') {
        value = value
          .replace(/\\n/g, "\n")
          .replace(/\\r/g, "\r")
          .replace(/\\t/g, "\t")
          .replace(/\\"/g, '"')
          .replace(/\\\\/g, "\\");
      }
    } else {
      const commentIndex = value.search(/\s#/);
      if (commentIndex >= 0) {
        value = value.slice(0, commentIndex).trim();
      }
    }

    parsedValues[key] = value;
  }

  return parsedValues;
}

async function readEnvFileIfPresent(
  envFilePath: string,
  target: Record<string, string>,
): Promise<void> {
  try {
    const rawContent = await readFile(envFilePath, "utf8");
    Object.assign(target, parseProjectEnvContent(rawContent));
  } catch (error) {
    const isMissingFile =
      error instanceof Error &&
      "code" in error &&
      error.code === "ENOENT";

    if (!isMissingFile) {
      throw error;
    }
  }
}

export async function ensureProjectEnvLoaded(): Promise<void> {
  const projectRoot = resolveProjectRoot();
  const skillRoot = resolveCurrentSkillRoot();
  const cacheKey = `${skillRoot ?? ""}:${projectRoot}:${process.env.NODE_ENV ?? ""}`;
  if (loadedRuntimeEnvCacheKey === cacheKey) {
    return;
  }

  const mergedRuntimeEnv: Record<string, string> = {};
  for (const envFilePath of buildProjectEnvFilePaths(projectRoot)) {
    await readEnvFileIfPresent(envFilePath, mergedRuntimeEnv);
  }

  if (skillRoot) {
    await readEnvFileIfPresent(
      path.join(skillRoot, CUSTOM_SKILL_ENV_BASENAME),
      mergedRuntimeEnv,
    );
  }

  for (const [key, value] of Object.entries(mergedRuntimeEnv)) {
    if (typeof process.env[key] === "undefined") {
      process.env[key] = value;
    }
  }

  loadedRuntimeEnvCacheKey = cacheKey;
}

export async function readProjectSkillRuntimeConfig(): Promise<SkillRuntimeConfig> {
  await ensureProjectEnvLoaded();

  const envBackendBaseUrl =
    process.env.CHEATCODE_SKILL_BACKEND_BASE_URL?.trim() ||
    process.env.CHEATCODE_BACKEND_BASE_URL?.trim() ||
    null;
  const envAccessToken = process.env.CHEATCODE_SKILL_ACCESS_TOKEN?.trim() || null;
  const envProjectId = process.env.CHEATCODE_PROJECT_ID?.trim() || null;
  const envRunId = process.env.CHEATCODE_RUN_ID?.trim() || null;
  const envAssistantClientMessageId =
    process.env.CHEATCODE_ASSISTANT_CLIENT_MESSAGE_ID?.trim() || null;
  const envChatSessionId = process.env.CHEATCODE_CHAT_SESSION_ID?.trim() || null;
  const envSandboxContext =
    (process.env.CHEATCODE_SANDBOX_CONTEXT?.trim() as SkillRuntimeConfig["sandboxContext"]) || null;
  const envDeliveryChannel =
    (process.env.CHEATCODE_DELIVERY_CHANNEL?.trim() as SkillRuntimeConfig["deliveryChannel"]) || null;
  const runtimeConfigPaths = [
    process.env.CHEATCODE_SKILL_RUNTIME_CONFIG?.trim() || null,
    DEFAULT_RUNTIME_CONFIG_PATH,
  ].filter(
    (path, index, paths): path is string =>
      typeof path === "string" && path.length > 0 && paths.indexOf(path) === index,
  );

  let parsedFileConfig: Partial<SkillRuntimeConfig> = {};
  for (const runtimeConfigPath of runtimeConfigPaths) {
    try {
      const raw = await readFile(runtimeConfigPath, "utf8");
      parsedFileConfig = JSON.parse(raw) as Partial<SkillRuntimeConfig>;
      break;
    } catch (error) {
      const isMissingFile =
        error instanceof Error &&
        "code" in error &&
        error.code === "ENOENT";

      if (!isMissingFile) {
        throw error;
      }
    }
  }

  const backendBaseUrl =
    envBackendBaseUrl || parsedFileConfig.backendBaseUrl?.trim() || null;
  const accessToken =
    envAccessToken || parsedFileConfig.accessToken?.trim() || null;
  const projectId =
    envProjectId || parsedFileConfig.projectId?.trim() || null;
  const runId = envRunId || parsedFileConfig.runId?.trim() || null;
  const assistantClientMessageId =
    envAssistantClientMessageId ||
    parsedFileConfig.assistantClientMessageId?.trim() ||
    null;
  const chatSessionId =
    envChatSessionId || parsedFileConfig.chatSessionId?.trim() || null;
  const sandboxContext =
    envSandboxContext || parsedFileConfig.sandboxContext || null;
  const deliveryChannel =
    envDeliveryChannel || parsedFileConfig.deliveryChannel || null;

  if (!backendBaseUrl || !accessToken) {
    throw new Error(
      "Invalid Cheatcode skill runtime config. Expected CHEATCODE_SKILL_ACCESS_TOKEN and CHEATCODE_SKILL_BACKEND_BASE_URL/CHEATCODE_BACKEND_BASE_URL to be set, with optional CHEATCODE_PROJECT_ID and CHEATCODE_SKILL_RUNTIME_CONFIG for file-based fallback.",
    );
  }

  return {
    backendBaseUrl: backendBaseUrl.replace(/\/+$/, ""),
    accessToken,
    ...(projectId ? { projectId } : {}),
    ...(runId ? { runId } : {}),
    ...(assistantClientMessageId ? { assistantClientMessageId } : {}),
    ...(chatSessionId ? { chatSessionId } : {}),
    ...(sandboxContext ? { sandboxContext } : {}),
    ...(deliveryChannel ? { deliveryChannel } : {}),
  };
}

export function createRuntimeBoundSkillRequester<
  TOperation extends string,
  TResponseMap extends Record<string, unknown>,
>(
  execute: (
    config: SkillRuntimeConfig,
    operation: TOperation,
    body: Record<string, unknown>,
  ) => Promise<unknown>,
): RuntimeBoundSkillRequester<TOperation, TResponseMap> {
  async function requestSkillJson<
    TSpecificOperation extends keyof TResponseMap & TOperation,
  >(params: {
    operation: TSpecificOperation;
    body?: Record<string, unknown>;
  }): Promise<TResponseMap[TSpecificOperation]>;
  async function requestSkillJson<TResponse>(params: {
    operation: TOperation;
    body?: Record<string, unknown>;
  }): Promise<TResponse>;
  async function requestSkillJson<TResponse>(params: {
    operation: TOperation;
    body?: Record<string, unknown>;
  }): Promise<TResponse> {
    const config = await readProjectSkillRuntimeConfig();

    return execute(
      config,
      params.operation,
      params.body ?? {},
    ) as Promise<TResponse>;
  }

  return requestSkillJson;
}

export async function requestCheatcodeSkillJson<TResponse>(params: {
  config: SkillRuntimeConfig;
  path: string;
  method?: CheatcodeSkillRequestMethod;
  body?: unknown;
}): Promise<TResponse> {
  const { config, path, method = "POST", body } = params;

  const response = await fetch(`${config.backendBaseUrl}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.accessToken}`,
    },
    body: typeof body === "undefined" ? undefined : JSON.stringify(body),
  });

  const data = (await response.json().catch(() => ({}))) as TResponse & {
    error?: string;
  };

  if (!response.ok) {
    const errorMessage =
      typeof data.error === "string" && data.error.length > 0
        ? data.error
        : `Request failed with status ${response.status}`;
    throw new Error(errorMessage);
  }

  return data;
}

export async function emitCheatcodeSkillFrontendEvent(params: {
  config: SkillRuntimeConfig;
  event: CheatcodeSkillFrontendEvent;
}): Promise<{ delivered: boolean }> {
  if (!params.config.runId) {
    throw new Error(
      "This Cheatcode skill runtime is not attached to an active Cheatcode run.",
    );
  }

  if (!params.config.assistantClientMessageId) {
    return { delivered: false };
  }

  if (!params.config.projectId) {
    return { delivered: false };
  }

  return requestCheatcodeSkillJson<{ delivered: boolean }>({
    config: params.config,
    path: "/skill-frontend-events",
    body: {
      projectId: params.config.projectId,
      runId: params.config.runId,
      assistantClientMessageId: params.config.assistantClientMessageId,
      ...(params.config.chatSessionId
        ? { chatSessionId: params.config.chatSessionId }
        : {}),
      event: params.event,
    },
  });
}
