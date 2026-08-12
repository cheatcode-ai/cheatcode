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
3. For one representative functional interaction, call `browser_observe` with the exact action
   needed. Choose one returned action and pass that action object unchanged to `browser_act`.
4. Call `browser_extract` once to read the resulting state and decide whether the criterion passed.
5. If a criterion fails, fix the concrete app defect and repeat only that changed criterion once.

Observed actions are page-bound and single-use. Observe again after a DOM or navigation change.
Never invent a selector, edit an observed action, or send prose directly to `browser_act`.

Finish as soon as the requested content renders, the representative interaction passes, and no
blocking browser error remains. Do not repeat equivalent screenshots, actions, or extractions.
