import { type ResearchClaim, type ResearchSource, ResearchSourceSchema } from "./research-schemas";

export function mergeResearchClaims(findings: Array<{ claims: ResearchClaim[] }>): ResearchClaim[] {
  const claims = new Map<string, ResearchClaim>();
  for (const finding of findings) {
    for (const claim of finding.claims) {
      const key = claim.claim.trim().replace(/\s+/g, " ").toLowerCase();
      const existing = claims.get(key);
      claims.set(key, {
        claim: existing?.claim ?? claim.claim,
        sourceIds: [...new Set([...(existing?.sourceIds ?? []), ...claim.sourceIds])].slice(0, 4),
      });
    }
  }
  return [...claims.values()].slice(0, 16);
}

export function validateSynthesisClaims(
  claims: ResearchClaim[],
  sources: ResearchSource[],
): ResearchClaim[] {
  const knownIds = new Set(sources.map((source) => source.id));
  return claims.map((claim) => {
    const sourceIds = [...new Set(claim.sourceIds)];
    if (sourceIds.some((sourceId) => !knownIds.has(sourceId))) {
      throw new Error("Research synthesis cited a source that was not collected by a provider.");
    }
    return { claim: claim.claim, sourceIds };
  });
}

export function mergeResearchSources(
  findings: Array<{ sources: ResearchSource[] }>,
): ResearchSource[] {
  const sources = new Map<string, ResearchSource>();
  for (const finding of findings) {
    for (const source of finding.sources) {
      const existing = sources.get(source.id);
      if (existing && existing.url !== source.url) {
        throw new Error("Research provider returned a conflicting source identifier.");
      }
      sources.set(source.id, existing ?? source);
    }
  }
  return [...sources.values()];
}

export function exaSource(input: {
  id: string;
  requestId: string;
  title: string | null;
  url: string;
}): ResearchSource {
  const url = new URL(input.url).href;
  return ResearchSourceSchema.parse({
    id: `exa:${input.id}`,
    provider: "exa",
    providerRequestId: input.requestId,
    providerResultId: input.id,
    ...(input.title ? { title: input.title } : {}),
    url,
  });
}

export function firecrawlSource(input: {
  title?: string | undefined;
  url: string;
}): ResearchSource {
  const url = new URL(input.url).href;
  return ResearchSourceSchema.parse({
    id: `firecrawl:${url}`,
    provider: "firecrawl",
    ...(input.title ? { title: input.title } : {}),
    url,
  });
}
