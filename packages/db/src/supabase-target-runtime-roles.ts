import {
  FUNCTION_CONTRACTS,
  functionIdentity,
  RUNTIME_DATABASE_ROLES,
  type RuntimeDatabaseRole,
} from "./supabase-target-contracts";
import {
  aclIdentity,
  functionAclIdentity,
  normalizeExpression,
  stringField,
  validateExactAcl,
  validateRuntimeRoleRow,
} from "./supabase-target-runtime-role-utils";

interface QueryResult {
  rows: Record<string, unknown>[];
}

interface TargetQueryClient {
  query(text: string, values?: unknown[]): Promise<QueryResult>;
}

type TablePrivilege = "DELETE" | "INSERT" | "SELECT";
type ColumnPrivilege = "INSERT" | "SELECT" | "UPDATE";
type PolicyRole = RuntimeDatabaseRole | "postgres";

interface TableGrantGroup {
  privilege: TablePrivilege;
  role: RuntimeDatabaseRole;
  tables: readonly string[];
}

interface ColumnGrantGroup {
  columns: readonly string[];
  privilege: ColumnPrivilege;
  role: RuntimeDatabaseRole;
  table: string;
}

interface PolicyContract {
  command: "ALL" | "DELETE" | "INSERT" | "SELECT" | "UPDATE";
  forceRls: boolean;
  name: string;
  permissive: "PERMISSIVE";
  roles: readonly PolicyRole[];
  table: string;
  usingExpression: string;
  withCheckExpression: string;
}

const ACTIVE_RUNTIME_ROLES = ["app_gateway", "app_agent", "app_webhooks"] as const;
const TABLE_GRANT_GROUPS: readonly TableGrantGroup[] = [
  {
    privilege: "SELECT",
    role: "app_gateway",
    tables: [
      "v2_entitlements",
      "v2_messages",
      "v2_projects",
      "v2_threads",
      "v2_user_integrations",
      "v2_user_profiles",
      "v2_user_skills",
    ],
  },
  {
    privilege: "INSERT",
    role: "app_gateway",
    tables: [
      "v2_entitlements",
      "v2_projects",
      "v2_threads",
      "v2_user_integrations",
      "v2_user_profiles",
      "v2_user_skills",
    ],
  },
  {
    privilege: "DELETE",
    role: "app_gateway",
    tables: ["v2_user_integrations", "v2_user_skills"],
  },
  {
    privilege: "SELECT",
    role: "app_agent",
    tables: ["v2_messages", "v2_projects", "v2_threads", "v2_user_skills"],
  },
  {
    privilege: "INSERT",
    role: "app_agent",
    tables: [
      "v2_agent_runs",
      "v2_generated_outputs",
      "v2_messages",
      "v2_projects",
      "v2_user_skills",
    ],
  },
  {
    privilege: "DELETE",
    role: "app_agent",
    tables: ["v2_artifact_upload_intents"],
  },
  {
    privilege: "SELECT",
    role: "app_webhooks",
    tables: [
      "v2_entitlements",
      "v2_resource_deletion_jobs",
      "v2_retention_jobs",
      "v2_user_deletion_jobs",
      "v2_user_deletion_refund_intents",
    ],
  },
  {
    privilege: "INSERT",
    role: "app_webhooks",
    tables: ["v2_entitlements", "v2_resource_deletion_jobs", "v2_user_deletion_jobs"],
  },
  {
    privilege: "DELETE",
    role: "app_webhooks",
    tables: [
      "v2_artifact_upload_intents",
      "v2_generated_outputs",
      "v2_projects",
      "v2_resource_deletion_jobs",
      "v2_retention_jobs",
      "v2_threads",
      "v2_user_deletion_jobs",
    ],
  },
];

