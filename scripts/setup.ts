import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { confirm, intro, isCancel, log, note, outro } from "@clack/prompts";
import {
  provisionDatabase,
  type RuntimeDatabaseCredentials,
  readAdminDatabaseIdentity,
  verifyDatabaseSetup,
  verifyMigrationLedger,
} from "./db-provision";
import {
  OPTIONAL_LOCAL_ENV_KEYS,
  PINNED_LOCAL_ENV_VALUES,
  REQUIRED_WEB_ENV,
  REQUIRED_WORKER_ENV,
  validateLocalEnvironment,
  validateSupabaseRuntimeDatabaseUrls,
} from "./local-env-contract";
import { collectSetupValues, confirmUnknownKeyRemoval } from "./setup-prompts";
import {
  type AdminDatabaseTarget,
  type MigrationEnvironment,
  migrationEnvironment,
  parseAdminDatabaseUrl,
  pollLocalReadiness,
  readOptionalEnvFile,
  runInheritedCommand,
  runSetupPreflight,
  sanitizedMigrationChildEnvironment,
  writeEnvFileAtomic,
} from "./setup-support";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const LOCAL_ENV_PATH = join(ROOT, ".env.local");
const MIGRATE_ENV_PATH = join(ROOT, ".env.migrate");

const LOCAL_ENV_ORDER = [
  "SUPABASE_GATEWAY_DATABASE_URL",
  "SUPABASE_AGENT_DATABASE_URL",
  "SUPABASE_WEBHOOKS_DATABASE_URL",
  "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY",
  "CLERK_SECRET_KEY",
  "CLERK_WEBHOOK_SIGNING_SECRET",
  "NEXT_PUBLIC_GATEWAY_URL",
  "DAYTONA_API_KEY",
  "DAYTONA_API_URL",
  "DAYTONA_PREVIEW_HOST_SUFFIXES",
  "DAYTONA_SANDBOX_SNAPSHOT",
  "DAYTONA_TARGET",
  "DAYTONA_WORKSPACE_VOLUME",
  "DAYTONA_WEBHOOK_SIGNING_SECRET",
  "DAYTONA_ORG_ID",
  "COMPOSIO_API_KEY",
  "COMPOSIO_AUTH_CONFIGS",
  "COMPOSIO_WEBHOOK_SECRET",
  "DEEPSEEK_PLATFORM_API_KEY",
  "MORPH_API_KEY",
  "POLAR_ACCESS_TOKEN",
  "POLAR_SERVER",
  "POLAR_WEBHOOK_SECRET",
  "POLAR_PRODUCT_ID_PRO",
  "POLAR_PRODUCT_ID_PREMIUM",
  "DATABASE_CONTEXT_SIGNING_SECRET_AGENT",
  "DATABASE_CONTEXT_SIGNING_SECRET_GATEWAY",
  "DATABASE_CONTEXT_SIGNING_SECRET_WEBHOOKS",
  "PREVIEW_TOKEN_SECRET",
  "OUTPUT_DOWNLOAD_SIGNING_SECRET",
] as const;

const MIGRATE_ENV_ORDER = [
  "SUPABASE_MIGRATION_URL",
  "SUPABASE_MIGRATION_EXPECTED_HOST",
  "SUPABASE_MIGRATION_EXPECTED_DATABASE",
  "SUPABASE_MIGRATION_EXPECTED_ROLE",
  "SUPABASE_MIGRATION_EXPECTED_SYSTEM_IDENTIFIER",
] as const;

const LOCAL_ENV_KEYS = new Set<string>([
  ...REQUIRED_WORKER_ENV,
  ...REQUIRED_WEB_ENV,
  ...OPTIONAL_LOCAL_ENV_KEYS,
  ...Object.keys(PINNED_LOCAL_ENV_VALUES),
]);
const MIGRATE_ENV_KEYS = new Set<string>(MIGRATE_ENV_ORDER);

async function runInteractiveSetup(): Promise<void> {
  intro("Cheatcode self-host setup");
  await runStep("host preflight", () => runSetupPreflight(ROOT));
  const [existingLocal, existingMigrate] = await runStep("environment file read", () =>
    Promise.all([readOptionalEnvFile(LOCAL_ENV_PATH), readOptionalEnvFile(MIGRATE_ENV_PATH)]),
  );
  const retainedLocal = await confirmUnknownKeyRemoval(existingLocal, LOCAL_ENV_KEYS, ".env.local");
  const retainedMigrate = await confirmUnknownKeyRemoval(
    existingMigrate,
    MIGRATE_ENV_KEYS,
    ".env.migrate",
  );
  const collected = await collectSetupValues(retainedLocal, retainedMigrate);
  await runStep("local environment validation", async () => {
    validateLocalEnvironment(collected.localValues, { webOnly: false, workersOnly: false });
  });
  const shouldApply = await confirmApply(collected.adminTarget);
  if (!shouldApply) {
    outro("Setup cancelled. No files or database state were changed.");
    return;
  }
  const identity = await runStep("Supabase identity read", () =>
    readAdminDatabaseIdentity(collected.adminTarget.url),
  );
  assertAdminIdentity(collected.adminTarget, identity.database, identity.role);
  const migrateValues = migrationEnvironment(collected.adminTarget, identity.systemIdentifier);
  await writeSetupFiles(collected.localValues, { ...retainedMigrate, ...migrateValues });
  await applyAndVerify(collected.localValues, collected.rolePasswords, migrateValues);
  await offerStackStart(collected.localValues);
}

