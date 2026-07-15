import {
  type ExpectedColumn,
  TABLE_CONTRACTS,
  type TableContract,
} from "./supabase-target-contracts";

interface QueryResult {
  rows: Record<string, unknown>[];
}

export interface PgClient {
  connect(): Promise<unknown>;
  end(): Promise<void>;
  query(text: string, values?: unknown[]): Promise<QueryResult>;
}

export type SupabaseTargetMode = "pre-migration" | "prod-ready";

interface ColumnInfo {
  dataType: string;
  nullable: boolean;
}

// The raw-owned audit table can exist before Drizzle starts; only this atomic
// Drizzle set indicates an interrupted or foreign bootstrap.
const V2_DRIZZLE_TABLES = [
  "v2_users",
  "v2_user_profiles",
  "v2_projects",
  "v2_threads",
  "v2_messages",
  "v2_agent_runs",
  "v2_provider_keys",
  "v2_user_integrations",
  "v2_generated_outputs",
  "v2_entitlements",
  "v2_billing_events",
  "v2_user_skills",
] as const;

const FORBIDDEN_TOKEN_ACCOUNTING_TABLES = ["v2_usage_daily_totals", "v2_usage_events"] as const;

const FORBIDDEN_TOKEN_ACCOUNTING_COLUMNS = [
  {
    columns: ["cost_usd", "tokens_cached", "tokens_in", "tokens_out"],
    tableName: "v2_agent_runs",
  },
  {
    columns: ["free_deepseek_tokens_used"],
    tableName: "v2_entitlements",
  },
] as const;

const FORBIDDEN_ENTITLEMENT_SCAFFOLDING_COLUMNS = [
  "flag_private_projects",
  "flag_sso",
  "max_concurrent_sandboxes",
  "max_seats",
  "quota_deployments",
] as const;

const FORBIDDEN_PROJECT_BACKUP_COLUMNS = ["container_backup"] as const;

const FORBIDDEN_OBSOLETE_TABLES = [
  "v2_automation_run_requests",
  "v2_automation_runs",
  "v2_automations",
  "v2_replay_shares",
  "v2_retired_automation_run_requests_20260715",
  "v2_retired_automation_runs_20260715",
  "v2_retired_automations_20260715",
] as const;

class SupabaseTargetError extends Error {
  public readonly issues: readonly string[];

  public constructor(mode: SupabaseTargetMode, issues: readonly string[]) {
    super(
      `Supabase target validation failed (${mode}):\n${issues.map((issue) => `- ${issue}`).join("\n")}`,
    );
    this.name = "SupabaseTargetError";
    this.issues = issues;
  }
}

export async function assertSupabaseTarget(
  client: PgClient,
  mode: SupabaseTargetMode,
): Promise<void> {
  const issues = await validateSupabaseTarget(client, mode);
  if (issues.length > 0) {
    throw new SupabaseTargetError(mode, issues);
  }
}

async function validateSupabaseTarget(
  client: PgClient,
  mode: SupabaseTargetMode,
): Promise<string[]> {
  const tables = await loadPublicColumns(client);
  const publicTableNames = await loadPublicTableNames(client);
  return [
    ...validateMigrationPresence(mode, publicTableNames),
    ...validateColumns(mode, tables),
    ...validateRemovedTokenAccounting(mode, publicTableNames, tables),
    ...validateRemovedObsoleteTables(mode, publicTableNames),
    ...validateRemovedEntitlementScaffolding(mode, tables),
    ...validateRemovedProjectBackup(mode, tables),
    ...(await validateAppWorker(client)),
    ...(await validateIntegrityConstraints(client, mode)),
    ...(await validateIntegrityIndexes(client, mode)),
    ...(await validateAuditBoundary(client, mode)),
    ...(await validateClerkTombstoneBoundary(client, mode)),
    ...(await validateMigrationLedger(client, mode)),
    ...(await validateAuditArchiveManifest(client, mode)),
    ...(await validateFirstArtifactMilestone(client, mode)),
  ];
}

function validateRemovedObsoleteTables(
  mode: SupabaseTargetMode,
  publicTableNames: Set<string>,
): string[] {
  if (mode !== "prod-ready") {
    return [];
  }
  return FORBIDDEN_OBSOLETE_TABLES.filter((tableName) => publicTableNames.has(tableName)).map(
    (tableName) => `Obsolete table public.${tableName} must be removed.`,
  );
}