const COLUMN_GRANT_GROUPS: readonly ColumnGrantGroup[] = [
  columnGrant("SELECT", "app_gateway", "v2_users", [
    "avatar_url",
    "clerk_id",
    "deleted_at",
    "deletion_fence",
    "display_name",
    "email",
    "id",
    "polar_customer_id",
  ]),
  columnGrant("SELECT", "app_gateway", "v2_agent_runs", [
    "finished_at",
    "id",
    "started_at",
    "status",
    "user_id",
  ]),
  columnGrant("SELECT", "app_gateway", "v2_provider_keys", [
    "created_at",
    "disabled_at",
    "disabled_reason",
    "provider",
    "user_id",
  ]),
  columnGrant("SELECT", "app_agent", "v2_users", [
    "deleted_at",
    "deletion_fence",
    "first_artifact_at",
    "id",
  ]),
  columnGrant("SELECT", "app_agent", "v2_entitlements", [
    "current_period_end",
    "current_period_start",
    "subscription_status",
    "tier",
    "updated_at",
    "user_id",
  ]),
  columnGrant("SELECT", "app_agent", "v2_agent_runs", [
    "id",
    "idempotency_key_hash",
    "model_id",
    "request_body_hash",
    "status",
    "thread_id",
    "user_id",
  ]),
  columnGrant("SELECT", "app_agent", "v2_generated_outputs", [
    "agent_run_id",
    "filename",
    "id",
    "mime_type",
    "r2_key",
    "user_id",
  ]),
  columnGrant("SELECT", "app_agent", "v2_artifact_upload_intents", [
    "agent_run_id",
    "cleanup_not_before",
    "id",
    "project_id",
    "quiesced_at",
    "r2_key",
    "user_id",
  ]),
  columnGrant("INSERT", "app_agent", "v2_artifact_upload_intents", [
    "agent_run_id",
    "cleanup_not_before",
    "id",
    "project_id",
    "r2_key",
    "user_id",
  ]),
  columnGrant("SELECT", "app_agent", "v2_user_profiles", [
    "agent_display_name",
    "disabled_models",
    "global_memory",
    "user_id",
  ]),
  columnGrant("SELECT", "app_agent", "v2_user_integrations", [
    "composio_connection_id",
    "integration",
    "is_default",
    "status",
    "updated_at",
    "user_id",
  ]),
  columnGrant("SELECT", "app_webhooks", "v2_users", [
    "avatar_url",
    "clerk_id",
    "created_at",
    "deleted_at",
    "deletion_fence",
    "display_name",
    "email",
    "id",
    "polar_customer_id",
  ]),
  columnGrant("SELECT", "app_webhooks", "v2_agent_runs", [
    "finished_at",
    "id",
    "started_at",
    "status",
    "thread_id",
    "user_id",
  ]),
  columnGrant("SELECT", "app_webhooks", "v2_generated_outputs", [
    "agent_run_id",
    "id",
    "r2_key",
    "user_id",
  ]),
  columnGrant("SELECT", "app_webhooks", "v2_artifact_upload_intents", [
    "agent_run_id",
    "cleanup_not_before",
    "id",
    "project_id",
    "quiesced_at",
    "r2_key",
    "user_id",
  ]),
  columnGrant("SELECT", "app_webhooks", "v2_projects", [
    "archive_after",
    "created_at",
    "deleted_at",
    "id",
    "name",
    "over_quota",
    "updated_at",
    "user_id",
    "workspace_slug",
  ]),
  columnGrant("SELECT", "app_webhooks", "v2_threads", [
    "active_run_id",
    "deleted_at",
    "id",
    "project_id",
    "user_id",
  ]),
  columnGrant("SELECT", "app_webhooks", "v2_provider_keys", [
    "created_at",
    "disabled_at",
    "disabled_reason",
    "fingerprint",
    "provider",
    "revalidation_claimed_at",
    "revalidation_lease_token",
    "user_id",
  ]),
  columnGrant("SELECT", "app_webhooks", "v2_user_integrations", [
    "composio_connection_id",
    "integration",
    "is_default",
    "status",
    "updated_at",
    "user_id",
  ]),
  columnGrant("UPDATE", "app_gateway", "v2_users", ["display_name"]),
  columnGrant("UPDATE", "app_gateway", "v2_entitlements", [
    "cancel_at_period_end",
    "current_period_end",
    "current_period_start",
    "polar_subscription_id",
    "subscription_status",
    "updated_at",
  ]),
  columnGrant("UPDATE", "app_gateway", "v2_projects", [
    "deleted_at",
    "name",
    "settings",
    "updated_at",
  ]),
  columnGrant("UPDATE", "app_gateway", "v2_threads", [
    "deleted_at",
    "latest_model_id",
    "title",
    "updated_at",
  ]),
  columnGrant("UPDATE", "app_gateway", "v2_provider_keys", ["disabled_at", "disabled_reason"]),
  columnGrant("UPDATE", "app_gateway", "v2_user_integrations", ["is_default", "status"]),
  columnGrant("UPDATE", "app_gateway", "v2_user_profiles", [
    "agent_display_name",
    "disabled_models",
    "global_memory",
    "onboarding_completed_at",
    "onboarding_state",
  ]),
  columnGrant("UPDATE", "app_gateway", "v2_user_skills", [
    "body",
    "category",
    "description",
    "tags",
    "updated_at",
  ]),
  columnGrant("UPDATE", "app_agent", "v2_users", ["first_artifact_at"]),
  columnGrant("UPDATE", "app_agent", "v2_threads", [
    "active_run_id",
    "latest_model_id",
    "launch_intent",
    "project_id",
    "updated_at",
  ]),
  columnGrant("UPDATE", "app_agent", "v2_agent_runs", ["finished_at", "model_id", "status"]),
  columnGrant("UPDATE", "app_agent", "v2_artifact_upload_intents", [
    "cleanup_not_before",
    "quiesced_at",
  ]),
  columnGrant("UPDATE", "app_agent", "v2_user_skills", [
    "body",
    "category",
    "description",
    "tags",
    "updated_at",
  ]),
  columnGrant("UPDATE", "app_webhooks", "v2_users", [
    "deleted_at",
    "deletion_fence",
    "polar_customer_id",
  ]),
  columnGrant("UPDATE", "app_webhooks", "v2_entitlements", [
    "cancel_at_period_end",
    "current_period_end",
    "current_period_start",
    "polar_subscription_id",
    "subscription_status",
    "tier",
    "updated_at",
  ]),
  columnGrant("UPDATE", "app_webhooks", "v2_projects", [
    "archive_after",
    "deleted_at",
    "over_quota",
    "updated_at",
    "workspace_slug",
  ]),
  columnGrant("UPDATE", "app_webhooks", "v2_threads", [
    "active_run_id",
    "deleted_at",
    "updated_at",
  ]),
  columnGrant("UPDATE", "app_webhooks", "v2_provider_keys", [
    "disabled_at",
    "disabled_reason",
    "last_revalidated_at",
    "revalidation_claimed_at",
    "revalidation_lease_token",
  ]),
  columnGrant("UPDATE", "app_webhooks", "v2_resource_deletion_jobs", [
    "continuation",
    "cursor",
    "failure_count",
    "last_error_code",
    "lease_expires_at",
    "lease_token",
    "next_attempt_at",
    "phase",
    "status",
  ]),
  columnGrant("UPDATE", "app_webhooks", "v2_user_deletion_jobs", [
    "continuation",
    "cursor",
    "failure_count",
    "last_error_code",
    "lease_expires_at",
    "lease_token",
    "next_attempt_at",
    "phase",
    "status",
  ]),
  columnGrant("INSERT", "app_webhooks", "v2_retention_jobs", ["day", "scheduled_at"]),
  columnGrant("UPDATE", "app_webhooks", "v2_retention_jobs", [
    "activation_cursor_event",
    "activation_cursor_user_id",
    "completed_at",
    "continuation",
    "failure_count",
    "last_error_code",
    "lease_expires_at",
    "lease_token",
    "next_attempt_at",
    "phase",
    "release_version_id",
    "status",
  ]),
];

