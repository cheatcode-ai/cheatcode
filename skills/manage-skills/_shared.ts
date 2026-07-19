import type { Dirent } from "node:fs";
import { readdir } from "node:fs/promises";

import {
  emitCheatcodeSkillFrontendEvent,
  readProjectSkillRuntimeConfig,
  requestCheatcodeSkillJson,
} from "@cheatcode/sandbox-skills-runtime";

const DEFAULT_RUNTIME_SKILLS_ROOT = "/workspace/.cheatcode/skills";
const IGNORED_SKILL_DIR_NAMES = new Set(["node_modules", "dist", "build", ".git"]);

const isManagedSkillDebugEnabled = () => process.env.CHEATCODE_DEBUG_MANAGED_SKILLS === "1";

function joinRuntimeSkillPath(rootPath: string, entryName: string): string {
  return rootPath.endsWith("/") ? `${rootPath}${entryName}` : `${rootPath}/${entryName}`;
}

const logManagedSkillDebug = (message: string, details: Record<string, unknown>) => {
  if (!isManagedSkillDebugEnabled()) {
    return;
  }

  console.error(message, details);
};

export type ManagedSkillSource = "built_in" | "custom" | "integration";

export type ManagedSkillListItem = {
  slug: string;
  name: string;
  description: string;
  source: ManagedSkillSource;
  enabled: boolean;
  requiresConnection?: boolean;
  isConnected?: boolean;
  connectedAccountCount?: number;
  alwaysEnabled: boolean;
  editable: boolean;
  canEnable: boolean;
  canDisable: boolean;
};

export type ManagedSkillsListFilter = "all" | "available" | "enabled";

export type ManagedSkillConnectedAccountItem = {
  id: string;
  label: string;
  status: string;
  isSelected: boolean;
  isDefault: boolean;
};

export type ManagedSkillConnectedIntegrationItem = {
  skillSlug: string;
  skillName: string;
  integrationSlug: string;
  integrationName: string;
  connectedAccountId: string | null;
  defaultConnectedAccountId: string | null;
  connectedAccounts: ManagedSkillConnectedAccountItem[];
};

function renderManagedSkillsListNote(filter: ManagedSkillsListFilter): string {
  const filterHint =
    filter === "all"
      ? "Showing all Cheatcode tools. To view only enabled ones, run `cheatcode-skills manage-skills/manage/list --enabled`. To view only available ones, run `cheatcode-skills manage-skills/manage/list --available`."
      : filter === "enabled"
        ? "Showing only enabled or connected Cheatcode tools. Run `cheatcode-skills manage-skills/manage/list` for the full list."
        : "Showing only tools that are not currently enabled or connected. Run `cheatcode-skills manage-skills/manage/list` for the full list.";

  return [
    `Note: ${filterHint} If output is truncated, use \`| grep ...\` to search for relevant integrations.`,
    "Run any listed action as `cheatcode-skills <action>`. Examples: `cheatcode-skills gmail/messages/search`, `cheatcode-skills googlecalendar/events/list`, `cheatcode-skills manage-skills/manage/connect --skill slack`, `cheatcode-skills manage-skills/manage/list-accounts`, `cheatcode-skills manage-skills/manage/switch --account-id <id>`.",
  ].join("\n");
}

async function readManagedSkillDirectory(rootPath: string): Promise<Dirent[]> {
  try {
    return await readdir(rootPath, { withFileTypes: true });
  } catch (error) {
    const isMissingDirectory = error instanceof Error && "code" in error && error.code === "ENOENT";
    if (isMissingDirectory) {
      return [];
    }
    throw error;
  }
}

function shouldVisitManagedSkillDirectory(params: {
  entryName: string;
  isRoot: boolean;
  allowedSkillSlugs: ReadonlySet<string>;
}) {
  if (
    params.entryName.startsWith(".") ||
    params.entryName.startsWith("_") ||
    IGNORED_SKILL_DIR_NAMES.has(params.entryName)
  ) {
    return false;
  }
  return !params.isRoot || params.allowedSkillSlugs.has(params.entryName);
}

function recordManagedSkillToolPath(params: {
  entry: Dirent;
  relativeSegments: readonly string[];
  allowedSkillSlugs: ReadonlySet<string>;
  discoveredPathsBySkillSlug: Map<string, Set<string>>;
}) {
  if (
    !params.entry.isFile() ||
    !params.entry.name.endsWith(".ts") ||
    params.entry.name.endsWith(".d.ts") ||
    params.entry.name.startsWith("_")
  ) {
    return;
  }

  const nextSegments = [...params.relativeSegments, params.entry.name];
  const [skillSlug] = nextSegments;
  if (nextSegments.length < 3 || !skillSlug || !params.allowedSkillSlugs.has(skillSlug)) {
    return;
  }

  const discoveredPaths = params.discoveredPathsBySkillSlug.get(skillSlug) ?? new Set<string>();
  discoveredPaths.add(`${skillSlug}/${nextSegments.slice(1).join("/").replace(/\.ts$/, "")}`);
  params.discoveredPathsBySkillSlug.set(skillSlug, discoveredPaths);
}

