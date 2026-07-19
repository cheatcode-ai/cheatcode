import {
  createDb,
  getUserSkillByName,
  listUserIntegrations,
  listUserSkillRecords,
  setDefaultUserIntegration,
  type UserIntegrationRecord,
  type UserSkillRecord,
  upsertUserSkill,
  withUserContext,
} from "@cheatcode/db";
import { APIError, readJsonRequest } from "@cheatcode/observability";
import { SKILL_MANIFEST } from "@cheatcode/skills/manifest";
import type { Context, Hono } from "hono";
import { z } from "zod";
import type { AgentEnv } from "./agent-env";
import { sandboxForUser } from "./agent-routing";
import { requireSkillRuntimePrincipal } from "./skill-runtime-auth";
import { parsePortableSkillMarkdown, userSkillSlug } from "./user-skill-files";
import {
  persistUserSkillPackage,
  readUserSkillPackage,
  UserSkillPackageFileSchema,
  writeUserSkillPackageMirror,
} from "./user-skill-packages";

type AgentContext = Context<{ Bindings: AgentEnv }>;
type RuntimePrincipal = Awaited<ReturnType<typeof requireSkillRuntimePrincipal>>;

const MAX_RUNTIME_REQUEST_BYTES = 1024 * 1024 + 32 * 1024;
const SkillSlugSchema = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u);
const SaveCustomSkillSchema = z
  .object({
    files: z.array(UserSkillPackageFileSchema).min(1).max(20),
    skillSlug: SkillSlugSchema,
  })
  .strict();
const SkillActionSchema = z
  .object({ action: z.enum(["enable", "disable"]), skillSlug: SkillSlugSchema })
  .strict();
const SkillSelectionSchema = z.object({ skillSlug: SkillSlugSchema }).strict();
const DefaultAccountSchema = z
  .object({ connectedAccountId: z.string().trim().min(1).max(256) })
  .strict();
const KNOWN_INTEGRATIONS = [
  "gmail",
  "github",
  "google_calendar",
  "google_docs",
  "google_drive",
  "google_sheets",
  "linear",
  "notion",
  "slack",
] as const;

interface ManagedSkillItem {
  alwaysEnabled: boolean;
  canDisable: boolean;
  canEnable: boolean;
  connectedAccountCount?: number;
  description: string;
  editable: boolean;
  enabled: boolean;
  isConnected?: boolean;
  name: string;
  requiresConnection?: boolean;
  slug: string;
  source: "built_in" | "custom" | "integration";
}

export function registerSkillRuntimeManagedRoutes(app: Hono<{ Bindings: AgentEnv }>): void {
  app.get("/skill-runtime/managed-skills", listManagedSkills);
  app.post("/skill-runtime/managed-skills/custom/save", saveCustomSkill);
  app.post("/skill-runtime/managed-skills/prepare-change", prepareSkillChange);
  app.post("/skill-runtime/managed-skills/prepare-connect-account", prepareConnectAccount);
  app.post("/skill-runtime/managed-skills/connect-link", connectLinkFallback);
  app.get("/skill-runtime/managed-skills/connected-accounts", listConnectedAccounts);
  app.patch("/skill-runtime/managed-skills/connected-accounts/default", switchDefaultAccount);
}

async function listManagedSkills(c: AgentContext): Promise<Response> {
  const principal = await requireSkillRuntimePrincipal(c.env, c.req.raw.headers, "skills:read");
  const state = await loadManagedState(c.env, principal);
  return c.json({ skills: managedSkillItems(state.skills, state.integrations) });
}