const FORCE_RLS_TABLES = [
  "v2_agent_runs",
  "v2_artifact_upload_intents",
  "v2_audit_log",
  "v2_deleted_clerk_identities",
  "v2_entitlements",
  "v2_generated_outputs",
  "v2_messages",
  "v2_projects",
  "v2_provider_keys",
  "v2_resource_deletion_jobs",
  "v2_retention_jobs",
  "v2_user_deletion_jobs",
  "v2_user_deletion_refund_intents",
  "v2_threads",
  "v2_user_integrations",
  "v2_user_profiles",
  "v2_user_skills",
  "v2_users",
] as const;

const OWN_USER_EXPRESSION = "(user_id = ( SELECT current_app_user() AS current_app_user))";
const OWN_USER_ID_EXPRESSION = "(id = ( SELECT current_app_user() AS current_app_user))";
const POLICY_CONTRACTS: readonly PolicyContract[] = [
  ...FORCE_RLS_TABLES.map(postgresPolicy),
  ownPolicy("v2_users", "SELECT", ["app_gateway", "app_agent", "app_webhooks"], true),
  ownPolicy("v2_users", "UPDATE", ["app_gateway", "app_agent", "app_webhooks"], true),
  ownPolicy("v2_entitlements", "SELECT", ["app_gateway", "app_agent", "app_webhooks"]),
  ownPolicy("v2_entitlements", "INSERT", ["app_gateway", "app_webhooks"]),
  ownPolicy("v2_entitlements", "UPDATE", ["app_gateway", "app_webhooks"]),
  ownPolicy("v2_user_profiles", "SELECT", ["app_gateway", "app_agent"]),
  ownPolicy("v2_user_profiles", "INSERT", ["app_gateway"]),
  ownPolicy("v2_user_profiles", "UPDATE", ["app_gateway"]),
  ownPolicy("v2_projects", "SELECT", ["app_gateway", "app_agent", "app_webhooks"]),
  ownPolicy("v2_projects", "INSERT", ["app_gateway", "app_agent"]),
  ownPolicy("v2_projects", "UPDATE", ["app_gateway", "app_webhooks"]),
  ownPolicy("v2_projects", "DELETE", ["app_webhooks"]),
  ownPolicy("v2_threads", "SELECT", ["app_gateway", "app_agent", "app_webhooks"]),
  ownPolicy("v2_threads", "INSERT", ["app_gateway"]),
  ownPolicy("v2_threads", "UPDATE", ["app_gateway", "app_agent", "app_webhooks"]),
  ownPolicy("v2_threads", "DELETE", ["app_webhooks"]),
  ownPolicy("v2_messages", "SELECT", ["app_gateway", "app_agent"]),
  ownPolicy("v2_messages", "INSERT", ["app_agent"]),
  ownPolicy("v2_agent_runs", "SELECT", ["app_gateway", "app_agent", "app_webhooks"]),
  ownPolicy("v2_agent_runs", "INSERT", ["app_agent"]),
  ownPolicy("v2_agent_runs", "UPDATE", ["app_agent"]),
  ownPolicy("v2_generated_outputs", "SELECT", ["app_agent", "app_webhooks"]),
  ownPolicy("v2_generated_outputs", "INSERT", ["app_agent"]),
  ownPolicy("v2_generated_outputs", "DELETE", ["app_webhooks"]),
  ownPolicy("v2_artifact_upload_intents", "SELECT", ["app_agent"]),
  ownPolicy("v2_artifact_upload_intents", "INSERT", ["app_agent"]),
  ownPolicy("v2_artifact_upload_intents", "UPDATE", ["app_agent"]),
  ownPolicy("v2_artifact_upload_intents", "DELETE", ["app_agent"]),
  maintenancePolicy("v2_artifact_upload_intents", "SELECT"),
  maintenancePolicy("v2_artifact_upload_intents", "DELETE"),
  ownPolicy("v2_user_skills", "SELECT", ["app_gateway", "app_agent"]),
  ownPolicy("v2_user_skills", "INSERT", ["app_gateway", "app_agent"]),
  ownPolicy("v2_user_skills", "UPDATE", ["app_gateway", "app_agent"]),
  ownPolicy("v2_user_skills", "DELETE", ["app_gateway"]),
  ownPolicy("v2_user_integrations", "SELECT", ["app_gateway", "app_agent", "app_webhooks"]),
  ownPolicy("v2_user_integrations", "INSERT", ["app_gateway"]),
  ownPolicy("v2_user_integrations", "UPDATE", ["app_gateway"]),
  ownPolicy("v2_user_integrations", "DELETE", ["app_gateway"]),
  ownPolicy("v2_resource_deletion_jobs", "SELECT", ["app_webhooks"]),
  ownPolicy("v2_resource_deletion_jobs", "INSERT", ["app_webhooks"]),
  ownPolicy("v2_resource_deletion_jobs", "UPDATE", ["app_webhooks"]),
  ownPolicy("v2_resource_deletion_jobs", "DELETE", ["app_webhooks"]),
  ownPolicy("v2_user_deletion_jobs", "SELECT", ["app_webhooks"]),
  ownPolicy("v2_user_deletion_jobs", "INSERT", ["app_webhooks"]),
  ownPolicy("v2_user_deletion_jobs", "UPDATE", ["app_webhooks"]),
  ownPolicy("v2_user_deletion_jobs", "DELETE", ["app_webhooks"]),
  ownPolicy("v2_user_deletion_refund_intents", "SELECT", ["app_webhooks"]),
  maintenancePolicy("v2_retention_jobs", "SELECT"),
  maintenancePolicy("v2_retention_jobs", "INSERT"),
  maintenancePolicy("v2_retention_jobs", "UPDATE"),
  maintenancePolicy("v2_retention_jobs", "DELETE"),
  ownPolicy("v2_provider_keys", "SELECT", ["app_gateway", "app_webhooks"]),
  ownPolicy("v2_provider_keys", "UPDATE", ["app_gateway", "app_webhooks"]),
];

