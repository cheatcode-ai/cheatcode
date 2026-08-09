export const REQUIRED_WORKER_ENV = [
  "CLERK_SECRET_KEY",
  "DAYTONA_API_KEY",
  "DAYTONA_API_URL",
  "DAYTONA_SANDBOX_SNAPSHOT",
  "DAYTONA_TARGET",
  "DAYTONA_WORKSPACE_VOLUME",
  "DAYTONA_WEBHOOK_SIGNING_SECRET",
  "MORPH_API_KEY",
  "DATABASE_CONTEXT_SIGNING_SECRET_AGENT",
  "DATABASE_CONTEXT_SIGNING_SECRET_GATEWAY",
  "DATABASE_CONTEXT_SIGNING_SECRET_WEBHOOKS",
  "PREVIEW_TOKEN_SECRET",
  "SUPABASE_AGENT_DATABASE_URL",
  "SUPABASE_GATEWAY_DATABASE_URL",
  "SUPABASE_WEBHOOKS_DATABASE_URL",
  "OUTPUT_DOWNLOAD_SIGNING_SECRET",
] as const;

export const REQUIRED_WEB_ENV = [
  "CLERK_SECRET_KEY",
  "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY",
  "NEXT_PUBLIC_GATEWAY_URL",
] as const;

type RequiredWorkerKey = (typeof REQUIRED_WORKER_ENV)[number];
type RequiredWebKey = (typeof REQUIRED_WEB_ENV)[number];
export type RequiredKey = RequiredWorkerKey | RequiredWebKey;

const FORBIDDEN_LOCAL_ENV = [
  "ANTHROPIC_API_KEY",
  "CLOUDFLARE_API_TOKEN",
  "CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE",
  "DATABASE_URL",
  "GOOGLE_API_KEY",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "NEXT_PUBLIC_SUPABASE_URL",
  "VERCEL_TOKEN",
] as const;

export const PINNED_LOCAL_ENV_VALUES = {
  DAYTONA_WORKSPACE_VOLUME: "cheatcode-workspaces-development",
  POLAR_SERVER: "sandbox",
} as const;

const DISTINCT_LOCAL_SECRET_GROUPS = [
  [
    "DATABASE_CONTEXT_SIGNING_SECRET_AGENT",
    "DATABASE_CONTEXT_SIGNING_SECRET_GATEWAY",
    "DATABASE_CONTEXT_SIGNING_SECRET_WEBHOOKS",
  ],
  ["PREVIEW_TOKEN_SECRET", "OUTPUT_DOWNLOAD_SIGNING_SECRET"],
] as const satisfies readonly (readonly RequiredKey[])[];

export const OPTIONAL_LOCAL_ENV_KEYS = [
  "CLERK_WEBHOOK_SIGNING_SECRET",
  "COMPOSIO_API_KEY",
  "COMPOSIO_AUTH_CONFIGS",
  "COMPOSIO_WEBHOOK_SECRET",
  "DAYTONA_ORG_ID",
  "DAYTONA_PREVIEW_HOST_SUFFIXES",
  "DEEPSEEK_PLATFORM_API_KEY",
  "POLAR_ACCESS_TOKEN",
  "POLAR_PRODUCT_ID_PREMIUM",
  "POLAR_PRODUCT_ID_PRO",
  "POLAR_SERVER",
  "POLAR_WEBHOOK_SECRET",
] as const;

export interface LocalEnvSurface {
  webOnly: boolean;
  workersOnly: boolean;
}

export interface SupabasePoolerTarget {
  database: string;
  hostname: string;
  port: string;
  projectRef: string;
}

const RUNTIME_DATABASE_KEYS = [
  ["SUPABASE_GATEWAY_DATABASE_URL", "app_gateway"],
  ["SUPABASE_AGENT_DATABASE_URL", "app_agent"],
  ["SUPABASE_WEBHOOKS_DATABASE_URL", "app_webhooks"],
] as const satisfies readonly (readonly [RequiredWorkerKey, string])[];

