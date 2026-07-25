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

export interface DrizzleMigration {
  checksum: string;
  file: string;
  when: string;
}

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DRIZZLE_DIR = join(ROOT, "packages/db/drizzle");
const DRIZZLE_JOURNAL_PATH = join(DRIZZLE_DIR, "meta/_journal.json");
const SHA256_PATTERN = /^[0-9a-f]{64}$/;

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

export async function verifyDrizzleMigrationIntegrity(
  client: PgClient,
  migrations: readonly DrizzleMigration[],
): Promise<Set<string>> {
  const applied = await loadAppliedDrizzleMigrations(client);
  if (applied.length > migrations.length) {
    throw new Error("Database contains more migrations than the source journal.");
  }

  const appliedFiles = new Set<string>();
  for (const [position, row] of applied.entries()) {
    const migration = migrations[position];
    if (!migration || row.createdAt !== migration.when || row.hash !== migration.checksum) {
      throw new Error(`Migration ledger diverges from source at position ${position}.`);
    }
    appliedFiles.add(migration.file);
  }
  return appliedFiles;
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
        throw new Error(`Migration ledger row ${position} is invalid.`);
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

function paths(files: readonly string[]): string {
  return files.map((file) => relative(ROOT, file)).join(", ") || "none";
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