function postgresPolicy(table: (typeof FORCE_RLS_TABLES)[number]): PolicyContract {
  return {
    command: "ALL",
    forceRls: true,
    name: `${table}_postgres_all`,
    permissive: "PERMISSIVE",
    roles: ["postgres"],
    table,
    usingExpression: "true",
    withCheckExpression: "true",
  };
}

function ownPolicy(
  table: string,
  command: Exclude<PolicyContract["command"], "ALL">,
  roles: readonly RuntimeDatabaseRole[],
  usesPrimaryId = false,
): PolicyContract {
  const expression = usesPrimaryId ? OWN_USER_ID_EXPRESSION : OWN_USER_EXPRESSION;
  return {
    command,
    forceRls: true,
    name: `${table}_${command.toLowerCase()}_own`,
    permissive: "PERMISSIVE",
    roles,
    table,
    usingExpression: command === "INSERT" ? "" : expression,
    withCheckExpression: command === "INSERT" || command === "UPDATE" ? expression : "",
  };
}

function maintenancePolicy(
  table: string,
  command: Exclude<PolicyContract["command"], "ALL">,
): PolicyContract {
  return {
    command,
    forceRls: true,
    name: `${table}_${command.toLowerCase()}_maintenance`,
    permissive: "PERMISSIVE",
    roles: ["app_webhooks"],
    table,
    usingExpression: command === "INSERT" ? "" : "true",
    withCheckExpression: command === "INSERT" || command === "UPDATE" ? "true" : "",
  };
}