const SUPABASE_PROJECT_REF_PATTERN = /^[a-z0-9]{20}$/u;
const SUPABASE_POOLER_HOST_PATTERN =
  /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+pooler\.supabase\.com$/u;

export function parseSupabaseProjectRef(value: string, label = "Supabase project ref"): string {
  if (!SUPABASE_PROJECT_REF_PATTERN.test(value)) {
    throw new Error(`${label} must be the 20-character lowercase project ref from Supabase.`);
  }
  return value;
}

export function validateSupabasePoolerHost(value: string): string {
  const hostname = value.toLowerCase();
  if (!SUPABASE_POOLER_HOST_PATTERN.test(hostname)) {
    throw new Error("Pooler host must match <region-pooler-host>.pooler.supabase.com.");
  }
  return hostname;
}

export function validateSupabaseSessionPoolerUrl(
  raw: string,
  envKey: string,
  expectedRole: string,
): SupabasePoolerTarget {
  const url = parsePostgresUrl(raw, envKey);
  const username = decodeUrlComponent(url.username, `${envKey} username`);
  const separator = username.lastIndexOf(".");
  const role = username.slice(0, separator);
  const projectRef = parseSupabaseProjectRef(
    username.slice(separator + 1),
    `${envKey} project ref`,
  );
  validatePoolerUrlShape(url, envKey, role, expectedRole);
  return {
    database: url.pathname.slice(1),
    hostname: url.hostname,
    port: url.port,
    projectRef,
  };
}

export function validateSupabaseRuntimeDatabaseUrls(
  values: Record<string, string>,
): SupabasePoolerTarget {
  const targets = RUNTIME_DATABASE_KEYS.map(([envKey, role]) => {
    const value = values[envKey];
    if (!value) {
      throw new Error(`.env.local is missing ${envKey}.`);
    }
    return [envKey, validateSupabaseSessionPoolerUrl(value, envKey, role)] as const;
  });
  const first = targets[0]?.[1];
  if (!first) {
    throw new Error("Supabase runtime database URL contract is empty.");
  }
  for (const [envKey, target] of targets.slice(1)) {
    if (!samePoolerTarget(first, target)) {
      throw new Error(
        `${envKey} must share the session-pooler host, port, database, and project ref used by all runtime database URLs.`,
      );
    }
  }
  return first;
}

export function validateRequiredLocalValue(key: RequiredKey, value: string): string | undefined {
  if (!value) {
    return `${key} is required.`;
  }
  if (key === "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY" && !value.startsWith("pk_test_")) {
    return `${key} must use a Clerk pk_test_ publishable key.`;
  }
  if (key === "CLERK_SECRET_KEY" && !value.startsWith("sk_test_")) {
    return `${key} must use a Clerk sk_test_ secret key.`;
  }
  return undefined;
}

function missingLocalEnvValues(
  values: Record<string, string>,
  required: readonly string[],
): string[] {
  return required.filter((key) => !values[key]);
}

export function validateLocalEnvironment(
  values: Record<string, string>,
  surface: LocalEnvSurface,
): void {
  validateForbiddenValues(values);
  validateLocalClerkSecrets(values);
  const required = [
    ...(surface.workersOnly ? [] : REQUIRED_WEB_ENV),
    ...(surface.webOnly ? [] : REQUIRED_WORKER_ENV),
  ];
  const missing = missingLocalEnvValues(values, required);
  if (missing.length > 0) {
    throw new Error(`.env.local is missing required local values: ${missing.join(", ")}.`);
  }
  validateRequiredValues(values, required);
  if (!surface.webOnly) {
    validateDistinctLocalSecretGroups(values);
    validatePinnedValues(values);
    validateSupabaseRuntimeDatabaseUrls(values);
  }
}

export function parseEnvFile(content: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const rawLine of content.replace(/^\uFEFF/u, "").split(/\r?\n/u)) {
    const line = rawLine.trim();
    const delimiterIndex = line.indexOf("=");
    if (!line || line.startsWith("#") || delimiterIndex === -1) {
      continue;
    }
    const key = line.slice(0, delimiterIndex).trim();
    if (/^[A-Z0-9_]+$/u.test(key)) {
      values[key] = unquoteEnvValue(line.slice(delimiterIndex + 1));
    }
  }
  return values;
}

