export function buildDeepResearchQueries(
  topic: string,
  maxQueries: number,
): Array<{ query: string }> {
  const trimmedTopic = topic.trim();
  const templates = [
    `${trimmedTopic} current landscape overview and authoritative primary sources`,
    `${trimmedTopic} technical product and implementation details constraints`,
    `${trimmedTopic} risks limitations failure modes criticism`,
    `${trimmedTopic} evidence data benchmarks case studies adoption`,
    `${trimmedTopic} legal regulatory economic and operational considerations`,
    `${trimmedTopic} recent developments future trends disagreements open questions`,
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
