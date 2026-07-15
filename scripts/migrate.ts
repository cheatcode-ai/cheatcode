import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  type DrizzleMigrationClient,
  runDrizzleMigrations,
} from "../packages/db/src/drizzle-migrations";
import { assertSupabaseTarget, type PgClient } from "../packages/db/src/supabase-target";
import {
  acquireDatabaseMaintenanceLock,
  assertAdministrativeConnectionTarget,
  assertPinnedDatabaseIdentity,
  configureDatabaseOperationSession,
  type DatabaseIdentityExpectation,
  releaseDatabaseMaintenanceLock,
} from "./database-operation-safety";
import {
  assertExpandOnlyDrizzleMigrations,
  type DrizzleMigration,
  loadDrizzleMigrations,
  verifyDrizzleMigrationIntegrity,
} from "./migration-drizzle";
import { loadMigrationEnvFromFiles } from "./migration-env";

interface PgModule {
  Client: new (config: { connectionString: string }) => DrizzleMigrationClient;
}

type Mode = "apply" | "dry-run";
type MigrationPhase = "all" | "post-deploy" | "pre-deploy";

interface MigrationOptions {
  mode: Mode;
  phase: MigrationPhase;
}

interface MigrationFiles {
  contractions: string[];
  drizzle: DrizzleMigration[];
  expansions: string[];
  foundations: string[];
  post: string[];
  retired: Map<string, string>;
}

type RawMigrationLedger = Map<string, string>;
type RawMigrationPhaseMap = Map<string, Exclude<MigrationPhase, "all">>;

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PRE_DIR = join(ROOT, "infra/supabase/migrations/pre");
const POST_DIR = join(ROOT, "infra/supabase/migrations/post");
const RETIRED_RAW_PATH = join(ROOT, "infra/supabase/migrations/retired-raw.json");
const RAW_PHASES_PATH = join(ROOT, "infra/supabase/migrations/raw-phases.json");
const FIRST_PHASE_ENFORCED_RAW_INDEX = 28;
const RAW_MIGRATION_PATH_PATTERN =
  /^infra\/supabase\/migrations\/(?:pre|post)\/\d{4}_[a-z0-9_]+\.sql$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;

function writeLine(line = ""): void {
  process.stdout.write(`${line}\n`);
}

function parseOptions(argv: string[]): MigrationOptions {
  if (argv.includes("--help")) {
    writeLine(
      "Usage: pnpm tsx scripts/migrate.ts [--dry-run|--apply] [--phase=all|pre-deploy|post-deploy]",
    );
    process.exit(0);
  }
  const hasApply = argv.includes("--apply");
  const hasDryRun = argv.includes("--dry-run");
  if (hasApply && hasDryRun) {
    throw new Error("Pass only one of --apply or --dry-run.");
  }
  const known = new Set(["--apply", "--dry-run"]);
  const phaseArguments = argv.filter((argument) => argument.startsWith("--phase="));
  const unknown = argv.find((argument) => !known.has(argument) && !argument.startsWith("--phase="));
  if (unknown) {
    throw new Error(`Unknown migration option: ${unknown}`);
  }
  if (phaseArguments.length > 1) {
    throw new Error("Pass --phase only once.");
  }
  if (
    argv.filter((argument) => argument === "--apply").length > 1 ||
    (hasDryRun && argv.filter((argument) => argument === "--dry-run").length > 1)
  ) {
    throw new Error("Pass the migration mode only once.");
  }
  const phaseArgument = phaseArguments[0];
  const phaseValue = phaseArgument?.slice("--phase=".length) ?? "all";
  if (phaseValue !== "all" && phaseValue !== "pre-deploy" && phaseValue !== "post-deploy") {
    throw new Error(`Invalid migration phase: ${phaseValue}`);
  }
  return {
    mode: hasApply ? "apply" : "dry-run",
    phase: phaseValue,
  };
}

async function sqlFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".sql"))
    .map((entry) => join(dir, entry.name))
    .sort((a, b) => a.localeCompare(b));
}

