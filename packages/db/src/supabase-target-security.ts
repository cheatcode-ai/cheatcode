import {
  EXPECTED_EXTENSIONS,
  EXPECTED_PUBLIC_TABLES,
  FUNCTION_CONTRACTS,
  functionIdentity,
  RUNTIME_DATABASE_ROLES,
} from "./supabase-target-contracts";
import { validateRuntimeRoleTarget } from "./supabase-target-runtime-roles";

interface QueryResult {
  rows: Record<string, unknown>[];
}

export interface TargetQueryClient {
  query(text: string, values?: unknown[]): Promise<QueryResult>;
}

const AUDIT_PARTITION_PATTERN = /^v2_audit_log_[0-9]{4}_(0[1-9]|1[0-2])$/;
const DATA_API_ROLES = ["anon", "authenticated", "service_role"] as const;
const CLOSED_DEFAULT_ACL_ROLES = [...DATA_API_ROLES, ...RUNTIME_DATABASE_ROLES] as const;
const PROVIDER_KEY_DESCRIPTION = "Cheatcode V2 BYOK provider key";
const EXTENSION_SCHEMAS = new Map([
  ["pg_cron", "pg_catalog"],
  ["pg_stat_statements", "extensions"],
  ["pgcrypto", "extensions"],
  ["plpgsql", "pg_catalog"],
  ["supabase_vault", "vault"],
  ["vector", "extensions"],
]);

export async function validateProductionSecurityTarget(
  client: TargetQueryClient,
): Promise<string[]> {
  const checks = [
    await validatePublicRelations(client),
    await validateExtensions(client),
    await validateCustomFunctions(client),
    await validateMastraRemoval(client),
    await validateDataApiPrivileges(client),
    await validateRuntimeRoleTarget(client),
    await validatePostgresDefaultPrivileges(client),
    await validateProviderKeyIdentity(client),
    await validateProviderVaultReferences(client),
    await validateAuditPartitionMaintenance(client),
    await validateAuditAccess(client),
    await validateTriggerSurface(client),
  ];
  return checks.flat();
}

async function validatePublicRelations(client: TargetQueryClient): Promise<string[]> {
  const result = await client.query(
    `select
       relation.relname,
       relation.relkind,
       owner.rolname as owner_name,
       exists (
         select 1 from pg_inherits inheritance
          where inheritance.inhrelid = relation.oid
            and inheritance.inhparent = 'public.v2_audit_log'::regclass
       ) as is_attached_audit_partition,
       exists (
         select 1 from public._audit_archive_manifest manifest
          where manifest.partition_name = relation.relname
            and manifest.state <> 'dropped'
       ) as is_archived_audit_partition
       from pg_class relation
       join pg_namespace namespace on namespace.oid = relation.relnamespace
       join pg_roles owner on owner.oid = relation.relowner
      where namespace.nspname = 'public'
        and relation.relkind in ('r', 'p', 'v', 'm', 'f', 'S')
      order by relation.relname`,
  );
  const issues: string[] = [];
  const actualTables = new Set<string>();
  for (const row of result.rows) {
    const validation = validatePublicRelationRow(row);
    issues.push(...validation.issues);
    if (validation.expectedTable) {
      actualTables.add(validation.expectedTable);
    }
  }
  for (const name of EXPECTED_PUBLIC_TABLES) {
    if (!actualTables.has(name)) {
      issues.push(`Required public table public.${name} is missing.`);
    }
  }
  return issues;
}

function validatePublicRelationRow(row: Record<string, unknown>): {
  expectedTable?: string;
  issues: string[];
} {
  const name = stringField(row, "relname");
  const kind = stringField(row, "relkind");
  if (!name || !kind) {
    return { issues: ["Unable to identify a public relation."] };
  }
  const ownerIssue =
    row["owner_name"] === "postgres"
      ? []
      : [`public.${name} must be owned by the postgres migration role.`];
  if ((kind === "r" || kind === "p") && EXPECTED_PUBLIC_TABLES.has(name)) {
    return { expectedTable: name, issues: ownerIssue };
  }
  if (kind !== "r" || !AUDIT_PARTITION_PATTERN.test(name)) {
    return { issues: [`Unexpected public relation ${name} (kind ${kind}) must be removed.`] };
  }
  const isTracked =
    row["is_attached_audit_partition"] === true || row["is_archived_audit_partition"] === true;
  return {
    issues: isTracked
      ? ownerIssue
      : [...ownerIssue, `Audit-shaped table public.${name} is neither attached nor archived.`],
  };
}

