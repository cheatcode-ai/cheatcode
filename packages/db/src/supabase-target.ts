export interface QueryResult {
  rows: Record<string, unknown>[];
}

export interface PgClient {
  connect(): Promise<void>;
  end(): Promise<void>;
  query(text: string, values?: unknown[]): Promise<QueryResult>;
}

export type SupabaseTargetMode = "pre-migration" | "prod-ready";

interface ExpectedColumn {
  name: string;
  dataType?: string;
}

interface TableContract {
  tableName: string;
  columns: readonly ExpectedColumn[];
}

interface ColumnInfo {
  dataType: string;
}

const TABLE_CONTRACTS: readonly TableContract[] = [
  {
    tableName: "v2_users",
    columns: [
      { name: "id", dataType: "uuid" },
      { name: "clerk_id", dataType: "text" },
      { name: "email", dataType: "text" },
      { name: "display_name", dataType: "text" },
      { name: "avatar_url", dataType: "text" },
    ],
  },
  {
    tableName: "v2_user_profiles",
    columns: [
      { name: "user_id", dataType: "uuid" },
      { name: "agent_display_name", dataType: "text" },
      { name: "global_memory", dataType: "text" },
      { name: "appbuilder_default_model", dataType: "text" },
      { name: "general_default_model", dataType: "text" },
      { name: "appbuilder_default_budget_usd", dataType: "numeric" },
      { name: "general_default_budget_usd", dataType: "numeric" },
      { name: "disabled_models", dataType: "jsonb" },
      { name: "onboarding_completed_at", dataType: "timestamp with time zone" },
      { name: "onboarding_state", dataType: "jsonb" },
    ],
  },
  {
    tableName: "v2_projects",
    columns: [
      { name: "id", dataType: "uuid" },
      { name: "user_id", dataType: "uuid" },
      { name: "name", dataType: "text" },
      { name: "mode", dataType: "text" },
      { name: "sandbox_id", dataType: "text" },
      { name: "container_backup", dataType: "jsonb" },
      { name: "over_quota", dataType: "boolean" },
      { name: "archived_pending_action", dataType: "boolean" },
      { name: "archive_after", dataType: "timestamp with time zone" },
    ],
  },
  {
    tableName: "v2_threads",
    columns: [
      { name: "id", dataType: "uuid" },
      { name: "project_id", dataType: "uuid" },
      { name: "user_id", dataType: "uuid" },
    ],
  },
  {
    tableName: "v2_messages",
    columns: [
      { name: "id", dataType: "uuid" },
      { name: "thread_id", dataType: "uuid" },
      { name: "user_id", dataType: "uuid" },
      { name: "role", dataType: "text" },
      { name: "parts", dataType: "jsonb" },
    ],
  },
  {
    tableName: "v2_agent_runs",
    columns: [
      { name: "id", dataType: "uuid" },
      { name: "thread_id", dataType: "uuid" },
      { name: "user_id", dataType: "uuid" },
      { name: "status", dataType: "text" },
      { name: "config", dataType: "jsonb" },
    ],
  },
  {
    tableName: "v2_provider_keys",
    columns: [
      { name: "id", dataType: "uuid" },
      { name: "user_id", dataType: "uuid" },
      { name: "provider", dataType: "text" },
      { name: "vault_secret_id", dataType: "uuid" },
      { name: "fingerprint", dataType: "text" },
      { name: "disabled_at", dataType: "timestamp with time zone" },
      { name: "disabled_reason", dataType: "text" },
    ],
  },
  {
    tableName: "v2_user_integrations",
    columns: [
      { name: "user_id", dataType: "uuid" },
      { name: "integration", dataType: "text" },
      { name: "composio_connection_id", dataType: "text" },
      { name: "status", dataType: "text" },
    ],
  },
  {
    tableName: "v2_generated_outputs",
    columns: [
      { name: "id", dataType: "uuid" },
      { name: "user_id", dataType: "uuid" },
      { name: "kind", dataType: "text" },
      { name: "r2_bucket", dataType: "text" },
      { name: "r2_key", dataType: "text" },
      { name: "mime_type", dataType: "text" },
      { name: "size_bytes", dataType: "bigint" },
    ],
  },
  {
    tableName: "v2_usage_events",
    columns: [
      { name: "id", dataType: "uuid" },
      { name: "user_id", dataType: "uuid" },
      { name: "event_type", dataType: "text" },
      { name: "cost_usd", dataType: "numeric" },
    ],
  },
  {
    tableName: "v2_usage_daily_totals",
    columns: [
      { name: "user_id", dataType: "uuid" },
      { name: "day", dataType: "date" },
      { name: "total_input_tokens", dataType: "bigint" },
      { name: "total_output_tokens", dataType: "bigint" },
      { name: "total_cost_usd", dataType: "numeric" },
    ],
  },
  {
    tableName: "v2_entitlements",
    columns: [
      { name: "user_id", dataType: "uuid" },
      { name: "tier", dataType: "text" },
      { name: "subscription_status", dataType: "text" },
      { name: "cancel_at_period_end", dataType: "boolean" },
      { name: "max_projects", dataType: "integer" },
      { name: "quota_sandbox_hours", dataType: "numeric" },
      { name: "quota_composio_calls", dataType: "integer" },
    ],
  },
  {
    tableName: "v2_billing_events",
    columns: [
      { name: "id", dataType: "uuid" },
      { name: "event_type", dataType: "text" },
      { name: "polar_event_id", dataType: "text" },
      { name: "payload", dataType: "jsonb" },
    ],
  },
  {
    tableName: "v2_audit_log",
    columns: [
      { name: "id", dataType: "uuid" },
      { name: "user_id", dataType: "uuid" },
      { name: "action", dataType: "text" },
      { name: "metadata", dataType: "jsonb" },
      { name: "created_at", dataType: "timestamp with time zone" },
    ],
  },
] as const;

