import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createWriteStream, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import { createGzip } from "node:zlib";
import { assertSupabaseTarget, type PgClient } from "../packages/db/src/supabase-target";
import { loadMigrationEnvFromFiles } from "./migration-env";

interface PgModule {
  Client: new (config: { connectionString: string }) => PgClient;
}

interface CommandResult {
  code: number;
  stderr: string;
  stdout: string;
}

interface ArchiveOptions {
  archiveBeforeDays: number;
  bucket: string;
  createMonthsAhead: number;
  keepTemp: boolean;
  mode: "apply" | "dry-run";
  now: Date;
}

interface AuditPartition {
  monthStart: Date;
  name: string;
}

interface ArchiveResult {
  key: string;
  partitionName: string;
  rowCount: number;
  sha256: string;
  sizeBytes: number;
}

interface ArchiveCursor {
  createdAt: string;
  id: string;
}

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_BUCKET = "cheatcode-audit";
const DEFAULT_ARCHIVE_BEFORE_DAYS = 90;
const DEFAULT_CREATE_MONTHS_AHEAD = 24;
const PAGE_SIZE = 5_000;
const VALUED_OPTIONS = new Set(["--archive-before-days", "--bucket", "--create-months-ahead"]);

function writeLine(line = ""): void {
  process.stdout.write(`${line}\n`);
}

function writeError(line: string): void {
  process.stderr.write(`${line}\n`);
}

function usage(): string {
  return [
    "Usage: pnpm audit:archive -- [--dry-run|--apply] [options]",
    "",
    "Options:",
    "  --archive-before-days <days>   Archive partitions whose month ended at least this many days ago.",
    "  --bucket <name>                R2 bucket for audit archives. Defaults to cheatcode-audit.",
    "  --create-months-ahead <n>      Ensure this many future monthly partitions exist.",
    "  --keep-temp                    Keep the local archive/verify files after upload.",
  ].join("\n");
}

