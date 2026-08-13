import { z } from "zod";

const MediaReferenceSchema = z
  .string()
  .trim()
  .min(1)
  .max(2_048)
  .describe("A project-relative or absolute sandbox path, or a public HTTPS URL.");

const MediaPromptSchema = z.string().trim().min(3).max(20_000);

export const GenerateOrEditImageInputSchema = z.strictObject({
  aspect_ratio: z
    .enum(["1:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9"])
    .optional(),
  image_reference_mode: z.enum(["reference_generate", "edit"]).optional(),
  prompt: MediaPromptSchema,
  reference_images: z.array(MediaReferenceSchema).max(8).optional(),
});

export const GenerateOrExtendVideoInputSchema = z
  .strictObject({
    aspect_ratio: z.enum(["16:9", "9:16"]).optional(),
    duration: z.union([z.literal(4), z.literal(6), z.literal(8)]).optional(),
    prompt: MediaPromptSchema,
    reference_images: z.array(MediaReferenceSchema).max(3).optional(),
    reference_video: MediaReferenceSchema.optional(),
  })
  .superRefine((input, context) => {
    if (input.reference_images?.length && input.reference_video) {
      context.addIssue({
        code: "custom",
        message: "reference_images and reference_video are mutually exclusive.",
        path: ["reference_video"],
      });
    }
  });

const MediaArtifactShape = {
  filename: z.string().min(1),
  mimeType: z.string().min(1),
  outputId: z.string().min(1),
  sizeBytes: z.number().int().nonnegative(),
} as const;

export const GenerateImageOutputSchema = z.strictObject({
  artifact: z.strictObject({ ...MediaArtifactShape, kind: z.literal("image") }),
  model: z.string().min(1),
  sandboxPath: z.string().min(1),
  type: z.literal("image"),
});

export const GenerateVideoOutputSchema = z.strictObject({
  artifact: z.strictObject({ ...MediaArtifactShape, kind: z.literal("video") }),
  model: z.string().min(1),
  sandboxPath: z.string().min(1),
  type: z.literal("video"),
});

export type GenerateOrEditImageInput = z.input<typeof GenerateOrEditImageInputSchema>;
export type GenerateOrExtendVideoInput = z.input<typeof GenerateOrExtendVideoInputSchema>;
export type GenerateImageOutput = z.output<typeof GenerateImageOutputSchema>;
export type GenerateVideoOutput = z.output<typeof GenerateVideoOutputSchema>;