async function stringRecord(file: string, label: string): Promise<Map<string, string>> {
  const parsed: unknown = JSON.parse(await readFile(file, "utf8"));
  if (!isRecord(parsed)) {
    throw new Error(`${label} must be a JSON object.`);
  }
  const entries = new Map<string, string>();
  for (const [key, value] of Object.entries(parsed)) {
    if (!RAW_MIGRATION_PATH_PATTERN.test(key) || typeof value !== "string") {
      throw new Error(`${label} contains an invalid entry for ${key}.`);
    }
    entries.set(key, value);
  }
  return entries;
}

async function retiredRawMigrations(): Promise<Map<string, string>> {
  const retired = await stringRecord(RETIRED_RAW_PATH, "Retired raw migration manifest");
  for (const [filename, checksum] of retired) {
    if (!SHA256_PATTERN.test(checksum)) {
      throw new Error(`Retired raw migration has an invalid checksum: ${filename}`);
    }
  }
  return retired;
}

async function rawMigrationPhases(postFiles: string[]): Promise<RawMigrationPhaseMap> {
  const configured = await stringRecord(RAW_PHASES_PATH, "Raw migration phase manifest");
  const sourceNames = new Set(postFiles.map((file) => relative(ROOT, file)));
  const unknown = [...configured.keys()].filter((filename) => !sourceNames.has(filename));
  const missing = [...sourceNames].filter((filename) => !configured.has(filename));
  if (unknown.length || missing.length) {
    throw new Error(
      [
        unknown.length ? `phase entries without source: ${unknown.join(", ")}` : "",
        missing.length ? `post migrations without a phase: ${missing.join(", ")}` : "",
      ]
        .filter(Boolean)
        .join("; "),
    );
  }
  const phases: RawMigrationPhaseMap = new Map();
  for (const [filename, phase] of configured) {
    if (phase !== "pre-deploy" && phase !== "post-deploy") {
      throw new Error(`Raw migration has an invalid phase: ${filename}`);
    }
    phases.set(filename, phase);
  }
  return phases;
}

function assertUniqueRawMigrationIndexes(
  files: readonly string[],
  retired: ReadonlyMap<string, string>,
): void {
  const identities = new Map<string, string>();
  for (const filename of [...files.map((file) => relative(ROOT, file)), ...retired.keys()]) {
    const match = /^(infra\/supabase\/migrations\/(?:pre|post))\/(\d{4})_/.exec(filename);
    if (!match) {
      throw new Error(`Invalid raw migration filename: ${filename}`);
    }
    const identity = `${match[1]}/${match[2]}`;
    const existing = identities.get(identity);
    if (existing) {
      throw new Error(`Raw migration index reused by ${existing} and ${filename}.`);
    }
    identities.set(identity, filename);
  }
}

