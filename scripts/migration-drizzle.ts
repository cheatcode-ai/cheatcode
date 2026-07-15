import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { PgClient } from "../packages/db/src/supabase-target";

interface DrizzleJournalEntry {
  idx: number;
  tag: string;
  when: number;
}

interface DrizzleLedgerException {
  databaseSha256: string;
  reason: string;
  sourceSha256: string;
}

export interface DrizzleMigration {
  checksum: string;
  file: string;
  when: string;
}

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DRIZZLE_DIR = join(ROOT, "packages/db/drizzle");
const DRIZZLE_JOURNAL_PATH = join(DRIZZLE_DIR, "meta/_journal.json");
const DRIZZLE_LEDGER_EXCEPTIONS_PATH = join(
  ROOT,
  "infra/supabase/migrations/drizzle-ledger-exceptions.json",
);
const FIRST_EXPAND_ONLY_DRIZZLE_INDEX = 18;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const DESTRUCTIVE_SQL_PATTERN =
  /\b(?:delete\s+from|detach\s+partition|drop\s+(?:column|constraint|extension|function|index|materialized\s+view|policy|procedure|schema|sequence|table|trigger|type|view)|rename\s+(?:column|constraint|to)|revoke\b|truncate\b|alter\s+column\s+[^;]+\s+(?:drop\s+default|set\s+not\s+null|type\b))/i;

export async function loadDrizzleMigrations(): Promise<DrizzleMigration[]> {
  const parsed: unknown = JSON.parse(await readFile(DRIZZLE_JOURNAL_PATH, "utf8"));
  if (
    !isRecord(parsed) ||
    parsed["dialect"] !== "postgresql" ||
    !Array.isArray(parsed["entries"])
  ) {
    throw new Error("Drizzle migration journal is invalid.");
  }
  const entries = parsed["entries"].map(parseDrizzleJournalEntry);
  assertDrizzleJournalSequence(entries);
  const files = await sqlFiles(DRIZZLE_DIR);
  const expectedFiles = entries.map((entry) => join(DRIZZLE_DIR, `${entry.tag}.sql`));
  const unexpected = files.filter((file) => !expectedFiles.includes(file));
  const missing = expectedFiles.filter((file) => !files.includes(file));
  if (unexpected.length > 0 || missing.length > 0) {
    throw new Error(
      `Drizzle journal/source mismatch: missing=${paths(missing)}; unexpected=${paths(unexpected)}.`,
    );
  }
  return Promise.all(
    entries.map(async (entry) => ({
      checksum: await fileChecksum(join(DRIZZLE_DIR, `${entry.tag}.sql`)),
      file: relative(ROOT, join(DRIZZLE_DIR, `${entry.tag}.sql`)),
      when: String(entry.when),
    })),
  );
}

function paths(files: readonly string[]): string {
  return files.map((file) => relative(ROOT, file)).join(", ") || "none";
}

function parseDrizzleJournalEntry(value: unknown, position: number): DrizzleJournalEntry {
  if (!isRecord(value)) {
    throw new Error(`Drizzle journal entry ${position} is invalid.`);
  }
  const { idx, tag, when } = value;
  if (
    typeof idx !== "number" ||
    !Number.isSafeInteger(idx) ||
    typeof when !== "number" ||
    !Number.isSafeInteger(when) ||
    typeof tag !== "string" ||
    !/^\d{4}_[a-z0-9_]+$/.test(tag)
  ) {
    throw new Error(`Drizzle journal entry ${position} has invalid identity fields.`);
  }
  return { idx, tag, when };
}

function assertDrizzleJournalSequence(entries: readonly DrizzleJournalEntry[]): void {
  for (const [position, entry] of entries.entries()) {
    if (entry.idx !== position || Number(entry.tag.slice(0, 4)) !== entry.idx) {
      throw new Error(`Drizzle journal must be contiguous; invalid entry ${entry.tag}.`);
    }
    const previous = entries[position - 1];
    if (previous && previous.when >= entry.when) {
      throw new Error(`Drizzle journal timestamps must increase; invalid entry ${entry.tag}.`);
    }
  }
}

export async function verifyDrizzleMigrationIntegrity(
  client: PgClient,
  migrations: readonly DrizzleMigration[],
  report: (message: string) => void,
): Promise<Set<string>> {
  const exceptions = await loadDrizzleLedgerExceptions();
  assertDrizzleExceptionSources(migrations, exceptions);
  const result = await loadAppliedDrizzleMigrations(client);
  if (result.length > migrations.length) {
    throw new Error("Database contains more Drizzle migrations than the source journal.");
  }
  const appliedFiles = new Set<string>();
  for (const [position, row] of result.entries()) {
    const migration = migrations[position];
    if (!migration || row.createdAt !== migration.when) {
      throw new Error(`Drizzle ledger is not a contiguous source prefix at ${row.createdAt}.`);
    }
    assertDrizzleChecksum(migration, row.hash, exceptions.get(migration.file), report);
    appliedFiles.add(migration.file);
  }
  return appliedFiles;
}

