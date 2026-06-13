import { spawn } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { assertSupabaseTarget, type PgClient } from "../packages/db/src/supabase-target";
import { loadMigrationEnvFromFiles } from "./migration-env";

interface PgModule {
  Client: new (config: { connectionString: string }) => PgClient;
}

type Mode = "apply" | "dry-run";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PRE_DIR = join(ROOT, "infra/supabase/migrations/pre");
const POST_DIR = join(ROOT, "infra/supabase/migrations/post");
const DRIZZLE_DIR = join(ROOT, "packages/db/drizzle");

function writeLine(line = ""): void {
  process.stdout.write(`${line}\n`);
}

function parseMode(argv: string[]): Mode {
  if (argv.includes("--help")) {
    writeLine("Usage: pnpm tsx scripts/migrate.ts [--dry-run|--apply]");
    process.exit(0);
  }
  const hasApply = argv.includes("--apply");
  const hasDryRun = argv.includes("--dry-run");
  if (hasApply && hasDryRun) {
    throw new Error("Pass only one of --apply or --dry-run.");
  }
  return hasApply ? "apply" : "dry-run";
}

async function sqlFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".sql"))
    .map((entry) => join(dir, entry.name))
    .sort((a, b) => a.localeCompare(b));
}

function createClient(databaseUrl: string): PgClient {
  const dbRequire = createRequire(join(ROOT, "packages/db/package.json"));
  const { Client } = dbRequire("pg") as PgModule;
  return new Client({ connectionString: databaseUrl });
}

async function ensureRawLedger(client: PgClient): Promise<void> {
  await client.query(
    `create table if not exists public._raw_migrations (
      filename text primary key,
      applied_at timestamptz not null default now()
    )`,
  );
}

async function appliedRawMigrations(client: PgClient): Promise<Set<string>> {
  try {
    const result = await client.query("select filename from public._raw_migrations");
    return new Set(result.rows.map((row) => String(row["filename"])));
  } catch (error) {
    if (isUndefinedTable(error)) {
      return new Set();
    }
    throw error;
  }
}

function isUndefinedTable(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "42P01"
  );
}

async function applyRawFile(client: PgClient, file: string): Promise<void> {
  const filename = relative(ROOT, file);
  const sql = await readFile(file, "utf8");
  await client.query("begin");
  try {
    await client.query(sql);
    await client.query("insert into public._raw_migrations (filename) values ($1)", [filename]);
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

function runDrizzleMigrate(databaseUrl: string): Promise<void> {
  writeLine("apply drizzle: packages/db/drizzle");
  return new Promise((resolvePromise, reject) => {
    const child = spawn(
      "pnpm",
      ["--filter", "@cheatcode/db", "exec", "drizzle-kit", "migrate", "--config=drizzle.config.ts"],
      {
        cwd: ROOT,
        env: { ...process.env, SUPABASE_MIGRATION_URL: databaseUrl },
        stdio: "inherit",
      },
    );
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolvePromise();
        return;
      }
      reject(new Error(`drizzle-kit migrate exited with code ${code ?? "unknown"}.`));
    });
  });
}

async function printPlan(client: PgClient, pre: string[], post: string[]): Promise<void> {
  const applied = await appliedRawMigrations(client);
  const drizzle = await sqlFiles(DRIZZLE_DIR);
  writeLine("Migration plan:");
  printRawPlan("Phase 1 raw pre", pre, applied);
  writeLine("Phase 2 drizzle");
  for (const file of drizzle) {
    writeLine(`  ${relative(ROOT, file)}`);
  }
  printRawPlan("Phase 3 raw post", post, applied);
}

function printRawPlan(title: string, files: string[], applied: Set<string>): void {
  writeLine(title);
  for (const file of files) {
    const filename = relative(ROOT, file);
    const state = applied.has(filename) ? "applied" : "pending";
    writeLine(`  ${state} ${filename}`);
  }
}

async function main(): Promise<void> {
  const mode = parseMode(process.argv.slice(2));
  const { databaseUrl } = loadMigrationEnvFromFiles(ROOT);
  const client = createClient(databaseUrl);
  const pre = await sqlFiles(PRE_DIR);
  const post = await sqlFiles(POST_DIR);
  await client.connect();
  try {
    await assertSupabaseTarget(client, "pre-migration");
    if (mode === "dry-run") {
      await printPlan(client, pre, post);
      return;
    }
    await ensureRawLedger(client);
    await applyRawPhase(client, "raw pre", pre);
    await runDrizzleMigrate(databaseUrl);
    await applyRawPhase(client, "raw post", post);
  } finally {
    await client.end();
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown migration error";
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
