import { APIError } from "@cheatcode/observability";
import { z } from "zod/v4";

export const ResearchRuntimeContextSchema = z
  .object({
    exaApiKey: z.string().trim().min(1).optional(),
    firecrawlApiKey: z.string().trim().min(1).optional(),
  })
  .strict();

export type ResearchRuntimeContext = z.infer<typeof ResearchRuntimeContextSchema>;

export function requireResearchProviderKey(
  runtimeContext: ResearchRuntimeContext,
  provider: "exa" | "firecrawl",
): string {
  const apiKey = provider === "exa" ? runtimeContext.exaApiKey : runtimeContext.firecrawlApiKey;
  if (!apiKey) {
    const label = provider === "exa" ? "Exa" : "Firecrawl";
    throw new APIError(
      400,
      "byok_key_missing",
      `Add a ${label} BYOK key before using ${provider} research tools.`,
      {
        details: { provider },
        hint: `Open BYOK Settings and save a ${label} API key.`,
        retriable: false,
      },
    );
  }
  return apiKey;
}
