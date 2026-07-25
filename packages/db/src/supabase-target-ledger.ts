import type { PgClient } from "./supabase-target";

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

export async function validateAuditArchiveManifest(client: PgClient): Promise<string[]> {
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
