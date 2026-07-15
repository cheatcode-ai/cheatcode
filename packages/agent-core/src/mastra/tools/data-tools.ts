import {
  AnalyzeCsvInputSchema,
  AnalyzeCsvOutputSchema,
  DataChartInputSchema,
  DataChartOutputSchema,
  DataScrapeToCsvInputSchema,
  DataScrapeToCsvOutputSchema,
  executeAnalyzeCsv,
  executeDataChart,
  executeDataScrapeToCsv,
} from "@cheatcode/tools-data";
import { createTool } from "@mastra/core/tools";
import { codeRuntimeFromContext } from "./tool-runtime-context";

export const mastraDataAnalyzeCsv = createTool({
  id: "data_analyze_csv",
  description:
    "Profile CSV text with Arquero parsing. Returns column types, missing counts, numeric summaries, top values, samples, and optional grouped aggregates.",
  inputSchema: AnalyzeCsvInputSchema,
  outputSchema: AnalyzeCsvOutputSchema,
  execute: async (input) => executeAnalyzeCsv(AnalyzeCsvInputSchema.parse(input)),
});

export const mastraDataChart = createTool({
  id: "data_chart",
  description:
    "Render a Recharts bar, line, or area chart from CSV or rows inside the project sandbox and return static SVG plus component source.",
  inputSchema: DataChartInputSchema,
  outputSchema: DataChartOutputSchema,
  execute: async (input, context) =>
    executeDataChart(DataChartInputSchema.parse(input), codeRuntimeFromContext(context)),
});

export const mastraDataScrapeToCsv = createTool({
  id: "data_scrape_to_csv",
  description:
    "Normalize Firecrawl/Exa extracted records or markdown tables into deterministic CSV with a preview.",
  inputSchema: DataScrapeToCsvInputSchema,
  outputSchema: DataScrapeToCsvOutputSchema,
  execute: async (input) => executeDataScrapeToCsv(DataScrapeToCsvInputSchema.parse(input)),
});