function optionValue(argv: readonly string[], index: number, name: string): string {
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${name} requires a value.`);
  }
  return value;
}

function parsePositiveInteger(raw: string, name: string): number {
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return value;
}

function applyBooleanOption(options: ArchiveOptions, arg: string): boolean {
  if (arg === "--apply") {
    options.mode = "apply";
    return true;
  }
  if (arg === "--dry-run") {
    options.mode = "dry-run";
    return true;
  }
  if (arg === "--keep-temp") {
    options.keepTemp = true;
    return true;
  }
  return false;
}

function splitAssignment(arg: string): { name: string; value: string } | undefined {
  const separatorIndex = arg.indexOf("=");
  if (separatorIndex === -1) {
    return undefined;
  }
  return {
    name: arg.slice(0, separatorIndex),
    value: arg.slice(separatorIndex + 1),
  };
}

function setValuedOption(options: ArchiveOptions, name: string, value: string): boolean {
  switch (name) {
    case "--archive-before-days":
      options.archiveBeforeDays = parsePositiveInteger(value, name);
      return true;
    case "--bucket":
      options.bucket = value;
      return true;
    case "--create-months-ahead":
      options.createMonthsAhead = parsePositiveInteger(value, name);
      return true;
    default:
      return false;
  }
}

function consumeValuedOption(
  options: ArchiveOptions,
  argv: readonly string[],
  index: number,
): number | undefined {
  const arg = argv[index];
  if (!arg) {
    return undefined;
  }
  const assignment = splitAssignment(arg);
  if (assignment) {
    return setValuedOption(options, assignment.name, assignment.value) ? 0 : undefined;
  }
  if (!VALUED_OPTIONS.has(arg)) {
    return undefined;
  }
  return setValuedOption(options, arg, optionValue(argv, index, arg)) ? 1 : undefined;
}

export function parseArchiveArgs(argv: readonly string[], now = new Date()): ArchiveOptions {
  const options: ArchiveOptions = {
    archiveBeforeDays: DEFAULT_ARCHIVE_BEFORE_DAYS,
    bucket: DEFAULT_BUCKET,
    createMonthsAhead: DEFAULT_CREATE_MONTHS_AHEAD,
    keepTemp: false,
    mode: "dry-run",
    now,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === undefined) {
      continue;
    }
    if (arg === "--help") {
      writeLine(usage());
      process.exit(0);
    }
    if (applyBooleanOption(options, arg)) {
      continue;
    }
    const consumed = consumeValuedOption(options, argv, index);
    if (consumed !== undefined) {
      index += consumed;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(options.bucket)) {
    throw new Error("--bucket must be a valid R2 bucket name.");
  }
  return options;
}

export function utcMonthStart(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

export function addUtcMonths(date: Date, months: number): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1));
}

export function auditPartitionName(monthStart: Date): string {
  const year = monthStart.getUTCFullYear();
  const month = String(monthStart.getUTCMonth() + 1).padStart(2, "0");
  return `v2_audit_log_${year}_${month}`;
}

export function archiveObjectKey(monthStart: Date): string {
  const year = monthStart.getUTCFullYear();
  const month = String(monthStart.getUTCMonth() + 1).padStart(2, "0");
  return `${year}-${month}/audit_log.ndjson.gz`;
}

export function partitionMonthStart(name: string): Date | undefined {
  const match = /^v2_audit_log_(\d{4})_(\d{2})$/.exec(name);
  if (!match) {
    return undefined;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (month < 1 || month > 12) {
    return undefined;
  }
  return new Date(Date.UTC(year, month - 1, 1));
}

export function selectArchivePartitions(
  partitions: readonly AuditPartition[],
  now: Date,
  archiveBeforeDays: number,
): AuditPartition[] {
  const cutoff = new Date(now.getTime() - archiveBeforeDays * 24 * 60 * 60 * 1_000);
  return partitions.filter((partition) => addUtcMonths(partition.monthStart, 1) <= cutoff);
}

function createClient(databaseUrl: string): PgClient {
  const dbRequire = createRequire(join(ROOT, "packages/db/package.json"));
  const { Client } = dbRequire("pg") as PgModule;
  return new Client({ connectionString: databaseUrl });
}

function assertSafePartitionName(name: string): void {
  if (!partitionMonthStart(name)) {
    throw new Error(`Unsafe audit partition name: ${name}`);
  }
}

function quotedPartition(name: string): string {
  assertSafePartitionName(name);
  return `public.${name}`;
}

async function loadAuditPartitions(client: PgClient): Promise<AuditPartition[]> {
  const result = await client.query(
    `select child.relname as partition_name
       from pg_inherits
       join pg_class parent on parent.oid = pg_inherits.inhparent
       join pg_class child on child.oid = pg_inherits.inhrelid
       join pg_namespace parent_ns on parent_ns.oid = parent.relnamespace
       join pg_namespace child_ns on child_ns.oid = child.relnamespace
      where parent_ns.nspname = 'public'
        and child_ns.nspname = 'public'
        and parent.relname = 'v2_audit_log'
      order by child.relname`,
  );

  return result.rows.flatMap((row) => {
    const name = stringField(row, "partition_name");
    if (!name) {
      return [];
    }
    const monthStart = partitionMonthStart(name);
    return monthStart ? [{ monthStart, name }] : [];
  });
}

function stringField(row: Record<string, unknown>, key: string): string | undefined {
  const value = row[key];
  return typeof value === "string" ? value : undefined;
}

async function ensureFuturePartitions(client: PgClient, options: ArchiveOptions): Promise<void> {
  const currentMonth = utcMonthStart(options.now);
  for (let offset = 0; offset <= options.createMonthsAhead; offset += 1) {
    const monthStart = addUtcMonths(currentMonth, offset);
    const monthEnd = addUtcMonths(monthStart, 1);
    const name = auditPartitionName(monthStart);
    if (options.mode === "dry-run") {
      writeLine(`would ensure partition ${name}`);
      continue;
    }
    await client.query(
      `create table if not exists ${quotedPartition(name)}
         partition of public.v2_audit_log
         for values from ('${monthStart.toISOString()}'::timestamptz)
         to ('${monthEnd.toISOString()}'::timestamptz)`,
    );
    writeLine(`ensured partition ${name}`);
  }
}

async function partitionRows(
  client: PgClient,
  partitionName: string,
  cursor: ArchiveCursor | undefined,
): Promise<{ cursor: ArchiveCursor | undefined; lines: string[] }> {
  const relation = quotedPartition(partitionName);
  const where = cursor ? "where (created_at, id) > ($1::timestamptz, $2::uuid)" : "";
  const params = cursor ? [cursor.createdAt, cursor.id, PAGE_SIZE] : [PAGE_SIZE];
  const limitPlaceholder = cursor ? "$3" : "$1";
  const result = await client.query(
    `select
        id::text,
        created_at::text,
        jsonb_strip_nulls(jsonb_build_object(
          'id', id::text,
          'user_id', user_id::text,
          'action', action,
          'resource_type', resource_type,
          'resource_id', resource_id,
          'metadata', metadata,
          'ip_address', ip_address::text,
          'user_agent', user_agent,
          'created_at', created_at
        ))::text as line
       from ${relation}
       ${where}
       order by created_at, id
       limit ${limitPlaceholder}`,
    params,
  );

  const lines = result.rows
    .map((row) => stringField(row, "line"))
    .filter((line): line is string => line !== undefined);
  const last = result.rows.at(-1);
  if (!last) {
    return { cursor: undefined, lines };
  }
  const id = stringField(last, "id");
  const createdAt = stringField(last, "created_at");
  if (!id || !createdAt) {
    return { cursor: undefined, lines };
  }
  return { cursor: { createdAt, id }, lines };
}

async function writeArchiveFile(
  client: PgClient,
  partitionName: string,
  outputPath: string,
): Promise<Omit<ArchiveResult, "key" | "partitionName">> {
  const hash = createHash("sha256");
  const gzip = createGzip();
  gzip.on("data", (chunk: Buffer) => hash.update(chunk));
  const output = createWriteStream(outputPath, { flags: "wx" });
  const finished = pipeline(gzip, output);
  let cursor: ArchiveCursor | undefined;
  let rowCount = 0;

  do {
    const page = await partitionRows(client, partitionName, cursor);
    for (const line of page.lines) {
      rowCount += 1;
      if (!gzip.write(`${line}\n`)) {
        await new Promise<void>((resolvePromise) => gzip.once("drain", resolvePromise));
      }
    }
    cursor = page.cursor;
  } while (cursor);

  gzip.end();
  await finished;
  return {
    rowCount,
    sha256: hash.digest("hex"),
    sizeBytes: statSync(outputPath).size,
  };
}

function runCommand(command: string, args: readonly string[]): Promise<CommandResult> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd: ROOT,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr?.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      resolvePromise({ code: code ?? 1, stderr, stdout });
    });
  });
}

async function runChecked(command: string, args: readonly string[]): Promise<void> {
  const result = await runCommand(command, args);
  if (result.code === 0) {
    return;
  }
  throw new Error(commandFailure(result));
}

function commandFailure(result: CommandResult): string {
  const lines = `${result.stderr}\n${result.stdout}`
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  return lines[0] ?? `command exited with code ${result.code}`;
}

function sha256File(path: string): string {
  const hash = createHash("sha256");
  const data = statSync(path);
  if (!data.isFile()) {
    throw new Error(`${path} is not a file.`);
  }
  hash.update(readFileSync(path));
  return hash.digest("hex");
}

async function uploadAndVerify(bucket: string, key: string, filePath: string, verifyPath: string) {
  await runChecked("pnpm", [
    "exec",
    "wrangler",
    "r2",
    "object",
    "put",
    `${bucket}/${key}`,
    "--file",
    filePath,
  ]);
  await runChecked("pnpm", [
    "exec",
    "wrangler",
    "r2",
    "object",
    "get",
    `${bucket}/${key}`,
    "--file",
    verifyPath,
  ]);
  const localHash = sha256File(filePath);
  const remoteHash = sha256File(verifyPath);
  if (localHash !== remoteHash) {
    throw new Error(`R2 verification failed for ${bucket}/${key}.`);
  }
}

async function detachPartition(client: PgClient, partitionName: string): Promise<void> {
  await client.query(
    `alter table public.v2_audit_log detach partition ${quotedPartition(partitionName)}`,
  );
}

async function archivePartition(
  client: PgClient,
  partition: AuditPartition,
  options: ArchiveOptions,
  tempDir: string,
): Promise<ArchiveResult> {
  const key = archiveObjectKey(partition.monthStart);
  const outputPath = join(tempDir, `${partition.name}.ndjson.gz`);
  const verifyPath = join(tempDir, `${partition.name}.verify.ndjson.gz`);
  const fileResult = await writeArchiveFile(client, partition.name, outputPath);
  await uploadAndVerify(options.bucket, key, outputPath, verifyPath);
  await detachPartition(client, partition.name);
  return {
    key,
    partitionName: partition.name,
    ...fileResult,
  };
}

async function runArchive(options: ArchiveOptions): Promise<void> {
  const { databaseUrl } = loadMigrationEnvFromFiles(ROOT);
  const client = createClient(databaseUrl);
  await client.connect();
  const tempDir = mkdtempSync(join(tmpdir(), "cheatcode-audit-archive-"));
  try {
    await assertSupabaseTarget(client, "prod-ready");
    await ensureFuturePartitions(client, options);
    const partitions = await loadAuditPartitions(client);
    const eligible = selectArchivePartitions(partitions, options.now, options.archiveBeforeDays);
    if (eligible.length === 0) {
      writeLine("no audit partitions are old enough to archive");
      return;
    }

    for (const partition of eligible) {
      const key = archiveObjectKey(partition.monthStart);
      if (options.mode === "dry-run") {
        writeLine(`would archive ${partition.name} to r2://${options.bucket}/${key}`);
        continue;
      }
      const result = await archivePartition(client, partition, options, tempDir);
      writeLine(
        `archived ${result.partitionName} to r2://${options.bucket}/${result.key} rows=${result.rowCount} bytes=${result.sizeBytes} sha256=${result.sha256}`,
      );
    }
  } finally {
    await client.end();
    if (options.keepTemp) {
      writeLine(`kept temp archive directory: ${tempDir}`);
    } else {
      rmSync(tempDir, { force: true, recursive: true });
    }
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runArchive(parseArchiveArgs(process.argv.slice(2))).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "Unknown audit archive error";
    writeError(message);
    process.exitCode = 1;
  });
}