async function validateFirstArtifactMilestone(
  client: PgClient,
  mode: SupabaseTargetMode,
): Promise<string[]> {
  if (mode !== "prod-ready") {
    return [];
  }
  const result = await client.query(
    `select
       exists (
         select 1 from pg_trigger
          where tgname = 'v2_capture_first_artifact_trigger'
            and not tgisinternal
       ) as bridge_exists,
       count(*)::text as invalid_count
     from public.v2_users users
     join (
       select user_id, min(created_at) as created_at
         from public.v2_generated_outputs
        group by user_id
     ) first_output on first_output.user_id = users.id
    where users.first_artifact_at is null
       or users.first_artifact_at > first_output.created_at`,
  );
  const row = result.rows[0];
  const issues: string[] = [];
  if (row?.["bridge_exists"] === true) {
    issues.push("The temporary first-artifact insertion bridge must be removed.");
  }
  if (row?.["invalid_count"] !== "0") {
    issues.push("Every user with generated outputs must retain the true first-artifact milestone.");
  }
  return issues;
}

function validateRemovedProjectBackup(
  mode: SupabaseTargetMode,
  tables: Map<string, Map<string, ColumnInfo>>,
): string[] {
  if (mode !== "prod-ready") {
    return [];
  }
  const columns = tables.get("v2_projects");
  return FORBIDDEN_PROJECT_BACKUP_COLUMNS.filter((column) => columns?.has(column)).map(
    (column) => `Obsolete project-backup column public.v2_projects.${column} must be removed.`,
  );
}

function validateRemovedEntitlementScaffolding(
  mode: SupabaseTargetMode,
  tables: Map<string, Map<string, ColumnInfo>>,
): string[] {
  if (mode !== "prod-ready") {
    return [];
  }
  const columns = tables.get("v2_entitlements");
  return FORBIDDEN_ENTITLEMENT_SCAFFOLDING_COLUMNS.filter((column) => columns?.has(column)).map(
    (column) => `Obsolete entitlement column public.v2_entitlements.${column} must be removed.`,
  );
}

function validateRemovedTokenAccounting(
  mode: SupabaseTargetMode,
  publicTableNames: Set<string>,
  tables: Map<string, Map<string, ColumnInfo>>,
): string[] {
  if (mode !== "prod-ready") {
    return [];
  }
  const tableIssues = FORBIDDEN_TOKEN_ACCOUNTING_TABLES.filter((tableName) =>
    publicTableNames.has(tableName),
  ).map((tableName) => `Obsolete token-accounting table public.${tableName} must be removed.`);
  const columnIssues = FORBIDDEN_TOKEN_ACCOUNTING_COLUMNS.flatMap(({ columns, tableName }) => {
    const actualColumns = tables.get(tableName);
    return columns
      .filter((columnName) => actualColumns?.has(columnName))
      .map(
        (columnName) =>
          `Obsolete token-accounting column public.${tableName}.${columnName} must be removed.`,
      );
  });
  return [...tableIssues, ...columnIssues];
}

async function loadPublicTableNames(client: PgClient): Promise<Set<string>> {
  const result = await client.query(
    `select table_name
       from information_schema.tables
      where table_schema = 'public'
        and table_type = 'BASE TABLE'
      order by table_name`,
  );
  return new Set(
    result.rows
      .map((row) => stringField(row, "table_name"))
      .filter((tableName): tableName is string => tableName !== undefined),
  );
}

async function loadPublicColumns(client: PgClient): Promise<Map<string, Map<string, ColumnInfo>>> {
  const result = await client.query(
    `select table_name, column_name, data_type, is_nullable
       from information_schema.columns
      where table_schema = 'public'
        and table_name = any($1::text[])
      order by table_name, ordinal_position`,
    [TABLE_CONTRACTS.map((contract) => contract.tableName)],
  );
  const tables = new Map<string, Map<string, ColumnInfo>>();
  for (const row of result.rows) {
    const tableName = stringField(row, "table_name");
    const columnName = stringField(row, "column_name");
    const dataType = stringField(row, "data_type");
    const nullable = stringField(row, "is_nullable");
    if (!tableName || !columnName || !dataType || !nullable) {
      continue;
    }
    const columns = tables.get(tableName) ?? new Map<string, ColumnInfo>();
    columns.set(columnName, { dataType, nullable: nullable === "YES" });
    tables.set(tableName, columns);
  }
  return tables;
}

function stringField(row: Record<string, unknown>, key: string): string | undefined {
  const value = row[key];
  return typeof value === "string" ? value : undefined;
}

