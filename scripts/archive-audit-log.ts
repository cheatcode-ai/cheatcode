import { createWriteStream, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import { createGzip } from "node:zlib";
import { assertSupabaseTarget, type PgClient } from "../packages/db/src/supabase-target";
import { type ArchiveOptions, parseArchiveArgs } from "./audit-archive-options";
import {
  type ArchiveObjectIdentity,
  archiveObjectIdentity,
  uploadAndVerifyArchive,
  verifyRemoteArchive,
} from "./audit-archive-storage";
import { createAuditArchiveOperationDeadline } from "./audit-operation-budget";
import {
  acquireDatabaseMaintenanceLock,
  assertAdministrativeConnectionTarget,
  assertPinnedDatabaseIdentity,
  configureDatabaseOperationSession,
  type DatabaseIdentityExpectation,
  releaseDatabaseMaintenanceLock,
} from "./database-operation-safety";
import { closePgClientWithGrace, createDeadlineAwarePgClient } from "./deadline-aware-pg-client";
import { loadMigrationEnvFromFiles } from "./migration-env";

interface AuditPartition {
  monthStart: Date;
  name: string;
}

interface ArchiveResult extends ArchiveObjectIdentity {
  bucket: string;
  key: string;
  partitionName: string;
  rowCount: string;
}

interface ArchiveCursor {
  createdAt: string;
  id: string;
}

interface ArchiveManifestRow {
  bucket: string;
  monthStart: Date;
  objectKey?: string;
  partitionName: string;
  rowCount?: string;
  sha256?: string;
  sizeBytes?: number;
  state: "detached" | "dropped" | "verified";
  verifiedAt?: Date;
}

interface CatalogPartition extends AuditPartition {
  isAttached: boolean;
}

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ARCHIVE_QUERY_TIMEOUT_MS = 30 * 60 * 1_000;
const PAGE_SIZE = 5_000;

function writeLine(line = ""): void {
  process.stdout.write(`${line}\n`);
}

function writeError(line: string): void {
  process.stderr.write(`${line}\n`);
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

export function archiveObjectKey(monthStart: Date, sha256: string): string {
  if (!/^[0-9a-f]{64}$/.test(sha256)) {
    throw new Error("Archive object key requires a SHA-256 identity.");
  }
  const year = monthStart.getUTCFullYear();
  const month = String(monthStart.getUTCMonth() + 1).padStart(2, "0");
  return `${year}-${month}/audit_log-${sha256}.ndjson.gz`;
}

export function partitionMonthStart(name: string): Date | undefined {
  const match = /^v2_audit_log_(\d{4})_(\d{2})$/.exec(name);
  if (!match) {
    return undefined;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  return month >= 1 && month <= 12 ? new Date(Date.UTC(year, month - 1, 1)) : undefined;
}

export function selectArchivePartitions(
  partitions: readonly AuditPartition[],
  now: Date,
  archiveBeforeDays: number,
): AuditPartition[] {
  const cutoff = new Date(now.getTime() - archiveBeforeDays * 86_400_000);
  return partitions.filter((partition) => addUtcMonths(partition.monthStart, 1) <= cutoff);
}

function quotedPartition(name: string): string {
  if (!partitionMonthStart(name)) {
    throw new Error(`Unsafe audit partition name: ${name}`);
  }
  return `public.${name}`;
}

async function loadCatalogPartitions(client: PgClient): Promise<CatalogPartition[]> {
  const result = await client.query(
    `select child.relname as partition_name,
            coalesce(parent.relname = 'v2_audit_log', false) as is_attached,
            case when parent.relname = 'v2_audit_log'
                 then pg_get_expr(child.relpartbound, child.oid)
                 else null
             end as partition_bound
       from pg_class child
       join pg_namespace child_ns on child_ns.oid = child.relnamespace
       left join pg_inherits inheritance on inheritance.inhrelid = child.oid
       left join pg_class parent on parent.oid = inheritance.inhparent
      where child_ns.nspname = 'public'
        and child.relkind in ('r', 'p')
        and child.relname ~ '^v2_audit_log_[0-9]{4}_(0[1-9]|1[0-2])$'
      order by child.relname`,
  );
  return result.rows.map(parseCatalogPartition);
}

function parseCatalogPartition(row: Record<string, unknown>): CatalogPartition {
  const name = requiredString(row, "partition_name");
  const monthStart = partitionMonthStart(name);
  if (!monthStart || typeof row["is_attached"] !== "boolean") {
    throw new Error(`Invalid audit partition catalog row: ${name}`);
  }
  const isAttached = row["is_attached"];
  if (isAttached) {
    assertPartitionBound(name, monthStart, requiredString(row, "partition_bound"));
  }
  return { isAttached, monthStart, name };
}

function assertPartitionBound(name: string, monthStart: Date, bound: string): void {
  const match = /^FOR VALUES FROM \('([^']+)'\) TO \('([^']+)'\)$/.exec(bound);
  const actualStart = match?.[1] ? new Date(match[1]) : undefined;
  const actualEnd = match?.[2] ? new Date(match[2]) : undefined;
  if (
    !actualStart ||
    !actualEnd ||
    actualStart.getTime() !== monthStart.getTime() ||
    actualEnd.getTime() !== addUtcMonths(monthStart, 1).getTime()
  ) {
    throw new Error(`Audit partition ${name} has unexpected range bounds: ${bound}`);
  }
}

async function ensureFuturePartitions(client: PgClient, options: ArchiveOptions): Promise<void> {
  const currentMonth = utcMonthStart(options.now);
  const expectedNames: string[] = [];
  for (let offset = 0; offset <= options.createMonthsAhead; offset += 1) {
    const monthStart = addUtcMonths(currentMonth, offset);
    const monthEnd = addUtcMonths(monthStart, 1);
    const name = auditPartitionName(monthStart);
    expectedNames.push(name);
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
  if (options.mode === "apply") {
    const attached = new Set(
      (await loadCatalogPartitions(client))
        .filter((partition) => partition.isAttached)
        .map((partition) => partition.name),
    );
    const missing = expectedNames.filter((name) => !attached.has(name));
    if (missing.length > 0) {
      throw new Error(`Future audit partitions were not attached: ${missing.join(", ")}`);
    }
  }
}

async function loadArchiveManifest(client: PgClient): Promise<ArchiveManifestRow[]> {
  const result = await client.query(
    `select partition_name,
            month_start::text,
            bucket,
            format_version,
            object_key,
            row_count::text,
            size_bytes::text,
            sha256,
            state,
            detached_at::text,
            verified_at::text,
            dropped_at::text
       from public._audit_archive_manifest
      order by month_start`,
  );
  return result.rows.map(parseManifestRow);
}

function parseManifestRow(row: Record<string, unknown>): ArchiveManifestRow {
  const partitionName = requiredString(row, "partition_name");
  const state = requiredString(row, "state");
  const monthStart = dateField(row, "month_start");
  const detachedAt = dateField(row, "detached_at");
  if (
    !partitionMonthStart(partitionName) ||
    !["detached", "verified", "dropped"].includes(state) ||
    row["format_version"] !== 1
  ) {
    throw new Error(`Invalid audit archive manifest row: ${partitionName}`);
  }
  const verifiedAt = optionalDateField(row, "verified_at");
  const droppedAt = optionalDateField(row, "dropped_at");
  const identity = optionalManifestIdentity(row);
  if (state === "detached" && identity.objectKey) {
    throw new Error(`Detached archive manifest already has object identity: ${partitionName}`);
  }
  if (state !== "detached" && !identity.objectKey) {
    throw new Error(`Completed archive manifest lacks object identity: ${partitionName}`);
  }
  assertManifestTimeline(partitionName, state, detachedAt, verifiedAt, droppedAt);
  if (
    identity.objectKey &&
    identity.sha256 &&
    archiveObjectKey(monthStart, identity.sha256) !== identity.objectKey
  ) {
    throw new Error(`Archive manifest object key is not content-addressed: ${partitionName}`);
  }
  return {
    bucket: requiredString(row, "bucket"),
    monthStart,
    partitionName,
    state: state as ArchiveManifestRow["state"],
    ...identity,
    ...(verifiedAt ? { verifiedAt } : {}),
  };
}

function optionalManifestIdentity(
  row: Record<string, unknown>,
): Partial<Pick<ArchiveManifestRow, "objectKey" | "rowCount" | "sha256" | "sizeBytes">> {
  const objectKey = optionalString(row, "object_key");
  const rowCount = optionalString(row, "row_count");
  const sha256 = optionalString(row, "sha256");
  const sizeBytesRaw = optionalString(row, "size_bytes");
  if ([objectKey, rowCount, sha256, sizeBytesRaw].every((value) => value === undefined)) {
    return {};
  }
  const sizeBytes = sizeBytesRaw ? Number(sizeBytesRaw) : Number.NaN;
  if (
    objectKey === undefined ||
    rowCount === undefined ||
    !/^\d+$/.test(rowCount) ||
    sha256 === undefined ||
    !/^[0-9a-f]{64}$/.test(sha256) ||
    sizeBytesRaw === undefined ||
    !Number.isSafeInteger(sizeBytes) ||
    sizeBytes < 0
  ) {
    throw new Error("Audit archive manifest has incomplete object identity.");
  }
  return { objectKey, rowCount, sha256, sizeBytes };
}

function assertManifestTimeline(
  partitionName: string,
  state: string,
  detachedAt: Date,
  verifiedAt: Date | undefined,
  droppedAt: Date | undefined,
): void {
  const hasValidVerifiedAt = verifiedAt && verifiedAt >= detachedAt;
  const hasValidDroppedAt = droppedAt && verifiedAt && droppedAt >= verifiedAt;
  const isValid =
    (state === "detached" && !verifiedAt && !droppedAt) ||
    (state === "verified" && hasValidVerifiedAt && !droppedAt) ||
    (state === "dropped" && hasValidVerifiedAt && hasValidDroppedAt);
  if (!isValid) {
    throw new Error(`Audit archive manifest has an invalid timeline: ${partitionName}`);
  }
}

function validateManifestCatalog(
  manifest: readonly ArchiveManifestRow[],
  catalog: readonly CatalogPartition[],
): void {
  const manifestByName = new Map(manifest.map((row) => [row.partitionName, row]));
  const catalogByName = new Map(catalog.map((row) => [row.name, row]));
  for (const row of manifest) {
    const relation = catalogByName.get(row.partitionName);
    const shouldExist = row.state !== "dropped";
    if (shouldExist && (!relation || relation.isAttached)) {
      throw new Error(
        `Manifest expects detached table ${row.partitionName}, but catalog disagrees.`,
      );
    }
    if (!shouldExist && relation) {
      throw new Error(`Manifest marks ${row.partitionName} dropped, but the table still exists.`);
    }
    if (auditPartitionName(row.monthStart) !== row.partitionName) {
      throw new Error(`Manifest month does not match partition ${row.partitionName}.`);
    }
  }
  const orphans = catalog.filter(
    (partition) => !partition.isAttached && !manifestByName.has(partition.name),
  );
  if (orphans.length > 0) {
    throw new Error(
      `Detached audit tables lack recovery manifests: ${orphans.map((row) => row.name).join(", ")}`,
    );
  }
}

async function detachForArchive(
  client: PgClient,
  partition: AuditPartition,
  bucket: string,
): Promise<ArchiveManifestRow> {
  await client.query("begin");
  try {
    await client.query(
      `insert into public._audit_archive_manifest
         (partition_name, month_start, bucket, state, detached_at)
       values ($1, $2::date, $3, 'detached', now())`,
      [partition.name, partition.monthStart.toISOString().slice(0, 10), bucket],
    );
    await client.query(
      `alter table public.v2_audit_log detach partition ${quotedPartition(partition.name)}`,
    );
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  }
  writeLine(`detached ${partition.name}; recovery manifest recorded`);
  return {
    bucket,
    monthStart: partition.monthStart,
    partitionName: partition.name,
    state: "detached",
  };
}

async function partitionRows(
  client: PgClient,
  partitionName: string,
  cursor: ArchiveCursor | undefined,
): Promise<{ cursor: ArchiveCursor | undefined; lines: string[] }> {
  const where = cursor ? "where (created_at, id) > ($1::timestamptz, $2::uuid)" : "";
  const params = cursor ? [cursor.createdAt, cursor.id, PAGE_SIZE] : [PAGE_SIZE];
  const limitPlaceholder = cursor ? "$3" : "$1";
  const result = await client.query(
    `select id::text,
            created_at::text,
            jsonb_strip_nulls(jsonb_build_object(
              'id', id::text,
              'action', action,
              'resource_type', resource_type,
              'subject_redacted', true,
              'created_at', created_at
            ))::text as line
       from ${quotedPartition(partitionName)}
       ${where}
      order by created_at, id
      limit ${limitPlaceholder}`,
    params,
  );
  const lines = result.rows.map((row) => requiredString(row, "line"));
  const last = result.rows.at(-1);
  return {
    cursor: last
      ? { createdAt: requiredString(last, "created_at"), id: requiredString(last, "id") }
      : undefined,
    lines,
  };
}

async function writeArchiveFile(
  client: PgClient,
  partitionName: string,
  outputPath: string,
): Promise<{ rowCount: string } & ArchiveObjectIdentity> {
  const gzip = createGzip({ level: 9 });
  const finished = pipeline(gzip, createWriteStream(outputPath, { flags: "wx" }));
  let cursor: ArchiveCursor | undefined;
  let rowCount = 0n;
  await client.query("begin isolation level repeatable read read only");
  try {
    const expectedCount = await partitionRowCount(client, partitionName);
    do {
      const page = await partitionRows(client, partitionName, cursor);
      for (const line of page.lines) {
        rowCount += 1n;
        if (!gzip.write(`${line}\n`)) {
          await new Promise<void>((resolvePromise) => gzip.once("drain", resolvePromise));
        }
      }
      cursor = page.cursor;
    } while (cursor);
    if (rowCount !== expectedCount) {
      throw new Error(`Archive row count changed while reading ${partitionName}.`);
    }
    gzip.end();
    await finished;
    await client.query("commit");
  } catch (error) {
    gzip.destroy();
    await finished.catch(() => undefined);
    await client.query("rollback");
    throw error;
  }
  return { ...(await archiveObjectIdentity(outputPath)), rowCount: rowCount.toString() };
}

async function partitionRowCount(client: PgClient, partitionName: string): Promise<bigint> {
  const result = await client.query(
    `select count(*)::text as row_count from ${quotedPartition(partitionName)}`,
  );
  const count = result.rows[0]?.["row_count"];
  if (typeof count !== "string" || !/^\d+$/.test(count)) {
    throw new Error(`Unable to count audit partition ${partitionName}.`);
  }
  return BigInt(count);
}

async function recordVerifiedArchive(client: PgClient, result: ArchiveResult): Promise<void> {
  const update = await client.query(
    `update public._audit_archive_manifest
        set object_key = $2,
            row_count = $3::bigint,
            size_bytes = $4::bigint,
            sha256 = $5,
            state = 'verified',
            verified_at = now()
      where partition_name = $1 and state = 'detached'
    returning partition_name`,
    [result.partitionName, result.key, result.rowCount, result.sizeBytes, result.sha256],
  );
  if (update.rows.length !== 1) {
    throw new Error(`Archive manifest state changed unexpectedly for ${result.partitionName}.`);
  }
}

async function archiveDetachedPartition(
  client: PgClient,
  row: ArchiveManifestRow,
  tempDir: string,
  cloudflareAccountId: string,
  deadline: number,
): Promise<ArchiveResult> {
  const outputPath = join(tempDir, `${row.partitionName}.ndjson.gz`);
  const verifyPath = join(tempDir, `${row.partitionName}.upload.verify.ndjson.gz`);
  const file = await writeArchiveFile(client, row.partitionName, outputPath);
  const key = archiveObjectKey(row.monthStart, file.sha256);
  await uploadAndVerifyArchive(
    cloudflareAccountId,
    row.bucket,
    key,
    outputPath,
    verifyPath,
    file,
    deadline,
  );
  const result = {
    bucket: row.bucket,
    key,
    partitionName: row.partitionName,
    ...file,
  };
  await recordVerifiedArchive(client, result);
  return result;
}

async function purgeVerifiedPartition(
  client: PgClient,
  row: ArchiveManifestRow,
  tempDir: string,
  cloudflareAccountId: string,
  deadline: number,
): Promise<void> {
  if (!row.objectKey || !row.sha256 || row.sizeBytes === undefined) {
    throw new Error(`Verified manifest lacks object identity: ${row.partitionName}`);
  }
  const verifyPath = join(tempDir, `${row.partitionName}.purge.verify.ndjson.gz`);
  await verifyRemoteArchive(
    cloudflareAccountId,
    row.bucket,
    row.objectKey,
    verifyPath,
    { sha256: row.sha256, sizeBytes: row.sizeBytes },
    deadline,
  );
  await client.query("begin");
  try {
    await client.query(`drop table ${quotedPartition(row.partitionName)}`);
    const update = await client.query(
      `update public._audit_archive_manifest
          set state = 'dropped', dropped_at = now()
        where partition_name = $1 and state = 'verified'
      returning partition_name`,
      [row.partitionName],
    );
    if (update.rows.length !== 1) {
      throw new Error(`Archive manifest state changed unexpectedly for ${row.partitionName}.`);
    }
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  }
  writeLine(`purged verified detached table ${row.partitionName}; R2 archive retained`);
}

function purgeCandidates(
  manifest: readonly ArchiveManifestRow[],
  now: Date,
  purgeVerifiedBeforeDays: number | undefined,
): ArchiveManifestRow[] {
  if (purgeVerifiedBeforeDays === undefined) {
    return [];
  }
  const cutoff = now.getTime() - purgeVerifiedBeforeDays * 86_400_000;
  return manifest.filter(
    (row) => row.state === "verified" && row.verifiedAt && row.verifiedAt.getTime() <= cutoff,
  );
}

async function executeArchivePlan(
  client: PgClient,
  options: ArchiveOptions,
  tempDir: string,
  cloudflareAccountId: string,
  deadline: number,
): Promise<void> {
  let manifest = await loadArchiveManifest(client);
  let catalog = await loadCatalogPartitions(client);
  validateManifestCatalog(manifest, catalog);
  const pending = manifest.filter((row) => row.state === "detached");
  const attached = catalog.filter((partition) => partition.isAttached);
  const eligible = selectArchivePartitions(attached, options.now, options.archiveBeforeDays);
  for (const row of pending) {
    writeLine(`resuming detached audit archive ${row.partitionName}`);
    await reportArchiveResult(
      await archiveDetachedPartition(client, row, tempDir, cloudflareAccountId, deadline),
    );
  }
  for (const partition of eligible) {
    const detached = await detachForArchive(client, partition, options.bucket);
    await reportArchiveResult(
      await archiveDetachedPartition(client, detached, tempDir, cloudflareAccountId, deadline),
    );
  }
  manifest = await loadArchiveManifest(client);
  catalog = await loadCatalogPartitions(client);
  validateManifestCatalog(manifest, catalog);
  for (const row of purgeCandidates(manifest, options.now, options.purgeVerifiedBeforeDays)) {
    await purgeVerifiedPartition(client, row, tempDir, cloudflareAccountId, deadline);
  }
}

function reportArchiveResult(result: ArchiveResult): void {
  writeLine(
    `archived ${result.partitionName} to r2://${result.bucket}/${result.key} rows=${result.rowCount} bytes=${result.sizeBytes} sha256=${result.sha256}`,
  );
}

async function printArchivePlan(client: PgClient, options: ArchiveOptions): Promise<void> {
  const manifest = await loadArchiveManifest(client);
  const catalog = await loadCatalogPartitions(client);
  validateManifestCatalog(manifest, catalog);
  const pending = manifest.filter((row) => row.state === "detached");
  const eligible = selectArchivePartitions(
    catalog.filter((partition) => partition.isAttached),
    options.now,
    options.archiveBeforeDays,
  );
  for (const row of pending) {
    writeLine(
      `would resume detached archive ${row.partitionName} to r2://${row.bucket}/<content-addressed-key>`,
    );
  }
  for (const partition of eligible) {
    writeLine(
      `would detach and archive ${partition.name} to r2://${options.bucket}/<content-addressed-key>`,
    );
  }
  for (const row of purgeCandidates(manifest, options.now, options.purgeVerifiedBeforeDays)) {
    writeLine(`would re-verify R2 and purge detached table ${row.partitionName}`);
  }
  if (pending.length === 0 && eligible.length === 0) {
    writeLine(
      "no audit partitions are old enough to archive and no detached archive needs recovery",
    );
  }
}

async function closeArchiveClient(
  client: PgClient,
  hasMaintenanceLock: boolean,
  operationFailed: boolean,
): Promise<void> {
  const failures: string[] = [];
  if (hasMaintenanceLock) {
    try {
      await releaseDatabaseMaintenanceLock(client);
    } catch (error) {
      failures.push(error instanceof Error ? error.message : "Failed to release maintenance lock");
    }
  }
  try {
    await closePgClientWithGrace(client, "Audit archive database close");
  } catch (error) {
    failures.push(error instanceof Error ? error.message : "Failed to close archive connection");
  }
  if (failures.length > 0 && operationFailed) {
    writeError(`Audit archive cleanup warning: ${failures.join("; ")}`);
  } else if (failures.length > 0) {
    throw new Error(failures.join("; "));
  }
}

function loadArchiveRuntimeConfig() {
  const { databaseUrl, expectedDatabase, expectedHost, expectedRole, expectedSystemIdentifier } =
    loadMigrationEnvFromFiles(ROOT);
  const cloudflareAccountId = process.env["CLOUDFLARE_ACCOUNT_ID"]?.trim();
  const identity: DatabaseIdentityExpectation = {
    ...(expectedDatabase ? { expectedDatabase } : {}),
    ...(expectedHost ? { expectedHost } : {}),
    ...(expectedRole ? { expectedRole } : {}),
    ...(expectedSystemIdentifier ? { expectedSystemIdentifier } : {}),
  };
  return { cloudflareAccountId, databaseUrl, identity };
}

async function runArchive(options: ArchiveOptions): Promise<void> {
  const { cloudflareAccountId, databaseUrl, identity } = loadArchiveRuntimeConfig();
  const deadline = createAuditArchiveOperationDeadline();
  assertAdministrativeConnectionTarget(databaseUrl, identity, options.mode);
  if (
    options.mode === "apply" &&
    (!cloudflareAccountId || !process.env["CLOUDFLARE_API_TOKEN"]?.trim())
  ) {
    throw new Error(
      "CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN are required for audit archive apply.",
    );
  }
  const client = createDeadlineAwarePgClient(ROOT, databaseUrl, deadline, ARCHIVE_QUERY_TIMEOUT_MS);
  await client.connect();
  let hasMaintenanceLock = false;
  let operationFailed = false;
  let tempDir: string | undefined;
  try {
    await configureDatabaseOperationSession(client, {
      applicationName: "cheatcode-audit-archive",
      statementTimeout: "30min",
    });
    await assertPinnedDatabaseIdentity(client, identity, options.mode);
    await acquireDatabaseMaintenanceLock(client, "audit archive");
    hasMaintenanceLock = true;
    await ensureFuturePartitions(client, options);
    await assertSupabaseTarget(client, "prod-ready");
    validateManifestCatalog(await loadArchiveManifest(client), await loadCatalogPartitions(client));
    if (options.mode === "dry-run") {
      await printArchivePlan(client, options);
      return;
    }
    tempDir = mkdtempSync(join(tmpdir(), "cheatcode-audit-archive-"));
    if (!cloudflareAccountId) {
      throw new Error("Audit archive apply requires a pinned Cloudflare account.");
    }
    await executeArchivePlan(client, options, tempDir, cloudflareAccountId, deadline);
  } catch (error) {
    operationFailed = true;
    throw error;
  } finally {
    try {
      await closeArchiveClient(client, hasMaintenanceLock, operationFailed);
    } finally {
      if (tempDir && options.keepTemp) {
        writeLine(`kept temp archive directory: ${tempDir}`);
      } else if (tempDir) {
        rmSync(tempDir, { force: true, recursive: true });
      }
    }
  }
}

function requiredString(row: Record<string, unknown>, key: string): string {
  const value = row[key];
  if (typeof value !== "string") {
    throw new Error(`Database row is missing ${key}.`);
  }
  return value;
}

function optionalString(row: Record<string, unknown>, key: string): string | undefined {
  const value = row[key];
  if (value === null || value === undefined) {
    return undefined;
  }
  if (typeof value !== "string") {
    throw new Error(`Database row has invalid ${key}.`);
  }
  return value;
}

function dateField(row: Record<string, unknown>, key: string): Date {
  const value = new Date(requiredString(row, key));
  if (Number.isNaN(value.getTime())) {
    throw new Error(`Database row has invalid ${key}.`);
  }
  return value;
}

function optionalDateField(row: Record<string, unknown>, key: string): Date | undefined {
  const value = optionalString(row, key);
  if (!value) {
    return undefined;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Database row has invalid ${key}.`);
  }
  return parsed;
}

async function main(): Promise<void> {
  await runArchive(parseArchiveArgs(process.argv.slice(2)));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    writeError(error instanceof Error ? error.message : "Unknown audit archive error");
    process.exitCode = 1;
  });
}