async function collectManagedSkillToolPaths(params: {
  rootPath: string;
  allowedSkillSlugs: ReadonlySet<string>;
  relativeSegments?: string[];
  discoveredPathsBySkillSlug: Map<string, Set<string>>;
}): Promise<void> {
  const { rootPath, allowedSkillSlugs, relativeSegments = [], discoveredPathsBySkillSlug } = params;
  const entries = await readManagedSkillDirectory(rootPath);
  const sortedEntries = entries.toSorted((left, right) => left.name.localeCompare(right.name));

  for (const entry of sortedEntries) {
    if (entry.isDirectory()) {
      if (
        !shouldVisitManagedSkillDirectory({
          entryName: entry.name,
          isRoot: relativeSegments.length === 0,
          allowedSkillSlugs,
        })
      ) {
        continue;
      }

      await collectManagedSkillToolPaths({
        rootPath: joinRuntimeSkillPath(rootPath, entry.name),
        allowedSkillSlugs,
        relativeSegments: [...relativeSegments, entry.name],
        discoveredPathsBySkillSlug,
      });
      continue;
    }

    recordManagedSkillToolPath({
      entry,
      relativeSegments,
      allowedSkillSlugs,
      discoveredPathsBySkillSlug,
    });
  }
}

export async function discoverManagedSkillToolPaths(
  skills: readonly ManagedSkillListItem[],
): Promise<Map<string, string[]>> {
  const allowedSkillSlugs = new Set(skills.map((skill) => skill.slug));
  const discoveredPathsBySkillSlug = new Map<string, Set<string>>();

  await collectManagedSkillToolPaths({
    rootPath: DEFAULT_RUNTIME_SKILLS_ROOT,
    allowedSkillSlugs,
    discoveredPathsBySkillSlug,
  });

  return new Map(
    skills.map((skill) => [
      skill.slug,
      [...(discoveredPathsBySkillSlug.get(skill.slug) ?? new Set<string>())].sort(),
    ]),
  );
}

export type ManagedSkillConfirmationQuestion = {
  questions: Array<{
    id: string;
    text: string;
    options: Array<{
      label: string;
      value: string;
      description?: string;
    }>;
    suggestedAnswerIndex?: number;
  }>;
  context: string;
};

export async function requestManagedSkillsJson<TResponse>(params: {
  path: string;
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
}) {
  const config = await readProjectSkillRuntimeConfig();

  return requestCheatcodeSkillJson<TResponse>({
    config,
    path: params.path,
    ...(params.method ? { method: params.method } : {}),
    ...(typeof params.body === "undefined" ? {} : { body: params.body }),
  });
}

function renderManagedSkillStatus(skill: ManagedSkillListItem): string {
  const status = skill.alwaysEnabled ? "always available" : skill.enabled ? "enabled" : "disabled";
  const connectionState =
    skill.source === "integration" && skill.requiresConnection
      ? skill.isConnected
        ? `${skill.connectedAccountCount ?? 0} ${(skill.connectedAccountCount ?? 0) === 1 ? "account" : "accounts"} connected`
        : "not connected"
      : null;

  return connectionState ? `${status}, ${connectionState}` : status;
}

function isManagedSkillEnabled(skill: ManagedSkillListItem): boolean {
  if (skill.alwaysEnabled || skill.enabled) {
    return true;
  }

  return (
    skill.source === "integration" &&
    skill.requiresConnection === true &&
    skill.isConnected === true
  );
}

function matchesManagedSkillsListFilter(
  skill: ManagedSkillListItem,
  filter: ManagedSkillsListFilter,
): boolean {
  if (filter === "all") {
    return true;
  }

  if (filter === "enabled") {
    return isManagedSkillEnabled(skill);
  }

  return !isManagedSkillEnabled(skill);
}

export function renderManagedSkillSummary(
  skill: ManagedSkillListItem,
  runnableToolPaths: readonly string[] = [],
  options: {
    includeStatus?: boolean;
  } = {},
): string {
  return [
    skill.name,
    `  id: ${skill.slug}`,
    ...(options.includeStatus === false ? [] : [`  status: ${renderManagedSkillStatus(skill)}`]),
    ...(runnableToolPaths.length > 0
      ? ["  runnable paths:", ...runnableToolPaths.map((toolPath) => `    - ${toolPath}`)]
      : []),
  ].join("\n");
}

export function renderManagedConnectedIntegrationSummary(
  integration: ManagedSkillConnectedIntegrationItem,
): string {
  return [
    integration.skillName,
    `  slug/id: ${integration.skillSlug}`,
    `  active account: ${integration.connectedAccountId ?? "(none)"}`,
    `  default account: ${integration.defaultConnectedAccountId ?? "(none)"}`,
    "  connected accounts:",
    ...integration.connectedAccounts.map((account) => {
      const flags = [
        account.isSelected ? "active" : null,
        account.isDefault ? "default" : null,
      ].filter((flag): flag is string => Boolean(flag));
      const suffix = flags.length > 0 ? ` [${flags.join(", ")}]` : "";

      return `    - ${account.id}${suffix}: ${account.label} (${account.status})`;
    }),
  ].join("\n");
}

