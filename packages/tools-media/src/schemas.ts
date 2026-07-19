import { z } from "zod";

const MediaReferenceSchema = z
  .string()
  .trim()
  .min(1)
  .max(2_048)
  .describe("A project-relative or absolute sandbox path, or a public HTTPS URL.");

export const GenerateOrEditMediaInputSchema = z
  .object({
    aspect_ratio: z
      .enum(["1:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9"])
      .optional(),
    duration: z.union([z.literal(4), z.literal(6), z.literal(8)]).optional(),
    image_reference_mode: z.enum(["reference_generate", "edit"]).optional(),
    prompt: z.string().trim().min(3).max(20_000),
    reference_images: z.array(MediaReferenceSchema).max(8).optional(),
    reference_video: MediaReferenceSchema.optional(),
    type: z.enum(["image", "video"]),
  })
  .strict()
  .superRefine((input, context) => {
    if (input.reference_images?.length && input.reference_video) {
      context.addIssue({
        code: "custom",
        message: "reference_images and reference_video are mutually exclusive.",
        path: ["reference_video"],
      });
    }
    if (input.type === "image" && (input.duration || input.reference_video)) {
      context.addIssue({
        code: "custom",
        message: "duration and reference_video are video-only parameters.",
        path: ["type"],
      });
    }
    if (input.type === "video" && (input.reference_images?.length ?? 0) > 3) {
      context.addIssue({
        code: "custom",
        message: "Video generation supports at most three reference images.",
        path: ["reference_images"],
      });
    }
    if (
      input.type === "video" &&
      input.aspect_ratio &&
      !["16:9", "9:16"].includes(input.aspect_ratio)
    ) {
      context.addIssue({
        code: "custom",
        message: "Video generation supports 16:9 or 9:16.",
        path: ["aspect_ratio"],
      });
    }
  });

const MediaArtifactSchema = z
  .object({
    filename: z.string().min(1),
    kind: z.enum(["image", "video"]),
    mimeType: z.string().min(1),
    outputId: z.string().min(1),
    sizeBytes: z.number().int().nonnegative(),
  })
  .strict();

export const GenerateOrEditMediaOutputSchema = z
  .object({
    artifact: MediaArtifactSchema,
    model: z.string().min(1),
    sandboxPath: z.string().min(1),
    type: z.enum(["image", "video"]),
  })
  .strict();

export type GenerateOrEditMediaInput = z.input<typeof GenerateOrEditMediaInputSchema>;
export type GenerateOrEditMediaOutput = z.output<typeof GenerateOrEditMediaOutputSchema>;
