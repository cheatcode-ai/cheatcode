import { z } from "zod";

/** Exact artifact kinds that can be stored, streamed, and rendered by V2. */
export const ARTIFACT_KINDS = ["docx", "image", "pdf", "slide", "video", "xlsx"] as const;

export const ArtifactKindSchema = z.enum(ARTIFACT_KINDS);
export const OutputIdSchema = z.string().uuid();

export const OutputDownloadUrlSchema = z
  .string()
  .url()
  .refine(isSafeOutputDownloadUrl, "Output download URL must use HTTPS");

export const OutputDownloadUrlResponseSchema = z
  .object({
    downloadUrl: OutputDownloadUrlSchema,
    expiresAt: z.string().datetime({ offset: true }),
  })
  .strict();

export type ArtifactKind = z.infer<typeof ArtifactKindSchema>;
export type OutputDownloadUrlResponse = z.infer<typeof OutputDownloadUrlResponseSchema>;

function isSafeOutputDownloadUrl(value: string): boolean {
  try {
    const url = new URL(value);
    const isLoopback = url.hostname === "localhost" || url.hostname === "127.0.0.1";
    return (
      !url.username &&
      !url.password &&
      (url.protocol === "https:" || (isLoopback && url.protocol === "http:"))
    );
  } catch {
    return false;
  }
}
