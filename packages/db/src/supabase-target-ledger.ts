import type { PgClient, SupabaseTargetMode } from "./supabase-target";

const ARCHIVE_MANIFEST_COLUMNS = [
  "partition_name",
  "month_start",
  "bucket",
  "format_version",
  "object_key",
  "row_count",
  "size_bytes",
  "sha256",
  "state",
  "detached_at",
  "verified_at",
  "dropped_at",
] as const;

export async function validateMigrationLedger(
  client: PgClient,
  mode: SupabaseTargetMode,
): Promise<string[]> {
  if (mode !== "prod-ready") {
    return [];
  }
  const shape = await client.query(
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
         select 1
           from pg_constraint
          where conrelid = to_regclass('public._raw_migrations')
            and conname = '_raw_migrations_sha256_check'
            and convalidated
       ) as checksum_constraint_validated`,
  );
  const row = shape.rows[0];
  if (
    row?.["table_exists"] !== true ||
    row["checksum_valid_shape"] !== true ||
    row["checksum_constraint_validated"] !== true
  ) {
    return ["Raw migration ledger must have a required, validated SHA-256 identity column."];
  }
  const result = await client.query(
    `select count(*)::text as missing_count
       from public._raw_migrations
      where sha256 is null or sha256 !~ '^[0-9a-f]{64}$'`,
  );
  return result.rows[0]?.["missing_count"] === "0"
    ? []
    : ["Every applied raw migration must have a valid SHA-256 checksum."];
}

export async function validateAuditArchiveManifest(
  client: PgClient,
  mode: SupabaseTargetMode,
): Promise<string[]> {
  if (mode !== "prod-ready") {
    return [];
  }
  const result = await client.query(
    `select column_name
       from information_schema.columns
      where table_schema = 'public'
        and table_name = '_audit_archive_manifest'`,
  );
  const columns = new Set(
    result.rows
      .map((row) => stringField(row, "column_name"))
      .filter((column): column is string => column !== undefined),
  );
  return ARCHIVE_MANIFEST_COLUMNS.filter((column) => !columns.has(column)).map(
    (column) =>
      `Audit archive manifest column public._audit_archive_manifest.${column} is missing.`,
  );
}

function stringField(row: Record<string, unknown>, key: string): string | undefined {
  const value = row[key];
  return typeof value === "string" ? value : undefined;
}