export async function validateRuntimeRoleTarget(client: TargetQueryClient): Promise<string[]> {
  const checks = [
    await validateRoleAttributes(client),
    await validateRoleMemberships(client),
    await validateDatabaseGrants(client),
    await validateSchemaGrants(client),
    await validateTableGrants(client),
    await validateColumnGrants(client),
    await validateFunctionGrants(client),
    await validatePolicies(client),
  ];
  return checks.flat();
}

async function validateRoleAttributes(client: TargetQueryClient): Promise<string[]> {
  const result = await client.query(
    `select role.rolname, role.rolcanlogin, role.rolinherit, role.rolsuper,
            role.rolcreatedb, role.rolcreaterole, role.rolreplication, role.rolbypassrls,
            role.rolconfig = array['search_path=public, pg_catalog']::text[] as config_matches
       from pg_roles role
      where role.rolname = any($1::text[]) or role.rolname = 'app_worker'
      order by role.rolname`,
    [[...RUNTIME_DATABASE_ROLES]],
  );
  const rows = new Map(result.rows.map((row) => [stringField(row, "rolname"), row]));
  const issues = RUNTIME_DATABASE_ROLES.flatMap((role) =>
    validateRuntimeRoleRow(role, rows.get(role)),
  );
  if (rows.has("app_worker")) {
    issues.push("Historical Postgres role app_worker must be dropped after the role cutover.");
  }
  return issues;
}

async function validateRoleMemberships(client: TargetQueryClient): Promise<string[]> {
  const result = await client.query(
    `select granted.rolname as granted_role, member.rolname as member_role
       from pg_auth_members membership
       join pg_roles granted on granted.oid = membership.roleid
       join pg_roles member on member.oid = membership.member
      where granted.rolname = any($1::text[]) or member.rolname = any($1::text[])
      order by granted.rolname, member.rolname`,
    [[...RUNTIME_DATABASE_ROLES]],
  );
  return result.rows.map(
    (row) =>
      `Runtime role membership ${stringField(row, "granted_role")} -> ${stringField(row, "member_role")} must be revoked.`,
  );
}