async function saveCustomSkill(c: AgentContext): Promise<Response> {
  const principal = await requireSkillRuntimePrincipal(c.env, c.req.raw.headers, "skills:write");
  const input = SaveCustomSkillSchema.parse(
    await readJsonRequest(c.req.raw, MAX_RUNTIME_REQUEST_BYTES, "Custom skill package"),
  );
  const markdown = input.files.find((file) => file.path === "SKILL.md")?.content;
  if (!markdown) {
    throw invalidSkillPackage("Custom skill package must include SKILL.md");
  }
  const parsed = parsePortableSkillMarkdown(markdown, input.skillSlug);
  if (!parsed.success) {
    throw invalidSkillPackage("Custom SKILL.md frontmatter or body is invalid");
  }
  return persistCustomSkill(c, principal, input, parsed.data);
}

async function persistCustomSkill(
  c: AgentContext,
  principal: RuntimePrincipal,
  input: z.infer<typeof SaveCustomSkillSchema>,
  parsed: { body: string; category: string; description: string; name: string; tags: string[] },
): Promise<Response> {
  const existing = await findSkillByName(c.env, principal, parsed.name);
  const skill = await upsertRuntimeSkill(c.env, principal, parsed);
  const previous = await readUserSkillPackage(c.env.R2_OUTPUTS, principal.userId, skill.id);
  const packageValue = await persistUserSkillPackage(
    c.env.R2_OUTPUTS,
    principal.userId,
    skill.id,
    input.files,
  );
  await writeUserSkillPackageMirror(
    await sandboxForUser(c.env, principal.userId),
    skill,
    packageValue,
  );
  return c.json({
    created: existing === null,
    saved: previous?.revision !== packageValue.revision,
    skill: runtimeSkillResponse(skill, input.skillSlug, packageValue.revision),
    source: "custom" as const,
  });
}

async function prepareSkillChange(c: AgentContext): Promise<Response> {
  const principal = await requireSkillRuntimePrincipal(c.env, c.req.raw.headers, "skills:write");
  const input = SkillActionSchema.parse(
    await readJsonRequest(c.req.raw, 8 * 1024, "Managed skill change"),
  );
  const state = await loadManagedState(c.env, principal);
  const skill = managedSkillItems(state.skills, state.integrations).find(
    (item) => item.slug === input.skillSlug,
  );
  if (!skill) throw skillNotFound(input.skillSlug);
  return c.json(managedSkillChangeResponse(skill, input.action));
}

async function prepareConnectAccount(c: AgentContext): Promise<Response> {
  const principal = await requireSkillRuntimePrincipal(
    c.env,
    c.req.raw.headers,
    "integrations:execute",
  );
  const input = SkillSelectionSchema.parse(
    await readJsonRequest(c.req.raw, 8 * 1024, "Managed integration connection"),
  );
  const state = await loadManagedState(c.env, principal);
  const skill = managedSkillItems(state.skills, state.integrations).find(
    (item) => item.slug === input.skillSlug && item.source === "integration",
  );
  if (!skill) throw skillNotFound(input.skillSlug);
  return c.json({ action: "connect", skill, uiAction: connectUiAction(skill) });
}

async function connectLinkFallback(c: AgentContext): Promise<Response> {
  const principal = await requireSkillRuntimePrincipal(
    c.env,
    c.req.raw.headers,
    "integrations:execute",
  );
  const input = SkillSelectionSchema.passthrough().parse(
    await readJsonRequest(c.req.raw, 8 * 1024, "Managed integration link"),
  );
  const state = await loadManagedState(c.env, principal);
  const connected = state.integrations.some(
    (item) => item.integration === input.skillSlug && isActiveStatus(item.status),
  );
  return c.json({
    alreadyConnected: connected,
    integrationName: titleCaseSlug(input.skillSlug),
    integrationSlug: input.skillSlug,
    message: connected
      ? `${titleCaseSlug(input.skillSlug)} is already connected.`
      : `Connect ${titleCaseSlug(input.skillSlug)} from the Cheatcode Skills screen.`,
  });
}

async function listConnectedAccounts(c: AgentContext): Promise<Response> {
  const principal = await requireSkillRuntimePrincipal(c.env, c.req.raw.headers, "skills:read");
  const state = await loadManagedState(c.env, principal);
  return c.json({ integrations: connectedIntegrationItems(state.integrations) });
}

