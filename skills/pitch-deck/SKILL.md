---
name: pitch-deck
description: Generates investor-ready pitch decks from a one-line startup idea or written brief. Use when the user asks for a pitch deck, investor deck, fundraising deck, demo day deck, seed deck, or fundraising-focused .pptx deck.
category: Research & Docs
tags: slides, fundraising, investor
license: MIT
compatibility: Requires docs tools, research tools, and sandbox file output.
---

# Pitch Deck

Build a concise investor narrative with evidence, then generate a `.pptx` artifact. The deck should be investor-ready: concrete problem, credible market, crisp product story, and no generic slide filler.

## Quick Start

1. Clarify company, buyer, market, and fundraising stage only if missing.
2. Draft a 10-12 slide outline before generating the deck.
3. Research market size, competitors, traction proxies, and proof points with citations.
4. Generate the `.pptx` with `docs_generate_slides` or the sandbox document workflow.
5. QA every slide visually before returning the file.

## Default Slide Structure

| # | Slide | Purpose |
|---|---|---|
| 1 | Title | Name, one-line positioning, round stage |
| 2 | Problem | Concrete pain and affected buyer |
| 3 | Solution | Product in plain language |
| 4 | Product | Screenshot, workflow, or demo steps |
| 5 | Why now | Market or technology shift |
| 6 | Market | TAM/SAM/SOM or bottoms-up sizing |
| 7 | Traction | Revenue, usage, LOIs, pilots, or waitlist |
| 8 | Business model | Pricing and unit economics |
| 9 | Competition | Direct and substitute alternatives |
| 10 | GTM | First channels and wedge |
| 11 | Team | Relevant unfair advantages |
| 12 | Ask | Round size, runway, milestones |

## Design Rules

- Every slide needs a visual: chart, product shot, diagram, screenshot, or strong numeric callout.
- Keep copy short. Titles make claims; body supports them.
- Do not use centered body copy, accent lines under every title, or stock business photos.
- Market slides must cite sources and show assumptions.
- If public market data is weak, use bottoms-up sizing and label it as an estimate.

## QA

- Text fits on every slide.
- Numbers match research notes.
- The story can be understood from slide titles alone.
- The `.pptx` opens and downloads successfully.

## Deliverables

- Deck outline
- `.pptx` file
- Research sources

## References

- `reference.md` - pitch narrative, market sizing, and visual QA rules.
