import type { ArtifactUploadIntentRecord } from "@cheatcode/db";
import { z } from "zod";

const ARTIFACT_INTENT_PAGE_SIZE = 50;
const ArtifactIntentPageSchema = z
  .array(
    z
      .object({
        id: z.string().uuid(),
        r2Key: z.string().min(1),
      })
      .strict(),
  )
  .max(ARTIFACT_INTENT_PAGE_SIZE);

type ActionOutcome = "advanced" | "completed" | "noop";

export interface UserDeletionArtifactIntentRuntime {
  advance(phase: "archive" | "objects"): Promise<ActionOutcome>;
  deleteRows(intents: ArtifactUploadIntentRecord[]): Promise<number | null>;
  list(): Promise<unknown>;
}

export async function processUserDeletionArtifactIntents(
  runtime: UserDeletionArtifactIntentRuntime,
): Promise<ActionOutcome> {
  const page = ArtifactIntentPageSchema.parse(await runtime.list());
  if (page.length === 0) {
    return runtime.advance("archive");
  }
  const removed = await runtime.deleteRows(page.map(artifactIntentFromWire));
  if (removed === null) {
    return "noop";
  }
  if (removed !== page.length) {
    throw artifactIntentInvariant("Account artifact-intent cleanup lost an exact row identity");
  }
  return runtime.advance("objects");
}

export function artifactIntentsToWire(intents: ArtifactUploadIntentRecord[]) {
  return intents;
}

function artifactIntentFromWire(
  intent: z.infer<typeof ArtifactIntentPageSchema>[number],
): ArtifactUploadIntentRecord {
  return intent;
}

function artifactIntentInvariant(message: string): Error & { retriable: false } {
  return Object.assign(new Error(message), { retriable: false as const });
}

export { ARTIFACT_INTENT_PAGE_SIZE };
