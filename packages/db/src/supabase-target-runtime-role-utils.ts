export function validateExactAcl(
  rows: readonly Record<string, unknown>[],
  expected: ReadonlySet<string>,
  label: string,
  identity: (row: Record<string, unknown>) => string,
): string[] {
  const actual = new Set(rows.map(identity));
  const issues = [...expected]
    .filter((grant) => !actual.has(grant))
    .map((grant) => `Required runtime ${label} grant ${grant} is missing.`);
  issues.push(
    ...[...actual]
      .filter((grant) => !expected.has(grant))
      .map((grant) => `Unexpected runtime ${label} grant ${grant} must be revoked.`),
  );
  issues.push(
    ...rows
      .filter((row) => row["is_grantable"] === true)
      .map((row) => `Runtime ${label} grant ${identity(row)} must not include grant option.`),
  );
  return issues;
}

export function aclIdentity(
  row: Record<string, unknown>,
  roleKey: string,
  objectKey: string | undefined,
): string {
  const role = stringField(row, roleKey) ?? "<unknown>";
  const object = objectKey ? `${stringField(row, objectKey) ?? "<unknown>"}|` : "";
  return `${role}|${object}${stringField(row, "privilege") ?? "<unknown>"}`;
}

export function functionAclIdentity(row: Record<string, unknown>): string {
  const name = stringField(row, "proname") ?? "<unknown>";
  const args = stringField(row, "arguments") ?? "";
  return `${stringField(row, "role_name") ?? "<unknown>"}|${name}(${args})|EXECUTE`;
}

export function normalizeExpression(value: string | undefined): string {
  return (value ?? "").toLowerCase().replaceAll(/[\s"]/g, "");
}

export function stringField(row: Record<string, unknown>, key: string): string | undefined {
  const value = row[key];
  return typeof value === "string" ? value : undefined;
}

export function validateRuntimeRoleRow(
  role: string,
  row: Record<string, unknown> | undefined,
): string[] {
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
