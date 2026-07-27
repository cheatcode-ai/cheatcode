import { coerceNumber, csvToRecords } from "./records";
import {
  type AnalyzeCsvInput,
  AnalyzeCsvInputSchema,
  type AnalyzeCsvOutput,
  AnalyzeCsvOutputSchema,
  type DataRecord,
} from "./schemas";

interface ProfileColumnResult {
  emptyCount: number;
  kind: "boolean" | "date" | "empty" | "mixed" | "number" | "string";
  name: string;
  nonEmptyCount: number;
  numeric?: {
    max: number;
    mean: number;
    median: number;
    min: number;
    standardDeviation: number;
    sum: number;
  };
  topValues: { count: number; value: string }[];
  uniqueCount: number;
}

export function executeAnalyzeCsv(input: AnalyzeCsvInput): AnalyzeCsvOutput {
  const parsed = AnalyzeCsvInputSchema.parse(input);
  const table = csvToRecords(parsed.csv, parsed.delimiter);
  const columns = table.columns.map((column) => profileColumn(column, table.rows));
  const metricColumns =
    parsed.metricColumns.length > 0 ? parsed.metricColumns : inferMetricColumns(columns);
  const groups = parsed.groupBy
    ? groupRows(table.rows, parsed.groupBy, metricColumns).slice(0, 50)
    : undefined;

  return AnalyzeCsvOutputSchema.parse({
    columns,
    ...(groups ? { groups } : {}),
    rowCount: table.rowCount,
    sampleRows: table.rows.slice(0, parsed.maxSampleRows),
  });
}

function profileColumn(name: string, rows: readonly DataRecord[]): ProfileColumnResult {
  const values = rows.map((row) => row[name] ?? null);
  const nonEmpty = values.filter((value) => value !== null && value !== "");
  const numericValues = nonEmpty
    .map((value) => coerceNumber(value))
    .filter((value): value is number => value !== null);
  const topValues = topValueCounts(nonEmpty);
  return {
    emptyCount: values.length - nonEmpty.length,
    kind: inferKind(nonEmpty, numericValues),
    name,
    nonEmptyCount: nonEmpty.length,
    ...(numericValues.length > 0 ? { numeric: numericSummary(numericValues) } : {}),
    topValues,
    uniqueCount: new Set(nonEmpty.map((value) => String(value))).size,
  };
}

function inferKind(
  values: readonly DataRecord[string][],
  numericValues: readonly number[],
): ProfileColumnResult["kind"] {
  if (values.length === 0) {
    return "empty";
  }
  if (numericValues.length === values.length) {
    return "number";
  }
  if (values.every((value) => typeof value === "boolean")) {
    return "boolean";
  }
  if (values.every((value) => typeof value === "string" && !Number.isNaN(Date.parse(value)))) {
    return "date";
  }
  if (values.every((value) => typeof value === "string")) {
    return "string";
  }
  return "mixed";
}

function numericSummary(values: readonly number[]) {
  const sorted = [...values].sort((left, right) => left - right);
  const sum = sorted.reduce((total, value) => total + value, 0);
  const mean = sum / sorted.length;
  const variance =
    sorted.reduce((total, value) => total + (value - mean) ** 2, 0) / Math.max(sorted.length, 1);
  return {
    max: sorted[sorted.length - 1] ?? 0,
    mean,
    median: median(sorted),
    min: sorted[0] ?? 0,
    standardDeviation: Math.sqrt(variance),
    sum,
  };
}

function median(sortedValues: readonly number[]): number {
  if (sortedValues.length === 0) {
    return 0;
  }
  const middle = Math.floor(sortedValues.length / 2);
  const right = sortedValues[middle] ?? 0;
  if (sortedValues.length % 2 === 1) {
    return right;
  }
  const left = sortedValues[middle - 1] ?? right;
  return (left + right) / 2;
}

function topValueCounts(values: readonly DataRecord[string][]): { count: number; value: string }[] {
  const counts = new Map<string, number>();
  for (const value of values) {
    const key = String(value);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([value, count]) => ({ count, value }))
    .sort((left, right) => right.count - left.count || left.value.localeCompare(right.value))
    .slice(0, 10);
}

function inferMetricColumns(columns: readonly ProfileColumnResult[]): string[] {
  return columns
    .filter((column) => column.kind === "number")
    .map((column) => column.name)
    .slice(0, 6);
}

function groupRows(rows: readonly DataRecord[], groupBy: string, metricColumns: readonly string[]) {
  const groups = new Map<string, DataRecord[]>();
  for (const row of rows) {
    const key = String(row[groupBy] ?? "");
    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key)?.push(row);
  }

  return [...groups.entries()]
    .map(([group, groupedRows]) => ({
      count: groupedRows.length,
      group,
      metrics: Object.fromEntries(
        metricColumns.map((column) => {
          const values = groupedRows
            .map((row) => coerceNumber(row[column] ?? null))
            .filter((value): value is number => value !== null);
          const sum = values.reduce((total, value) => total + value, 0);
          return [column, { mean: values.length > 0 ? sum / values.length : 0, sum }];
        }),
      ),
    }))
    .sort((left, right) => right.count - left.count || left.group.localeCompare(right.group));
}
