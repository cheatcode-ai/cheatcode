import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  type DrizzleMigrationClient,
  runDrizzleMigrations,
} from "../packages/db/src/drizzle-migrations";
import { assertSupabaseTarget, type PgClient } from "../packages/db/src/supabase-target";
import { loadMigrationEnvFromFiles } from "../packages/env/src/migrate";
import {
  acquireDatabaseMaintenanceLock,
  assertAdministrativeConnectionTarget,
  assertPinnedDatabaseIdentity,
  configureDatabaseOperationSession,
  type DatabaseIdentityExpectation,
  releaseDatabaseMaintenanceLock,
} from "./database-operation-safety";
import {
  type DrizzleMigration,
  loadDrizzleMigrations,
  verifyDrizzleMigrationIntegrity,
} from "./migration-drizzle";

interface PgModule {
  Client: new (config: { connectionString: string }) => DrizzleMigrationClient;
}

type MigrationMode = "apply" | "dry-run";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const writeLine = (line = ""): void => void process.stdout.write(`${line}\n`);

function parseMode(argv: string[]): MigrationMode {
  const args = argv.filter((argument) => argument !== "--");
  if (args.includes("--help")) {
    writeLine("Usage: pnpm db:migrate [--dry-run|--apply]");
    process.exit(0);
  }
  const allowed = new Set(["--apply", "--dry-run"]);
  const unknown = args.find((argument) => !allowed.has(argument));
  if (unknown) {
    throw new Error(`Unknown migration option: ${unknown}`);
  }
  if (args.length > 1 || (args.includes("--apply") && args.includes("--dry-run"))) {
    throw new Error("Pass exactly one migration mode.");
  }
  return args.includes("--apply") ? "apply" : "dry-run";
}

function createClient(databaseUrl: string): DrizzleMigrationClient {
  const dbRequire = createRequire(join(ROOT, "packages/db/package.json"));
  const { Client } = dbRequire("pg") as PgModule;
  return new Client({ connectionString: databaseUrl });
}

async function loadPendingPlans(
  migrations: readonly DrizzleMigration[],
  applied: ReadonlySet<string>,
) {
  const pending = migrations.filter((migration) => !applied.has(migration.file));
  return Promise.all(
    pending.map(async (migration) => ({
      checksum: migration.checksum,
      file: migration.file,
      statements: (await readFile(resolve(ROOT, migration.file), "utf8")).split(
        "--> statement-breakpoint",
      ),
      when: migration.when,
    })),
  );
}

async function executeMigration(
  client: DrizzleMigrationClient,
  mode: MigrationMode,
): Promise<void> {
  const migrations = await loadDrizzleMigrations();
  const applied = await verifyDrizzleMigrationIntegrity(client, migrations);
  const pending = migrations.filter((migration) => !applied.has(migration.file));

  writeLine("Migration plan:");
  for (const migration of migrations) {
    writeLine(`  ${applied.has(migration.file) ? "applied" : "pending"} ${migration.file}`);
  }

  if (mode === "dry-run") {
    if (pending.length === 0) {
      await assertSupabaseTarget(client);
      writeLine("Production schema contract verified.");
    }
    return;
  }

  await runDrizzleMigrations(client, await loadPendingPlans(migrations, applied), writeLine);
  const finalLedger = await verifyDrizzleMigrationIntegrity(client, migrations);
  if (finalLedger.size !== migrations.length) {
    throw new Error("Migration runner returned before applying the complete journal.");
  }
  await assertSupabaseTarget(client);
  writeLine("Production schema contract verified.");
}

async function closeClient(
  client: PgClient,
  hasMaintenanceLock: boolean,
  operationFailed: boolean,
): Promise<void> {
  const failures: string[] = [];
  if (hasMaintenanceLock) {
    try {
      await releaseDatabaseMaintenanceLock(client);
    } catch (error) {
      failures.push(errorMessage(error, "Failed to release database maintenance lock"));
    }
  }
  try {
    await client.end();
  } catch (error) {
    failures.push(errorMessage(error, "Failed to close migration database connection"));
  }
  if (failures.length === 0) {
    return;
  }
  if (operationFailed) {
    process.stderr.write(`Migration cleanup warning: ${failures.join("; ")}\n`);
    return;
  }
  throw new Error(failures.join("; "));
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

async function runMigration(
  databaseUrl: string,
  identity: DatabaseIdentityExpectation,
  mode: MigrationMode,
): Promise<void> {
  const client = createClient(databaseUrl);
  await client.connect();
  let hasMaintenanceLock = false;
  let operationFailed = false;
  try {
    await configureDatabaseOperationSession(client, {
      applicationName: "cheatcode-schema-migration",
      statementTimeout: "10min",
    });
    await assertPinnedDatabaseIdentity(client, identity, mode);
    await acquireDatabaseMaintenanceLock(client, "schema migration");
    hasMaintenanceLock = true;
    await executeMigration(client, mode);
  } catch (error) {
    operationFailed = true;
    throw error;
  } finally {
    await closeClient(client, hasMaintenanceLock, operationFailed);
  }
}

async function main(): Promise<void> {
  const mode = parseMode(process.argv.slice(2));
  const { databaseUrl, expectedDatabase, expectedHost, expectedRole, expectedSystemIdentifier } =
    loadMigrationEnvFromFiles(ROOT);
  const identity: DatabaseIdentityExpectation = {
    ...(expectedDatabase ? { expectedDatabase } : {}),
    ...(expectedHost ? { expectedHost } : {}),
    ...(expectedRole ? { expectedRole } : {}),
    ...(expectedSystemIdentifier ? { expectedSystemIdentifier } : {}),
  };
  assertAdministrativeConnectionTarget(databaseUrl, identity, mode);
  await runMigration(databaseUrl, identity, mode);
}

main().catch((error: unknown) => {
  process.stderr.write(`${errorMessage(error, "Unknown migration error")}\n`);
  process.exitCode = 1;
});
