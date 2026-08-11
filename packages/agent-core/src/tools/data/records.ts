import { APIError } from "@cheatcode/observability";
import type { DataEntry } from "./schemas";

const DATA_CELL_MAX_CHARACTERS = 10_000;
const DATA_COLUMN_NAME_MAX_CHARACTERS = 200;
const MARKDOWN_TABLE_MAX_COLUMNS = 100;
const MARKDOWN_TABLE_MAX_ROWS = 2_000;
const CSV_OUTPUT_MAX_CHARACTERS = 500_000;

export function csvToRecords(
  csv: string,
  delimiter: string,
  limits: { maxColumns: number; maxRows: number } = { maxColumns: 100, maxRows: 50_000 },
): {
  columns: string[];
  rowCount: number;
  rows: DataEntry[];
} {
  const parsedRows = parseCsvRows(csv, delimiter, limits.maxRows + 1);
  const header = parsedRows[0];
  if (!header) {
    throw invalidDataShape("CSV must contain a header row.");
  }
  const columns = header.map((column, index) =>
    index === 0 ? column.replace(/^\uFEFF/u, "") : column,
  );
  assertCsvColumns(columns);
  const dataRows = parsedRows.slice(1);
  assertTableDimensions(columns, dataRows.length, limits);
  const rows = dataRows.map((values) => csvRecord(columns, values));
  return {
    columns,
    rowCount: rows.length,
    rows,
  };
}

function parseCsvRows(csv: string, delimiter: string, maximumRows: number): string[][] {
  if (!delimiter) {
    throw invalidDataShape("CSV delimiter cannot be empty.");
  }
  const state: CsvParserState = {
    csv,
    delimiter,
    field: "",
    hasClosedQuote: false,
    hasRowInput: false,
    index: 0,
    isQuoted: false,
    maximumRows,
    row: [],
    rows: [],
  };
  while (state.index < state.csv.length) {
    if (state.isQuoted) consumeQuotedCharacter(state);
    else consumeUnquotedCharacter(state);
  }
  if (state.isQuoted) {
    throw invalidDataShape("CSV contains an unterminated quoted field.");
  }
  if (state.field.length > 0 || state.row.length > 0 || !endsWithRowBreak(csv)) {
    finishCsvRow(state);
  }
  return state.rows;
}

interface CsvParserState {
  csv: string;
  delimiter: string;
  field: string;
  hasClosedQuote: boolean;
  hasRowInput: boolean;
  index: number;
  isQuoted: boolean;
  maximumRows: number;
  row: string[];
  rows: string[][];
}

function consumeQuotedCharacter(state: CsvParserState): void {
  const character = state.csv[state.index] ?? "";
  if (character !== '"') {
    appendCsvCharacter(state, character);
    return;
  }
  if (state.csv[state.index + 1] === '"') {
    appendCsvCharacter(state, '"', 2);
    return;
  }
  state.isQuoted = false;
  state.hasClosedQuote = true;
  state.index += 1;
}

function consumeUnquotedCharacter(state: CsvParserState): void {
  const character = state.csv[state.index] ?? "";
  if (state.hasClosedQuote && !isCsvBoundary(state.csv, state.index, state.delimiter)) {
    throw invalidDataShape("CSV contains characters after a closing quote.");
  }
  if (state.csv.startsWith(state.delimiter, state.index)) {
    state.hasRowInput = true;
    finishCsvField(state);
    state.index += state.delimiter.length;
    return;
  }
  if (character === "\n" || character === "\r") {
    finishCsvRow(state);
    state.index += character === "\r" && state.csv[state.index + 1] === "\n" ? 2 : 1;
    return;
  }
  if (character === '"') {
    if (state.field.length > 0) {
      throw invalidDataShape("CSV contains a quote inside an unquoted field.");
    }
    state.hasRowInput = true;
    state.isQuoted = true;
    state.index += 1;
    return;
  }
  appendCsvCharacter(state, character);
}

function appendCsvCharacter(state: CsvParserState, value: string, consumed = 1): void {
  state.field += value;
  state.hasRowInput = true;
  assertCsvCellLength(state.field);
  state.index += consumed;
}

function finishCsvField(state: CsvParserState): void {
  state.row.push(state.field);
  state.field = "";
  state.hasClosedQuote = false;
}

function finishCsvRow(state: CsvParserState): void {
  finishCsvField(state);
  if (state.hasRowInput) {
    state.rows.push(state.row);
  }
  state.row = [];
  state.hasRowInput = false;
  if (state.rows.length > state.maximumRows) {
    throw invalidDataShape("CSV has too many rows.");
  }
}

function isCsvBoundary(csv: string, index: number, delimiter: string): boolean {
  const character = csv[index];
  return (
    character === undefined ||
    character === "\n" ||
    character === "\r" ||
    csv.startsWith(delimiter, index)
  );
}

function endsWithRowBreak(value: string): boolean {
  return value.endsWith("\n") || value.endsWith("\r");
}

function assertCsvCellLength(value: string): void {
  if (value.length > DATA_CELL_MAX_CHARACTERS) {
    throw invalidDataShape("Data contains a cell that is too large.");
  }
}

