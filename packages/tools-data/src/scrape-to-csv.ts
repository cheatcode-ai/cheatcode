import { inferColumns, normalizeRows, parseMarkdownTable, toCsv } from "./records";
import {
  type DataScrapeToCsvInput,
  DataScrapeToCsvInputSchema,
  type DataScrapeToCsvOutput,
  DataScrapeToCsvOutputSchema,
} from "./schemas";

export function executeDataScrapeToCsv(input: DataScrapeToCsvInput): DataScrapeToCsvOutput {
  const parsed = DataScrapeToCsvInputSchema.parse(input);
  const rows = parsed.records
    ? normalizeRows(parsed.records)
    : parseMarkdownTable(parsed.markdownTable ?? "");
  const columns = inferColumns(rows, parsed.columns);
  return DataScrapeToCsvOutputSchema.parse({
    columns,
    csv: toCsv(rows, columns),
    previewRows: rows.slice(0, 10),
    rowCount: rows.length,
    ...(parsed.sourceUrl ? { sourceUrl: parsed.sourceUrl } : {}),
  });
}