async function validateExtensions(client: TargetQueryClient): Promise<string[]> {
  const result = await client.query(
    `select extension.extname, namespace.nspname
       from pg_extension extension
       join pg_namespace namespace on namespace.oid = extension.extnamespace
      order by extension.extname`,
  );
  const actual = new Map(
    result.rows.map((row) => [stringField(row, "extname"), stringField(row, "nspname")]),
  );
  const missing = [...EXPECTED_EXTENSIONS]
    .filter((name) => !actual.has(name))
    .map((name) => `Required Postgres extension ${name} is missing.`);
  const unexpected = [...actual.keys()]
    .filter((name): name is string => name !== undefined)
    .filter((name) => !EXPECTED_EXTENSIONS.has(name))
    .map((name) => `Unused Postgres extension ${name} must be removed.`);
  const misplaced = [...EXTENSION_SCHEMAS]
    .filter(([name, schema]) => actual.has(name) && actual.get(name) !== schema)
    .map(([name, schema]) => `Postgres extension ${name} must be installed in schema ${schema}.`);
  return [...missing, ...unexpected, ...misplaced];
}

async function validateCustomFunctions(client: TargetQueryClient): Promise<string[]> {
  const result = await client.query(
    `select
       procedure.proname,
       oidvectortypes(procedure.proargtypes) as arguments,
       pg_get_function_result(procedure.oid) as result,
       procedure.prokind,
       procedure.prosecdef,
       owner.rolname as owner_name,
       language.lanname as language_name,
       encode(extensions.digest(procedure.prosrc, 'sha256'), 'hex') as source_hash,
       coalesce(array_to_string(procedure.proconfig, ','), '') as configuration
     from pg_proc procedure
     join pg_namespace namespace on namespace.oid = procedure.pronamespace
     join pg_roles owner on owner.oid = procedure.proowner
     join pg_language language on language.oid = procedure.prolang
     left join pg_depend extension_dependency
       on extension_dependency.classid = 'pg_proc'::regclass
      and extension_dependency.objid = procedure.oid
      and extension_dependency.deptype = 'e'
    where namespace.nspname = 'public'
      and extension_dependency.objid is null
    order by procedure.proname, arguments`,
  );
  const actual = new Map(result.rows.map((row) => [functionIdentityFromRow(row), row] as const));
  const expected = new Set(FUNCTION_CONTRACTS.map(functionIdentity));
  const issues = [...actual.keys()]
    .filter((identity) => !expected.has(identity))
    .map((identity) => `Unexpected custom function public.${identity} must be removed.`);
  for (const contract of FUNCTION_CONTRACTS) {
    issues.push(...validateFunctionContract(contract, actual.get(functionIdentity(contract))));
  }
  return issues;
}

function validateFunctionContract(
  contract: (typeof FUNCTION_CONTRACTS)[number],
  row: Record<string, unknown> | undefined,
): string[] {
  const identity = functionIdentity(contract);
  if (!row) {
    return [`Required custom function public.${identity} is missing.`];
  }
  const issues: string[] = [];
  if (row["prosecdef"] !== contract.securityDefiner) {
    issues.push(
      `public.${identity} must be ${contract.securityDefiner ? "SECURITY DEFINER" : "SECURITY INVOKER"}.`,
    );
  }
  if (row["prokind"] !== "f") {
    issues.push(`public.${identity} must be a function, not another routine kind.`);
  }
  if (row["owner_name"] !== "postgres") {
    issues.push(`public.${identity} must be owned by the postgres migration role.`);
  }
  if (row["result"] !== contract.result) {
    issues.push(`public.${identity} must return ${contract.result}.`);
  }
  if (contract.language && row["language_name"] !== contract.language) {
    issues.push(`public.${identity} must use language ${contract.language}.`);
  }
  if (contract.sourceHash && row["source_hash"] !== contract.sourceHash) {
    issues.push(`public.${identity} does not match its migration-owned implementation.`);
  }
  const mustLockSearchPath = contract.securityDefiner || contract.requiresLockedSearchPath;
  if (mustLockSearchPath && !hasLockedSearchPath(stringField(row, "configuration"))) {
    issues.push(`public.${identity} must pin an empty search_path.`);
  }
  return issues;
}