function assertCsvColumns(columns: readonly string[]): void {
  if (columns.length === 0 || columns.some((column) => column.length === 0)) {
    throw invalidDataShape("CSV column names cannot be empty.");
  }
  if (columns.some((column) => column.length > DATA_COLUMN_NAME_MAX_CHARACTERS)) {
    throw invalidDataShape("CSV column names are too long.");
  }
  if (new Set(columns).size !== columns.length) {
    throw invalidDataShape("CSV column names must be unique.");
  }
}

function csvRecord(columns: readonly string[], values: readonly string[]): DataEntry {
  if (values.length > columns.length) {
    throw invalidDataShape("CSV row has more fields than the header.");
  }
  return Object.fromEntries(
    columns.map((column, index) => [column, autoTypeCsvCell(values[index] ?? "")]),
  );
}

function autoTypeCsvCell(value: string): DataEntry[string] {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return null;
  }
  if (/^(?:true|false)$/iu.test(trimmed)) {
    return trimmed.toLowerCase() === "true";
  }
  if (/^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/iu.test(trimmed)) {
    const numeric = Number(trimmed);
    if (Number.isFinite(numeric)) {
      return numeric;
    }
  }
  return value;
}

export function normalizeRows(rows: readonly unknown[]): DataEntry[] {
  return rows.map((row) => normalizeRecord(row));
}

function normalizeRecord(row: unknown): DataEntry {
  if (!isRecord(row)) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(row).map(([key, value]) => {
      if (key.length === 0 || key.length > DATA_COLUMN_NAME_MAX_CHARACTERS) {
        throw invalidDataShape("Data contains an invalid column name.");
      }
      return [key, normalizeCell(value)];
    }),
  );
}

function normalizeCell(value: unknown): DataEntry[string] {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === "string" || typeof value === "boolean") {
    if (typeof value === "string" && value.length > DATA_CELL_MAX_CHARACTERS) {
      throw invalidDataShape("Data contains a cell that is too large.");
    }
    return value;
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  }
  const text = String(value);
  if (text.length > DATA_CELL_MAX_CHARACTERS) {
    throw invalidDataShape("Data contains a cell that is too large.");
  }
  return text;
}

export function inferColumns(rows: readonly DataEntry[], preferred: readonly string[]): string[] {
  if (preferred.length > 0) {
    return [...preferred];
  }
  const seen = new Set<string>();
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      seen.add(key);
      if (seen.size > MARKDOWN_TABLE_MAX_COLUMNS) {
        throw invalidDataShape("Data has too many distinct columns.");
      }
    }
  }
  return [...seen];
}

export function toCsv(rows: readonly DataEntry[], columns: readonly string[]): string {
  const header = columns.map(escapeCsvCell).join(",");
  const output = [header];
  let outputCharacters = header.length;
  for (const row of rows) {
    const line = columns.map((column) => escapeCsvCell(row[column] ?? null)).join(",");
    outputCharacters += line.length + 1;
    if (outputCharacters > CSV_OUTPUT_MAX_CHARACTERS) {
      throw invalidDataShape("CSV output is too large; use fewer rows or columns.");
    }
    output.push(line);
  }
  return output.join("\n");
}

export function parseMarkdownTable(markdown: string): DataEntry[] {
  const rows = markdown
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("|") && line.endsWith("|"));
  if (rows.length < 2) {
    return [];
  }

  const headers = splitMarkdownRow(rows[0] ?? "");
  const dataRows = rows.slice(2).filter((line) => !isSeparatorRow(splitMarkdownRow(line)));
  if (headers.length > MARKDOWN_TABLE_MAX_COLUMNS || dataRows.length > MARKDOWN_TABLE_MAX_ROWS) {
    throw invalidDataShape("Markdown table has too many rows or columns.");
  }
  return dataRows.map((line) => {
    const cells = splitMarkdownRow(line);
    return Object.fromEntries(
      headers.map((header, index) => [
        header || `column_${index + 1}`,
        normalizeCell(cells[index]),
      ]),
    );
  });
}

export function coerceNumber(value: DataEntry[string]): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value !== "string") {
    return null;
  }
  const normalized = Number(value.replace(/[$,%\s]/g, ""));
  return Number.isFinite(normalized) ? normalized : null;
}

function splitMarkdownRow(line: string): string[] {
  return line
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

function isSeparatorRow(cells: readonly string[]): boolean {
  return cells.every((cell) => /^:?-{3,}:?$/.test(cell));
}

function escapeCsvCell(value: DataEntry[string]): string {
  if (value === null) {
    return "";
  }
  const text = String(value);
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertTableDimensions(
  columns: readonly string[],
  rowCount: number,
  limits: { maxColumns: number; maxRows: number },
): void {
  if (columns.length > limits.maxColumns || rowCount > limits.maxRows) {
    throw invalidDataShape("Data has too many rows or columns.");
  }
}

function invalidDataShape(message: string): APIError {
  return new APIError(400, "tool_validation_failed", message, {
    hint: "Split the data into smaller tables and retry.",
    retriable: false,
  });
}
