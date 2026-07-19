import {
  CANONICAL_PROJECT_WORKSPACE_CONSTRAINT,
  CANONICAL_PROVIDER_KEY_CONSTRAINT,
  EXACT_INTEGRITY_CONSTRAINTS,
  type ExpectedColumn,
  FORBIDDEN_SUPERSEDED_INDEXES,
  REQUIRED_INTEGRITY_CONSTRAINTS,
  REQUIRED_INTEGRITY_INDEXES,
  TABLE_CONTRACTS,
  type TableContract,
} from "./supabase-target-contracts";
import { validateAuditArchiveManifest, validateMigrationLedger } from "./supabase-target-ledger";
import { validateProductionSecurityTarget } from "./supabase-target-security";

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
  datetimePrecision?: number;
  nullable: boolean;
}
// These tables are created together by the first Drizzle migration and remain
// permanent schema anchors. Later migrations may add tables, so folding those
// additions into this atomic set would make every older valid deployment fail
// preflight before it can migrate forward.
const V2_FOUNDATION_DRIZZLE_TABLES = [
  "v2_users",
  "v2_projects",
  "v2_threads",
  "v2_messages",
  "v2_agent_runs",
  "v2_provider_keys",
  "v2_user_integrations",
  "v2_generated_outputs",
  "v2_entitlements",
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
    ...(mode === "prod-ready" ? await validateProductionSecurityTarget(client) : []),
    ...(await validateIntegrityConstraints(client, mode)),
    ...(await validateCanonicalProjectWorkspaces(client, mode)),
    ...(await validateIntegrityIndexes(client, mode)),
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
    `select table_name, column_name, data_type, is_nullable, datetime_precision
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
    const datetimePrecision = numberField(row, "datetime_precision");
    columns.set(columnName, {
      dataType,
      ...(datetimePrecision === undefined ? {} : { datetimePrecision }),
      nullable: nullable === "YES",
    });
    tables.set(tableName, columns);
  }
  return tables;
}

function stringField(row: Record<string, unknown>, key: string): string | undefined {
  const value = row[key];
  return typeof value === "string" ? value : undefined;
}

function numberField(row: Record<string, unknown>, key: string): number | undefined {
  const value = row[key];
  return typeof value === "number" && Number.isInteger(value) ? value : undefined;
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
    const expectedNames = new Set(contract.columns.map(({ name }) => name));
    const unexpected =
      mode === "prod-ready"
        ? [...columns.keys()]
            .filter((name) => !expectedNames.has(name))
            .map(
              (name) => `Unexpected column public.${contract.tableName}.${name} must be removed.`,
            )
        : [];
    return [
      ...contract.columns.flatMap((expected) => validateColumn(mode, contract, expected, columns)),
      ...unexpected,
    ];
  });
}

function validateMigrationPresence(
  mode: SupabaseTargetMode,
  publicTableNames: Set<string>,
): string[] {
  if (mode !== "pre-migration") {
    return [];
  }

  const expectedTableNames = V2_FOUNDATION_DRIZZLE_TABLES;
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
    expected.datetimePrecision !== undefined &&
    actual.datetimePrecision !== expected.datetimePrecision
  ) {
    return [
      `public.${contract.tableName}.${expected.name} must use timestamp precision ${expected.datetimePrecision}.`,
    ];
  }
  if (mode === "prod-ready" && actual.nullable !== expected.nullable) {
    return [
      `public.${contract.tableName}.${expected.name} must be ${expected.nullable ? "nullable" : "NOT NULL"}.`,
    ];
  }
  return [];
}

async function validateIntegrityConstraints(
  client: PgClient,
  mode: SupabaseTargetMode,
): Promise<string[]> {
  if (mode !== "prod-ready") {
    return [];
  }
  const result = await client.query(
    `select
       relation.relname as table_name,
       constraint_record.conname,
       pg_get_constraintdef(constraint_record.oid) as definition,
       constraint_record.confdeltype::text as delete_action
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
  const missing = REQUIRED_INTEGRITY_CONSTRAINTS.filter(
    ([tableName, name]) => !present.has(`${tableName}.${name}`),
  ).map(
    ([tableName, name]) =>
      `Required tenant/output integrity constraint public.${tableName}.${name} is missing or not validated.`,
  );
  const outputRunForeignKey = result.rows.find(
    (row) => row["conname"] === "v2_generated_outputs_agent_run_user_fk",
  );
  const deleteAction = outputRunForeignKey?.["delete_action"];
  if (deleteAction !== "a" && deleteAction !== "r") {
    missing.push("Generated-output/run integrity must use NO ACTION or RESTRICT deletion.");
  }
  const workspaceConstraint = result.rows.find(
    (row) => row["conname"] === CANONICAL_PROJECT_WORKSPACE_CONSTRAINT.name,
  );
  if (
    workspaceConstraint &&
    normalizedSqlDefinition(workspaceConstraint["definition"]) !==
      CANONICAL_PROJECT_WORKSPACE_CONSTRAINT.definition
  ) {
    missing.push("The canonical project workspace ownership check has the wrong definition.");
  }
  const providerConstraint = result.rows.find(
    (row) => row["conname"] === CANONICAL_PROVIDER_KEY_CONSTRAINT.name,
  );
  if (
    providerConstraint &&
    normalizedSqlDefinition(providerConstraint["definition"]) !==
      CANONICAL_PROVIDER_KEY_CONSTRAINT.definition
  ) {
    missing.push("The provider-key allowlist check has the wrong definition.");
  }
  missing.push(...validateExactIntegrityConstraints(result.rows));
  return missing;
}