function hasLockedSearchPath(configuration: string | undefined): boolean {
  return configuration?.split(",").some((setting) => /^search_path=(""|)$/.test(setting)) === true;
}

function functionIdentityFromRow(row: Record<string, unknown>): string {
  return `${stringField(row, "proname") ?? "<unknown>"}(${stringField(row, "arguments") ?? ""})`;
}

async function validateMastraRemoval(client: TargetQueryClient): Promise<string[]> {
  const result = await client.query(
    `select exists (select 1 from pg_namespace where nspname = 'mastra') as schema_exists`,
  );
  return result.rows[0]?.["schema_exists"] === true
    ? ["Obsolete schema mastra and all of its persisted state must be removed."]
    : [];
}

async function validateDataApiPrivileges(client: TargetQueryClient): Promise<string[]> {
  const roleResult = await client.query(
    `select rolname from pg_roles where rolname = any($1::text[])`,
    [[...DATA_API_ROLES]],
  );
  const existingRoles = new Set(roleResult.rows.map((row) => stringField(row, "rolname")));
  const roleIssues = DATA_API_ROLES.filter((role) => !existingRoles.has(role)).map(
    (role) => `Required Supabase platform role ${role} is missing.`,
  );
  const tableResult = await client.query(
    `select role.rolname, relation.relname, privilege.name as privilege
       from pg_roles role
       join pg_class relation on relation.relkind in ('r', 'p', 'v', 'm', 'f')
       join pg_namespace namespace on namespace.oid = relation.relnamespace
      cross join (values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE')) privilege(name)
      where role.rolname = any($1::text[])
        and namespace.nspname = 'public'
        and has_table_privilege(role.oid, relation.oid, privilege.name)`,
    [[...DATA_API_ROLES]],
  );
  const functionResult = await client.query(
    `select role.rolname, procedure.oid::regprocedure::text as identity
       from pg_roles role
       join pg_proc procedure on true
       join pg_namespace namespace on namespace.oid = procedure.pronamespace
       left join pg_depend extension_dependency
         on extension_dependency.classid = 'pg_proc'::regclass
        and extension_dependency.objid = procedure.oid
        and extension_dependency.deptype = 'e'
      where role.rolname = any($1::text[])
        and namespace.nspname = 'public'
        and extension_dependency.objid is null
        and has_function_privilege(role.oid, procedure.oid, 'EXECUTE')`,
    [[...DATA_API_ROLES]],
  );
  return [
    ...roleIssues,
    ...tableResult.rows.map(
      (row) =>
        `Data API role ${stringField(row, "rolname")} retains ${stringField(row, "privilege")} on public.${stringField(row, "relname")}.`,
    ),
    ...functionResult.rows.map(
      (row) =>
        `Data API role ${stringField(row, "rolname")} retains EXECUTE on ${stringField(row, "identity")}.`,
    ),
  ];
}

async function validatePostgresDefaultPrivileges(client: TargetQueryClient): Promise<string[]> {
  const result = await client.query(
    `with object_types(object_type) as (
       values ('r'::"char"), ('S'::"char"), ('f'::"char")
     ), base_acl as (
       select object_types.object_type,
              coalesce(defaults.defaclacl, acldefault(object_types.object_type, owner.oid)) acl
         from pg_roles owner
        cross join object_types
         left join pg_default_acl defaults
           on defaults.defaclrole = owner.oid
          and defaults.defaclnamespace = 0
          and defaults.defaclobjtype = object_types.object_type
        where owner.rolname = 'postgres'
     ), scoped_acl as (
       select defaults.defaclobjtype as object_type, defaults.defaclacl as acl
         from pg_default_acl defaults
         join pg_roles owner on owner.oid = defaults.defaclrole
         join pg_namespace namespace on namespace.oid = defaults.defaclnamespace
        where owner.rolname = 'postgres' and namespace.nspname = 'public'
     ), effective_entries as (
       select object_type, aclexplode(acl) as entry from base_acl
       union all
       select object_type, aclexplode(acl) as entry from scoped_acl
     )
     select
       effective_entries.object_type::text,
       coalesce(grantee.rolname, case when (entry).grantee = 0 then 'PUBLIC' end) as grantee,
       (entry).privilege_type
     from effective_entries
     left join pg_roles grantee on grantee.oid = (entry).grantee
     where (entry).grantee = 0 or grantee.rolname = any($1::text[])`,
    [[...CLOSED_DEFAULT_ACL_ROLES]],
  );
  return result.rows.map(
    (row) =>
      `postgres default ACL for public object type ${stringField(row, "object_type")} grants ${stringField(row, "privilege_type")} to ${stringField(row, "grantee")}.`,
  );
}

