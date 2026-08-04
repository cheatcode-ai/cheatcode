---
name: deep-research
description: Produces a cited long-form research report on a complex question, fanning out parallel research probes when the topic spans many entities or angles. Use when the user asks for deep research, a cited report, market analysis, due diligence, a broad market scan, or a comprehensive investigation. Do NOT trigger for quick factual lookups.
category: Research & Docs
tags: research, report, analysis
license: PolyForm-Noncommercial-1.0.0
compatibility: Requires Exa and Firecrawl research tools; fan-out mode requires Mastra workflows.
---

# Deep Research

Answer complex questions with sourced synthesis. The output should read like an analyst brief: clear thesis, cited evidence, disagreement handling, and confidence notes. Every run produces a complete PDF deliverable in the user's project in addition to a concise chat summary. When the question spans many entities or angles, use Fan-out Mode.

## Quick Start

1. Scope the user's ask, timeframe, geography, and decision use.
2. Run the request through `research_deep`; it performs the parallel research, validates citations, and creates the PDF deliverable.
3. Return the key conclusion and important caveats in chat, with a short source list.
4. Refer to the PDF naturally as ready below. Do not call a separate document tool or recreate the report.

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
- The report includes what would change the conclusion.
- Contradictions are explained, not hidden.
- The answer distinguishes fact, estimate, and inference.

## Deliverables

- PDF research report saved in the project and shown in Deliverables
- Concise chat summary with the main conclusion and caveats
- Claim-to-source evidence map and source list inside the PDF
- Confidence and gaps

## References

- `reference.md` - source quality ladder, citation style, and synthesis checklist.
