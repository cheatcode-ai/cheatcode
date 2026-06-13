---
name: deep-research
description: Produces a cited long-form research report on a complex question, fanning out parallel research probes when the topic spans many entities or angles. Use when the user asks for deep research, a cited report, market analysis, due diligence, a broad market scan, or a comprehensive investigation. Do NOT trigger for quick factual lookups.
license: MIT
compatibility: Requires Exa and Firecrawl research tools; fan-out mode requires Mastra workflows.
---

# Deep Research

Answer complex questions with sourced synthesis. The output should read like an analyst brief: clear thesis, cited evidence, disagreement handling, and confidence notes. When the question spans many entities or angles, fan out parallel probes first (see Fan-out Mode), then synthesize.

## Quick Start

1. Rewrite the user's ask into 3-6 research questions.
2. Create a source matrix with question, claim, evidence, URL, date, and confidence columns.
3. Search with `search_web_advanced`; use date/domain filters when appropriate.
4. Scrape authoritative sources with `firecrawl_scrape`.
5. Synthesize with inline citations and explicit uncertainty.

## Fan-out Mode

Use breadth first when the ask covers many independent entities (companies, tools, policies, markets): survey a population, compare many companies, or scan a market across 10-25 angles. Run it through the `research_fanout` workflow tool.

1. Identify the population to cover and the comparison criteria.
2. Define up to 25 independent probe slots with clear per-probe questions and source expectations.
3. Fan out the probes; keep them independent so slow or failed branches do not block the answer.
4. Use the same fields for every entity so the comparison is fair; track source URLs per cell.
5. Deduplicate facts, aliases, and repeated articles before synthesis.
6. Return a comparison matrix plus narrative answer; mark missing data as unknown, not blank.

## Research Workflow

| Phase | Action |
|---|---|
| Scope | Define question, timeframe, geography, and decision use |
| Search | Find primary sources first, then reputable secondary analysis |
| Extract | Capture claim, evidence, URL, date, author, and confidence |
| Compare | Resolve contradictions by source quality and recency |
| Synthesize | Write answer, not notes; include citations for important claims |

## Source Quality

- Tier 1: official docs, filings, datasets, standards, primary interviews.
- Tier 2: reputable journalism, analyst reports, academic papers.
- Tier 3: blogs, forums, social posts. Use for signals, not final claims.

## QA

- Every key claim has a citation.
- The report includes what would change the conclusion.
- Contradictions are explained, not hidden.
- The answer distinguishes fact, estimate, and inference.

## Deliverables

- Markdown report
- Source matrix
- Confidence and gaps

## References

- `reference.md` - source quality ladder, citation style, and synthesis checklist.
