import { z } from "zod";

const TextValueSchema = z.string().trim().min(1).max(5_000);

const ArtifactOutputSchema = z.strictObject({
  filename: z.string().min(1),
  kind: z.enum(["docx", "pdf", "slide", "xlsx"]),
  mimeType: z.string().min(1),
  outputId: z.string().min(1),
  sizeBytes: z.number().int().nonnegative(),
});

const SlideItemSchema = z.strictObject({
  bullets: z.array(TextValueSchema).max(8).default([]),
  heading: TextValueSchema,
  notes: z.string().max(10_000).optional(),
});

export const GenerateSlidesInputSchema = z.strictObject({
  filename: z.string().trim().min(1).max(160).optional(),
  slides: z.array(SlideItemSchema).min(1).max(40),
  theme: z.enum(["minimal", "corporate", "creative"]).default("minimal"),
  title: TextValueSchema,
});

const DocumentSectionSchema = z.strictObject({
  heading: TextValueSchema,
  paragraphs: z.array(TextValueSchema).min(1).max(20),
});

export const GenerateDocumentInputSchema = z.strictObject({
  filename: z.string().trim().min(1).max(160).optional(),
  sections: z.array(DocumentSectionSchema).min(1).max(80),
  title: TextValueSchema,
});

export const GenerateMarkdownPdfInputSchema = z.strictObject({
  filename: z.string().trim().min(1).max(160).optional(),
  markdown: z.string().trim().min(1).max(120_000),
  title: TextValueSchema.optional(),
});

const SpreadsheetCellSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);
const SpreadsheetRowSchema = z.record(z.string().min(1).max(80), SpreadsheetCellSchema);

const SpreadsheetSheetSchema = z.strictObject({
  columns: z.array(z.string().trim().min(1).max(80)).min(1).max(50),
  name: z.string().trim().min(1).max(31),
  rows: z.array(SpreadsheetRowSchema).max(2_000),
});

export const GenerateSpreadsheetInputSchema = z.strictObject({
  filename: z.string().trim().min(1).max(160).optional(),
  sheets: z.array(SpreadsheetSheetSchema).min(1).max(12),
  title: TextValueSchema,
});

export const GenerateDocxOutputSchema = z.strictObject({
  ...ArtifactOutputSchema.shape,
  kind: z.literal("docx"),
  sectionCount: z.number().int().positive(),
});

export const GeneratePdfOutputSchema = z.strictObject({
  ...ArtifactOutputSchema.shape,
  kind: z.literal("pdf"),
  sectionCount: z.number().int().positive(),
});

export const GenerateMarkdownPdfOutputSchema = z.strictObject({
  ...ArtifactOutputSchema.shape,
  blockCount: z.number().int().positive(),
  kind: z.literal("pdf"),
});

export const GenerateSlidesOutputSchema = z.strictObject({
  ...ArtifactOutputSchema.shape,
  kind: z.literal("slide"),
  slideCount: z.number().int().positive(),
});

export const GenerateXlsxOutputSchema = z.strictObject({
  ...ArtifactOutputSchema.shape,
  kind: z.literal("xlsx"),
  sheetCount: z.number().int().positive(),
});

export type GenerateDocumentInput = z.input<typeof GenerateDocumentInputSchema>;
export type GenerateDocxOutput = z.output<typeof GenerateDocxOutputSchema>;
export type GenerateMarkdownPdfInput = z.input<typeof GenerateMarkdownPdfInputSchema>;
export type GenerateMarkdownPdfOutput = z.output<typeof GenerateMarkdownPdfOutputSchema>;
export type GeneratePdfOutput = z.output<typeof GeneratePdfOutputSchema>;
export type GenerateSlidesInput = z.input<typeof GenerateSlidesInputSchema>;
export type GenerateSlidesOutput = z.output<typeof GenerateSlidesOutputSchema>;
export type GenerateSpreadsheetInput = z.input<typeof GenerateSpreadsheetInputSchema>;
export type GenerateXlsxOutput = z.output<typeof GenerateXlsxOutputSchema>;
