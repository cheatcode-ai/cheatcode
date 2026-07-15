---
name: landing-page
description: Builds production-quality landing pages or app marketing pages from an offer, product, or audience. Use when the user asks for a landing page, homepage, SaaS page, launch page, or conversion page. Do NOT trigger for full app dashboards.
category: Builder & Apps
tags: web, landing page, marketing
license: MIT
compatibility: Requires sandbox web app tooling.
---

# Landing Page

Build the actual page, not a marketing plan. Ship a responsive, polished marketing surface in the sandbox with direct visual review.

## Quick Start

1. Identify offer, audience, proof, CTA, objections, and brand constraints.
2. Create a brief implementation checklist in the chat before editing.
3. Implement in the existing app stack. Do not create a separate mockup if an app already exists.
4. Use visual assets that reveal the product, place, or result.
5. Start the dev server and verify desktop and mobile at its internal localhost address, interacting with the UI and checking console/network output. Never copy or disclose the external preview URL; the user opens it from the Computer panel.

## Design Rules

- First viewport must make the product or offer obvious.
- Use full-width sections, not cards inside cards.
- Keep cards at 8px radius or less unless the app's design system differs.
- Avoid one-note palettes and generic gradient-only hero sections.
- Do not explain UI controls in visible app text.
- Text must not overflow buttons, cards, nav items, or mobile viewports.

## Build Workflow

| Step | Check |
|---|---|
| App audit | Reuse existing components, fonts, colors, and routing |
| Hero | Product/offer signal, clear CTA, next section visible |
| Sections | Features, proof, pricing, FAQ, final CTA as needed |
| Assets | Real/generated visual assets, no dark stock-like placeholders |
| Review | Screenshot desktop/mobile, check console and network |

## Review

- Desktop and mobile screenshots are visually coherent.
- The internal preview loads without console errors.
- Primary CTA is visible above the fold.
- Longest visible text fits its container.

## Deliverables

- Implemented page
- Visual review notes and screenshots

## References

- `reference.md` - landing page structure, layout rules, and QA checklist.
