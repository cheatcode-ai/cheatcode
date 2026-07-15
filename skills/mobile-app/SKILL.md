---
name: mobile-app
description: Builds the mobile app experience for the current project — Expo Router screens in mobile (app-builder-mobile) projects, mobile-first responsive web surfaces in web projects. Use when the user asks for a mobile app, iPhone-like app, mobile-first builder, or responsive app prototype. Do NOT trigger for App Store or Play Store release builds.
category: Builder & Apps
tags: mobile, app, expo
license: MIT
compatibility: Requires the project workspace (Expo in mobile projects, Next.js in web projects).
---

# Mobile App

Ship a mobile-first responsive app surface unless the plan explicitly expands scope to native app stores. The result should feel designed for thumb use, not a desktop page squeezed down.

## Quick Start

1. Identify the core mobile workflow and primary repeat action.
2. Create a compact mobile implementation checklist in the chat before editing.
3. Reuse the existing frontend stack and components.
4. Build mobile-first navigation, empty states, loading states, and responsive layouts.
5. Verify a narrow mobile viewport and a desktop viewport by directly opening the preview, tapping/clicking through the UI, and checking console/network output.

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
| Review | Mobile screenshot, desktop screenshot, console/network review |

## Review

- No horizontal scroll at mobile width.
- Tap targets are large enough and not crowded.
- Keyboard and sheet interactions do not hide critical fields.

## Deliverables

- Mobile-first implementation
- Mobile review notes
- UI screenshots and console/network notes

## References

- `reference.md` - mobile app patterns and QA checklist.