function parsePostgresUrl(raw: string, envKey: string): URL {
  try {
    const url = new URL(raw);
    if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
      throw new Error("wrong protocol");
    }
    return url;
  } catch {
    throw new Error(`${envKey} must be a PostgreSQL connection URL.`);
  }
}

function validatePoolerUrlShape(
  url: URL,
  envKey: string,
  actualRole: string,
  expectedRole: string,
): void {
  const hasTlsParameters =
    url.searchParams.size === 2 &&
    url.searchParams.get("sslmode") === "require" &&
    url.searchParams.get("uselibpqcompat") === "true";
  const isValid =
    actualRole === expectedRole &&
    Boolean(url.password) &&
    SUPABASE_POOLER_HOST_PATTERN.test(url.hostname) &&
    url.port === "5432" &&
    url.pathname === "/postgres" &&
    hasTlsParameters &&
    !url.hash;
  if (!isValid) {
    throw new Error(
      `${envKey} must use ${expectedRole}.<project-ref> on a Supabase session pooler (*.pooler.supabase.com:5432/postgres) with sslmode=require and uselibpqcompat=true.`,
    );
  }
}

function decodeUrlComponent(value: string, label: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    throw new Error(`${label} must be valid URL-encoded text.`);
  }
}

function samePoolerTarget(left: SupabasePoolerTarget, right: SupabasePoolerTarget): boolean {
  return (
    left.hostname === right.hostname &&
    left.port === right.port &&
    left.database === right.database &&
    left.projectRef === right.projectRef
  );
}

function validateForbiddenValues(values: Record<string, string>): void {
  const forbidden = FORBIDDEN_LOCAL_ENV.filter((key) => values[key]);
  if (forbidden.length > 0) {
    throw new Error(`Remove cloud-only or unused values from .env.local: ${forbidden.join(", ")}.`);
  }
}

function validateLocalClerkSecrets(values: Record<string, string>): void {
  const publishableKey = values["NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY"];
  const secretKey = values["CLERK_SECRET_KEY"];
  if (publishableKey && !publishableKey.startsWith("pk_test_")) {
    throw new Error(".env.local must use a Clerk pk_test_ publishable key.");
  }
  if (secretKey && !secretKey.startsWith("sk_test_")) {
    throw new Error(".env.local must use a Clerk sk_test_ secret key.");
  }
}

function validateRequiredValues(values: Record<string, string>, required: readonly RequiredKey[]) {
  for (const key of required) {
    const issue = validateRequiredLocalValue(key, values[key] ?? "");
    if (issue) {
      throw new Error(issue);
    }
  }
}

function validateDistinctLocalSecretGroups(values: Record<string, string>): void {
  for (const names of DISTINCT_LOCAL_SECRET_GROUPS) {
    const secrets = names.map((name) => values[name] ?? "");
    if (secrets.some((secret) => new TextEncoder().encode(secret).byteLength < 32)) {
      throw new Error(
        `Local HMAC secrets must contain at least 32 UTF-8 bytes: ${names.join(", ")}.`,
      );
    }
    if (new Set(secrets).size !== secrets.length) {
      throw new Error(`Local HMAC secrets must be distinct: ${names.join(", ")}.`);
    }
  }
}

function validatePinnedValues(values: Record<string, string>): void {
  for (const [key, expected] of Object.entries(PINNED_LOCAL_ENV_VALUES)) {
    if (values[key] !== expected) {
      throw new Error(`.env.local must set ${key}=${expected} for local development.`);
    }
  }
}

function unquoteEnvValue(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length < 2) {
    return trimmed;
  }
  const quote = trimmed[0];
  const last = trimmed.at(-1);
  if ((quote !== '"' && quote !== "'") || quote !== last) {
    return trimmed;
  }
  return trimmed.slice(1, -1);
}