function validateColumns(
  mode: SupabaseTargetMode,
  tables: Map<string, Map<string, ColumnInfo>>,
): string[] {
  return TABLE_CONTRACTS.flatMap((contract) => {
    const columns = tables.get(contract.tableName);
    if (!columns) {
      return mode === "prod-ready" ? [`public.${contract.tableName} is missing.`] : [];
    }
    return contract.columns.flatMap((expected) =>
      validateColumn(mode, contract, expected, columns),
    );
  });
}

function validateMigrationPresence(
  mode: SupabaseTargetMode,
  publicTableNames: Set<string>,
): string[] {
  if (mode !== "pre-migration") {
    return [];
  }

  const expectedTableNames = V2_DRIZZLE_TABLES;
  const existing = expectedTableNames.filter((tableName) => publicTableNames.has(tableName));
  if (existing.length === 0 || existing.length === expectedTableNames.length) {
    return [];
  }

  const missing = expectedTableNames.filter((tableName) => !publicTableNames.has(tableName));
  return [
    `Pre-migration target has partial V2 Cheatcode tables (${existing.map((tableName) => `public.${tableName}`).join(", ")}) but is missing ${missing.map((tableName) => `public.${tableName}`).join(", ")}. Finish or roll back the V2 migration before retrying.`,
  ];
}

function validateColumn(
  mode: SupabaseTargetMode,
  contract: TableContract,
  expected: ExpectedColumn,
  columns: Map<string, ColumnInfo>,
): string[] {
  const actual = columns.get(expected.name);
  if (!actual) {
    return mode === "prod-ready"
      ? [`public.${contract.tableName}.${expected.name} is missing.`]
      : [];
  }
  if (expected.dataType && actual.dataType !== expected.dataType) {
    return [
      `public.${contract.tableName}.${expected.name} must be ${expected.dataType}, got ${actual.dataType}.`,
    ];
  }
  if (
    mode === "prod-ready" &&
    expected.nullable !== undefined &&
    actual.nullable !== expected.nullable
  ) {
    return [
      `public.${contract.tableName}.${expected.name} must be ${expected.nullable ? "nullable" : "NOT NULL"}.`,
    ];
  }
  return [];
}

async function validateAppWorker(client: PgClient): Promise<string[]> {
  const result = await client.query(
    `select rolcanlogin, rolsuper, rolcreatedb, rolcreaterole, rolreplication, rolbypassrls
       from pg_roles where rolname = 'app_worker'`,
  );
  const row = result.rows[0];
  if (!row) {
    return [
      "Postgres role app_worker is missing; provision it with a unique out-of-band credential before running migrations.",
    ];
  }
  const issues: string[] = [];
  if (row["rolcanlogin"] !== true) {
    issues.push("Postgres role app_worker must be LOGIN-enabled.");
  }
  for (const attribute of [
    "rolsuper",
    "rolcreatedb",
    "rolcreaterole",
    "rolreplication",
    "rolbypassrls",
  ]) {
    if (row[attribute] === true) {
      issues.push(`Postgres role app_worker must not have ${attribute}.`);
    }
  }
  return issues;
}

const REQUIRED_INTEGRITY_CONSTRAINTS = [
  ["v2_projects", "v2_projects_id_user_id_key"],
  ["v2_threads", "v2_threads_id_user_id_key"],
  ["v2_agent_runs", "v2_agent_runs_id_user_id_key"],
  ["v2_agent_runs", "v2_agent_runs_id_user_id_thread_id_key"],
  ["v2_threads", "v2_threads_project_user_fk"],
  ["v2_messages", "v2_messages_thread_user_fk"],
  ["v2_messages", "v2_messages_agent_run_scope_fk"],
  ["v2_agent_runs", "v2_agent_runs_thread_user_fk"],
  ["v2_threads", "v2_threads_active_run_scope_fk"],
  ["v2_generated_outputs", "v2_generated_outputs_project_user_fk"],
  ["v2_generated_outputs", "v2_generated_outputs_agent_run_user_fk"],
  ["v2_generated_outputs", "v2_generated_outputs_r2_object_key"],
  ["v2_generated_outputs", "v2_generated_outputs_size_check"],
  ["v2_generated_outputs", "v2_generated_outputs_sha256_check"],
  ["v2_generated_outputs", "v2_generated_outputs_bucket_check"],
  ["v2_generated_outputs", "v2_generated_outputs_key_check"],
  ["v2_generated_outputs", "v2_generated_outputs_filename_check"],
  ["v2_generated_outputs", "v2_generated_outputs_mime_type_check"],
  ["v2_generated_outputs", "v2_generated_outputs_kind_check"],
  ["v2_generated_outputs", "v2_generated_outputs_metadata_check"],
  ["v2_generated_outputs", "v2_generated_outputs_expiry_check"],
  ["v2_provider_keys", "v2_provider_keys_provider_check"],
  ["v2_deleted_clerk_identities", "v2_deleted_clerk_identities_hash_check"],
  ["v2_agent_runs", "v2_agent_runs_idempotency_key_hash_check"],
  ["v2_agent_runs", "v2_agent_runs_request_body_hash_check"],
  ["v2_user_integrations", "v2_user_integrations_composio_connection_id_pk"],
  ["v2_user_integrations", "v2_user_integrations_default_active_check"],
  ["v2_user_integrations", "v2_user_integrations_connection_id_check"],
  ["v2_user_integrations", "v2_user_integrations_integration_check"],
] as const;

