import { APIError } from "@cheatcode/observability";
import type { CodeRuntimeContext } from "@cheatcode/tools-code";
import { z } from "zod";
import { buildChartComponentSource, buildChartScript } from "./chart-script";
import { csvToRecords, normalizeRows } from "./records";
import {
  type DataChartInput,
  DataChartInputSchema,
  type DataChartOutput,
  DataChartOutputSchema,
  type DataRecord,
} from "./schemas";

const ChartScriptOutputSchema = z
  .object({
    svg: z.string().min(1),
  })
  .strict();

export async function executeDataChart(
  input: DataChartInput,
  runtimeContext: CodeRuntimeContext,
): Promise<DataChartOutput> {
  const parsed = DataChartInputSchema.parse(input);
  const rows = rowsFromInput(parsed);
  assertChartColumns(parsed, rows);

  const result = await runtimeContext.sandbox.runCode({
    code: buildChartScript({ input: parsed, rows }),
    language: "javascript",
  });
  if (result.success !== true) {
    throw new APIError(502, "upstream_sandbox_failed", "Recharts chart rendering failed", {
      details: {
        stderrBytes: (result.stderr ?? "").length,
        stdoutBytes: (result.stdout ?? "").length,
      },
      retriable: false,
    });
  }

  const rendered = parseChartOutput(result.stdout ?? "");
  const filename = normalizeFilename(parsed.filename ?? parsed.title, "svg");
  const artifact = runtimeContext.artifacts
    ? await runtimeContext.artifacts.put({
        contentType: "image/svg+xml",
        data: utf8ToBytes(rendered.svg),
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
    componentSource: buildChartComponentSource(parsed, rows.slice(0, 100)),
    height: parsed.height,
    rowCount: rows.length,
    svg: rendered.svg,
    title: parsed.title,
    width: parsed.width,
    xKey: parsed.xKey,
    yKeys: parsed.yKeys,
  });
}

function rowsFromInput(input: DataChartInput): DataRecord[] {
  if (input.csv) {
    return csvToRecords(input.csv, input.delimiter).rows.slice(0, 2_000);
  }
  return normalizeRows(input.rows ?? []).slice(0, 2_000);
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

function parseChartOutput(stdout: string): z.infer<typeof ChartScriptOutputSchema> {
  try {
    return ChartScriptOutputSchema.parse(JSON.parse(stdout.trim()));
  } catch (error) {
    throw new APIError(502, "upstream_sandbox_failed", "Sandbox returned invalid chart output", {
      details: { error: error instanceof Error ? error.message : "Unknown parse error" },
      retriable: false,
    });
  }
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
