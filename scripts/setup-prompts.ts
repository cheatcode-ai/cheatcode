import { cancel, confirm, isCancel, log, password, text } from "@clack/prompts";
import {
  PINNED_LOCAL_ENV_VALUES,
  parseSupabaseProjectRef,
  type RequiredKey,
  validateRequiredLocalValue,
  validateSupabasePoolerHost,
} from "./local-env-contract";
import { SETUP_KEY_META } from "./setup-keys";
import {
  type AdminDatabaseTarget,
  assertSafeEnvValue,
  generateSecret,
  parseAdminDatabaseUrl,
} from "./setup-support";

export interface CollectedSetupValues {
  adminTarget: AdminDatabaseTarget;
  localValues: Record<string, string>;
  rolePasswords: Readonly<Record<RuntimeRole, string>>;
}

type RuntimeRole = "app_agent" | "app_gateway" | "app_webhooks";

const SIGNING_SECRET_KEYS = [
  "DATABASE_CONTEXT_SIGNING_SECRET_GATEWAY",
  "DATABASE_CONTEXT_SIGNING_SECRET_AGENT",
  "DATABASE_CONTEXT_SIGNING_SECRET_WEBHOOKS",
  "PREVIEW_TOKEN_SECRET",
  "OUTPUT_DOWNLOAD_SIGNING_SECRET",
] as const satisfies readonly RequiredKey[];

const ROLE_DATABASE_KEYS: Readonly<
  Record<
    RuntimeRole,
    | "SUPABASE_AGENT_DATABASE_URL"
    | "SUPABASE_GATEWAY_DATABASE_URL"
    | "SUPABASE_WEBHOOKS_DATABASE_URL"
  >
> = {
  app_agent: "SUPABASE_AGENT_DATABASE_URL",
  app_gateway: "SUPABASE_GATEWAY_DATABASE_URL",
  app_webhooks: "SUPABASE_WEBHOOKS_DATABASE_URL",
};

export async function collectSetupValues(
  existingLocal: Record<string, string>,
  existingMigrate: Record<string, string>,
): Promise<CollectedSetupValues> {
  log.info(
    "Use a dedicated Supabase project. Copy the project ref and Database connection values from https://supabase.com/dashboard.",
  );
  const projectRef = await promptProjectRef(existingLocal);
  const poolerHost = await promptPoolerHost(existingLocal);
  const adminUrl = await promptAdminUrl(existingMigrate, projectRef);
  const rolePasswords = await promptRolePasswords(existingLocal);
  const localValues = await collectApplicationValues(existingLocal);
  Object.assign(localValues, runtimeDatabaseUrls(projectRef, poolerHost, rolePasswords));
  return {
    adminTarget: parseAdminDatabaseUrl(adminUrl, projectRef),
    localValues,
    rolePasswords,
  };
}

export async function confirmUnknownKeyRemoval(
  values: Record<string, string>,
  knownKeys: ReadonlySet<string>,
  fileName: string,
): Promise<Record<string, string>> {
  const unknown = Object.keys(values)
    .filter((key) => !knownKeys.has(key))
    .sort();
  if (unknown.length === 0) {
    return { ...values };
  }
  log.warn(`${fileName} contains unknown keys: ${unknown.join(", ")}.`);
  const shouldRemove = await promptConfirm(`Remove these unknown keys from ${fileName}?`, false);
  if (!shouldRemove) {
    return { ...values };
  }
  return Object.fromEntries(Object.entries(values).filter(([key]) => !unknown.includes(key)));
}

async function collectApplicationValues(
  existing: Record<string, string>,
): Promise<Record<string, string>> {
  const values = { ...existing };
  await collectClerkValues(values);
  await collectDaytonaValues(values);
  values["MORPH_API_KEY"] = await promptRequiredSecret("MORPH_API_KEY", values["MORPH_API_KEY"]);
  for (const key of SIGNING_SECRET_KEYS) {
    values[key] = await promptGeneratedSecret(key, values[key]);
  }
  await collectOptionalGroups(values);
  values["NEXT_PUBLIC_GATEWAY_URL"] = "http://127.0.0.1:8787";
  Object.assign(values, PINNED_LOCAL_ENV_VALUES);
  return values;
}