async function validateDatabaseGrants(client: TargetQueryClient): Promise<string[]> {
  const result = await client.query(
    `select grantee.rolname as role_name, (entry).privilege_type as privilege,
            (entry).is_grantable as is_grantable
       from pg_database database_record
      cross join lateral aclexplode(
        coalesce(database_record.datacl, acldefault('d', database_record.datdba))
      ) entry
       join pg_roles grantee on grantee.oid = (entry).grantee
      where database_record.datname = current_database()
        and grantee.rolname = any($1::text[])`,
    [[...RUNTIME_DATABASE_ROLES]],
  );
  const expected = new Set(ACTIVE_RUNTIME_ROLES.map((role) => `${role}|CONNECT`));
  return validateExactAcl(result.rows, expected, "database", (row) =>
    aclIdentity(row, "role_name", undefined),
  );
}

async function validateSchemaGrants(client: TargetQueryClient): Promise<string[]> {
  const result = await client.query(
    `select role.rolname as role_name, namespace.nspname as object_name,
            privilege.name as privilege,
            has_schema_privilege(role.oid, namespace.oid, privilege.name) as allowed
       from pg_roles role
       join pg_namespace namespace on namespace.nspname = any($2::text[])
      cross join (values ('USAGE'), ('CREATE')) privilege(name)
      where role.rolname = any($1::text[])
      order by role.rolname, namespace.nspname, privilege.name`,
    [[...RUNTIME_DATABASE_ROLES], ["public", "extensions", "vault"]],
  );
  const actual = result.rows.filter((row) => row["allowed"] === true);
  const expected = new Set(ACTIVE_RUNTIME_ROLES.map((role) => `${role}|public|USAGE`));
  return validateExactAcl(actual, expected, "schema", (row) =>
    aclIdentity(row, "role_name", "object_name"),
  );
}

async function validateTableGrants(client: TargetQueryClient): Promise<string[]> {
  const result = await client.query(
    `select grantee.rolname as role_name, relation.relname as object_name,
            (entry).privilege_type as privilege, (entry).is_grantable as is_grantable
       from pg_class relation
       join pg_namespace namespace on namespace.oid = relation.relnamespace
      cross join lateral aclexplode(relation.relacl) entry
       join pg_roles grantee on grantee.oid = (entry).grantee
      where namespace.nspname = 'public'
        and relation.relkind in ('r', 'p', 'v', 'm', 'f', 'S')
        and relation.relacl is not null
        and grantee.rolname = any($1::text[])`,
    [[...RUNTIME_DATABASE_ROLES]],
  );
  return validateExactAcl(result.rows, expectedTableGrants(), "table", (row) =>
    aclIdentity(row, "role_name", "object_name"),
  );
}

async function validateColumnGrants(client: TargetQueryClient): Promise<string[]> {
  const result = await client.query(
    `select grantee.rolname as role_name, relation.relname as object_name,
            attribute.attname as column_name, (entry).privilege_type as privilege,
            (entry).is_grantable as is_grantable
       from pg_attribute attribute
       join pg_class relation on relation.oid = attribute.attrelid
       join pg_namespace namespace on namespace.oid = relation.relnamespace
      cross join lateral aclexplode(attribute.attacl) entry
       join pg_roles grantee on grantee.oid = (entry).grantee
      where namespace.nspname = 'public' and attribute.attnum > 0 and not attribute.attisdropped
        and attribute.attacl is not null
        and grantee.rolname = any($1::text[])`,
    [[...RUNTIME_DATABASE_ROLES]],
  );
  return validateExactAcl(
    result.rows,
    expectedColumnGrants(),
    "column",
    (row) =>
      `${aclIdentity(row, "role_name", "object_name")}|${stringField(row, "column_name") ?? "<unknown>"}`,
  );
}

async function validateFunctionGrants(client: TargetQueryClient): Promise<string[]> {
  const result = await client.query(
    `select role.rolname as role_name, procedure.proname,
            oidvectortypes(procedure.proargtypes) as arguments,
            has_function_privilege(role.oid, procedure.oid, 'EXECUTE') as allowed
       from pg_roles role
       join pg_proc procedure on true
       join pg_namespace namespace on namespace.oid = procedure.pronamespace
       left join pg_depend extension_dependency
         on extension_dependency.classid = 'pg_proc'::regclass
        and extension_dependency.objid = procedure.oid and extension_dependency.deptype = 'e'
      where role.rolname = any($1::text[]) and namespace.nspname = 'public'
        and extension_dependency.objid is null`,
    [[...RUNTIME_DATABASE_ROLES]],
  );
  const actual = result.rows.filter((row) => row["allowed"] === true);
  return validateExactAcl(actual, expectedFunctionGrants(), "function", functionAclIdentity);
}

