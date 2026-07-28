import type { PgClient } from "../pg-client";
import {
  DATA_API_ROLES,
  EXPECTED_PUBLIC_TABLES,
  REQUIRED_EXTENSIONS,
  REQUIRED_FUNCTIONS,
  REQUIRED_SCHEMAS,
  RUNTIME_DATABASE_ROLES,
} from "./contracts";
import {
  validateCanonicalProjectWorkspaces,
  validateFirstArtifactMilestone,
  validateIntegrityConstraints,
  validateIntegrityIndexes,
} from "./invariants";

class SupabaseTargetError extends Error {
  public readonly issues: readonly string[];

  public constructor(issues: readonly string[]) {
    super(`Supabase target validation failed:\n${issues.map((issue) => `- ${issue}`).join("\n")}`);
    this.name = "SupabaseTargetError";
    this.issues = issues;
  }
}

export async function assertSupabaseTarget(client: PgClient): Promise<void> {
  const checks = await Promise.all([
    validateTableSet(client),
    validateRls(client),
    validateExtensionsAndSchemas(client),
    validateFunctions(client),
    validateRuntimeRoles(client),
    validateRuntimeAcl(client),
    validateDataApiIsolation(client),
    validateIntegrityConstraints(client),
    validateIntegrityIndexes(client),
    validateCanonicalProjectWorkspaces(client),
    validateFirstArtifactMilestone(client),
  ]);
  const issues = checks.flat();
  if (issues.length > 0) {
    throw new SupabaseTargetError(issues);
  }
}

async function validateTableSet(client: PgClient): Promise<string[]> {
  const result = await client.query(
    `select table_name
       from information_schema.tables
      where table_schema = 'public' and table_type = 'BASE TABLE'
      order by table_name`,
  );
  const actual = new Set(result.rows.map((row) => stringField(row, "table_name")));
  const expected = new Set<string>(EXPECTED_PUBLIC_TABLES);
  return [
    ...EXPECTED_PUBLIC_TABLES.filter((table) => !actual.has(table)).map(
      (table) => `Required public table public.${table} is missing.`,
    ),
    ...[...actual]
      .filter((table): table is string => table !== undefined && !expected.has(table))
      .map((table) => `Unexpected table public.${table} must be removed.`),
  ];
}

async function validateRls(client: PgClient): Promise<string[]> {
  const result = await client.query(
    `select relation.relname, relation.relrowsecurity, relation.relforcerowsecurity,
            exists (
              select 1 from pg_policy policy where policy.polrelid = relation.oid
            ) as has_policy
       from pg_class relation
       join pg_namespace namespace on namespace.oid = relation.relnamespace
      where namespace.nspname = 'public' and relation.relname = any($1::text[])`,
    [[...EXPECTED_PUBLIC_TABLES]],
  );
  const rows = new Map(result.rows.map((row) => [stringField(row, "relname"), row]));
  return EXPECTED_PUBLIC_TABLES.flatMap((table) => validateRlsRow(table, rows.get(table)));
}

function validateRlsRow(table: string, row: Record<string, unknown> | undefined): string[] {
  if (!row) {
    return [];
  }
  const issues: string[] = [];
  if (row["relrowsecurity"] !== true || row["relforcerowsecurity"] !== true) {
    issues.push(`public.${table} must have row-level security enabled and forced.`);
  }
  if (row["has_policy"] !== true) {
    issues.push(`public.${table} must retain at least one row-level-security policy.`);
  }
  return issues;
}

async function validateExtensionsAndSchemas(client: PgClient): Promise<string[]> {
  const schemaResult = await client.query(
    `select nspname from pg_namespace where nspname = any($1::text[])`,
    [[...REQUIRED_SCHEMAS]],
  );
  const schemas = new Set(schemaResult.rows.map((row) => stringField(row, "nspname")));
  const extensionResult = await client.query(
    `select extension.extname, namespace.nspname
       from pg_extension extension
       join pg_namespace namespace on namespace.oid = extension.extnamespace`,
  );
  const extensions = new Map(
    extensionResult.rows.map((row) => [stringField(row, "extname"), stringField(row, "nspname")]),
  );
  return [
    ...REQUIRED_SCHEMAS.filter((schema) => !schemas.has(schema)).map(
      (schema) => `Required Postgres schema ${schema} is missing.`,
    ),
    ...[...REQUIRED_EXTENSIONS].flatMap(([extension, schema]) =>
      validateExtension(extension, schema, extensions),
    ),
  ];
}

function validateExtension(
  extension: string,
  schema: string,
  actual: ReadonlyMap<string | undefined, string | undefined>,
): string[] {
  if (!actual.has(extension)) {
    return [`Required Postgres extension ${extension} is missing.`];
  }
  return actual.get(extension) === schema
    ? []
    : [`Postgres extension ${extension} must be installed in schema ${schema}.`];
}

