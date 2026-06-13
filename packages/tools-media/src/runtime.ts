import { APIError } from "@cheatcode/observability";
import type { ArtifactRuntime } from "@cheatcode/tools-code";
import { z } from "zod/v4";

function isArtifactRuntime(value: unknown): value is ArtifactRuntime {
  return (
    typeof value === "object" &&
    value !== null &&
    "put" in value &&
    typeof (value as { put?: unknown }).put === "function"
  );
}

function isFetchLike(value: unknown): value is typeof fetch {
  return typeof value === "function";
}

export const MediaRuntimeContextSchema = z
  .object({
    artifacts: z.custom<ArtifactRuntime>(isArtifactRuntime).optional(),
    elevenlabsApiKey: z.string().trim().min(1).optional(),
    falApiKey: z.string().trim().min(1).optional(),
    fetch: z.custom<typeof fetch>(isFetchLike).optional(),
  })
  .strict();

export type MediaRuntimeContext = z.infer<typeof MediaRuntimeContextSchema>;

export function requireMediaProviderKey(
  runtimeContext: MediaRuntimeContext,
  provider: "elevenlabs" | "fal",
): string {
  const apiKey = provider === "fal" ? runtimeContext.falApiKey : runtimeContext.elevenlabsApiKey;
  if (!apiKey) {
    const label = provider === "fal" ? "FAL" : "ElevenLabs";
    throw new APIError(
      400,
      "byok_key_missing",
      `Add a ${label} BYOK key before using ${provider} media tools.`,
      {
        details: { provider },
        hint: `Open BYOK Settings and save a ${label} API key.`,
        retriable: false,
      },
    );
  }
  return apiKey;
}

export function requireArtifactRuntime(runtimeContext: MediaRuntimeContext): ArtifactRuntime {
  if (!runtimeContext.artifacts) {
    throw new Error("Artifact storage is unavailable for media generation.");
  }
  return runtimeContext.artifacts;
}

export function mediaFetch(runtimeContext: MediaRuntimeContext): typeof fetch {
  return runtimeContext.fetch ?? fetch;
}
