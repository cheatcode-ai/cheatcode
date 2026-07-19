import {
  DURABLE_OBJECT_STORAGE_SCHEMA_VERSIONS,
  type DurableObjectStorageClass,
  type InternalDurableObjectStorageRequest,
  InternalDurableObjectStorageRequestSchema,
  type InternalDurableObjectStorageResponse,
  InternalDurableObjectStorageResponseSchema,
} from "@cheatcode/types";

export const CURRENT_SQLITE_STORAGE_VERSION = 1;

const STORAGE_METADATA_TABLE = "__cheatcode_storage_metadata";
const STORAGE_METADATA_TABLE_SQL = `CREATE TABLE ${STORAGE_METADATA_TABLE} (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  schema_version INTEGER NOT NULL CHECK (schema_version > 0)
) STRICT`;
const STORAGE_METADATA_SCHEMA: ExpectedSqliteObject = {
  name: STORAGE_METADATA_TABLE,
  sql: STORAGE_METADATA_TABLE_SQL,
  tableName: STORAGE_METADATA_TABLE,
  type: "table",
};

export class SqliteSchemaMismatchError extends Error {
  override readonly name = "SqliteSchemaMismatchError";
}

export interface ExpectedSqliteObject {
  name: string;
  sql: string;
  tableName: string;
  type: SqliteSchemaObjectType;
}

export type SqliteSchemaObjectType = "index" | "table" | "trigger" | "view";

type SqlTokenKind = "number" | "quoted-identifier" | "string" | "symbol" | "word";

interface SqlToken {
  kind: SqlTokenKind;
  value: string;
}

interface CanonicalSqliteObject {
  name: string;
  sql: string;
  tableName: string;
  type: SqliteSchemaObjectType;
}

interface ReleaseBoundDurableObjectEnv {
  CHEATCODE_RELEASE_GATE: "closed" | "draining" | "open";
  CHEATCODE_RELEASE_SHA?: string;
}

export function assertStorageReconciliationRequest(
  ctx: DurableObjectState,
  env: ReleaseBoundDurableObjectEnv,
  value: InternalDurableObjectStorageRequest,
  className: DurableObjectStorageClass,
): InternalDurableObjectStorageRequest {
  const input = InternalDurableObjectStorageRequestSchema.parse(value);
  if (
    env.CHEATCODE_RELEASE_GATE !== "closed" ||
    env.CHEATCODE_RELEASE_SHA !== input.releaseSha ||
    input.className !== className ||
    input.objectId !== ctx.id.toString()
  ) {
    throw new Error(`${className} storage reconciliation authority mismatch.`);
  }
  return input;
}

export function storageSchemaEvidence(
  input: InternalDurableObjectStorageRequest,
): InternalDurableObjectStorageResponse {
  return InternalDurableObjectStorageResponseSchema.parse({
    className: input.className,
    objectId: input.objectId,
    releaseSha: input.releaseSha,
    schemaVersion: DURABLE_OBJECT_STORAGE_SCHEMA_VERSIONS[input.className],
    verified: true,
  });
}

export function setCurrentSqliteStorageVersion(ctx: DurableObjectState): void {
  // Durable Object SQL does not support PRAGMA user_version, so the marker is application-owned.
  ctx.storage.sql.exec(`DROP TABLE IF EXISTS ${STORAGE_METADATA_TABLE}`);
  ctx.storage.sql.exec(STORAGE_METADATA_TABLE_SQL);
  ctx.storage.sql.exec(
    `INSERT INTO ${STORAGE_METADATA_TABLE} (singleton, schema_version) VALUES (1, ?)`,
    CURRENT_SQLITE_STORAGE_VERSION,
  );
}

/** Rebuild once, then make retries and signed-request replays verification-only. */
export function reconcileExactSqliteStorage(
  mode: InternalDurableObjectStorageRequest["mode"],
  assertCurrent: () => void,
  reconcile: () => void,
): void {
  if (mode === "verify") {
    assertCurrent();
    return;
  }
  try {
    assertCurrent();
  } catch (error) {
    if (!(error instanceof SqliteSchemaMismatchError)) throw error;
    reconcile();
  }
}

/** Proves a copy step did not filter or replace rows before the source table is dropped. */
export function assertSqliteRowCountPreserved(
  ctx: DurableObjectState,
  sourceTable: string,
  targetTable: string,
): void {
  if (!isSafeSqlIdentifier(sourceTable) || !isSafeSqlIdentifier(targetTable)) {
    throw new TypeError("SQLite preservation evidence requires safe table identifiers.");
  }
  const [row] = ctx.storage.sql
    .exec(
      `SELECT (SELECT count(*) FROM ${sourceTable}) AS source_count,
              (SELECT count(*) FROM ${targetTable}) AS target_count`,
    )
    .toArray();
  if (
    !isRecord(row) ||
    typeof row["source_count"] !== "number" ||
    typeof row["target_count"] !== "number" ||
    row["source_count"] !== row["target_count"]
  ) {
    throw new Error("Durable Object reconciliation did not preserve every source row.");
  }
}