async function switchDefaultAccount(c: AgentContext): Promise<Response> {
  const principal = await requireSkillRuntimePrincipal(
    c.env,
    c.req.raw.headers,
    "integrations:execute",
  );
  const input = DefaultAccountSchema.parse(
    await readJsonRequest(c.req.raw, 8 * 1024, "Default integration account"),
  );
  const integration = await makeAccountDefault(c.env, principal, input.connectedAccountId);
  const state = await loadManagedState(c.env, principal);
  const integrations = connectedIntegrationItems(state.integrations);
  return c.json({
    connectedAccountId: input.connectedAccountId,
    integration: integrations.find((item) => item.integrationSlug === integration) ?? null,
    integrationName: titleCaseSlug(integration),
    integrationSlug: integration,
    integrations,
    success: true,
  });
}

async function loadManagedState(env: AgentEnv, principal: RuntimePrincipal) {
  return withRuntimeDb(env, principal, async (db) => ({
    integrations: await listUserIntegrations(db, principal.userId),
    skills: await listUserSkillRecords(db, principal.userId),
  }));
}

async function findSkillByName(
  env: AgentEnv,
  principal: RuntimePrincipal,
  name: string,
): Promise<UserSkillRecord | null> {
  return withRuntimeDb(env, principal, (db) => getUserSkillByName(db, principal.userId, name));
}

async function upsertRuntimeSkill(
  env: AgentEnv,
  principal: RuntimePrincipal,
  skill: { body: string; category: string; description: string; name: string; tags: string[] },
): Promise<UserSkillRecord> {
  return withRuntimeDb(env, principal, (db) =>
    upsertUserSkill(db, { ...skill, userId: principal.userId }),
  );
}

async function makeAccountDefault(
  env: AgentEnv,
  principal: RuntimePrincipal,
  connectedAccountId: string,
): Promise<string> {
  const integration = await withRuntimeDb(env, principal, async (db) => {
    const accounts = await listUserIntegrations(db, principal.userId);
    const account = accounts.find((item) => item.composioConnectionId === connectedAccountId);
    if (!account) return null;
    const updated = await setDefaultUserIntegration(db, {
      composioConnectionId: connectedAccountId,
      integration: account.integration,
      userId: principal.userId,
    });
    return updated ? account.integration : null;
  });
  if (!integration) throw skillNotFound("connected account");
  return integration;
}

async function withRuntimeDb<T>(
  env: AgentEnv,
  principal: RuntimePrincipal,
  operation: (db: Parameters<typeof listUserSkillRecords>[0]) => Promise<T>,
): Promise<T> {
  const { db, close } = createDb(env.HYPERDRIVE, {
    audience: "app_agent",
    signingSecret: env.DATABASE_CONTEXT_SIGNING_SECRET_AGENT,
  });
  try {
    return await withUserContext(db, principal.userId, operation);
  } finally {
    await close();
  }
}

function managedSkillItems(
  customSkills: UserSkillRecord[],
  accounts: UserIntegrationRecord[],
): ManagedSkillItem[] {
  return [
    ...SKILL_MANIFEST.map((skill) => builtInSkill(skill)),
    ...customSkills.map(customSkill),
    ...integrationSlugs(accounts).map((slug) => integrationSkill(slug, accounts)),
  ].sort((left, right) => left.name.localeCompare(right.name));
}

function builtInSkill(skill: (typeof SKILL_MANIFEST)[number]): ManagedSkillItem {
  return {
    alwaysEnabled: true,
    canDisable: false,
    canEnable: false,
    description: skill.description,
    editable: false,
    enabled: true,
    name: titleCaseSlug(skill.name),
    slug: skill.name,
    source: "built_in",
  };
}

function customSkill(skill: UserSkillRecord): ManagedSkillItem {
  return {
    alwaysEnabled: true,
    canDisable: false,
    canEnable: false,
    description: skill.description,
    editable: true,
    enabled: true,
    name: skill.name,
    slug: userSkillSlug(skill.name),
    source: "custom",
  };
}

