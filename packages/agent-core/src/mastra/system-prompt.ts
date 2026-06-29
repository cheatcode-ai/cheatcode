import { buildSystemPromptSection } from "@cheatcode/skills";

export const MASTER_INSTRUCTIONS_CONTEXT_KEY = "masterInstructions";
export const AGENT_DISPLAY_NAME_CONTEXT_KEY = "agentDisplayName";
export const GLOBAL_MEMORY_CONTEXT_KEY = "globalMemory";
/** The caller's custom skills (full, with body) — read by the prompt + `skill_invoke`. */
export const USER_SKILLS_CONTEXT_KEY = "userSkills";
/** Request-scoped capability the `skill_create` tool uses to persist a new user skill. */
export const USER_SKILL_STORE_CONTEXT_KEY = "userSkillStore";

/** A user-created skill carried in the request context (mirrors the bundled SKILL.md shape). */
export interface UserSkillRuntime {
  name: string;
  description: string;
  body: string;
  category?: string;
}

/** Persists a skill the agent authored in Skill Creator mode. Injected by the agent-worker. */
export interface UserSkillStore {
  save(skill: {
    name: string;
    description: string;
    body: string;
    category?: string;
    tags?: string[];
  }): Promise<void>;
}

export function userSkillStoreFromRequestContext(
  requestContext: { get(key: string): unknown } | undefined,
): UserSkillStore | null {
  const value = requestContext?.get(USER_SKILL_STORE_CONTEXT_KEY);
  if (value && typeof (value as UserSkillStore).save === "function") {
    return value as UserSkillStore;
  }
  return null;
}

interface RequestContextReader {
  get(key: string): unknown;
}

export interface PromptRuntimeContext {
  agentDisplayName?: string;
  globalMemory?: string;
  masterInstructions?: string;
  userSkills?: UserSkillRuntime[];
}

/** Parse the request-context user-skills value into a typed list (defensive — it crosses the DO boundary). */
export function userSkillsFromRequestContext(
  requestContext: RequestContextReader | undefined,
): UserSkillRuntime[] {
  const raw = requestContext?.get(USER_SKILLS_CONTEXT_KEY);
  if (!Array.isArray(raw)) {
    return [];
  }
  const skills: UserSkillRuntime[] = [];
  for (const entry of raw) {
    if (
      entry &&
      typeof entry === "object" &&
      typeof (entry as { name?: unknown }).name === "string" &&
      typeof (entry as { description?: unknown }).description === "string" &&
      typeof (entry as { body?: unknown }).body === "string"
    ) {
      const value = entry as UserSkillRuntime;
      skills.push({
        body: value.body,
        description: value.description,
        name: value.name,
        ...(typeof value.category === "string" ? { category: value.category } : {}),
      });
    }
  }
  return skills;
}

export function promptRuntimeContextFromRequestContext(
  requestContext: RequestContextReader | undefined,
): PromptRuntimeContext {
  const context: PromptRuntimeContext = {};
  const agentDisplayName = trimmedContextValue(requestContext, AGENT_DISPLAY_NAME_CONTEXT_KEY);
  if (agentDisplayName) {
    context.agentDisplayName = agentDisplayName;
  }
  const globalMemory = trimmedContextValue(requestContext, GLOBAL_MEMORY_CONTEXT_KEY);
  if (globalMemory) {
    context.globalMemory = globalMemory;
  }
  const masterInstructions = trimmedContextValue(requestContext, MASTER_INSTRUCTIONS_CONTEXT_KEY);
  if (masterInstructions) {
    context.masterInstructions = masterInstructions;
  }
  const userSkills = userSkillsFromRequestContext(requestContext);
  if (userSkills.length > 0) {
    context.userSkills = userSkills;
  }
  return context;
}

function trimmedContextValue(
  requestContext: RequestContextReader | undefined,
  key: string,
): string | undefined {
  const value = requestContext?.get(key);
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

export function buildSystemPrompt(runtimeContext: PromptRuntimeContext = {}): string {
  return [
    "You are Cheatcode, a generalist AI agent that builds apps, documents, research, and workflows.",
    runtimeContext.agentDisplayName
      ? `The user calls you "${runtimeContext.agentDisplayName}"; answer to that name.`
      : "",
    "Follow the user's instructions, respect BYOK constraints, and use tools for deterministic work.",
    "For coding and data requests, use the project sandbox tools instead of guessing. Use runCode for small scripts, shell_exec for CLI work, fs_read/fs_write/fs_list/fs_search for files, git_* for repositories, and start_dev_server for live previews on port 5173.",
    "Tokens like @<path> in user messages refer to files in the project sandbox at /workspace/<path>. Read them with fs_read (or fs_list for directories) before acting on them.",
    "For browser tasks, use browser_open, browser_act, browser_observe, browser_extract, and browser_screenshot. These run Stagehand LOCAL mode inside the sandbox browser; never ask for Browserbase or expose CDP.",
    "For document artifacts, use docs_generate_slides, docs_generate_docx, docs_generate_xlsx, or docs_generate_pdf and return the signed download URL.",
    "For user-requested external app actions, use composio_list_tools to find exact action slugs and composio_execute only against integrations the user has connected in Settings.",
    "When building a web app preview, create or update files under /workspace, start the dev server with --hostname 0.0.0.0, and include the preview URL returned by start_dev_server.",
    runtimeContext.globalMemory
      ? `## User Memory\n${runtimeContext.globalMemory}\n\nProject instructions take precedence over this memory when they conflict.`
      : "",
    runtimeContext.masterInstructions
      ? `## Project Instructions\n${runtimeContext.masterInstructions}`
      : "",
    buildSystemPromptSection(),
    buildUserSkillsSection(runtimeContext.userSkills),
    SKILL_CREATION_NOTE,
  ]
    .filter((part) => part.length > 0)
    .join("\n\n");
}

/** Lists the caller's custom skills alongside the bundled catalog; both load via `skill_invoke`. */
function buildUserSkillsSection(userSkills: UserSkillRuntime[] | undefined): string {
  if (!userSkills || userSkills.length === 0) {
    return "";
  }
  return [
    "## Your Custom Skills",
    "",
    "These are skills this user created. Load full instructions with `skill_invoke` (by name) just like bundled skills.",
    "",
    ...userSkills.map((skill) => `- **${skill.name}**: ${skill.description}`),
  ].join("\n");
}

const SKILL_CREATION_NOTE = [
  "## Creating skills",
  'When the user asks to create or save a reusable "skill", author it and persist it with the `skill_create` tool:',
  "draft a short name, a one-line description (what it does + when to use it), and a markdown body of concrete step-by-step",
  'instructions (which tools to use, in what order, what to produce); pick a category ("Builder & Apps", "Research & Docs",',
  'or "Data & Media"); then call `skill_create` with { name, description, body, category, tags }. Saved skills are then',
  "available via `skill_invoke` by name in future chats.",
].join("\n");
