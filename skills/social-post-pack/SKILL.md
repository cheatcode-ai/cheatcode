---
name: social-post-pack
description: Creates platform-specific social posts, hooks, image prompts, and variants from a launch, report, or announcement. Use when the user asks for LinkedIn posts, X/Twitter threads, social copy, carousels, or launch content. Do NOT trigger for long-form reports.
license: MIT
compatibility: Requires writing and optional media tools.
---

# Social Post Pack

Make reusable launch content for multiple channels while preserving facts, source tone, and platform-specific constraints.

## Quick Start

1. Collect the source URL, announcement, product note, or report.
2. Outline the target platforms, audience, claims, proof points, and CTA.
3. Extract claims, proof points, audience, tone, and CTA.
4. Produce platform-specific variants with clear hooks.
5. Flag claims that need source review before posting.

## Platform Defaults

| Platform | Default output |
|---|---|
| LinkedIn | 1 long post, 2 short variants, professional but not stiff |
| X/Twitter | 1 thread, 5 standalone posts, tight hooks |
| Reddit | Subreddit-aware post draft, lower promotional tone |
| Instagram | Caption, carousel outline, image prompt |
| Email | Optional launch blurb when requested |

## Rules

- Do not exaggerate metrics or customer claims.
- Preserve regulated disclaimers when the source has them.
- Avoid engagement bait and fake personal anecdotes.
- Match platform norms without changing facts.
- Include alt text or image prompt guidance for visual variants.

## QA

- Each post has a clear audience and CTA.
- Thread posts fit platform length expectations.
- Claims trace to source material.
- Tone is varied by platform, not copy-pasted.

## Deliverables

- Social copy variants
- Thread outline
- Creative prompts

## References

- `reference.md` - platform constraints, tone rules, and claim-review checklist.