async function collectClerkValues(values: Record<string, string>): Promise<void> {
  log.info(
    "Use Clerk development keys. Ensure the session token exposes metadata={{user.public_metadata}} or onboarding state will not reach the app.",
  );
  values["NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY"] = await promptRequiredText(
    "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY",
    values["NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY"],
  );
  values["CLERK_SECRET_KEY"] = await promptRequiredSecret(
    "CLERK_SECRET_KEY",
    values["CLERK_SECRET_KEY"],
  );
  values["CLERK_WEBHOOK_SIGNING_SECRET"] = await promptOptionalSecret(
    "Clerk webhook signing secret (optional; skipping disables local Clerk webhooks)",
    values["CLERK_WEBHOOK_SIGNING_SECRET"],
  );
}

async function collectDaytonaValues(values: Record<string, string>): Promise<void> {
  log.info(
    "Daytona requires an API key and immutable sandbox snapshot. Self-hosters build infra/containers/sandbox with the build-snapshot workflow first.",
  );
  values["DAYTONA_API_KEY"] = await promptRequiredSecret(
    "DAYTONA_API_KEY",
    values["DAYTONA_API_KEY"],
  );
  values["DAYTONA_API_URL"] = await promptRequiredText(
    "DAYTONA_API_URL",
    values["DAYTONA_API_URL"] ?? "https://app.daytona.io/api",
  );
  values["DAYTONA_SANDBOX_SNAPSHOT"] = await promptRequiredText(
    "DAYTONA_SANDBOX_SNAPSHOT",
    values["DAYTONA_SANDBOX_SNAPSHOT"],
  );
  values["DAYTONA_TARGET"] = await promptRequiredText(
    "DAYTONA_TARGET",
    values["DAYTONA_TARGET"] ?? "us",
  );
  values["DAYTONA_WEBHOOK_SIGNING_SECRET"] = await promptRequiredSecret(
    "DAYTONA_WEBHOOK_SIGNING_SECRET",
    values["DAYTONA_WEBHOOK_SIGNING_SECRET"],
  );
  values["DAYTONA_ORG_ID"] = await promptOptionalText(
    "Daytona organization ID (optional)",
    values["DAYTONA_ORG_ID"],
  );
  values["DAYTONA_PREVIEW_HOST_SUFFIXES"] =
    values["DAYTONA_PREVIEW_HOST_SUFFIXES"] ?? "daytonaproxy01.net,proxy.daytona.work";
}

async function collectOptionalGroups(values: Record<string, string>): Promise<void> {
  await collectPolarValues(values);
  await collectComposioValues(values);
  const useDeepSeek = await promptConfirm(
    "Configure a DeepSeek platform fallback? Skipping means users must use BYOK for DeepSeek.",
    Boolean(values["DEEPSEEK_PLATFORM_API_KEY"]),
  );
  values["DEEPSEEK_PLATFORM_API_KEY"] = useDeepSeek
    ? await promptOptionalSecret("DeepSeek platform API key", values["DEEPSEEK_PLATFORM_API_KEY"])
    : "";
}

async function collectPolarValues(values: Record<string, string>): Promise<void> {
  const usePolar = await promptConfirm(
    "Configure Polar sandbox billing? Skipping disables local checkout and billing webhooks.",
    Boolean(values["POLAR_ACCESS_TOKEN"]),
  );
  if (!usePolar) {
    clearValues(values, [
      "POLAR_ACCESS_TOKEN",
      "POLAR_WEBHOOK_SECRET",
      "POLAR_PRODUCT_ID_PRO",
      "POLAR_PRODUCT_ID_PREMIUM",
    ]);
    return;
  }
  values["POLAR_ACCESS_TOKEN"] = await promptOptionalSecret(
    "Polar sandbox access token",
    values["POLAR_ACCESS_TOKEN"],
  );
  values["POLAR_WEBHOOK_SECRET"] = await promptOptionalSecret(
    "Polar sandbox webhook secret",
    values["POLAR_WEBHOOK_SECRET"],
  );
  values["POLAR_PRODUCT_ID_PRO"] = await promptOptionalText(
    "Polar Pro product ID",
    values["POLAR_PRODUCT_ID_PRO"],
  );
  values["POLAR_PRODUCT_ID_PREMIUM"] = await promptOptionalText(
    "Polar Premium product ID",
    values["POLAR_PRODUCT_ID_PREMIUM"],
  );
}