async function assertExpandOnlyRawMigrations(files: readonly string[]): Promise<void> {
  for (const file of files) {
    const index = Number.parseInt(file.split("/").at(-1)?.slice(0, 4) ?? "", 10);
    if (!Number.isInteger(index) || index < FIRST_PHASE_ENFORCED_RAW_INDEX) {
      continue;
    }
    const sql = stripFunctionBodies(stripSqlComments(await readFile(file, "utf8")));
    if (IRREVERSIBLE_SQL_PATTERN.test(sql)) {
      throw new Error(
        `Pre-deploy raw migration must be expand-only: ${relative(ROOT, file)}. Classify irreversible contractions as post-deploy.`,
      );
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function createClient(databaseUrl: string): DrizzleMigrationClient {
  const dbRequire = createRequire(join(ROOT, "packages/db/package.json"));
  const { Client } = dbRequire("pg") as PgModule;
  return new Client({ connectionString: databaseUrl });
}

async function ensureRawLedger(client: PgClient): Promise<void> {
  await client.query(
    `create table if not exists public._raw_migrations (
      filename text primary key,
      sha256 text not null
        constraint _raw_migrations_sha256_check check (sha256 ~ '^[0-9a-f]{64}$'),
      applied_at timestamptz not null default now()
    )`,
  );
}

async function assertRawLedgerShape(client: PgClient, allowMissing: boolean): Promise<void> {
  const result = await client.query(
    `select
       to_regclass('public._raw_migrations') is not null as table_exists,
       exists (
         select 1 from information_schema.columns
          where table_schema = 'public'
            and table_name = '_raw_migrations'
            and column_name = 'sha256'
            and data_type = 'text'
            and is_nullable = 'NO'
       ) as checksum_valid_shape,
       exists (
         select 1 from pg_constraint
          where conrelid = to_regclass('public._raw_migrations')
            and conname = '_raw_migrations_sha256_check'
            and convalidated
       ) as checksum_constraint_validated`,
  );
  const row = result.rows[0];
  if (row?.["table_exists"] !== true && allowMissing) {
    return;
  }
  if (
    row?.["table_exists"] !== true ||
    row["checksum_valid_shape"] !== true ||
    row["checksum_constraint_validated"] !== true
  ) {
    throw new Error("Raw migration ledger must have a required, validated SHA-256 identity.");
  }
}

async function appliedRawMigrations(client: PgClient): Promise<RawMigrationLedger> {
  try {
    const result = await client.query("select filename, sha256 from public._raw_migrations");
    const applied: RawMigrationLedger = new Map();
    for (const row of result.rows) {
      const filename = String(row["filename"]);
      const checksum = row["sha256"];
      if (typeof checksum !== "string" || !SHA256_PATTERN.test(checksum)) {
        throw new Error(`Applied raw migration has no valid checksum: ${filename}`);
      }
      applied.set(filename, checksum);
    }
    return applied;
  } catch (error) {
    if (isUndefinedTable(error)) {
      return new Map();
    }
    throw error;
  }
}

function isUndefinedTable(error: unknown): boolean {
  return pgErrorCode(error) === "42P01";
}

function pgErrorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return undefined;
  }
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
}

async function fileChecksum(file: string): Promise<string> {
  return createHash("sha256")
    .update(await readFile(file))
    .digest("hex");
}

async function applyRawFile(client: PgClient, file: string): Promise<void> {
  const filename = relative(ROOT, file);
  const sql = await readFile(file, "utf8");
  const sha256 = await fileChecksum(file);
  await client.query("begin");
  try {
    await client.query(sql);
    await client.query("insert into public._raw_migrations (filename, sha256) values ($1, $2)", [
      filename,
      sha256,
    ]);
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  }
}

async function applyRawPhase(client: PgClient, title: string, files: string[]): Promise<void> {
  const applied = await appliedRawMigrations(client);
  for (const file of files) {
    const filename = relative(ROOT, file);
    if (applied.has(filename)) {
      writeLine(`skip ${title}: ${filename}`);
      continue;
    }
    writeLine(`apply ${title}: ${filename}`);
    await applyRawFile(client, file);
  }
}

async function runDrizzleMigrate(
  client: DrizzleMigrationClient,
  migrations: readonly DrizzleMigration[],
): Promise<void> {
  const applied = await verifyDrizzleMigrationIntegrity(client, migrations, writeLine);
  const pending = migrations.filter((migration) => !applied.has(migration.file));
  const plans = await Promise.all(
    pending.map(async (migration) => ({
      checksum: migration.checksum,
      file: migration.file,
      statements: (await readFile(resolve(ROOT, migration.file), "utf8")).split(
        "--> statement-breakpoint",
      ),
      when: migration.when,
    })),
  );
  await runDrizzleMigrations(client, plans, writeLine);
}

async function printPlan(
  client: PgClient,
  foundations: string[],
  expansions: string[],
  contractions: string[],
  phase: MigrationPhase,
  drizzle: readonly DrizzleMigration[],
  appliedDrizzle: ReadonlySet<string>,
): Promise<void> {
  const applied = await appliedRawMigrations(client);
  writeLine("Migration plan:");
  if (phase !== "post-deploy") {
    printRawPlan("Phase 1 raw foundations", foundations, applied);
    writeLine("Phase 2 Drizzle expansions");
    for (const migration of drizzle) {
      const state = appliedDrizzle.has(migration.file) ? "applied" : "pending";
      writeLine(`  ${state} ${migration.file}`);
    }
    printRawPlan("Phase 3 raw expansions and security overlays", expansions, applied);
  }
  if (phase !== "pre-deploy") {
    printRawPlan("Phase 4 post-deploy contractions", contractions, applied);
  }
}

function printRawPlan(title: string, files: string[], applied: RawMigrationLedger): void {
  writeLine(title);
  for (const file of files) {
    const filename = relative(ROOT, file);
    const state = applied.has(filename) ? "applied" : "pending";
    writeLine(`  ${state} ${filename}`);
  }
}

async function assertRawApplyOrder(
  client: PgClient,
  groups: ReadonlyArray<readonly string[]>,
): Promise<void> {
  const applied = await appliedRawMigrations(client);
  let firstPending: string | undefined;
  for (const files of groups) {
    for (const file of files) {
      const filename = relative(ROOT, file);
      if (!applied.has(filename)) {
        firstPending ??= filename;
      } else if (firstPending) {
        throw new Error(`Raw migration ${filename} was applied before ${firstPending}.`);
      }
    }
  }
}

async function assertPreDeployComplete(
  client: PgClient,
  foundations: readonly string[],
  expansions: readonly string[],
  drizzle: readonly DrizzleMigration[],
): Promise<void> {
  const raw = await appliedRawMigrations(client);
  const missingRaw = [...foundations, ...expansions]
    .map((file) => relative(ROOT, file))
    .filter((filename) => !raw.has(filename));
  const appliedDrizzle = await verifyDrizzleMigrationIntegrity(client, drizzle, writeLine);
  const missingDrizzle = drizzle
    .map((migration) => migration.file)
    .filter((filename) => !appliedDrizzle.has(filename));
  if (missingRaw.length > 0 || missingDrizzle.length > 0) {
    throw new Error(
      `Post-deploy contractions require a complete pre-deploy phase: missing ${[...missingRaw, ...missingDrizzle].join(", ")}.`,
    );
  }
}

async function closeMigrationClient(
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

async function verifyRawMigrationIntegrity(
  client: PgClient,
  files: string[],
  retired: Map<string, string>,
): Promise<void> {
  const applied = await appliedRawMigrations(client);
  const sourceFiles = new Set(files.map((file) => relative(ROOT, file)));
  assertRawMigrationCoverage(applied, sourceFiles, retired);
  const appliedChecksums = await collectAppliedChecksums(files, retired, applied);
  assertAppliedChecksums(appliedChecksums, applied);
}

function assertRawMigrationCoverage(
  applied: RawMigrationLedger,
  sourceFiles: Set<string>,
  retired: Map<string, string>,
): void {
  const overlap = [...retired.keys()].filter((filename) => sourceFiles.has(filename));
  if (overlap.length > 0) {
    throw new Error(`Retired raw migrations still exist as executable SQL: ${overlap.join(", ")}`);
  }
  const missing = [...applied.keys()].filter(
    (filename) => !sourceFiles.has(filename) && !retired.has(filename),
  );
  if (missing.length > 0) {
    throw new Error(
      `Applied raw migrations are missing from source and the retired manifest: ${missing.join(", ")}`,
    );
  }
}

async function collectAppliedChecksums(
  files: string[],
  retired: Map<string, string>,
  applied: RawMigrationLedger,
): Promise<Map<string, string>> {
  const appliedChecksums = new Map<string, string>();
  for (const file of files) {
    const filename = relative(ROOT, file);
    if (!applied.has(filename)) {
      continue;
    }
    appliedChecksums.set(filename, await fileChecksum(file));
  }
  for (const [filename, checksum] of retired) {
    if (applied.has(filename)) {
      appliedChecksums.set(filename, checksum);
    }
  }
  return appliedChecksums;
}

function assertAppliedChecksums(
  appliedChecksums: Map<string, string>,
  applied: RawMigrationLedger,
): void {
  for (const [filename, actual] of appliedChecksums) {
    const expected = applied.get(filename);
    if (expected !== actual) {
      throw new Error(`Applied raw migration was modified: ${filename}`);
    }
  }
}

function stripSqlComments(sql: string): string {
  return sql.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n]*/g, " ");
}