async function validateProviderKeyIdentity(client: TargetQueryClient): Promise<string[]> {
  const result = await client.query(
    `select
       coalesce((
         select string_agg(attribute.attname, ',' order by key.ordinality)
           from pg_constraint constraint_record
          cross join lateral unnest(constraint_record.conkey) with ordinality key(attnum, ordinality)
           join pg_attribute attribute
             on attribute.attrelid = constraint_record.conrelid
            and attribute.attnum = key.attnum
          where constraint_record.conrelid = 'public.v2_provider_keys'::regclass
            and constraint_record.contype = 'p'
       ), '') as primary_key_columns,
       exists (
         select 1 from pg_constraint
          where conrelid = 'public.v2_provider_keys'::regclass
            and conname = 'v2_provider_keys_disabled_pair_check'
            and convalidated
       ) as disabled_pair_check,
       exists (
         select 1 from pg_constraint
          where conrelid = 'public.v2_provider_keys'::regclass
            and conname = 'v2_provider_keys_revalidation_lease_pair_check'
            and convalidated
       ) as revalidation_lease_pair_check`,
  );
  const issues: string[] = [];
  const row = result.rows[0];
  if (row?.["primary_key_columns"] !== "user_id,provider") {
    issues.push("public.v2_provider_keys must use (user_id, provider) as its primary key.");
  }
  if (row?.["disabled_pair_check"] !== true) {
    issues.push("public.v2_provider_keys must have a validated disabled timestamp/reason check.");
  }
  if (row?.["revalidation_lease_pair_check"] !== true) {
    issues.push("public.v2_provider_keys must have a validated revalidation lease-pair check.");
  }
  const indexes = await loadProviderIndexes(client);
  issues.push(...validateProviderIndexes(indexes));
  return issues;
}

async function loadProviderIndexes(client: TargetQueryClient): Promise<Map<string, IndexRow>> {
  const result = await client.query(
    `select
       index_relation.relname,
       index_record.indisunique,
       index_record.indisvalid,
       index_record.indisready,
       coalesce(pg_get_expr(index_record.indpred, index_record.indrelid), '') as predicate,
       string_agg(
         attribute.attname
           || case when (index_record.indoption[position.value] & 1) <> 0
                then ' DESC' else '' end
           || case when (index_record.indoption[position.value] & 2) <> 0
                then ' NULLS FIRST' else '' end,
         ',' order by position.value
       ) as columns
     from pg_index index_record
     join pg_class index_relation on index_relation.oid = index_record.indexrelid
     cross join lateral generate_series(0, index_record.indnkeyatts - 1) position(value)
     join pg_attribute attribute
       on attribute.attrelid = index_record.indrelid
      and attribute.attnum = index_record.indkey[position.value]
    where index_record.indrelid = 'public.v2_provider_keys'::regclass
      and index_relation.relname = any($1::text[])
    group by index_relation.relname, index_record.indisunique, index_record.indisvalid,
             index_record.indisready, index_record.indpred, index_record.indrelid`,
    [
      [
        "v2_provider_keys_vault_secret_uidx",
        "v2_provider_keys_revalidation_lease_idx",
        "v2_provider_keys_revalidation_idx",
      ],
    ],
  );
  return new Map(
    result.rows.map((row) => [stringField(row, "relname") ?? "", row as IndexRow] as const),
  );
}

interface IndexRow extends Record<string, unknown> {
  columns?: string;
  predicate?: string;
}