async function collectComposioValues(values: Record<string, string>): Promise<void> {
  const useComposio = await promptConfirm(
    "Configure Composio? Skipping disables connected-app authorization and tools.",
    Boolean(values["COMPOSIO_API_KEY"]),
  );
  if (!useComposio) {
    clearValues(values, ["COMPOSIO_API_KEY", "COMPOSIO_AUTH_CONFIGS", "COMPOSIO_WEBHOOK_SECRET"]);
    return;
  }
  values["COMPOSIO_API_KEY"] = await promptOptionalSecret(
    "Composio API key",
    values["COMPOSIO_API_KEY"],
  );
  values["COMPOSIO_AUTH_CONFIGS"] = await promptOptionalSecret(
    "Composio auth-config JSON",
    values["COMPOSIO_AUTH_CONFIGS"],
  );
  values["COMPOSIO_WEBHOOK_SECRET"] = await promptOptionalSecret(
    "Composio webhook secret",
    values["COMPOSIO_WEBHOOK_SECRET"],
  );
}

async function promptProjectRef(existing: Record<string, string>): Promise<string> {
  return promptTextValue("Supabase project ref", inferProjectRef(existing), (value) => {
    try {
      parseSupabaseProjectRef(value);
      return undefined;
    } catch (error) {
      return errorMessage(error);
    }
  });
}

async function promptPoolerHost(existing: Record<string, string>): Promise<string> {
  const value = await promptTextValue(
    "Supabase session-pooler host",
    inferPoolerHost(existing),
    (candidate) => {
      try {
        validateSupabasePoolerHost(candidate);
        return undefined;
      } catch (error) {
        return errorMessage(error);
      }
    },
  );
  return validateSupabasePoolerHost(value);
}

async function promptAdminUrl(
  existing: Record<string, string>,
  projectRef: string,
): Promise<string> {
  const current = existing["SUPABASE_MIGRATION_URL"];
  const result = await password({
    message: current
      ? "Supabase admin connection string (Enter keeps existing; direct/session pooler only)"
      : "Supabase admin connection string (direct/session pooler only)",
    validate: (value) => {
      const candidate = value || current || "";
      try {
        assertSafeEnvValue("SUPABASE_MIGRATION_URL", candidate);
        parseAdminDatabaseUrl(candidate, projectRef);
        return undefined;
      } catch (error) {
        return errorMessage(error);
      }
    },
  });
  return unwrapPrompt(result) || current || "";
}

async function promptRolePasswords(
  existing: Record<string, string>,
): Promise<Readonly<Record<RuntimeRole, string>>> {
  return {
    app_agent: await promptGeneratedPassword(
      "app_agent",
      existingRolePassword(existing, "app_agent"),
    ),
    app_gateway: await promptGeneratedPassword(
      "app_gateway",
      existingRolePassword(existing, "app_gateway"),
    ),
    app_webhooks: await promptGeneratedPassword(
      "app_webhooks",
      existingRolePassword(existing, "app_webhooks"),
    ),
  };
}

async function promptGeneratedSecret(key: RequiredKey, existing?: string): Promise<string> {
  const result = await password({
    message: `${SETUP_KEY_META[key].label} (Enter ${existing ? "keeps existing" : "generates one"})`,
    validate: (value) => validateGeneratedSecretInput(key, value ?? "", existing),
  });
  const value = unwrapPrompt(result);
  return value || existing || generateSecret();
}

async function promptGeneratedPassword(role: RuntimeRole, existing?: string): Promise<string> {
  const result = await password({
    message: `${role} password (Enter ${existing ? "keeps existing" : "generates one"})`,
    validate: (value) => validateSecretInput(`${role} password`, value ?? "", existing, 16),
  });
  const value = unwrapPrompt(result);
  return value || existing || generateSecret();
}

async function promptRequiredText(key: RequiredKey, existing?: string): Promise<string> {
  return promptTextValue(SETUP_KEY_META[key].label, existing, (value) => {
    const unsafe = safeValueIssue(key, value);
    return unsafe ?? validateRequiredLocalValue(key, value);
  });
}

