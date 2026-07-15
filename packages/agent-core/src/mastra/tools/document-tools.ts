import {
  executeGenerateDocx,
  executeGeneratePdf,
  executeGenerateSlides,
  executeGenerateXlsx,
  GenerateDocumentInputSchema,
  GenerateDocxOutputSchema,
  GeneratePdfOutputSchema,
  GenerateSlidesInputSchema,
  GenerateSlidesOutputSchema,
  GenerateSpreadsheetInputSchema,
  GenerateXlsxOutputSchema,
} from "@cheatcode/tools-docs";
import { createTool } from "@mastra/core/tools";
import { codeRuntimeFromContext } from "./tool-runtime-context";

export const mastraDocsGenerateSlides = createTool({
  id: "docs_generate_slides",
  description:
    "Generate a PowerPoint deck from a structured title and slides. Returns a short-lived R2 download URL.",
  inputSchema: GenerateSlidesInputSchema,
  outputSchema: GenerateSlidesOutputSchema,
  execute: async (input, context) =>
    executeGenerateSlides(GenerateSlidesInputSchema.parse(input), codeRuntimeFromContext(context)),
});

export const mastraDocsGenerateDocx = createTool({
  id: "docs_generate_docx",
  description:
    "Generate a DOCX document from titled sections and paragraphs. Returns a short-lived R2 download URL.",
  inputSchema: GenerateDocumentInputSchema,
  outputSchema: GenerateDocxOutputSchema,
  execute: async (input, context) =>
    executeGenerateDocx(GenerateDocumentInputSchema.parse(input), codeRuntimeFromContext(context)),
});

export const mastraDocsGenerateXlsx = createTool({
  id: "docs_generate_xlsx",
  description:
    "Generate an XLSX workbook from sheets, columns, and rows. Returns a short-lived R2 download URL.",
  inputSchema: GenerateSpreadsheetInputSchema,
  outputSchema: GenerateXlsxOutputSchema,
  execute: async (input, context) =>
    executeGenerateXlsx(
      GenerateSpreadsheetInputSchema.parse(input),
      codeRuntimeFromContext(context),
    ),
});

export const mastraDocsGeneratePdf = createTool({
  id: "docs_generate_pdf",
  description:
    "Generate a PDF document from titled sections and paragraphs. Returns a short-lived R2 download URL.",
  inputSchema: GenerateDocumentInputSchema,
  outputSchema: GeneratePdfOutputSchema,
  execute: async (input, context) =>
    executeGeneratePdf(GenerateDocumentInputSchema.parse(input), codeRuntimeFromContext(context)),
});