async function loadDrizzleLedgerExceptions(): Promise<Map<string, DrizzleLedgerException>> {
  const parsed: unknown = JSON.parse(await readFile(DRIZZLE_LEDGER_EXCEPTIONS_PATH, "utf8"));
  if (!isRecord(parsed)) {
    throw new Error("Drizzle ledger exception manifest must be an object.");
  }
  const exceptions = new Map<string, DrizzleLedgerException>();
  for (const [filename, value] of Object.entries(parsed)) {
    if (!/^packages\/db\/drizzle\/\d{4}_[a-z0-9_]+\.sql$/.test(filename)) {
      throw new Error(`Invalid Drizzle ledger exception path: ${filename}`);
    }
    exceptions.set(filename, parseDrizzleLedgerException(filename, value));
  }
  return exceptions;
}

function parseDrizzleLedgerException(filename: string, value: unknown): DrizzleLedgerException {
  if (!isRecord(value)) {
    throw new Error(`Invalid Drizzle ledger exception: ${filename}`);
  }
  const databaseSha256 = value["databaseSha256"];
  const sourceSha256 = value["sourceSha256"];
  const reason = value["reason"];
  if (
    typeof databaseSha256 !== "string" ||
    !SHA256_PATTERN.test(databaseSha256) ||
    typeof sourceSha256 !== "string" ||
    !SHA256_PATTERN.test(sourceSha256) ||
    typeof reason !== "string" ||
    reason.trim().length < 20
  ) {
    throw new Error(`Invalid Drizzle ledger exception details: ${filename}`);
  }
  return { databaseSha256, reason, sourceSha256 };
}

function assertDrizzleExceptionSources(
  migrations: readonly DrizzleMigration[],
  exceptions: ReadonlyMap<string, DrizzleLedgerException>,
): void {
  const sources = new Map(migrations.map((migration) => [migration.file, migration.checksum]));
  for (const [filename, exception] of exceptions) {
    if (sources.get(filename) !== exception.sourceSha256) {
      throw new Error(`Drizzle ledger exception source identity mismatch: ${filename}`);
    }
  }
}

async function loadAppliedDrizzleMigrations(
  client: PgClient,
): Promise<Array<{ createdAt: string; hash: string }>> {
  try {
    const result = await client.query(
      "select hash, created_at::text from drizzle.__drizzle_migrations order by created_at",
    );
    return result.rows.map((row, position) => {
      const hash = row["hash"];
      const createdAt = row["created_at"];
      if (typeof hash !== "string" || !SHA256_PATTERN.test(hash) || typeof createdAt !== "string") {
        throw new Error(`Drizzle ledger row ${position} is invalid.`);
      }
      return { createdAt, hash };
    });
  } catch (error) {
    if (pgErrorCode(error) === "42P01" || pgErrorCode(error) === "3F000") {
      return [];
    }
    throw error;
  }
}

function assertDrizzleChecksum(
  migration: DrizzleMigration,
  databaseChecksum: string,
  exception: DrizzleLedgerException | undefined,
  report: (message: string) => void,
): void {
  if (databaseChecksum === migration.checksum) {
    return;
  }
  if (
    exception &&
    databaseChecksum === exception.databaseSha256 &&
    migration.checksum === exception.sourceSha256
  ) {
    report(`attested Drizzle ledger divergence: ${migration.file}`);
    return;
  }
  throw new Error(`Applied Drizzle migration identity mismatch: ${migration.file}`);
}

export async function assertExpandOnlyDrizzleMigrations(): Promise<void> {
  const files = await sqlFiles(DRIZZLE_DIR);
  for (const file of files) {
    const index = Number.parseInt(file.split("/").at(-1)?.slice(0, 4) ?? "", 10);
    if (!Number.isInteger(index) || index < FIRST_EXPAND_ONLY_DRIZZLE_INDEX) {
      continue;
    }
    const sql = stripSqlComments(await readFile(file, "utf8"));
    if (DESTRUCTIVE_SQL_PATTERN.test(sql)) {
      throw new Error(
        `Drizzle migration must be expand-only: ${relative(ROOT, file)}. Put contractions in an explicitly post-deploy raw migration.`,
      );
    }
  }
}

async function sqlFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".sql"))
    .map((entry) => join(dir, entry.name))
    .sort((a, b) => a.localeCompare(b));
}

async function fileChecksum(file: string): Promise<string> {
  return createHash("sha256")
    .update(await readFile(file))
    .digest("hex");
}

function stripSqlComments(sql: string): string {
  return sql.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n]*/g, " ");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function pgErrorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return undefined;
  }
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
}