async function applyAndVerify(
  localValues: Record<string, string>,
  rolePasswords: Parameters<typeof provisionDatabase>[0]["rolePasswords"],
  migrateValues: MigrationEnvironment,
): Promise<void> {
  await runStep("database migrations", () =>
    runInheritedCommand(
      "pnpm",
      ["db:migrate", "--apply"],
      ROOT,
      sanitizedMigrationChildEnvironment(migrateValues),
    ),
  );
  const credentials = runtimeCredentials(localValues);
  await runStep("database provisioning", () =>
    provisionDatabase({
      adminDatabaseUrl: migrateValues.SUPABASE_MIGRATION_URL,
      rolePasswords,
      runtimeCredentials: credentials,
    }),
  );
  await runStep("runtime database probes", () => verifyDatabaseSetup(credentials));
  await runStep("local environment validation", async () => {
    validateLocalEnvironment(localValues, { webOnly: false, workersOnly: false });
  });
}

async function runCheck(): Promise<void> {
  intro("Cheatcode setup check");
  await runStep("host preflight", () => runSetupPreflight(ROOT));
  const [localValues, migrateValues] = await runStep("environment file read", () =>
    Promise.all([readOptionalEnvFile(LOCAL_ENV_PATH), readOptionalEnvFile(MIGRATE_ENV_PATH)]),
  );
  const migration = await runStep("environment validation", async () => {
    validateLocalEnvironment(localValues, { webOnly: false, workersOnly: false });
    const runtimeTarget = validateSupabaseRuntimeDatabaseUrls(localValues);
    return parseMigrationEnvironment(migrateValues, runtimeTarget.projectRef);
  });
  await runStep("migration ledger and database connectivity", () =>
    verifyMigrationLedger(migration.SUPABASE_MIGRATION_URL, {
      expectedDatabase: migration.SUPABASE_MIGRATION_EXPECTED_DATABASE,
      expectedHost: migration.SUPABASE_MIGRATION_EXPECTED_HOST,
      expectedRole: migration.SUPABASE_MIGRATION_EXPECTED_ROLE,
      expectedSystemIdentifier: migration.SUPABASE_MIGRATION_EXPECTED_SYSTEM_IDENTIFIER,
    }),
  );
  await runStep("runtime database probes", () =>
    verifyDatabaseSetup(runtimeCredentials(localValues)),
  );
  outro("Setup check passed. No files or database state were changed.");
}

async function writeSetupFiles(
  localValues: Record<string, string>,
  migrateValues: Record<string, string>,
): Promise<void> {
  await runStep("environment file write", async () => {
    await writeEnvFileAtomic(LOCAL_ENV_PATH, localValues, LOCAL_ENV_ORDER, [
      "Generated by pnpm dev:setup. Re-run the wizard to change or rotate values.",
      "Application credentials only; administrative credentials stay in .env.migrate.",
    ]);
    await writeEnvFileAtomic(MIGRATE_ENV_PATH, migrateValues, MIGRATE_ENV_ORDER, [
      "Generated by pnpm dev:setup. Never load this administrative file into the app.",
    ]);
  });
}

async function confirmApply(target: AdminDatabaseTarget): Promise<boolean> {
  note(`Host: ${target.hostname}\nDatabase: ${target.database}`, "Migration target");
  const result = await confirm({
    initialValue: false,
    message: "Apply migrations and provision this dedicated Supabase project?",
  });
  return isCancel(result) ? false : result;
}

async function offerStackStart(localValues: Record<string, string>): Promise<void> {
  const answer = await confirm({ initialValue: false, message: "Start the stack now?" });
  if (isCancel(answer) || !answer) {
    printStartInstructions("The stack was not started.");
    outro("Setup complete.");
    return;
  }
  await runStep("local stack start", () =>
    runInheritedCommand(
      "docker",
      [
        "compose",
        "--env-file",
        ".env.local",
        "up",
        "-d",
        "--build",
        "--force-recreate",
        "--wait",
        "app",
      ],
      ROOT,
    ),
  );
  await runStep("local readiness", () => pollLocalReadiness());
  printFeatureSummary(localValues);
  printStartInstructions("The stack is running.");
  outro("Cheatcode is ready.");
}