function integrationSkill(slug: string, accounts: UserIntegrationRecord[]): ManagedSkillItem {
  const connected = accounts.filter(
    (account) => account.integration === slug && isActiveStatus(account.status),
  );
  return {
    alwaysEnabled: false,
    canDisable: false,
    canEnable: connected.length === 0,
    connectedAccountCount: connected.length,
    description: `Use ${titleCaseSlug(slug)} through a connected account.`,
    editable: false,
    enabled: connected.length > 0,
    isConnected: connected.length > 0,
    name: titleCaseSlug(slug),
    requiresConnection: true,
    slug,
    source: "integration",
  };
}

function integrationSlugs(accounts: UserIntegrationRecord[]): string[] {
  return [...new Set([...KNOWN_INTEGRATIONS, ...accounts.map((item) => item.integration)])].sort();
}

function managedSkillChangeResponse(skill: ManagedSkillItem, action: "enable" | "disable") {
  if (skill.source === "integration" && action === "enable" && !skill.isConnected) {
    return { action, requiresConfirmation: true, skill, uiAction: connectUiAction(skill) };
  }
  return {
    action,
    message: skill.alwaysEnabled
      ? `${skill.name} is always available in Cheatcode.`
      : `${skill.name} follows its connected-account state.`,
    requiresConfirmation: false,
    skill,
  };
}

function connectUiAction(skill: ManagedSkillItem) {
  return {
    integrationName: skill.name,
    integrationSlug: skill.slug,
    kind: "connect_account" as const,
    skillName: skill.name,
    skillSlug: skill.slug,
    skillSource: "integration" as const,
  };
}

function connectedIntegrationItems(accounts: UserIntegrationRecord[]) {
  const groups = groupIntegrationAccounts(accounts);
  return [...groups.entries()].map(([integration, items]) => ({
    connectedAccountId:
      items.find((item) => item.isDefault)?.composioConnectionId ??
      items[0]?.composioConnectionId ??
      null,
    connectedAccounts: items.map((item) => ({
      id: item.composioConnectionId,
      isDefault: item.isDefault,
      isSelected: item.isDefault,
      label: item.composioConnectionId,
      status: item.status,
    })),
    defaultConnectedAccountId: items.find((item) => item.isDefault)?.composioConnectionId ?? null,
    integrationName: titleCaseSlug(integration),
    integrationSlug: integration,
    skillName: titleCaseSlug(integration),
    skillSlug: integration,
  }));
}

function groupIntegrationAccounts(
  accounts: UserIntegrationRecord[],
): Map<string, UserIntegrationRecord[]> {
  const groups = new Map<string, UserIntegrationRecord[]>();
  for (const account of accounts) {
    const existing = groups.get(account.integration) ?? [];
    existing.push(account);
    groups.set(account.integration, existing);
  }
  return groups;
}

function runtimeSkillResponse(skill: UserSkillRecord, slug: string, signature: string) {
  return {
    archivedAt: null,
    description: skill.description,
    latestRevision: Math.max(1, Math.floor(skill.updatedAt.getTime() / 1000)),
    name: skill.name,
    signature,
    slug,
    updatedAt: skill.updatedAt.toISOString(),
  };
}

function isActiveStatus(status: string): boolean {
  return ["active", "authorized", "connected", "enabled"].includes(status.trim().toLowerCase());
}

function titleCaseSlug(slug: string): string {
  return slug
    .split(/[-_]+/u)
    .filter(Boolean)
    .map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1)}`)
    .join(" ");
}

function invalidSkillPackage(message: string): APIError {
  return new APIError(400, "tool_validation_failed", message, { retriable: false });
}

function skillNotFound(skill: string): APIError {
  return new APIError(404, "not_found_skill", `Managed skill not found: ${skill}`, {
    retriable: false,
  });
}