function stripFunctionBodies(sql: string): string {
  return sql.replace(/\bas\s+(\$[a-z0-9_]*\$)[\s\S]*?\1/gi, " ");
}

const IRREVERSIBLE_SQL_PATTERN =
  /\b(?:delete\s+from|detach\s+partition|drop\s+(?:column|constraint|extension|function|index|materialized\s+view|policy|procedure|schema|sequence|table|trigger|type|view)|rename\s+(?:column|constraint|to)|truncate\s+(?!on\b)|alter\s+column\s+[^;]+\s+(?:drop\s+default|set\s+not\s+null|type\b))/i;

async function loadMigrationFiles(): Promise<MigrationFiles> {
  await assertExpandOnlyDrizzleMigrations();
  const foundations = await sqlFiles(PRE_DIR);
  const post = await sqlFiles(POST_DIR);
  const phases = await rawMigrationPhases(post);
  const expansions = post.filter((file) => phases.get(relative(ROOT, file)) === "pre-deploy");
  const contractions = post.filter((file) => phases.get(relative(ROOT, file)) === "post-deploy");
  const retired = await retiredRawMigrations();
  assertUniqueRawMigrationIndexes([...foundations, ...post], retired);
  await assertExpandOnlyRawMigrations([...foundations, ...expansions]);
  const drizzle = await loadDrizzleMigrations();
  return { contractions, drizzle, expansions, foundations, post, retired };
}