export class SupabaseTargetError extends Error {
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

export async function validateSupabaseTarget(
  client: PgClient,
  mode: SupabaseTargetMode,
): Promise<string[]> {
  const [tables, publicTableNames] = await Promise.all([
    loadPublicColumns(client),
    loadPublicTableNames(client),
  ]);
  return [
    ...validateMigrationPresence(mode, publicTableNames),
    ...validateColumns(mode, tables),
    ...(await validateAppWorker(client, mode)),
  ];
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
    `select table_name, column_name, data_type
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
    if (!tableName || !columnName || !dataType) {
      continue;
    }
    const columns = tables.get(tableName) ?? new Map<string, ColumnInfo>();
    columns.set(columnName, { dataType });
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
    return contract.columns.flatMap((expected) => validateColumn(contract, expected, columns));
  });
}

function validateMigrationPresence(
  mode: SupabaseTargetMode,
  publicTableNames: Set<string>,
): string[] {
  if (mode !== "pre-migration") {
    return [];
  }

  const expectedTableNames = TABLE_CONTRACTS.map((contract) => contract.tableName);
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
  contract: TableContract,
  expected: ExpectedColumn,
  columns: Map<string, ColumnInfo>,
): string[] {
  const actual = columns.get(expected.name);
  if (!actual) {
    return [`public.${contract.tableName}.${expected.name} is missing.`];
  }
  if (expected.dataType && actual.dataType !== expected.dataType) {
    return [
      `public.${contract.tableName}.${expected.name} must be ${expected.dataType}, got ${actual.dataType}.`,
    ];
  }
  return [];
}

async function validateAppWorker(client: PgClient, mode: SupabaseTargetMode): Promise<string[]> {
  if (mode !== "prod-ready") {
    return [];
  }
  const result = await client.query("select 1 from pg_roles where rolname = 'app_worker'");
  return result.rows.length === 0 ? ["Postgres role app_worker is missing."] : [];
}