const REQUIRED_INTEGRITY_INDEXES = [
  "v2_agent_runs_user_idempotency_key_unique",
  "v2_messages_thread_page_idx",
  "v2_projects_user_page_idx",
  "v2_threads_project_page_idx",
  "v2_threads_user_page_idx",
  "v2_agent_runs_user_delete_page_idx",
  "v2_messages_agent_run_assistant_uidx",
  "v2_generated_outputs_expiry_idx",
  "v2_user_integrations_delete_page_idx",
] as const;

const FORBIDDEN_SUPERSEDED_INDEXES = ["v2_threads_user_recent_idx"] as const;

async function validateIntegrityConstraints(
  client: PgClient,
  mode: SupabaseTargetMode,
): Promise<string[]> {
  if (mode !== "prod-ready") {
    return [];
  }
  const result = await client.query(
    `select relation.relname as table_name, constraint_record.conname
       from pg_constraint constraint_record
       join pg_class relation on relation.oid = constraint_record.conrelid
       join pg_namespace namespace on namespace.oid = relation.relnamespace
      where namespace.nspname = 'public'
        and constraint_record.convalidated
        and constraint_record.conname = any($1::text[])`,
    [REQUIRED_INTEGRITY_CONSTRAINTS.map(([, name]) => name)],
  );
  const present = new Set(
    result.rows.map((row) => `${stringField(row, "table_name")}.${stringField(row, "conname")}`),
  );
  return REQUIRED_INTEGRITY_CONSTRAINTS.filter(
    ([tableName, name]) => !present.has(`${tableName}.${name}`),
  ).map(
    ([tableName, name]) =>
      `Required tenant/output integrity constraint public.${tableName}.${name} is missing or not validated.`,
  );
}

async function validateIntegrityIndexes(
  client: PgClient,
  mode: SupabaseTargetMode,
): Promise<string[]> {
  if (mode !== "prod-ready") {
    return [];
  }
  const names = [...REQUIRED_INTEGRITY_INDEXES, ...FORBIDDEN_SUPERSEDED_INDEXES];
  const result = await client.query(
    `select index_relation.relname as index_name, index_record.indisvalid, index_record.indisready
       from pg_index index_record
       join pg_class index_relation on index_relation.oid = index_record.indexrelid
       join pg_namespace namespace on namespace.oid = index_relation.relnamespace
      where namespace.nspname = 'public'
        and index_relation.relname = any($1::text[])`,
    [names],
  );
  const present = new Set(
    result.rows
      .map((row) => stringField(row, "index_name"))
      .filter((name): name is string => name !== undefined),
  );
  const valid = new Set(
    result.rows
      .filter((row) => row["indisvalid"] === true && row["indisready"] === true)
      .map((row) => stringField(row, "index_name"))
      .filter((name): name is string => name !== undefined),
  );
  const missing = REQUIRED_INTEGRITY_INDEXES.filter((name) => !valid.has(name)).map(
    (name) => `Required production index public.${name} is missing, invalid, or not ready.`,
  );
  const superseded = FORBIDDEN_SUPERSEDED_INDEXES.filter((name) => present.has(name)).map(
    (name) => `Superseded production index public.${name} must be removed.`,
  );
  return [...missing, ...superseded];
}

async function validateAuditBoundary(
  client: PgClient,
  mode: SupabaseTargetMode,
): Promise<string[]> {
  if (mode !== "prod-ready") {
    return [];
  }
  const tableResult = await client.query(
    `select c.relname, c.relrowsecurity, c.relforcerowsecurity
       from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and c.relname in ('v2_audit_log', 'v2_provider_keys')`,
  );
  const functionResult = await client.query(
    `select p.proname, p.prosecdef
         from pg_proc p
         join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and (
            (p.proname = 'append_v2_audit_event'
              and oidvectortypes(p.proargtypes) = 'text, text, text, jsonb')
            or (p.proname = 'scrub_current_user_audit' and p.pronargs = 0)
          )`,
  );
  const grantResult = await client.query(
    `select privilege
       from pg_roles app_role
       join pg_class target on target.relname = 'v2_audit_log'
       join pg_namespace n on n.oid = target.relnamespace and n.nspname = 'public'
      cross join unnest(array['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']) as privilege
      where app_role.rolname = 'app_worker'
        and has_table_privilege(app_role.oid, target.oid, privilege)`,
  );
  return validateAuditSecurityRows(tableResult.rows, functionResult.rows, grantResult.rows);
}

