import { z } from "zod";

/** Exact artifact kinds that can be stored, streamed, and rendered by V2. */
const ARTIFACT_KINDS = ["docx", "file", "image", "pdf", "slide", "video", "xlsx"] as const;

/** Reserved filename namespace for durable outputs that support the agent UI, not the user. */
export const INTERNAL_OUTPUT_FILENAME_PREFIX = ".cheatcode-internal-";

export const ArtifactExposureSchema = z.enum(["deliverable", "internal"]);

/** One generated deliverable stays bounded for Worker memory and sandbox transfer safety. */
export const GENERATED_OUTPUT_MAX_BYTES = 32 * 1024 * 1024;

export const ArtifactKindSchema = z.enum(ARTIFACT_KINDS);
export const OutputIdSchema = z.string().uuid();

const OutputDownloadUrlSchema = z
  .string()
  .url()
  .refine(isSafeOutputDownloadUrl, "Output download URL must use HTTPS");

export const OutputDownloadUrlResponseSchema = z.strictObject({
  downloadUrl: OutputDownloadUrlSchema,
  expiresAt: z.string().datetime({ offset: true }),
});

export type ArtifactKind = z.infer<typeof ArtifactKindSchema>;
export type ArtifactExposure = z.infer<typeof ArtifactExposureSchema>;
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
