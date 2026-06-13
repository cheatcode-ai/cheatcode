export function v2TableName<const TableName extends string>(
  tableName: TableName,
): `v2_${TableName}` {
  return `v2_${tableName}`;
}