async function promptRequiredSecret(key: RequiredKey, existing?: string): Promise<string> {
  const result = await password({
    message: `${SETUP_KEY_META[key].label}${existing ? " (Enter keeps existing)" : ""}`,
    validate: (value) => {
      const candidate = value || existing || "";
      return safeValueIssue(key, candidate) ?? validateRequiredLocalValue(key, candidate);
    },
  });
  return unwrapPrompt(result) || existing || "";
}

async function promptOptionalText(message: string, existing?: string): Promise<string> {
  return promptTextValue(message, existing, (value) => safeValueIssue(message, value));
}

async function promptOptionalSecret(message: string, existing?: string): Promise<string> {
  const result = await password({
    message: `${message}${existing ? " (Enter keeps existing)" : ""}`,
    validate: (value) => safeValueIssue(message, value || existing || ""),
  });
  return unwrapPrompt(result) || existing || "";
}

async function promptTextValue(
  message: string,
  existing: string | undefined,
  validate: (value: string) => string | undefined,
): Promise<string> {
  const result = await text({
    message,
    ...(existing ? { initialValue: existing } : {}),
    validate: (value) => validate(value ?? ""),
  });
  return unwrapPrompt(result);
}

async function promptConfirm(message: string, initialValue: boolean): Promise<boolean> {
  return unwrapPrompt(await confirm({ initialValue, message }));
}

function runtimeDatabaseUrls(
  projectRef: string,
  poolerHost: string,
  passwords: Readonly<Record<RuntimeRole, string>>,
): Record<string, string> {
  return Object.fromEntries(
    (Object.entries(ROLE_DATABASE_KEYS) as Array<[RuntimeRole, string]>).map(([role, key]) => [
      key,
      `postgresql://${role}.${projectRef}:${encodeURIComponent(passwords[role])}@${poolerHost}:5432/postgres?sslmode=require&uselibpqcompat=true`,
    ]),
  );
}

function inferProjectRef(values: Record<string, string>): string | undefined {
  const username = databaseUrlPart(values["SUPABASE_GATEWAY_DATABASE_URL"], "username");
  if (!username) {
    return undefined;
  }
  const separator = username.lastIndexOf(".");
  return separator === -1 ? undefined : username.slice(separator + 1);
}

function inferPoolerHost(values: Record<string, string>): string | undefined {
  return databaseUrlPart(values["SUPABASE_GATEWAY_DATABASE_URL"], "hostname");
}

function existingRolePassword(
  values: Record<string, string>,
  role: RuntimeRole,
): string | undefined {
  return databaseUrlPart(values[ROLE_DATABASE_KEYS[role]], "password");
}

function databaseUrlPart(
  raw: string | undefined,
  part: "hostname" | "password" | "username",
): string | undefined {
  if (!raw) {
    return undefined;
  }
  try {
    return decodeURIComponent(new URL(raw)[part]);
  } catch {
    return undefined;
  }
}

function validateGeneratedSecretInput(
  key: string,
  value: string,
  existing: string | undefined,
): string | undefined {
  return validateSecretInput(key, value, existing, 32);
}

function validateSecretInput(
  key: string,
  value: string,
  existing: string | undefined,
  minimumBytes: number,
): string | undefined {
  const candidate = value || existing;
  if (!candidate) {
    return undefined;
  }
  const unsafe = safeValueIssue(key, candidate);
  if (unsafe) {
    return unsafe;
  }
  return new TextEncoder().encode(candidate).byteLength < minimumBytes
    ? `${key} must contain at least ${minimumBytes} UTF-8 bytes.`
    : undefined;
}

function safeValueIssue(key: string, value: string): string | undefined {
  try {
    assertSafeEnvValue(key, value);
    return undefined;
  } catch (error) {
    return errorMessage(error);
  }
}

function unwrapPrompt<T>(value: T | symbol): T {
  if (isCancel(value)) {
    cancel("Setup cancelled; no further steps were run.");
    process.exit(1);
  }
  return value as T;
}

function clearValues(values: Record<string, string>, keys: readonly string[]): void {
  for (const key of keys) {
    values[key] = "";
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Invalid value.";
}
