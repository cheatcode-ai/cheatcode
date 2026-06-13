---
name: slide-from-prd
description: Turns a PRD, roadmap, memo, or internal product brief into clear presentation slides. Use when the user asks for product update slides, roadmap slides, executive slides, or a PRD-to-deck conversion. Do NOT trigger for fundraising decks; use pitch-deck.
category: Research & Docs
tags: slides, prd, product
license: MIT
compatibility: Requires docs tools.
---

# Slide From PRD

Convert product documents into executive-ready slides. Preserve the actual product constraints, decisions, risks, and milestones instead of turning the PRD into vague marketing copy.

## Quick Start

1. Locate the PRD, RFC, roadmap, memo, or pasted product brief.
2. Extract goals, problem, solution, decisions, risks, and timeline into a slide outline.
3. Identify audience, decision needed, product changes, risks, and timeline.
4. Produce an outline first, then generate the `.pptx`.
5. QA that the slides preserve source constraints and do not invent commitments.

## Slide Patterns

| Source material | Slide treatment |
|---|---|
| Goals | Decision-oriented title plus success metrics |
| User problem | Journey or before/after flow |
| Requirements | Grouped capabilities, not raw bullet dump |
| Tradeoffs | Decision table with rejected alternatives |
| Timeline | Milestones with owners or dependencies |
| Risks | Mitigation matrix |

## Rules

- Preserve "must", "should", and "out of scope" semantics.
- Keep one claim per slide.
- Do not hide open questions; executives need them visible.
- If the source is too long, summarize by section before designing.

## QA

- Every important source section maps to a slide or explicit omission.
- Timeline and metrics match the source.
- Product risks are visible, not buried in notes.
- The deck answers the audience's decision need.

## Deliverables

- Slide outline
- `.pptx` file
- Source-to-slide mapping

## References

- `reference.md` - PRD extraction rules and executive slide patterns.
