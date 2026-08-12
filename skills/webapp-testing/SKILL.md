---
name: webapp-testing
description: Verify a running local web application through Cheatcode's managed headed browser without creating a second test harness or browser process.
category: Builder & Apps
tags: qa, browser, webapp, responsive
compatibility: Requires the managed headed Chromium browser.
allowed-tools: browser_open browser_observe browser_act browser_extract browser_screenshot
---

# Web Application Testing

Use the already-running managed preview and the native browser tools. Never install a browser,
launch a second browser process, write a Playwright/Python test harness, or start another dev server.

## Verification flow

1. Open the app's internal `http://localhost:<port>` URL once.
2. Capture one screenshot with one explicit visual acceptance criterion. Use its PASS/FAIL
   assessment instead of inferring quality from image size.
3. For one representative functional interaction, call `browser_observe` once. Choose one exact
   hyphenated element ref from its accessibility tree and call `browser_act` with that ref plus the
   required method/value.
4. Read the post-action tree returned by `browser_act` to decide whether the criterion passed.
5. If a criterion fails, fix the concrete app defect and repeat only that changed criterion once.

Observed refs are page-bound and single-use. Observe again before any later interaction after a DOM
or navigation change. Never invent a ref or selector.

Finish as soon as the requested content renders, the representative interaction passes, and no
blocking browser error remains. Do not repeat equivalent screenshots, actions, or extractions.