export function assertExactSqliteSchema(
  ctx: DurableObjectState,
  expected: readonly ExpectedSqliteObject[],
): void {
  // Workerd owns KV/alarm metadata; Miniflare adds the named-object discovery table locally.
  const actual = ctx.storage.sql
    .exec(
      `SELECT type, name, tbl_name, sql
       FROM sqlite_schema
       WHERE substr(lower(name), 1, 7) <> 'sqlite_'
         AND name NOT IN ('_cf_KV', '_cf_METADATA', '__miniflare_do_name')
       ORDER BY type, name`,
    )
    .toArray();
  const canonicalExpected = [...expected, STORAGE_METADATA_SCHEMA]
    .map(canonicalExpectedObject)
    .sort(compareSchemaObjects);
  const canonicalActual = actual.map(canonicalActualObject).sort(compareSchemaObjects);
  if (JSON.stringify(canonicalActual) !== JSON.stringify(canonicalExpected)) {
    throw new SqliteSchemaMismatchError(
      "Durable Object SQLite schema does not match the exact current contract.",
    );
  }
  const versions = ctx.storage.sql
    .exec(`SELECT singleton, schema_version FROM ${STORAGE_METADATA_TABLE}`)
    .toArray();
  const version = versions[0];
  if (
    versions.length !== 1 ||
    !isRecord(version) ||
    version["singleton"] !== 1 ||
    version["schema_version"] !== CURRENT_SQLITE_STORAGE_VERSION
  ) {
    throw new SqliteSchemaMismatchError("Durable Object SQLite schema version is not current.");
  }
}

function canonicalExpectedObject(object: ExpectedSqliteObject): CanonicalSqliteObject {
  return {
    name: normalizeMetadataIdentifier(object.name),
    sql: normalizeSql(object.sql),
    tableName: normalizeMetadataIdentifier(object.tableName),
    type: object.type,
  };
}

function canonicalActualObject(value: unknown): CanonicalSqliteObject {
  if (!isRecord(value)) throw new Error("SQLite returned malformed schema metadata.");
  const type = value["type"];
  const name = value["name"];
  const tableName = value["tbl_name"];
  const sql = value["sql"];
  if (
    !isSqliteSchemaObjectType(type) ||
    typeof name !== "string" ||
    typeof tableName !== "string" ||
    typeof sql !== "string"
  ) {
    throw new Error("SQLite returned incomplete schema metadata.");
  }
  return {
    name: normalizeMetadataIdentifier(name),
    sql: normalizeSql(sql),
    tableName: normalizeMetadataIdentifier(tableName),
    type,
  };
}

function schemaObjectKey(object: Pick<ExpectedSqliteObject, "name" | "type">): string {
  return `${object.type}:${object.name}`;
}

function compareSchemaObjects(
  left: Pick<ExpectedSqliteObject, "name" | "type">,
  right: Pick<ExpectedSqliteObject, "name" | "type">,
): number {
  const leftKey = schemaObjectKey(left);
  const rightKey = schemaObjectKey(right);
  if (leftKey === rightKey) return 0;
  return leftKey < rightKey ? -1 : 1;
}

function normalizeSql(sql: string): string {
  const tokens = removeCreateIfNotExists(tokenizeSql(sql));
  return JSON.stringify(tokens);
}

function tokenizeSql(sql: string): SqlToken[] {
  const tokens: SqlToken[] = [];
  let cursor = 0;
  while (cursor < sql.length) {
    const character = sql[cursor] ?? "";
    if (isSqlWhitespace(character)) {
      cursor += 1;
      continue;
    }
    const commentEnd = readCommentEnd(sql, cursor);
    if (commentEnd !== null) {
      cursor = commentEnd;
      continue;
    }
    const quoted = readQuotedToken(sql, cursor);
    if (quoted) {
      tokens.push(quoted.token);
      cursor = quoted.end;
      continue;
    }
    const numberEnd = readNumberEnd(sql, cursor);
    if (numberEnd !== cursor) {
      tokens.push({ kind: "number", value: sql.slice(cursor, numberEnd) });
      cursor = numberEnd;
      continue;
    }
    if (isSqlWordStart(character)) {
      const end = readWhile(sql, cursor + 1, isSqlWordPart);
      tokens.push({ kind: "word", value: asciiLowercase(sql.slice(cursor, end)) });
      cursor = end;
      continue;
    }
    const symbolEnd = readSymbolEnd(sql, cursor);
    tokens.push({ kind: "symbol", value: sql.slice(cursor, symbolEnd) });
    cursor = symbolEnd;
  }
  return tokens;
}

