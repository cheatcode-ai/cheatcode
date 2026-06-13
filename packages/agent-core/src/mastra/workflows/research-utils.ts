import type { ResearchFinding, ResearchSource } from "./research-schemas";

const URL_PATTERN = /https?:\/\/[^\s)\]}"'<>]+/g;

export function buildDeepResearchQueries(
  topic: string,
  maxQueries: number,
): Array<{ query: string }> {
  const trimmedTopic = topic.trim();
  const templates = [
    `${trimmedTopic} current overview and key facts`,
    `${trimmedTopic} recent developments and news`,
    `${trimmedTopic} market landscape competitors and alternatives`,
    `${trimmedTopic} technical details implementation constraints`,
    `${trimmedTopic} risks limitations criticism`,
    `${trimmedTopic} primary sources documentation reports`,
    `${trimmedTopic} case studies adoption examples`,
    `${trimmedTopic} pricing business model economics`,
    `${trimmedTopic} legal regulatory policy considerations`,
    `${trimmedTopic} future roadmap trends forecasts`,
    `${trimmedTopic} expert analysis long-form review`,
    `${trimmedTopic} data benchmarks statistics`,
  ];
  return dedupeQueries(templates)
    .slice(0, maxQueries)
    .map((query) => ({ query }));
}

export function buildFanoutQueries(input: {
  entities?: string[] | undefined;
  goal: string;
  maxQueries: number;
}): Array<{ query: string }> {
  const goal = input.goal.trim();
  if (input.entities && input.entities.length > 0) {
    return input.entities.slice(0, input.maxQueries).map((entity) => ({
      query: `${goal}: ${entity}`,
    }));
  }

  const templates = [
    `${goal} top entities overview`,
    `${goal} company and competitor landscape`,
    `${goal} pricing and packaging comparison`,
    `${goal} recent news and announcements`,
    `${goal} customer segments and use cases`,
    `${goal} product capabilities matrix`,
    `${goal} funding traction hiring signals`,
    `${goal} strengths weaknesses opportunities threats`,
    `${goal} market size and growth estimates`,
    `${goal} risks and open questions`,
  ];
  return dedupeQueries(templates)
    .slice(0, input.maxQueries)
    .map((query) => ({ query }));
}

export function extractSources(text: string): ResearchSource[] {
  const urls = text.match(URL_PATTERN) ?? [];
  const uniqueUrls = [...new Set(urls.map(cleanUrl))].filter(isHttpUrl);
  return uniqueUrls.map((url) => ({ url }));
}

export function mergeSources(findings: ResearchFinding[]): ResearchSource[] {
  const byUrl = new Map<string, ResearchSource>();
  for (const finding of findings) {
    for (const source of finding.sources) {
      if (!byUrl.has(source.url)) {
        byUrl.set(source.url, source);
      }
    }
  }
  return [...byUrl.values()];
}

function dedupeQueries(queries: string[]): string[] {
  const seen = new Set<string>();
  const deduped: string[] = [];
  for (const query of queries) {
    const normalized = query.trim().replace(/\s+/g, " ");
    const key = normalized.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      deduped.push(normalized);
    }
  }
  return deduped;
}

function cleanUrl(url: string): string {
  return url.replace(/[),.;:!?]+$/g, "");
}

function isHttpUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}
