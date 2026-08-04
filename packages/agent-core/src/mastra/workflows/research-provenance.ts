import { RequestContext } from "@mastra/core/request-context";
import { z } from "zod/v4";
import {
  type ResearchClaim,
  ResearchFindingSchema,
  type ResearchSource,
  ResearchSourceSchema,
} from "./research-schemas";

const RESEARCH_EVIDENCE_CONTEXT_KEY = "researchEvidenceCollector";
const COLLECTOR_BRAND = Symbol("research-evidence-collector");

const HttpUrlSchema = z.string().url();

const SourceReferenceSchema = z.discriminatedUnion("provider", [
  z.strictObject({
    provider: z.literal("exa"),
    providerResultId: z.string().trim().min(1).max(500),
    url: HttpUrlSchema,
  }),
  z.strictObject({
    provider: z.literal("firecrawl"),
    url: HttpUrlSchema,
  }),
]);

const SourceReferenceDraftSchema = z.strictObject({
  provider: z.enum(["exa", "firecrawl"]),
  providerResultId: z.string().trim().max(500),
  url: z.string().trim().min(1),
});

export const ResearchPassDraftSchema = z.strictObject({
  claims: z
    .array(
      z.strictObject({
        claim: z.string().trim().min(1).max(800),
        sources: z.array(SourceReferenceDraftSchema).min(1).max(3),
      }),
    )
    .min(1)
    .max(6),
  summary: z.string().trim().min(1).max(2_000),
});

export const ResearchSynthesisDraftSchema = z.strictObject({
  claims: z
    .array(
      z.strictObject({
        claim: z.string().trim().min(1).max(800),
        sourceIds: z.array(z.string().trim().min(1).max(4_096)).min(1).max(4),
      }),
    )
    .min(1)
    .max(16),
  report: z.string().trim().min(1).max(12_000),
});

type SourceReference = z.infer<typeof SourceReferenceSchema>;
type SourceReferenceDraft = z.infer<typeof SourceReferenceDraftSchema>;
type ResearchPassDraft = z.infer<typeof ResearchPassDraftSchema>;

interface EvidenceCollector {
  readonly [COLLECTOR_BRAND]: true;
  add(source: ResearchSource): void;
  resolve(reference: SourceReference): ResearchSource | undefined;
}

export function createResearchStepContext(parent: RequestContext): {
  collector: EvidenceCollector;
  requestContext: RequestContext;
} {
  const requestContext = new RequestContext(parent.entries());
  const collector = createEvidenceCollector();
  requestContext.set(RESEARCH_EVIDENCE_CONTEXT_KEY, collector);
  return { collector, requestContext };
}

export function registerResearchSources(context: unknown, sources: ResearchSource[]): void {
  const collector = evidenceCollectorFromToolContext(context);
  if (!collector) {
    return;
  }
  for (const source of sources) {
    collector.add(ResearchSourceSchema.parse(source));
  }
}

export function validateResearchPass(
  draft: ResearchPassDraft,
  query: string,
  collector: EvidenceCollector,
) {
  const citedSources = new Map<string, ResearchSource>();
  const claims = draft.claims.map((claim) => ({
    claim: claim.claim,
    sourceIds: resolveClaimSources(
      claim.sources.map(sourceReferenceFromDraft),
      collector,
      citedSources,
    ),
  }));
  return ResearchFindingSchema.parse({
    claims,
    query,
    sources: [...citedSources.values()],
    summary: draft.summary,
  });
}

function sourceReferenceFromDraft(draft: SourceReferenceDraft): SourceReference {
  if (draft.provider === "exa") {
    return SourceReferenceSchema.parse({
      provider: draft.provider,
      providerResultId: draft.providerResultId,
      url: draft.url,
    });
  }
  if (draft.providerResultId.length > 0) {
    throw new Error("A Firecrawl citation cannot include an Exa result identifier.");
  }
  return SourceReferenceSchema.parse({ provider: draft.provider, url: draft.url });
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

function createEvidenceCollector(): EvidenceCollector {
  const sources = new Map<string, ResearchSource>();
  return {
    [COLLECTOR_BRAND]: true,
    add(source) {
      const current = sources.get(source.id);
      if (current && current.url !== source.url) {
        throw new Error("Research provider returned a conflicting source identifier.");
      }
      sources.set(source.id, current?.title ? current : source);
    },
    resolve(reference) {
      const url = new URL(reference.url).href;
      const id =
        reference.provider === "exa" ? `exa:${reference.providerResultId}` : `firecrawl:${url}`;
      const source = sources.get(id);
      return source?.url === url ? source : undefined;
    },
  };
}

function resolveClaimSources(
  references: SourceReference[],
  collector: EvidenceCollector,
  citedSources: Map<string, ResearchSource>,
): string[] {
  const sourceIds = new Set<string>();
  for (const reference of references) {
    const source = collector.resolve(reference);
    if (!source) {
      throw new Error("Research claim cited a source that was not returned by a provider.");
    }
    citedSources.set(source.id, source);
    sourceIds.add(source.id);
  }
  return [...sourceIds];
}

function evidenceCollectorFromToolContext(context: unknown): EvidenceCollector | undefined {
  if (!context || typeof context !== "object") {
    return undefined;
  }
  const requestContext = (context as { requestContext?: unknown }).requestContext;
  if (!requestContext || typeof requestContext !== "object") {
    return undefined;
  }
  const get = (requestContext as { get?: unknown }).get;
  if (typeof get !== "function") {
    return undefined;
  }
  const collector = get.call(requestContext, RESEARCH_EVIDENCE_CONTEXT_KEY) as unknown;
  return isEvidenceCollector(collector) ? collector : undefined;
}

function isEvidenceCollector(value: unknown): value is EvidenceCollector {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as Partial<EvidenceCollector>)[COLLECTOR_BRAND] === true
  );
}