function validateAuditSecurityRows(
  tableRows: readonly Record<string, unknown>[],
  functionRows: readonly Record<string, unknown>[],
  grantRows: readonly Record<string, unknown>[],
): string[] {
  const issues: string[] = [];
  const securityTables = new Map(tableRows.map((row) => [stringField(row, "relname"), row]));
  for (const tableName of ["v2_audit_log", "v2_provider_keys"]) {
    const table = securityTables.get(tableName);
    if (table?.["relrowsecurity"] !== true || table?.["relforcerowsecurity"] !== true) {
      issues.push(`public.${tableName} must have forced row-level security enabled.`);
    }
  }
  const functions = new Map(
    functionRows.map((row) => [stringField(row, "proname"), row["prosecdef"]]),
  );
  for (const name of ["append_v2_audit_event", "scrub_current_user_audit"]) {
    if (functions.get(name) !== true) {
      issues.push(`public.${name} must exist as SECURITY DEFINER.`);
    }
  }
  if (grantRows.length > 0) {
    issues.push("app_worker must not mutate public.v2_audit_log directly.");
  }
  return issues;
}

async function validateClerkTombstoneBoundary(
  client: PgClient,
  mode: SupabaseTargetMode,
): Promise<string[]> {
  if (mode !== "prod-ready") {
    return [];
  }
  const result = await client.query(
    `select
       (select relrowsecurity
          from pg_class
         where oid = to_regclass('public.v2_deleted_clerk_identities')) as rls_enabled,
       has_table_privilege('app_worker', to_regclass('public.v2_deleted_clerk_identities'), 'SELECT') as can_select,
       has_table_privilege('app_worker', to_regclass('public.v2_deleted_clerk_identities'), 'INSERT') as can_insert,
       has_table_privilege('app_worker', to_regclass('public.v2_deleted_clerk_identities'), 'UPDATE') as can_update,
       has_table_privilege('app_worker', to_regclass('public.v2_deleted_clerk_identities'), 'DELETE') as can_delete,
       has_table_privilege('app_worker', to_regclass('public.v2_deleted_clerk_identities'), 'TRUNCATE') as can_truncate`,
  );
  const policyResult = await client.query(
    `select policyname, cmd
       from pg_policies
      where schemaname = 'public'
        and tablename = 'v2_deleted_clerk_identities'
        and 'app_worker' = any(roles)
        and policyname = any($1::text[])`,
    [["v2_deleted_clerk_identities_select", "v2_deleted_clerk_identities_insert"]],
  );
  const row = result.rows[0];
  if (!row) {
    return ["Unable to validate the Clerk deletion tombstone access boundary."];
  }
  return validateClerkTombstoneAccess(row, policyResult.rows);
}

function validateClerkTombstoneAccess(
  row: Record<string, unknown>,
  policyRows: readonly Record<string, unknown>[],
): string[] {
  const issues: string[] = [];
  if (row["rls_enabled"] !== true) {
    issues.push("public.v2_deleted_clerk_identities must have row-level security enabled.");
  }
  if (row["can_select"] !== true || row["can_insert"] !== true) {
    issues.push("app_worker must have SELECT and INSERT on Clerk deletion tombstones.");
  }
  if (row["can_update"] === true || row["can_delete"] === true || row["can_truncate"] === true) {
    issues.push("app_worker must not mutate or remove existing Clerk deletion tombstones.");
  }
  const policies = new Map(
    policyRows.map((policy) => [stringField(policy, "policyname"), policy["cmd"]]),
  );
  if (policies.get("v2_deleted_clerk_identities_select") !== "SELECT") {
    issues.push("app_worker must have the Clerk deletion tombstone SELECT policy.");
  }
  if (policies.get("v2_deleted_clerk_identities_insert") !== "INSERT") {
    issues.push("app_worker must have the Clerk deletion tombstone INSERT policy.");
  }
  return issues;
}

async function validateMigrationLedger(
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

async function validateAuditArchiveManifest(
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