function runtimeCredentials(values: Record<string, string>): RuntimeDatabaseCredentials[] {
  return [
    runtimeCredential(values, "app_gateway", "GATEWAY"),
    runtimeCredential(values, "app_agent", "AGENT"),
    runtimeCredential(values, "app_webhooks", "WEBHOOKS"),
  ];
}

function runtimeCredential(
  values: Record<string, string>,
  role: RuntimeDatabaseCredentials["role"],
  suffix: "AGENT" | "GATEWAY" | "WEBHOOKS",
): RuntimeDatabaseCredentials {
  const databaseUrl = values[`SUPABASE_${suffix}_DATABASE_URL`];
  const signingSecret = values[`DATABASE_CONTEXT_SIGNING_SECRET_${suffix}`];
  if (!databaseUrl || !signingSecret) {
    throw new Error(`Missing runtime database credentials for ${role}.`);
  }
  return { databaseUrl, role, signingSecret };
}

function parseMigrationEnvironment(
  values: Record<string, string>,
  projectRef: string,
): MigrationEnvironment {
  for (const key of MIGRATE_ENV_ORDER) {
    if (!values[key]) {
      throw new Error(`.env.migrate is missing ${key}. Run pnpm dev:setup.`);
    }
  }
  const target = parseAdminDatabaseUrl(values["SUPABASE_MIGRATION_URL"] ?? "", projectRef);
  if (
    values["SUPABASE_MIGRATION_EXPECTED_HOST"] !== target.hostname ||
    values["SUPABASE_MIGRATION_EXPECTED_DATABASE"] !== target.database ||
    values["SUPABASE_MIGRATION_EXPECTED_ROLE"] !== target.role
  ) {
    throw new Error(".env.migrate identity pins do not match its admin connection string.");
  }
  return values as unknown as MigrationEnvironment;
}

function assertAdminIdentity(
  target: AdminDatabaseTarget,
  actualDatabase: string,
  actualRole: string,
): void {
  if (actualDatabase !== target.database || actualRole !== target.role) {
    throw new Error(
      `Supabase identity mismatch: expected ${target.role}@${target.database}, got ${actualRole}@${actualDatabase}.`,
    );
  }
}

function printFeatureSummary(values: Record<string, string>): void {
  const enabled = [
    values["POLAR_ACCESS_TOKEN"] ? "Polar sandbox billing" : undefined,
    values["COMPOSIO_API_KEY"] ? "Composio connected apps" : undefined,
    values["DEEPSEEK_PLATFORM_API_KEY"] ? "DeepSeek platform fallback" : undefined,
  ].filter((value): value is string => Boolean(value));
  log.info(
    "Core features: agent runs, Daytona workspaces and previews, generated files, and BYOK.",
  );
  log.info(
    `Optional features: ${enabled.join(", ") || "none (core BYOK flows remain available)"}.`,
  );
}

function printStartInstructions(status: string): void {
  note(
    [
      status,
      "Start/restart: docker compose --env-file .env.local up -d --build --force-recreate --wait app",
      "Web: http://localhost:3001",
      "Gateway: http://127.0.0.1:8787",
      "Inspector: http://127.0.0.1:9239",
      "Use 127.0.0.1 for gateway cookies; localhost and 127.0.0.1 are different cookie sites.",
    ].join("\n"),
    "Local URLs",
  );
}

async function runStep<T>(label: string, action: () => Promise<T>): Promise<T> {
  log.step(label);
  try {
    return await action();
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown failure.";
    throw new Error(
      `Setup failed during ${label}: ${message} Re-run pnpm dev:setup to resume safely; completed steps are idempotent.`,
    );
  }
}

function parseMode(argv: string[]): "check" | "interactive" {
  const args = argv.filter((arg) => arg !== "--");
  if (args.length === 0) {
    return "interactive";
  }
  if (args.length === 1 && args[0] === "--check") {
    return "check";
  }
  if (args.length === 1 && (args[0] === "--help" || args[0] === "-h")) {
    process.stdout.write("Usage: pnpm dev:setup [--check]\n");
    process.exit(0);
  }
  throw new Error(`Unknown setup option: ${args.join(" ")}`);
}

async function main(): Promise<void> {
  const mode = parseMode(process.argv.slice(2));
  if (mode === "check") {
    await runCheck();
    return;
  }
  await runInteractiveSetup();
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown setup failure.";
  log.error(message);
  process.exitCode = 1;
});