async function validateFunctions(client: PgClient): Promise<string[]> {
  const result = await client.query(
    `select procedure.proname, oidvectortypes(procedure.proargtypes) as arguments
       from pg_proc procedure
       join pg_namespace namespace on namespace.oid = procedure.pronamespace
       left join pg_depend extension_dependency
         on extension_dependency.classid = 'pg_proc'::regclass
        and extension_dependency.objid = procedure.oid
        and extension_dependency.deptype = 'e'
      where namespace.nspname = 'public' and extension_dependency.objid is null`,
  );
  const actual = new Set(result.rows.map(functionIdentity));
  return REQUIRED_FUNCTIONS.filter((identity) => !actual.has(identity)).map(
    (identity) => `Required custom function public.${identity} is missing.`,
  );
}

async function validateRuntimeRoles(client: PgClient): Promise<string[]> {
  const result = await client.query(
    `select role.rolname, role.rolcanlogin, role.rolinherit, role.rolsuper,
            role.rolcreatedb, role.rolcreaterole, role.rolreplication, role.rolbypassrls,
            role.rolconfig = array['search_path=public, pg_catalog']::text[] as config_matches
       from pg_roles role where role.rolname = any($1::text[])`,
    [[...RUNTIME_DATABASE_ROLES]],
  );
  const rows = new Map(result.rows.map((row) => [stringField(row, "rolname"), row]));
  const issues = RUNTIME_DATABASE_ROLES.flatMap((role) =>
    validateRuntimeRole(role, rows.get(role)),
  );
  issues.push(...(await validateRoleMemberships(client)));
  issues.push(...(await validateRoleAccessBaseline(client)));
  return issues;
}

function validateRuntimeRole(role: string, row: Record<string, unknown> | undefined): string[] {
  if (!row) {
    return [`Required Postgres runtime role ${role} is missing.`];
  }
  const issues: string[] = [];
  if (row["rolcanlogin"] !== true) {
    issues.push(`${role} must be LOGIN.`);
  }
  if (row["rolinherit"] !== false) {
    issues.push(`${role} must be NOINHERIT.`);
  }
  for (const attribute of [
    "rolsuper",
    "rolcreatedb",
    "rolcreaterole",
    "rolreplication",
    "rolbypassrls",
  ]) {
    if (row[attribute] !== false) {
      issues.push(`${role} must not have ${attribute}.`);
    }
  }
  if (row["config_matches"] !== true) {
    issues.push(`${role} has the wrong role-level search_path configuration.`);
  }
  return issues;
}

async function validateRoleMemberships(client: PgClient): Promise<string[]> {
  const result = await client.query(
    `select granted.rolname as granted_role, member.rolname as member_role
       from pg_auth_members membership
       join pg_roles granted on granted.oid = membership.roleid
       join pg_roles member on member.oid = membership.member
      where member.rolname = any($1::text[]) or granted.rolname = any($1::text[])`,
    [[...RUNTIME_DATABASE_ROLES]],
  );
  return result.rows.map(
    (row) =>
      `Runtime role membership ${stringField(row, "granted_role")} -> ${stringField(row, "member_role")} must be revoked.`,
  );
}

async function validateRoleAccessBaseline(client: PgClient): Promise<string[]> {
  const result = await client.query(
    `select role.rolname,
            has_database_privilege(role.oid, current_database(), 'CONNECT') as can_connect,
            has_database_privilege(role.oid, current_database(), 'CREATE') as can_create_database,
            has_schema_privilege(role.oid, 'public', 'USAGE') as can_use_public,
            has_schema_privilege(role.oid, 'public', 'CREATE') as can_create_public
       from pg_roles role where role.rolname = any($1::text[])`,
    [[...RUNTIME_DATABASE_ROLES]],
  );
  return result.rows.flatMap(validateRoleAccessRow);
}

function validateRoleAccessRow(row: Record<string, unknown>): string[] {
  const role = stringField(row, "rolname") ?? "<unknown>";
  const issues: string[] = [];
  if (row["can_connect"] !== true || row["can_use_public"] !== true) {
    issues.push(`${role} must retain CONNECT and public-schema USAGE.`);
  }
  if (row["can_create_database"] === true || row["can_create_public"] === true) {
    issues.push(`${role} must not create database or public-schema objects.`);
  }
  return issues;
}

async function validateRuntimeAcl(client: PgClient): Promise<string[]> {
  const result = await client.query(runtimeAclQuery(), [[...RUNTIME_DATABASE_ROLES]]);
  const expectedTables = new Set<string>(EXPECTED_PUBLIC_TABLES);
  const expectedFunctions = new Set<string>(REQUIRED_FUNCTIONS);
  const issues = result.rows.flatMap((row) => {
    const kind = stringField(row, "object_kind");
    const object = stringField(row, "object_name") ?? "<unknown>";
    const privilege = stringField(row, "privilege") ?? "<unknown>";
    const issues =
      kind === "function"
        ? validateFunctionAcl(object, privilege, expectedFunctions)
        : validateRelationAcl(kind, object, privilege, expectedTables);
    return row["is_grantable"] === true
      ? [...issues, `Runtime ${kind} grant on ${object} must not include grant option.`]
      : issues;
  });
  for (const role of RUNTIME_DATABASE_ROLES) {
    const roleRows = result.rows.filter((row) => row["role_name"] === role);
    if (
      !roleRows.some((row) => row["object_kind"] === "table" || row["object_kind"] === "column")
    ) {
      issues.push(`${role} must retain at least one bounded tenant-table grant.`);
    }
    if (!roleRows.some((row) => row["object_kind"] === "function")) {
      issues.push(`${role} must retain at least one bounded custom-function grant.`);
    }
  }
  return issues;
}

