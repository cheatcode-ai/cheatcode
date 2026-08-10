---
name: mobile-app
description: Builds the mobile app experience for the current project — Expo Router screens in mobile (app-builder-mobile) projects, mobile-first responsive web surfaces in web projects. Use when the user asks for a mobile app, iPhone-like app, mobile-first builder, or responsive app prototype. Do NOT trigger for App Store or Play Store release builds.
category: Builder & Apps
tags: mobile, app, expo
license: PolyForm-Noncommercial-1.0.0
compatibility: Requires the project workspace (Expo in mobile projects, Next.js in web projects).
---

# Mobile App

Ship a mobile-first responsive app surface unless the plan explicitly expands scope to native app stores. The result should feel designed for thumb use, not a desktop page squeezed down.

## Quick Start

1. Identify the core mobile workflow and primary repeat action.
2. Inspect the existing route, theme, and reusable components together before editing.
3. Reuse the existing frontend stack and components.
4. Build the smallest coherent set of screens and states that completes the workflow.
5. Wait for a stable render, inspect it once, exercise one representative interaction, and check browser errors once. If those checks pass, finish.

## Design Rules

- Primary actions should be thumb-reachable.
- Keep bottom navigation to 3-5 destinations.
- Use sheets, segmented controls, tabs, and icon buttons where expected.
- Avoid oversized marketing hero sections for app tools.
- Preserve dense but readable information surfaces.
- Do not rely on hover-only controls.

## Mobile Workflow

| Step | Requirement |
|---|---|
| Navigation | Bottom navigation or thumb-reachable primary action when appropriate |
| Layout | Mobile-first spacing, responsive panels, no horizontal overflow |
| Input | Keyboard-safe forms and obvious submit action |
| State | Empty, loading, error, and success states for the core loop |
| Review | One stable mobile render, one core interaction, and one browser-error review |

## Review

- No horizontal scroll at mobile width.
- Tap targets are large enough and not crowded.
- Keyboard and sheet interactions do not hide critical fields.
- For an Expo project, verify the managed web render only after Metro has produced page content; an initial empty capture during bundling is not a defect signal.
- For a responsive web project, check a desktop viewport only when the request includes a desktop experience.
- Do not infer readiness from screenshot file size or repeat equivalent screenshots after the rendered content and representative interaction pass.

## Deliverables

- Mobile-first implementation
- Mobile review notes
- Browser screenshots remain verification evidence inside their originating browser activity; they are not user Deliverables.

## References

- `references/reference.md` - mobile app patterns and QA checklist.