async function validatePolicies(client: TargetQueryClient): Promise<string[]> {
  const result = await client.query(
    `select policyname, tablename as table_name, cmd, permissive,
            array_to_string(roles, ',') as roles,
            coalesce(qual, '') as using_expression,
            coalesce(with_check, '') as with_check_expression
       from pg_policies
      where schemaname = 'public' and tablename = any($1::text[])
      order by tablename, policyname`,
    [[...FORCE_RLS_TABLES]],
  );
  const actual = new Map(result.rows.map((row) => [stringField(row, "policyname"), row]));
  const issues = unexpectedPolicies(actual);
  for (const contract of POLICY_CONTRACTS) {
    issues.push(...validatePolicy(contract, actual.get(contract.name)));
  }
  issues.push(...(await validatePolicyTableRls(client)));
  return issues;
}

function validatePolicy(
  contract: PolicyContract,
  row: Record<string, unknown> | undefined,
): string[] {
  if (!row) {
    return [`Required RLS policy ${contract.name} is missing.`];
  }
  const roles = (stringField(row, "roles") ?? "").split(",").filter(Boolean).sort().join(",");
  const expectedRoles = [...contract.roles].sort().join(",");
  const matches =
    row["table_name"] === contract.table &&
    row["cmd"] === contract.command &&
    row["permissive"] === contract.permissive &&
    roles === expectedRoles &&
    normalizeExpression(stringField(row, "using_expression")) ===
      normalizeExpression(contract.usingExpression) &&
    normalizeExpression(stringField(row, "with_check_expression")) ===
      normalizeExpression(contract.withCheckExpression);
  return matches ? [] : [`RLS policy ${contract.name} does not match its exact service boundary.`];
}

async function validatePolicyTableRls(client: TargetQueryClient): Promise<string[]> {
  const result = await client.query(
    `select relation.relname, relation.relrowsecurity, relation.relforcerowsecurity
       from pg_class relation
       join pg_namespace namespace on namespace.oid = relation.relnamespace
      where namespace.nspname = 'public' and relation.relname = any($1::text[])`,
    [[...FORCE_RLS_TABLES]],
  );
  return POLICY_CONTRACTS.flatMap((contract) => {
    const row = result.rows.find((candidate) => candidate["relname"] === contract.table);
    if (row?.["relrowsecurity"] === true && row["relforcerowsecurity"] === contract.forceRls) {
      return [];
    }
    return [`public.${contract.table} has the wrong row-level-security enforcement mode.`];
  }).filter((issue, index, issues) => issues.indexOf(issue) === index);
}

function unexpectedPolicies(
  actual: ReadonlyMap<string | undefined, Record<string, unknown>>,
): string[] {
  const expected = new Set(POLICY_CONTRACTS.map(({ name }) => name));
  return [...actual.keys()]
    .filter((name): name is string => name !== undefined && !expected.has(name))
    .map((name) => `Unexpected runtime RLS policy ${name} must be removed.`);
}

function expectedTableGrants(): Set<string> {
  return new Set(
    TABLE_GRANT_GROUPS.flatMap(({ privilege, role, tables }) =>
      tables.map((table) => `${role}|${table}|${privilege}`),
    ),
  );
}

function expectedColumnGrants(): Set<string> {
  return new Set(
    COLUMN_GRANT_GROUPS.flatMap(({ columns, privilege, role, table }) =>
      columns.map((column) => `${role}|${table}|${privilege}|${column}`),
    ),
  );
}

function expectedFunctionGrants(): Set<string> {
  return new Set(
    FUNCTION_CONTRACTS.flatMap((contract) =>
      contract.executeRoles.map((role) => `${role}|${functionIdentity(contract)}|EXECUTE`),
    ),
  );
}

function columnGrant(
  privilege: ColumnPrivilege,
  role: RuntimeDatabaseRole,
  table: string,
  columns: readonly string[],
): ColumnGrantGroup {
  return { columns, privilege, role, table };
}
