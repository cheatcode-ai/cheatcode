import { z } from "zod";

const TextValueSchema = z.string().trim().min(1).max(5_000);

const ArtifactOutputSchema = z
  .object({
    downloadUrl: z.string().url(),
    filename: z.string().min(1),
    kind: z.enum(["docx", "pdf", "slide", "xlsx"]),
    mimeType: z.string().min(1),
    outputId: z.string().min(1),
    r2Key: z.string().min(1),
    sizeBytes: z.number().int().nonnegative(),
  })
  .strict();

const SlideItemSchema = z
  .object({
    bullets: z.array(TextValueSchema).max(8).default([]),
    heading: TextValueSchema,
    notes: z.string().max(10_000).optional(),
  })
  .strict();

export const GenerateSlidesInputSchema = z
  .object({
    filename: z.string().trim().min(1).max(160).optional(),
    slides: z.array(SlideItemSchema).min(1).max(40),
    theme: z.enum(["minimal", "corporate", "creative"]).default("minimal"),
    title: TextValueSchema,
  })
  .strict();

const DocumentSectionSchema = z
  .object({
    heading: TextValueSchema,
    paragraphs: z.array(TextValueSchema).min(1).max(20),
  })
  .strict();

export const GenerateDocumentInputSchema = z
  .object({
    filename: z.string().trim().min(1).max(160).optional(),
    sections: z.array(DocumentSectionSchema).min(1).max(80),
    title: TextValueSchema,
  })
  .strict();

const SpreadsheetCellSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);
const SpreadsheetRowSchema = z.record(z.string().min(1).max(80), SpreadsheetCellSchema);

const SpreadsheetSheetSchema = z
  .object({
    columns: z.array(z.string().trim().min(1).max(80)).min(1).max(50),
    name: z.string().trim().min(1).max(31),
    rows: z.array(SpreadsheetRowSchema).max(2_000),
  })
  .strict();

export const GenerateSpreadsheetInputSchema = z
  .object({
    filename: z.string().trim().min(1).max(160).optional(),
    sheets: z.array(SpreadsheetSheetSchema).min(1).max(12),
    title: TextValueSchema,
  })
  .strict();

export const GenerateDocxOutputSchema = ArtifactOutputSchema.extend({
  kind: z.literal("docx"),
  sectionCount: z.number().int().positive(),
}).strict();

export const GeneratePdfOutputSchema = ArtifactOutputSchema.extend({
  kind: z.literal("pdf"),
  sectionCount: z.number().int().positive(),
}).strict();

export const GenerateSlidesOutputSchema = ArtifactOutputSchema.extend({
  kind: z.literal("slide"),
  slideCount: z.number().int().positive(),
}).strict();

export const GenerateXlsxOutputSchema = ArtifactOutputSchema.extend({
  kind: z.literal("xlsx"),
  sheetCount: z.number().int().positive(),
}).strict();

export type GenerateDocumentInput = z.input<typeof GenerateDocumentInputSchema>;
export type GenerateDocxOutput = z.output<typeof GenerateDocxOutputSchema>;
export type GeneratePdfOutput = z.output<typeof GeneratePdfOutputSchema>;
export type GenerateSlidesInput = z.input<typeof GenerateSlidesInputSchema>;
export type GenerateSlidesOutput = z.output<typeof GenerateSlidesOutputSchema>;
export type GenerateSpreadsheetInput = z.input<typeof GenerateSpreadsheetInputSchema>;
export type GenerateXlsxOutput = z.output<typeof GenerateXlsxOutputSchema>;
