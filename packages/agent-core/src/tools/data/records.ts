import { APIError } from "@cheatcode/observability";
import * as aq from "arquero";
import type { DataRecord } from "./schemas";

const DATA_CELL_MAX_CHARACTERS = 10_000;
const DATA_COLUMN_NAME_MAX_CHARACTERS = 200;
const MARKDOWN_TABLE_MAX_COLUMNS = 100;
const MARKDOWN_TABLE_MAX_ROWS = 2_000;
const CSV_OUTPUT_MAX_CHARACTERS = 500_000;

type ArqueroTable = {
  columnNames(): string[];
  numRows(): number;
  objects(): unknown[];
};

export function csvToRecords(
  csv: string,
  delimiter: string,
  limits: { maxColumns: number; maxRows: number } = { maxColumns: 100, maxRows: 50_000 },
): {
  columns: string[];
  rowCount: number;
  rows: DataRecord[];
} {
  assertCsvLineCount(csv, limits.maxRows);
  const table = aq.fromCSV(csv, { autoType: true, delimiter }) as ArqueroTable;
  const columns = table.columnNames();
  assertTableDimensions(columns, table.numRows(), limits);
  return {
    columns,
    rowCount: table.numRows(),
    rows: normalizeRows(table.objects()),
  };
}

export function normalizeRows(rows: readonly unknown[]): DataRecord[] {
  return rows.map((row) => normalizeRecord(row));
}

function normalizeRecord(row: unknown): DataRecord {
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

function normalizeCell(value: unknown): DataRecord[string] {
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

export function inferColumns(rows: readonly DataRecord[], preferred: readonly string[]): string[] {
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

export function toCsv(rows: readonly DataRecord[], columns: readonly string[]): string {
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

export function parseMarkdownTable(markdown: string): DataRecord[] {
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

export function coerceNumber(value: DataRecord[string]): number | null {
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

function escapeCsvCell(value: DataRecord[string]): string {
  if (value === null) {
    return "";
  }
  const text = String(value);
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertCsvLineCount(csv: string, maxRows: number): void {
  let lineBreaks = 0;
  for (let index = 0; index < csv.length; index += 1) {
    if (csv.charCodeAt(index) === 10) {
      lineBreaks += 1;
      if (lineBreaks > maxRows) {
        throw invalidDataShape("CSV has too many rows.");
      }
    }
  }
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
