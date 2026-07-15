import { APIError } from "@cheatcode/observability";
import type { CodeRuntimeContext } from "@cheatcode/sandbox-contracts";
import { buildChartComponentSource, type ChartPoint, renderChartSvg } from "./chart-renderer";
import { csvToRecords, normalizeRows } from "./records";
import {
  type DataChartInput,
  DataChartInputSchema,
  type DataChartOutput,
  DataChartOutputSchema,
  type DataRecord,
} from "./schemas";

export async function executeDataChart(
  input: DataChartInput,
  runtimeContext: CodeRuntimeContext,
): Promise<DataChartOutput> {
  const parsed = DataChartInputSchema.parse(input);
  const rows = rowsFromInput(parsed);
  assertChartColumns(parsed, rows);
  const svg = renderChartSvg(parsed, chartPoints(parsed, rows));
  const filename = normalizeFilename(parsed.filename ?? parsed.title, "svg");
  const artifact = runtimeContext.artifacts
    ? await runtimeContext.artifacts.put({
        contentType: "image/svg+xml",
        data: utf8ToBytes(svg),
        filename,
        kind: "image",
        metadata: {
          chartType: parsed.chartType,
          rowCount: rows.length,
          xKey: parsed.xKey,
          yKeys: parsed.yKeys,
        },
      })
    : undefined;

  return DataChartOutputSchema.parse({
    ...(artifact ? { artifact } : {}),
    chartType: parsed.chartType,
    componentSource: buildChartComponentSource(
      parsed,
      projectChartRows(parsed, rows.slice(0, 100)),
    ),
    height: parsed.height,
    rowCount: rows.length,
    svg,
    title: parsed.title,
    width: parsed.width,
    xKey: parsed.xKey,
    yKeys: parsed.yKeys,
  });
}

function rowsFromInput(input: DataChartInput): DataRecord[] {
  if (input.csv) {
    return csvToRecords(input.csv, input.delimiter, { maxColumns: 100, maxRows: 5_000 }).rows.slice(
      0,
      500,
    );
  }
  return normalizeRows(input.rows ?? []).slice(0, 500);
}

function projectChartRows(input: DataChartInput, rows: readonly DataRecord[]): DataRecord[] {
  return rows.map((row) =>
    Object.fromEntries([input.xKey, ...input.yKeys].map((key) => [key, row[key] ?? null])),
  );
}

function assertChartColumns(input: DataChartInput, rows: readonly DataRecord[]): void {
  const first = rows[0];
  if (!first) {
    throw new APIError(400, "invalid_request_body", "Chart data has no rows", {
      retriable: false,
    });
  }
  const keys = new Set(Object.keys(first));
  const missing = [input.xKey, ...input.yKeys].filter((key) => !keys.has(key));
  if (missing.length > 0) {
    throw new APIError(400, "invalid_request_body", "Chart columns are missing", {
      details: { missing },
      retriable: false,
    });
  }
}

function chartPoints(input: DataChartInput, rows: readonly DataRecord[]): ChartPoint[] {
  return rows.map((row, rowIndex) => ({
    label: String(row[input.xKey] ?? ""),
    values: input.yKeys.map((key) => numericChartValue(row[key], key, rowIndex)),
  }));
}

function numericChartValue(value: unknown, key: string, rowIndex: number): number {
  const numeric = typeof value === "number" ? value : Number(String(value ?? "").trim());
  if (!Number.isFinite(numeric)) {
    throw new APIError(400, "invalid_request_body", "Chart series values must be numeric", {
      details: { column: key, row: rowIndex + 1 },
      retriable: false,
    });
  }
  return numeric;
}

function normalizeFilename(value: string, extension: string): string {
  const base = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 96);
  const safeBase = base.length > 0 ? base : "cheatcode-chart";
  return safeBase.endsWith(`.${extension}`) ? safeBase : `${safeBase}.${extension}`;
}

function utf8ToBytes(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}