function readCommentEnd(sql: string, start: number): number | null {
  if (sql.startsWith("--", start)) {
    const newline = sql.indexOf("\n", start + 2);
    return newline === -1 ? sql.length : newline + 1;
  }
  if (!sql.startsWith("/*", start)) return null;
  const closing = sql.indexOf("*/", start + 2);
  if (closing === -1) throw new Error("SQLite schema SQL contains an unterminated comment.");
  return closing + 2;
}

function readQuotedToken(sql: string, start: number): { end: number; token: SqlToken } | null {
  const opening = sql[start];
  if (opening === "[") {
    const closing = sql.indexOf("]", start + 1);
    if (closing === -1) throw new Error("SQLite schema SQL contains an unterminated identifier.");
    return quotedToken(sql, start, closing + 1, "quoted-identifier");
  }
  if (opening !== "'" && opening !== '"' && opening !== "`") return null;
  let cursor = start + 1;
  while (cursor < sql.length) {
    if (sql[cursor] !== opening) {
      cursor += 1;
      continue;
    }
    if (sql[cursor + 1] === opening) {
      cursor += 2;
      continue;
    }
    const kind = opening === "'" ? "string" : "quoted-identifier";
    return quotedToken(sql, start, cursor + 1, kind);
  }
  throw new Error("SQLite schema SQL contains an unterminated quoted token.");
}

function quotedToken(
  sql: string,
  start: number,
  end: number,
  kind: "quoted-identifier" | "string",
): { end: number; token: SqlToken } {
  return { end, token: { kind, value: sql.slice(start, end) } };
}

function readNumberEnd(sql: string, start: number): number {
  const remaining = sql.slice(start);
  const match =
    /^(?:0[xX][0-9a-fA-F](?:_?[0-9a-fA-F])*|(?:\.\d(?:_?\d)*|\d(?:_?\d)*(?:\.(?:\d(?:_?\d)*)?)?)(?:[eE][+-]?\d(?:_?\d)*)?)/u.exec(
      remaining,
    );
  return match?.[0] ? start + match[0].length : start;
}

function readSymbolEnd(sql: string, start: number): number {
  for (const length of [3, 2] as const) {
    const candidate = sql.slice(start, start + length);
    if (["->>", "||", "<<", ">>", "<=", ">=", "==", "!=", "<>", "->"].includes(candidate)) {
      return start + length;
    }
  }
  return start + 1;
}

function removeCreateIfNotExists(tokens: readonly SqlToken[]): SqlToken[] {
  const normalized = [...tokens];
  let cursor = 0;
  if (!isWord(normalized[cursor], "create")) return normalized;
  cursor += 1;
  if (isWord(normalized[cursor], "temp") || isWord(normalized[cursor], "temporary")) cursor += 1;
  if (isWord(normalized[cursor], "unique") || isWord(normalized[cursor], "virtual")) cursor += 1;
  if (!isSchemaObjectKeyword(normalized[cursor])) return normalized;
  cursor += 1;
  if (
    isWord(normalized[cursor], "if") &&
    isWord(normalized[cursor + 1], "not") &&
    isWord(normalized[cursor + 2], "exists")
  ) {
    normalized.splice(cursor, 3);
  }
  return normalized;
}

function isSchemaObjectKeyword(token: SqlToken | undefined): boolean {
  return (
    isWord(token, "index") ||
    isWord(token, "table") ||
    isWord(token, "trigger") ||
    isWord(token, "view")
  );
}

function isWord(token: SqlToken | undefined, value: string): boolean {
  return token?.kind === "word" && token.value === value;
}

function isSqliteSchemaObjectType(value: unknown): value is SqliteSchemaObjectType {
  return value === "index" || value === "table" || value === "trigger" || value === "view";
}

function normalizeMetadataIdentifier(value: string): string {
  return asciiLowercase(value);
}

function asciiLowercase(value: string): string {
  return value.replace(/[A-Z]/gu, (character) => character.toLowerCase());
}

function readWhile(sql: string, start: number, predicate: (value: string) => boolean): number {
  let cursor = start;
  while (cursor < sql.length && predicate(sql[cursor] ?? "")) cursor += 1;
  return cursor;
}

function isSqlWhitespace(value: string): boolean {
  return value === " " || value === "\t" || value === "\n" || value === "\r" || value === "\f";
}

function isSafeSqlIdentifier(value: string): boolean {
  return /^[a-z][a-z0-9_]*$/u.test(value);
}

function isSqlWordStart(value: string): boolean {
  return /[A-Z_a-z\u0080-\u{10ffff}]/u.test(value);
}

function isSqlWordPart(value: string): boolean {
  return /[$0-9A-Z_a-z\u0080-\u{10ffff}]/u.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