function validateExactIntegrityConstraints(rows: readonly Record<string, unknown>[]): string[] {
  return EXACT_INTEGRITY_CONSTRAINTS.flatMap((contract) => {
    const row = rows.find(
      (candidate) =>
        candidate["table_name"] === contract.tableName && candidate["conname"] === contract.name,
    );
    if (!row) {
      return [];
    }
    const issues: string[] = [];
    if (normalizedSqlDefinition(row["definition"]) !== contract.definition) {
      issues.push(
        `Integrity constraint public.${contract.tableName}.${contract.name} has the wrong definition.`,
      );
    }
    if (contract.deleteAction !== undefined && row["delete_action"] !== contract.deleteAction) {
      issues.push(
        `Integrity constraint public.${contract.tableName}.${contract.name} has the wrong delete action.`,
      );
    }
    return issues;
  });
}

function normalizedSqlDefinition(value: unknown): string {
  return typeof value === "string" ? value.replaceAll(/\s+/g, " ").trim() : "";
}

async function validateCanonicalProjectWorkspaces(
  client: PgClient,
  mode: SupabaseTargetMode,
): Promise<string[]> {
  if (mode !== "prod-ready") {
    return [];
  }
  const result = await client.query(
    `select count(*)::text as invalid_count
       from public.v2_projects
      where not (
        octet_length(workspace_slug) between 38 and 64
        and right(workspace_slug, 37) = '-' || id::text
        and left(workspace_slug, length(workspace_slug) - 37)
          ~ '^[a-z0-9]+(-[a-z0-9]+)*$'
      )`,
  );
  return result.rows[0]?.["invalid_count"] === "0"
    ? []
    : ["Every project workspace slug must be a safe bounded base owned by its UUID suffix."];
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
    `select
       index_relation.relname as index_name,
       table_relation.relname as table_name,
       index_record.indisvalid,
       index_record.indisready,
       index_record.indisunique,
       coalesce(pg_get_expr(index_record.indpred, index_record.indrelid), '') as predicate,
       pg_get_indexdef(index_record.indexrelid) as definition
       from pg_index index_record
       join pg_class index_relation on index_relation.oid = index_record.indexrelid
       join pg_class table_relation on table_relation.oid = index_record.indrelid
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
  return [...missing, ...superseded, ...validateRequiredIndexShapes(result.rows)];
}

function validateRequiredIndexShapes(rows: readonly Record<string, unknown>[]): string[] {
  return [
    ...validateMessageTranscriptIndexShapes(rows),
    ...validateActivationIndexShapes(rows),
    ...validateLifecycleIndexShapes(rows),
    ...validateNamedIndexShape(rows, "v2_generated_outputs_agent_run_idx", "agent_run_id", ""),
    ...validateArtifactIntentIndexShapes(rows),
    ...validateNamedIndexShape(
      rows,
      "v2_projects_deletion_queue_idx",
      "deleted_at,id",
      "deleted_atisnotnull",
    ),
    ...validateNamedIndexShape(rows, "v2_threads_project_delete_idx", "user_id,project_id,id", ""),
    ...validateNamedIndexShape(
      rows,
      "v2_threads_deletion_queue_idx",
      "deleted_at,id",
      "deleted_atisnotnull",
    ),
    ...validateNamedIndexShape(
      rows,
      "v2_agent_runs_thread_delete_page_idx",
      "user_id,thread_id,id",
      "",
    ),
    ...validateNamedIndexShape(
      rows,
      "v2_resource_deletion_jobs_generation_uidx",
      "kind,resource_id,generation",
      "",
    ),
    ...validateNamedIndexShape(rows, "v2_resource_deletion_jobs_user_idx", "user_id", ""),
    ...validateNamedIndexShape(
      rows,
      "v2_resource_deletion_jobs_ready_idx",
      "next_attempt_at,id",
      "status='queued'::text",
    ),
    ...validateNamedIndexShape(
      rows,
      "v2_resource_deletion_jobs_lease_idx",
      "lease_expires_at,id",
      "status='leased'::text",
    ),
  ];
}

function validateArtifactIntentIndexShapes(rows: readonly Record<string, unknown>[]): string[] {
  return [
    ...validateNamedIndexShape(
      rows,
      "v2_artifact_upload_intents_cleanup_idx",
      "cleanup_not_before,quiesced_at,id",
      "quiesced_atisnotnull",
    ),
    ...validateNamedIndexShape(rows, "v2_artifact_upload_intents_user_idx", "user_id,id", ""),
    ...validateNamedIndexShape(
      rows,
      "v2_artifact_upload_intents_project_idx",
      "user_id,project_id,id",
      "",
    ),
    ...validateNamedIndexShape(
      rows,
      "v2_artifact_upload_intents_run_idx",
      "user_id,agent_run_id,id",
      "",
    ),
  ];
}

function validateLifecycleIndexShapes(rows: readonly Record<string, unknown>[]): string[] {
  return [
    ...validateNamedIndexShape(
      rows,
      "v2_messages_thread_page_idx",
      "user_id,thread_id,created_at,agent_run_segment,id",
      "",
      { tableName: "v2_messages", unique: false },
    ),
    ...validateNamedIndexShape(
      rows,
      "v2_agent_runs_user_finished_idx",
      "user_id,finished_at",
      "finished_atisnotnull",
      { tableName: "v2_agent_runs", unique: false },
    ),
    ...validateNamedIndexShape(
      rows,
      "v2_entitlements_polar_subscription_uidx",
      "polar_subscription_id",
      "polar_subscription_idisnotnull",
      { tableName: "v2_entitlements", unique: true },
    ),
    ...validateNamedIndexShape(
      rows,
      "v2_threads_active_run_idx",
      "active_run_id",
      "active_run_idisnotnull",
      { tableName: "v2_threads", unique: false },
    ),
    ...validateNamedIndexShape(
      rows,
      "v2_users_deletion_due_idx",
      "deleted_at,id",
      "deleted_atisnotnull",
      { tableName: "v2_users", unique: false },
    ),
    ...validateNamedIndexShape(
      rows,
      "v2_user_deletion_refund_intents_idempotency_uidx",
      "idempotency_key",
      "",
      { tableName: "v2_user_deletion_refund_intents", unique: true },
    ),
    ...validateNamedIndexShape(
      rows,
      "v2_user_deletion_refund_intents_provider_uidx",
      "provider_refund_id",
      "provider_refund_idisnotnull",
      { tableName: "v2_user_deletion_refund_intents", unique: true },
    ),
    ...validateNamedIndexShape(
      rows,
      "v2_user_deletion_refund_intents_unresolved_idx",
      "user_id,job_id",
      "provider_statusisdistinctfrom'succeeded'::text",
      { tableName: "v2_user_deletion_refund_intents", unique: false },
    ),
  ];
}

function validateActivationIndexShapes(rows: readonly Record<string, unknown>[]): string[] {
  return [
    ...validateNamedIndexShape(
      rows,
      "v2_agent_runs_user_started_idx",
      "user_id,started_atDESC",
      "",
    ),
    ...validateNamedIndexShape(
      rows,
      "v2_users_activation_created_idx",
      "created_at,id",
      "deleted_atisnull",
    ),
  ];
}

function validateMessageTranscriptIndexShapes(rows: readonly Record<string, unknown>[]): string[] {
  return [
    ...validateNamedIndexShape(
      rows,
      "v2_messages_agent_run_segment_assistant_uidx",
      "agent_run_id,agent_run_segment",
      "agent_run_idisnotnullandrole='assistant'::text",
    ),
    ...validateNamedIndexShape(
      rows,
      "v2_messages_agent_run_final_assistant_uidx",
      "agent_run_id",
      "agent_run_idisnotnullandrole='assistant'::textandagent_run_segment_final",
    ),
  ];
}

function validateNamedIndexShape(
  rows: readonly Record<string, unknown>[],
  name: string,
  columns: string,
  predicate: string,
  options: { tableName?: string; unique?: boolean } = {},
): string[] {
  return validateIndexShape(
    rows.find((row) => row["index_name"] === name),
    columns,
    predicate,
    name,
    options,
  );
}

function validateIndexShape(
  row: Record<string, unknown> | undefined,
  columns: string,
  predicate: string,
  label: string,
  options: { tableName?: string; unique?: boolean } = {},
): string[] {
  const definition = stringField(row ?? {}, "definition")?.replaceAll(/[\s"]/g, "") ?? "";
  const actualPredicate = String(row?.["predicate"] ?? "")
    .toLowerCase()
    .replaceAll(/[()\s"]/g, "");
  const hasExpectedTable =
    options.tableName === undefined || row?.["table_name"] === options.tableName;
  const hasExpectedUniqueness =
    options.unique === undefined || row?.["indisunique"] === options.unique;
  if (
    actualPredicate !== predicate ||
    !definition.includes(`USINGbtree(${columns})`) ||
    !hasExpectedTable ||
    !hasExpectedUniqueness
  ) {
    return [`The ${label} index has the wrong columns or predicate.`];
  }
  return [];
}