function validateFunctionAcl(
  object: string,
  privilege: string,
  expected: ReadonlySet<string>,
): string[] {
  return privilege === "EXECUTE" && expected.has(object)
    ? []
    : [`Unexpected runtime function grant ${object}|${privilege} must be revoked.`];
}

function validateRelationAcl(
  kind: string | undefined,
  object: string,
  privilege: string,
  expected: ReadonlySet<string>,
): string[] {
  const allowed =
    kind === "table" ? ["DELETE", "INSERT", "SELECT", "UPDATE"] : ["INSERT", "SELECT", "UPDATE"];
  return expected.has(object.split(".")[0] ?? "") && allowed.includes(privilege)
    ? []
    : [`Unexpected runtime ${kind} grant ${object}|${privilege} must be revoked.`];
}

async function validateDataApiIsolation(client: PgClient): Promise<string[]> {
  const result = await client.query(
    `select role.rolname, relation.relname, 'table' as access_kind, privilege.name
       from pg_roles role
       join pg_class relation on relation.relkind in ('r', 'p')
       join pg_namespace namespace on namespace.oid = relation.relnamespace
      cross join (values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE'),
                         ('REFERENCES'), ('TRIGGER')) privilege(name)
      where role.rolname = any($1::text[]) and namespace.nspname = 'public'
        and has_table_privilege(role.oid, relation.oid, privilege.name)
      union all
     select role.rolname, relation.relname, 'column', privilege.name
       from pg_roles role
       join pg_class relation on relation.relkind in ('r', 'p')
       join pg_namespace namespace on namespace.oid = relation.relnamespace
      cross join (values ('SELECT'), ('INSERT'), ('UPDATE'), ('REFERENCES')) privilege(name)
      where role.rolname = any($1::text[]) and namespace.nspname = 'public'
        and has_any_column_privilege(role.oid, relation.oid, privilege.name)`,
    [[...DATA_API_ROLES]],
  );
  const functionResult = await client.query(
    `select role.rolname, procedure.oid::regprocedure::text as identity
       from pg_roles role
       join pg_proc procedure on true
       join pg_namespace namespace on namespace.oid = procedure.pronamespace
       left join pg_depend dependency on dependency.classid = 'pg_proc'::regclass
        and dependency.objid = procedure.oid and dependency.deptype = 'e'
      where role.rolname = any($1::text[]) and namespace.nspname = 'public'
        and dependency.objid is null
        and has_function_privilege(role.oid, procedure.oid, 'EXECUTE')`,
    [[...DATA_API_ROLES]],
  );
  return [
    ...result.rows.map(
      (row) =>
        `Data API role ${stringField(row, "rolname")} retains ${stringField(row, "name")} ${stringField(row, "access_kind")} access on public.${stringField(row, "relname")}.`,
    ),
    ...functionResult.rows.map(
      (row) =>
        `Data API role ${stringField(row, "rolname")} retains EXECUTE on ${stringField(row, "identity")}.`,
    ),
  ];
}

function runtimeAclQuery(): string {
  return `select grantee.rolname as role_name, 'table' as object_kind,
                 relation.relname as object_name,
                 (entry).privilege_type as privilege, (entry).is_grantable
            from pg_class relation
            join pg_namespace namespace on namespace.oid = relation.relnamespace
           cross join lateral aclexplode(relation.relacl) entry
            join pg_roles grantee on grantee.oid = (entry).grantee
           where namespace.nspname = 'public' and grantee.rolname = any($1::text[])
          union all
          select grantee.rolname, 'column', relation.relname || '.' || attribute.attname,
                 (entry).privilege_type, (entry).is_grantable
            from pg_attribute attribute
            join pg_class relation on relation.oid = attribute.attrelid
            join pg_namespace namespace on namespace.oid = relation.relnamespace
           cross join lateral aclexplode(attribute.attacl) entry
            join pg_roles grantee on grantee.oid = (entry).grantee
           where namespace.nspname = 'public' and grantee.rolname = any($1::text[])
          union all
          select grantee.rolname, 'function',
                 procedure.proname || '(' || oidvectortypes(procedure.proargtypes) || ')',
                 (entry).privilege_type, (entry).is_grantable
            from pg_proc procedure
            join pg_namespace namespace on namespace.oid = procedure.pronamespace
           cross join lateral aclexplode(procedure.proacl) entry
            join pg_roles grantee on grantee.oid = (entry).grantee
           where namespace.nspname = 'public' and grantee.rolname = any($1::text[])`;
}

function functionIdentity(row: Record<string, unknown>): string {
  return `${stringField(row, "proname") ?? "<unknown>"}(${stringField(row, "arguments") ?? ""})`;
}

function stringField(row: Record<string, unknown>, key: string): string | undefined {
  const value = row[key];
  return typeof value === "string" ? value : undefined;
}