function validateProviderIndexes(indexes: ReadonlyMap<string, IndexRow>): string[] {
  const issues: string[] = [];
  const vault = indexes.get("v2_provider_keys_vault_secret_uidx");
  if (
    !isUsableIndex(vault) ||
    vault?.["indisunique"] !== true ||
    vault.columns !== "vault_secret_id"
  ) {
    issues.push("Provider Vault references require a valid unique index on vault_secret_id.");
  }
  const revalidation = indexes.get("v2_provider_keys_revalidation_lease_idx");
  const expectedColumns =
    "last_revalidated_at NULLS FIRST,revalidation_claimed_at NULLS FIRST,created_at,user_id,provider";
  if (
    !isUsableIndex(revalidation) ||
    revalidation?.columns !== expectedColumns ||
    normalizeSql(revalidation.predicate) !== "disabled_atisnull"
  ) {
    issues.push(
      "Provider revalidation requires a valid lease-aware due-order index for enabled keys.",
    );
  }
  if (indexes.has("v2_provider_keys_revalidation_idx")) {
    issues.push("The superseded provider-key revalidation index must be removed.");
  }
  return issues;
}

function isUsableIndex(row: IndexRow | undefined): boolean {
  return row?.["indisvalid"] === true && row["indisready"] === true;
}

