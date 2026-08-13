import { createTool } from "@mastra/core/tools";
import {
  executeGenerateDocx,
  executeGeneratePdf,
  executeGenerateSlides,
  executeGenerateXlsx,
} from "../../tools/docs/execute";
import {
  GenerateDocumentInputSchema,
  GenerateDocxOutputSchema,
  GeneratePdfOutputSchema,
  GenerateSlidesInputSchema,
  GenerateSlidesOutputSchema,
  GenerateSpreadsheetInputSchema,
  GenerateXlsxOutputSchema,
} from "../../tools/docs/schemas";
import { workspaceRuntimeFromContext } from "./tool-runtime-context";

export const mastraDocsGenerateSlides = createTool({
  id: "docs_generate_slides",
  description:
    "Generate a structurally validated PowerPoint deck from an ordered array containing every visible slide, including any title slide. The title field is deck metadata and never adds another slide. Publishes the finished PPTX as a Deliverable and returns its exact project filePath. For routine structured decks, the returned slideCount is authoritative; do not convert or screenshot the deck unless the user explicitly requests visual inspection.",
  inputSchema: GenerateSlidesInputSchema,
  outputSchema: GenerateSlidesOutputSchema,
  execute: async (input, context) =>
    executeGenerateSlides(
      GenerateSlidesInputSchema.parse(input),
      await workspaceRuntimeFromContext(context),
    ),
});

export const mastraDocsGenerateDocx = createTool({
  id: "docs_generate_docx",
  description:
    "Generate a structurally validated DOCX document from titled sections and paragraphs. Publishes the finished DOCX as a Deliverable and returns its exact project filePath. For routine memos, reports, letters, briefs, and one-pagers, the returned sectionCount is authoritative; do not write a custom generator, run dependency probes, convert the document, search for the file, or screenshot it unless the user explicitly requests custom layout or visual inspection.",
  inputSchema: GenerateDocumentInputSchema,
  outputSchema: GenerateDocxOutputSchema,
  execute: async (input, context) =>
    executeGenerateDocx(
      GenerateDocumentInputSchema.parse(input),
      await workspaceRuntimeFromContext(context),
    ),
});

export const mastraDocsGenerateXlsx = createTool({
  id: "docs_generate_xlsx",
  description:
    "Generate an XLSX workbook from sheets, columns, scalar cells, and typed formula cells with cached results and number formats. Publishes it as a Deliverable and returns its exact project filePath; routine workbooks need no custom script or recalculation pass.",
  inputSchema: GenerateSpreadsheetInputSchema,
  outputSchema: GenerateXlsxOutputSchema,
  execute: async (input, context) =>
    executeGenerateXlsx(
      GenerateSpreadsheetInputSchema.parse(input),
      await workspaceRuntimeFromContext(context),
    ),
});

export const mastraDocsGeneratePdf = createTool({
  id: "docs_generate_pdf",
  description:
    "Generate a PDF document from titled sections and paragraphs. Publishes it as a Deliverable and returns its exact project filePath.",
  inputSchema: GenerateDocumentInputSchema,
  outputSchema: GeneratePdfOutputSchema,
  execute: async (input, context) =>
    executeGeneratePdf(
      GenerateDocumentInputSchema.parse(input),
      await workspaceRuntimeFromContext(context),
    ),
});
