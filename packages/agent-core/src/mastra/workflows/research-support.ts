const MAX_RESEARCH_QUERY_CHARACTERS = 2_000;

export function buildDeepResearchQueries(
  topic: string,
  maxQueries: number,
): Array<{ query: string }> {
  const trimmedTopic = topic.trim();
  const angles = [
    "current landscape overview and authoritative primary sources",
    "technical product and implementation details constraints",
    "risks limitations failure modes criticism",
    "evidence data benchmarks case studies adoption",
    "legal regulatory economic and operational considerations",
    "recent developments future trends disagreements open questions",
  ];
  return dedupeQueries(angles.map((angle) => buildResearchQuery(trimmedTopic, angle)))
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
      query: buildResearchQuery(goal, entity, ": "),
    }));
  }

  const angles = [
    "top entities overview",
    "company and competitor landscape",
    "pricing and packaging comparison",
    "recent news and announcements",
    "customer segments and use cases",
    "product capabilities matrix",
    "funding traction hiring signals",
    "strengths weaknesses opportunities threats",
    "market size and growth estimates",
    "risks and open questions",
  ];
  return dedupeQueries(angles.map((angle) => buildResearchQuery(goal, angle)))
    .slice(0, input.maxQueries)
    .map((query) => ({ query }));
}

function buildResearchQuery(subject: string, qualifier: string, separator = " "): string {
  const suffix = `${separator}${qualifier}`;
  const maxSubjectCharacters = MAX_RESEARCH_QUERY_CHARACTERS - suffix.length;
  if (subject.length <= maxSubjectCharacters) {
    return `${subject}${suffix}`;
  }
  const candidate = subject.slice(0, maxSubjectCharacters - 1).trimEnd();
  const wordBoundary = candidate.lastIndexOf(" ");
  const bounded =
    wordBoundary >= maxSubjectCharacters * 0.75 ? candidate.slice(0, wordBoundary) : candidate;
  return `${bounded.trimEnd()}…${suffix}`;
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