function normalizeSql(value: string | undefined): string {
  return (value ?? "").toLowerCase().replaceAll(/[()\s"]/g, "");
}

async function validateProviderVaultReferences(client: TargetQueryClient): Promise<string[]> {
  const result = await client.query(
    `select
       count(*) filter (
         where secret.id is null
            or secret.name not like key.user_id::text || ':' || key.provider || ':%'
            or secret.description is distinct from $1
       )::text as invalid_reference_count,
       (select count(*)::text
          from vault.secrets candidate
         where candidate.description = $1
           and not exists (
             select 1 from public.v2_provider_keys key
              where key.vault_secret_id = candidate.id
           )) as orphan_count,
       count(*) filter (
         where (key.disabled_at is null) <> (key.disabled_reason is null)
       )::text as invalid_disabled_pair_count
     from public.v2_provider_keys key
     left join vault.secrets secret on secret.id = key.vault_secret_id`,
    [PROVIDER_KEY_DESCRIPTION],
  );
  const row = result.rows[0];
  const issues: string[] = [];
  if (row?.["invalid_reference_count"] !== "0") {
    issues.push("Every provider key must reference its own normalized Cheatcode Vault secret.");
  }
  if (row?.["orphan_count"] !== "0") {
    issues.push("Unreferenced Cheatcode BYOK Vault secrets must be removed.");
  }
  if (row?.["invalid_disabled_pair_count"] !== "0") {
    issues.push("Provider disabled_at and disabled_reason must be set or cleared together.");
  }
  return issues;
}

async function validateAuditPartitionMaintenance(client: TargetQueryClient): Promise<string[]> {
  const result = await client.query(
    `select jobname, schedule, command, database, username, active,
            current_database() as current_database
       from cron.job
      where jobname = 'cheatcode-v2-audit-partitions'`,
  );
  if (result.rows.length !== 1) {
    return ["Exactly one database-owned audit-partition maintenance job is required."];
  }
  const row = result.rows[0];
  const isExact =
    row?.["schedule"] === "17 2 * * *" &&
    row["command"] === "select public.ensure_v2_audit_partitions();" &&
    row["database"] === row["current_database"] &&
    row["username"] === "postgres" &&
    row["active"] === true;
  return isExact
    ? []
    : ["The audit-partition maintenance job has drifted from its exact daily contract."];
}

async function validateAuditAccess(client: TargetQueryClient): Promise<string[]> {
  const result = await client.query(
    `select relation.relname, relation.relrowsecurity, relation.relforcerowsecurity
       from pg_class relation
       join pg_namespace namespace on namespace.oid = relation.relnamespace
      where namespace.nspname = 'public'
        and relation.relname in ('v2_audit_log', 'v2_provider_keys')`,
  );
  const issues: string[] = [];
  for (const name of ["v2_audit_log", "v2_provider_keys"]) {
    const row = result.rows.find((candidate) => candidate["relname"] === name);
    if (row?.["relrowsecurity"] !== true || row["relforcerowsecurity"] !== true) {
      issues.push(`public.${name} must have forced row-level security enabled.`);
    }
  }
  const policies = await client.query(
    `select policyname, cmd, permissive, array_to_string(roles, ',') as roles,
            coalesce(qual, '') as using_expression,
            coalesce(with_check, '') as with_check_expression
       from pg_policies
      where schemaname = 'public' and tablename = 'v2_audit_log'`,
  );
  const auditPolicy = policies.rows[0];
  if (
    policies.rows.length !== 1 ||
    auditPolicy?.["policyname"] !== "v2_audit_log_postgres_all" ||
    auditPolicy["cmd"] !== "ALL" ||
    auditPolicy["permissive"] !== "PERMISSIVE" ||
    auditPolicy["roles"] !== "postgres" ||
    auditPolicy["using_expression"] !== "true" ||
    auditPolicy["with_check_expression"] !== "true"
  ) {
    issues.push("public.v2_audit_log must expose only its postgres maintenance policy.");
  }
  const partitions = await client.query(
    `with expected as (
       select
         'v2_audit_log_' || pg_catalog.to_char(month_start, 'YYYY_MM') as partition_name,
         pg_catalog.format(
           'FOR VALUES FROM (%L) TO (%L)',
           month_start::text || ' 00:00:00+00',
           ((month_start + pg_catalog.make_interval(months => 1))::date)::text ||
             ' 00:00:00+00'
         ) as partition_bound
       from (
         select (
           pg_catalog.date_trunc(
             'month',
             pg_catalog.timezone('UTC', pg_catalog.statement_timestamp())
           ) + pg_catalog.make_interval(months => month_offset)
         )::date as month_start
         from pg_catalog.generate_series(0, 3) month_offset
       ) months
     ), attached as (
       select child.relname as partition_name,
              pg_catalog.pg_get_expr(child.relpartbound, child.oid) as partition_bound,
              child.relrowsecurity,
              child.relforcerowsecurity,
              (
                select count(*)
                  from pg_catalog.pg_policies policy
                 where policy.schemaname = 'public' and policy.tablename = child.relname
              ) as policy_count,
              exists (
                select 1
                  from pg_catalog.pg_policies policy
                 where policy.schemaname = 'public'
                   and policy.tablename = child.relname
                   and policy.policyname = 'v2_audit_partition_postgres_all'
                   and policy.cmd = 'ALL'
                   and policy.permissive = 'PERMISSIVE'
                   and policy.roles = array['postgres']::name[]
                   and policy.qual = 'true'
                   and policy.with_check = 'true'
              ) as policy_matches
         from pg_catalog.pg_inherits inheritance
         join pg_catalog.pg_class child on child.oid = inheritance.inhrelid
        where inheritance.inhparent = 'public.v2_audit_log'::pg_catalog.regclass
     )
     select count(*) filter (where attached.partition_name is null)::text as missing_count,
            count(*) filter (
              where attached.partition_name is not null
                and attached.partition_bound is distinct from expected.partition_bound
            )::text as invalid_bound_count,
            count(*) filter (
              where attached.partition_name is not null
                and (not attached.relrowsecurity or not attached.relforcerowsecurity)
            )::text as invalid_security_count,
            count(*) filter (
              where attached.partition_name is not null
                and (attached.policy_count <> 1 or not attached.policy_matches)
            )::text as invalid_policy_count
       from expected
       left join attached using (partition_name)`,
  );
  const partitionState = partitions.rows[0];
  if (
    partitionState?.["missing_count"] !== "0" ||
    partitionState["invalid_bound_count"] !== "0" ||
    partitionState["invalid_security_count"] !== "0" ||
    partitionState["invalid_policy_count"] !== "0"
  ) {
    issues.push("Audit log must retain the exact current-plus-three-month partition runway.");
  }
  return issues;
}

interface TriggerContract {
  before: boolean;
  delete: boolean;
  functionName: string;
  insert: boolean;
  tableName: string;
  triggerName: string;
  update: boolean;
  updateColumns?: readonly string[];
}

const TRIGGER_CONTRACTS: readonly TriggerContract[] = [
  touchTrigger("trg_v2_projects_updated", "v2_projects"),
  touchTrigger("trg_v2_threads_updated", "v2_threads"),
  touchTrigger("trg_v2_user_integrations_updated", "v2_user_integrations"),
  touchTrigger("trg_v2_user_profiles_updated", "v2_user_profiles"),
  touchTrigger("trg_v2_entitlements_updated", "v2_entitlements"),
  auditTrigger("trg_v2_audit_provider_keys", "v2_provider_keys", "v2_audit_provider_key_change"),
  auditTrigger(
    "v2_audit_entitlement_change_trigger",
    "v2_entitlements",
    "v2_audit_entitlement_change",
  ),
  auditTrigger(
    "v2_audit_integration_change_trigger",
    "v2_user_integrations",
    "v2_audit_integration_change",
  ),
  {
    before: true,
    delete: true,
    functionName: "v2_delete_provider_vault_secret",
    insert: false,
    tableName: "v2_provider_keys",
    triggerName: "trg_v2_provider_keys_delete_vault",
    update: false,
  },
  {
    before: true,
    delete: true,
    functionName: "v2_guard_user_deletion_refund_resolution",
    insert: false,
    tableName: "v2_user_deletion_jobs",
    triggerName: "trg_v2_user_deletion_refund_resolution",
    update: true,
    updateColumns: ["phase"],
  },
  {
    before: true,
    delete: false,
    functionName: "v2_guard_terminal_agent_run_state",
    insert: false,
    tableName: "v2_agent_runs",
    triggerName: "trg_v2_agent_runs_terminal_state",
    update: true,
    updateColumns: ["finished_at", "status"],
  },
] as const;

function touchTrigger(triggerName: string, tableName: string): TriggerContract {
  return {
    before: true,
    delete: false,
    functionName: "v2_touch_updated_at",
    insert: false,
    tableName,
    triggerName,
    update: true,
  };
}

function auditTrigger(
  triggerName: string,
  tableName: string,
  functionName: string,
): TriggerContract {
  return {
    before: false,
    delete: true,
    functionName,
    insert: true,
    tableName,
    triggerName,
    update: true,
  };
}

async function validateTriggerSurface(client: TargetQueryClient): Promise<string[]> {
  const result = await client.query(
    `select
       trigger_record.tgname,
       relation.relname as table_name,
       procedure.proname as function_name,
       (trigger_record.tgtype & 2) <> 0 as is_before,
       (trigger_record.tgtype & 4) <> 0 as on_insert,
       (trigger_record.tgtype & 8) <> 0 as on_delete,
       (trigger_record.tgtype & 16) <> 0 as on_update,
       coalesce((
         select string_agg(attribute.attname, ',' order by trigger_column.ordinality)
           from unnest(trigger_record.tgattr::smallint[]) with ordinality
             as trigger_column(attnum, ordinality)
           join pg_attribute attribute
             on attribute.attrelid = trigger_record.tgrelid
            and attribute.attnum = trigger_column.attnum
       ), '') as update_columns
     from pg_trigger trigger_record
     join pg_class relation on relation.oid = trigger_record.tgrelid
     join pg_namespace namespace on namespace.oid = relation.relnamespace
     join pg_proc procedure on procedure.oid = trigger_record.tgfoid
    where namespace.nspname = 'public'
      and not trigger_record.tgisinternal
    order by trigger_record.tgname`,
  );
  const actual = new Map(result.rows.map((row) => [stringField(row, "tgname"), row]));
  const expectedNames = new Set(TRIGGER_CONTRACTS.map(({ triggerName }) => triggerName));
  const issues = [...actual.keys()]
    .filter((name): name is string => name !== undefined && !expectedNames.has(name))
    .map((name) => `Unexpected public trigger ${name} must be removed.`);
  for (const contract of TRIGGER_CONTRACTS) {
    if (!triggerMatches(contract, actual.get(contract.triggerName))) {
      issues.push(
        `Public trigger ${contract.triggerName} is missing or has the wrong event contract.`,
      );
    }
  }
  return issues;
}

function triggerMatches(
  contract: TriggerContract,
  row: Record<string, unknown> | undefined,
): boolean {
  return (
    row?.["table_name"] === contract.tableName &&
    row["function_name"] === contract.functionName &&
    row["is_before"] === contract.before &&
    row["on_insert"] === contract.insert &&
    row["on_delete"] === contract.delete &&
    row["on_update"] === contract.update &&
    row["update_columns"] === (contract.updateColumns?.join(",") ?? "")
  );
}

function stringField(row: Record<string, unknown>, key: string): string | undefined {
  const value = row[key];
  return typeof value === "string" ? value : undefined;
}