async function runMigration(
  databaseUrl: string,
  identity: DatabaseIdentityExpectation,
  options: MigrationOptions,
  files: MigrationFiles,
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
    await assertPinnedDatabaseIdentity(client, identity, options.mode);
    await acquireDatabaseMaintenanceLock(client, "schema migration");
    hasMaintenanceLock = true;
    await executeMigration(client, options, files);
  } catch (error) {
    operationFailed = true;
    throw error;
  } finally {
    await closeMigrationClient(client, hasMaintenanceLock, operationFailed);
  }
}

async function executeMigration(
  client: DrizzleMigrationClient,
  options: MigrationOptions,
  files: MigrationFiles,
): Promise<void> {
  const { contractions, drizzle, expansions, foundations, post, retired } = files;
  await assertSupabaseTarget(client, "pre-migration");
  if (options.mode === "apply") {
    await ensureRawLedger(client);
  }
  await assertRawLedgerShape(client, options.mode === "dry-run");
  await verifyRawMigrationIntegrity(client, [...foundations, ...post], retired);
  await assertRawApplyOrder(client, [foundations, expansions, contractions]);
  const appliedDrizzle = await verifyDrizzleMigrationIntegrity(client, drizzle, writeLine);
  if (options.mode === "dry-run") {
    await printPlan(
      client,
      foundations,
      expansions,
      contractions,
      options.phase,
      drizzle,
      appliedDrizzle,
    );
    return;
  }
  await applySelectedPhases(client, options.phase, files);
  await verifyRawMigrationIntegrity(client, [...foundations, ...post], retired);
  await assertRawApplyOrder(client, [foundations, expansions, contractions]);
}

async function applySelectedPhases(
  client: DrizzleMigrationClient,
  phase: MigrationPhase,
  files: MigrationFiles,
): Promise<void> {
  if (phase !== "post-deploy") {
    await applyRawPhase(client, "raw foundations", files.foundations);
    await runDrizzleMigrate(client, files.drizzle);
    const applied = await verifyDrizzleMigrationIntegrity(client, files.drizzle, writeLine);
    if (applied.size !== files.drizzle.length) {
      throw new Error("Drizzle returned without applying the complete migration journal.");
    }
    await applyRawPhase(client, "raw expansions", files.expansions);
  }
  if (phase !== "pre-deploy") {
    await assertPreDeployComplete(client, files.foundations, files.expansions, files.drizzle);
    await applyRawPhase(client, "post-deploy contractions", files.contractions);
    await assertSupabaseTarget(client, "prod-ready");
  }
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  if (options.mode === "apply" && options.phase === "all") {
    throw new Error(
      "Refusing --apply --phase=all. Apply pre-deploy and post-deploy in separate release gates.",
    );
  }
  const { databaseUrl, expectedDatabase, expectedHost, expectedRole, expectedSystemIdentifier } =
    loadMigrationEnvFromFiles(ROOT);
  const identity: DatabaseIdentityExpectation = {
    ...(expectedDatabase ? { expectedDatabase } : {}),
    ...(expectedHost ? { expectedHost } : {}),
    ...(expectedRole ? { expectedRole } : {}),
    ...(expectedSystemIdentifier ? { expectedSystemIdentifier } : {}),
  };
  assertAdministrativeConnectionTarget(databaseUrl, identity, options.mode);
  await runMigration(databaseUrl, identity, options, await loadMigrationFiles());
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown migration error";
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
