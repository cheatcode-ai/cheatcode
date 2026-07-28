import { z } from "zod";

const DATA_RECORD_MAX_BYTES = 256 * 1024;
const DataCellSchema = z.union([z.string().max(10_000), z.number(), z.boolean(), z.null()]);
const DataRecordSchema = z
  .record(z.string().min(1).max(200), DataCellSchema)
  .refine((value) => Object.keys(value).length <= 100, { message: "Record has too many fields." });

const ColumnKindSchema = z.enum(["boolean", "date", "empty", "mixed", "number", "string"]);

const NumericSummarySchema = z
  .object({
    max: z.number(),
    mean: z.number(),
    median: z.number(),
    min: z.number(),
    standardDeviation: z.number(),
    sum: z.number(),
  })
  .strict();

const TopValueSchema = z
  .object({
    count: z.number().int().nonnegative(),
    value: z.string().max(10_000),
  })
  .strict();

const ColumnProfileSchema = z
  .object({
    emptyCount: z.number().int().nonnegative(),
    kind: ColumnKindSchema,
    name: z.string().max(200),
    nonEmptyCount: z.number().int().nonnegative(),
    numeric: NumericSummarySchema.optional(),
    topValues: z.array(TopValueSchema),
    uniqueCount: z.number().int().nonnegative(),
  })
  .strict();

const GroupSummarySchema = z
  .object({
    count: z.number().int().nonnegative(),
    group: z.string().max(10_000),
    metrics: z.record(
      z.string(),
      z
        .object({
          mean: z.number(),
          sum: z.number(),
        })
        .strict(),
    ),
  })
  .strict();

export const AnalyzeCsvInputSchema = z
  .object({
    csv: z.string().min(1).max(1_000_000).describe("CSV text to profile."),
    delimiter: z.string().min(1).max(4).default(",").describe("CSV delimiter."),
    groupBy: z
      .string()
      .min(1)
      .max(200)
      .optional()
      .describe("Optional column to group by for aggregate summaries."),
    maxSampleRows: z
      .number()
      .int()
      .min(1)
      .max(50)
      .default(10)
      .describe("Maximum normalized sample rows to include."),
    metricColumns: z
      .array(z.string().min(1).max(200))
      .max(12)
      .default([])
      .describe("Numeric columns to aggregate when groupBy is set."),
  })
  .strict();

export const AnalyzeCsvOutputSchema = z
  .object({
    columns: z.array(ColumnProfileSchema).max(100),
    groups: z.array(GroupSummarySchema).optional(),
    rowCount: z.number().int().nonnegative(),
    sampleRows: z.array(DataRecordSchema).max(50),
  })
  .strict();

const ChartTypeSchema = z.enum(["area", "bar", "line"]);

export const DataChartInputSchema = z
  .object({
    chartType: ChartTypeSchema.default("bar").describe("SVG chart family to render."),
    csv: z.string().min(1).max(1_000_000).optional().describe("CSV text to chart."),
    delimiter: z.string().min(1).max(4).default(",").describe("CSV delimiter when csv is used."),
    filename: z
      .string()
      .min(1)
      .max(160)
      .optional()
      .describe("Optional SVG filename for artifact upload."),
    height: z.number().int().min(240).max(1600).default(520).describe("Chart SVG height."),
    rows: z
      .array(DataRecordSchema)
      .max(500)
      .refine((value) => serializedSizeWithin(value, DATA_RECORD_MAX_BYTES), {
        message: "Chart records are too large.",
      })
      .optional()
      .describe("Already-extracted rows to chart. Use csv or rows, not both."),
    title: z.string().min(1).max(200).default("Cheatcode Chart").describe("Chart title."),
    width: z.number().int().min(360).max(2400).default(920).describe("Chart SVG width."),
    xKey: z.string().min(1).max(200).describe("Categorical/date x-axis column."),
    yKeys: z.array(z.string().min(1).max(200)).min(1).max(4).describe("Numeric series columns."),
  })
  .strict()
  .refine((input) => Boolean(input.csv) !== Boolean(input.rows), {
    message: "Provide exactly one of csv or rows.",
    path: ["csv"],
  });

const ChartArtifactSchema = z
  .object({
    filename: z.string(),
    kind: z.literal("image"),
    mimeType: z.string(),
    outputId: z.string(),
    sizeBytes: z.number().int().nonnegative(),
  })
  .strict();

export const DataChartOutputSchema = z
  .object({
    artifact: ChartArtifactSchema.optional(),
    chartType: ChartTypeSchema,
    componentSource: z.string().max(500_000),
    height: z.number().int().positive(),
    rowCount: z.number().int().nonnegative(),
    svg: z.string().max(2_000_000),
    title: z.string(),
    width: z.number().int().positive(),
    xKey: z.string(),
    yKeys: z.array(z.string()),
  })
  .strict();

export const DataScrapeToCsvInputSchema = z
  .object({
    columns: z
      .array(z.string().min(1).max(200))
      .max(100)
      .default([])
      .describe("Optional explicit output column order."),
    markdownTable: z
      .string()
      .min(1)
      .max(250_000)
      .optional()
      .describe("Markdown table scraped from a page."),
    records: z
      .array(DataRecordSchema)
      .max(2_000)
      .refine((value) => serializedSizeWithin(value, DATA_RECORD_MAX_BYTES), {
        message: "Structured records are too large.",
      })
      .optional()
      .describe("Structured records from Firecrawl/Exa extraction."),
    sourceUrl: z.string().url().optional().describe("Source URL used for provenance."),
  })
  .strict()
  .refine((input) => Boolean(input.markdownTable) !== Boolean(input.records), {
    message: "Provide exactly one of markdownTable or records.",
    path: ["records"],
  });

export const DataScrapeToCsvOutputSchema = z
  .object({
    columns: z.array(z.string().max(200)).max(100),
    csv: z.string().max(500_000),
    previewRows: z.array(DataRecordSchema).max(10),
    rowCount: z.number().int().nonnegative(),
    sourceUrl: z.string().url().optional(),
  })
  .strict();

export type AnalyzeCsvInput = z.infer<typeof AnalyzeCsvInputSchema>;
export type AnalyzeCsvOutput = z.infer<typeof AnalyzeCsvOutputSchema>;
export type DataChartInput = z.infer<typeof DataChartInputSchema>;
export type DataChartOutput = z.infer<typeof DataChartOutputSchema>;
export type DataRecord = z.infer<typeof DataRecordSchema>;
export type DataScrapeToCsvInput = z.infer<typeof DataScrapeToCsvInputSchema>;
export type DataScrapeToCsvOutput = z.infer<typeof DataScrapeToCsvOutputSchema>;

function serializedSizeWithin(value: unknown, maxBytes: number): boolean {
  try {
    const serialized = JSON.stringify(value);
    return serialized !== undefined && new TextEncoder().encode(serialized).byteLength <= maxBytes;
  } catch {
    return false;
  }
}