export function renderManagedConnectedAccountsOutput(
  integrations: readonly ManagedSkillConnectedIntegrationItem[],
): string {
  if (integrations.length === 0) {
    return [
      "No connected Cheatcode integration accounts are available.",
      "",
      "Connect an integration first with `cheatcode-skills manage-skills/manage/connect --skill <slug>`.",
    ].join("\n");
  }

  return [
    "Connected Cheatcode integration accounts.",
    "Use `cheatcode-skills manage-skills/manage/switch --account-id <id>` to switch the default account used for future calls.",
    "",
    integrations
      .map((integration) => renderManagedConnectedIntegrationSummary(integration))
      .join("\n\n"),
  ].join("\n");
}

const MANAGED_SKILLS_CREATE_HINT =
  'If the capability you need is not listed above, and the user wants Cheatcode to do it on demand rather than build it into the project, consider creating a reusable custom skill via `cheatcode-skills skill-authoring/create --name "<skill name>" --goal "<summary>" [--skill <slug>]` and then follow the Cheatcode skill-authoring flow.';

export function renderManagedSkillsListOutput(
  skills: readonly ManagedSkillListItem[],
  runnableToolPathsBySkillSlug: ReadonlyMap<string, readonly string[]> = new Map(),
  options: {
    filter?: ManagedSkillsListFilter;
  } = {},
): string {
  const filter = options.filter ?? "all";
  const filteredSkills = skills.filter((skill) => matchesManagedSkillsListFilter(skill, filter));

  if (filteredSkills.length === 0) {
    const emptyMessage =
      filter === "enabled"
        ? "No enabled or connected Cheatcode tools are currently available."
        : filter === "available"
          ? "No additional Cheatcode tools are currently available to connect or enable."
          : "No Cheatcode tools are available.";

    return [emptyMessage, "", MANAGED_SKILLS_CREATE_HINT].join("\n");
  }

  return [
    renderManagedSkillsListNote(filter),
    "",
    filteredSkills
      .map((skill) =>
        renderManagedSkillSummary(skill, runnableToolPathsBySkillSlug.get(skill.slug) ?? [], {
          includeStatus: filter === "all",
        }),
      )
      .join("\n\n"),
    "",
    MANAGED_SKILLS_CREATE_HINT,
  ].join("\n");
}

export type RequestManagedSkillChangeResponse = {
  skill: ManagedSkillListItem;
  action: "enable" | "disable";
  requiresConfirmation: boolean;
  message?: string;
  question?: ManagedSkillConfirmationQuestion;
  uiAction?:
    | {
        kind: "connect_account";
        skillSlug: string;
        skillSource: "integration";
        skillName: string;
        integrationSlug: string;
        integrationName: string;
        logoUrl?: string | null;
      }
    | {
        kind: "enable_skill";
        skillSlug: string;
        skillSource: "integration";
        skillName: string;
        integrationSlug: string;
        integrationName: string;
        logoUrl?: string | null;
      };
};

export type RequestManagedSkillConnectResponse = {
  skill: ManagedSkillListItem;
  action: "connect";
  message?: string;
  uiAction?: Extract<
    NonNullable<RequestManagedSkillChangeResponse["uiAction"]>,
    { kind: "connect_account" }
  >;
};

type ManagedSkillUiAction = NonNullable<RequestManagedSkillChangeResponse["uiAction"]>;

async function emitManagedSkillUiActionEventWithConfig(params: {
  config: Awaited<ReturnType<typeof readProjectSkillRuntimeConfig>>;
  toolCallId: string;
  uiAction: ManagedSkillUiAction;
}) {
  const { config, toolCallId, uiAction } = params;

  return emitCheatcodeSkillFrontendEvent({
    config,
    event: {
      type:
        uiAction.kind === "connect_account"
          ? "coding_agent.connect_integration_account"
          : "coding_agent.enable_managed_skill",
      data: {
        toolCallId,
        ...uiAction,
      },
    },
  });
}

export async function tryEmitManagedSkillUiActionEvent(params: {
  toolCallId: string;
  uiAction: ManagedSkillUiAction;
}): Promise<boolean> {
  const config = await readProjectSkillRuntimeConfig();

  if (!config.runId) {
    logManagedSkillDebug(
      "[manage-skills] Skipping managed skill UI event because no active run is attached",
      {
        toolCallId: params.toolCallId,
        projectId: config.projectId,
        uiAction: params.uiAction.kind,
      },
    );
    return false;
  }

  const result = await emitManagedSkillUiActionEventWithConfig({
    config,
    toolCallId: params.toolCallId,
    uiAction: params.uiAction,
  });

  return result.delivered;
}
