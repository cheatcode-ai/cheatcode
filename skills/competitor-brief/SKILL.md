---
name: competitor-brief
description: Creates concise competitor intelligence briefs with positioning, pricing, product surface, traction, and risks. Use when the user asks for competitor research, company intel, alternatives, or competitive landscape. Do NOT trigger for generic news digests.
license: MIT
compatibility: Requires Exa company/news search and Firecrawl scraping.
---

# Competitor Brief

Build an actionable competitor profile from a company URL, name, or market segment. Prioritize facts a founder, PM, or seller can use: positioning, ICP, packaging, recent momentum, risks, and openings.

## Quick Start

1. Normalize the target into `company_name`, `homepage_url` when available, and `comparison_context`.
2. Use `search_company` for company profile, leadership, funding, jobs, and recent news.
3. Use `firecrawl_scrape` on homepage, pricing, docs, changelog, and case studies.
4. Draft the brief using the structure in `reference.md`.
5. Fill the skeleton with sourced claims only. If a claim has no URL, mark it as inference.

## Research Workflow

Collect these fields before writing:

| Field | Minimum evidence |
|---|---|
| Product | Homepage, docs, changelog, demo, screenshots |
| ICP | Case studies, customer logos, pricing copy, sales pages |
| Pricing | Pricing page, docs, or clearly marked "not public" |
| Positioning | Tagline, meta title, homepage H1, comparison pages |
| Traction | Funding, hiring velocity, reviews, integrations, social proof |
| Risks | Security pages, support docs, reviews, market complaints |

## Analysis Rules

- Separate direct competitors from substitute workflows.
- Quote short phrases only when they carry positioning value; otherwise paraphrase.
- Use "unknown" rather than inventing private metrics.
- Compare against the user's product only when the user gives enough context.
- Keep SWOT blunt. Do not fill every box with generic claims.

## QA

- Every non-obvious claim has a URL.
- Pricing is dated and marked as public, gated, or unavailable.
- The brief says what changed recently, not only evergreen website copy.
- Recommendations are tied to observed gaps or threats.

## Deliverables

- One-page brief
- Comparison table
- Source list with access date

## References

- `reference.md` - brief structure, source ranking, and competitive-risk rubric.
