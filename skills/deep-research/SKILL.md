---
name: deep-research
description: Produces a cited long-form research report on a complex question, fanning out parallel research probes when the topic spans many entities or angles. Use when the user asks for deep research, a cited report, market analysis, due diligence, a broad market scan, or a comprehensive investigation. Do NOT trigger for quick factual lookups.
category: Research & Docs
tags: research, report, analysis
license: PolyForm-Noncommercial-1.0.0
compatibility: Requires Exa and Firecrawl research tools; fan-out mode requires Mastra workflows.
---

# Deep Research

Answer complex questions with sourced synthesis. The output should read like an analyst brief: clear thesis, cited evidence, disagreement handling, and confidence notes. Preserve the user's exact scope, requested count, distinctions, title, and exclusions; a narrow requested report stays narrow. Every run produces one canonical Markdown report that is shown unchanged in chat and rendered unchanged into the PDF deliverable. When the question spans many entities or angles, use Fan-out Mode.

## Quick Start

1. Scope the user's ask, timeframe, geography, and decision use.
2. Run the request through `research_deep`; use 3 queries for concise or narrow reports, 4 by default, and 5-6 only when the user explicitly asks for deeper coverage. It validates citations and creates the PDF deliverable.
3. The workflow returns the complete report in chat and the same report as a PDF. Do not add a second summary.
4. Do not call a separate document tool or recreate the report.
5. Call the workflow once per user request. If it fails, explain the failure instead of immediately rerunning it.

## Fan-out Mode

Use breadth first when the ask covers many independent entities (companies, tools, policies, markets): survey a population, compare many companies, or scan a market across many angles. Run it through the `research_fanout` workflow tool; it creates the cited comparison PDF automatically.

1. Identify the population to cover and the comparison criteria.
2. Define up to 12 independent probe slots with clear per-probe questions and source expectations.
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
- Every explicit user constraint is satisfied, including exact item counts and requested fact-versus-synthesis distinctions.
- The report includes what would change the conclusion.
- Contradictions are explained, not hidden.
- The answer distinguishes fact, estimate, and inference.

## Deliverables

- PDF research report saved in the project and shown in Deliverables
- The canonical report Markdown displayed unchanged in chat
- Claim-to-source evidence map and source list inside the PDF
- Confidence and gaps

## References

- `reference.md` - source quality ladder, citation style, and synthesis checklist.
