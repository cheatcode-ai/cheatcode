import * as aq from "arquero";
import type { DataRecord } from "./schemas";

type ArqueroTable = {
  columnNames(): string[];
  numRows(): number;
  objects(): unknown[];
};

export function csvToRecords(
  csv: string,
  delimiter: string,
): {
  columns: string[];
  rowCount: number;
  rows: DataRecord[];
} {
  const table = aq.fromCSV(csv, { autoType: true, delimiter }) as ArqueroTable;
  const columns = table.columnNames();
  return {
    columns,
    rowCount: table.numRows(),
    rows: normalizeRows(table.objects()),
  };
}

export function normalizeRows(rows: readonly unknown[]): DataRecord[] {
  return rows.map((row) => normalizeRecord(row));
}

export function normalizeRecord(row: unknown): DataRecord {
  if (!isRecord(row)) {
    return {};
  }
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [key, normalizeCell(value)]));
}

export function normalizeCell(value: unknown): DataRecord[string] {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === "string" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  }
  return String(value);
}

export function inferColumns(rows: readonly DataRecord[], preferred: readonly string[]): string[] {
  if (preferred.length > 0) {
    return [...preferred];
  }
  const seen = new Set<string>();
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      seen.add(key);
    }
  }
  return [...seen];
}

export function toCsv(rows: readonly DataRecord[], columns: readonly string[]): string {
  const header = columns.map(escapeCsvCell).join(",");
  const body = rows.map((row) =>
    columns.map((column) => escapeCsvCell(row[column] ?? null)).join(","),
  );
  return [header, ...body].join("\n");
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
