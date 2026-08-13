---
name: connected-apps
description: Uses the user's connected Gmail, GitHub, Notion, Google Workspace, Slack, and other supported accounts for explicit on-demand actions. Use when the user asks Cheatcode to read, search, create, or update something in a connected service.
category: Builder & Apps
tags: integrations, composio, oauth, connected apps
license: PolyForm-Noncommercial-1.0.0
compatibility: Requires an account connected from the Cheatcode Skills screen and the Composio runtime tools.
---

# Connected Apps

Perform the user's requested action through their connected account. This playbook is for agent-side work now; it does not add provider credentials or deployable integration code to a generated application.

## Workflow

1. Identify the provider, intended action, target object, and whether the operation mutates external state.
2. Call `composio_list_tools` with the provider and a concise action/object search to discover the exact supported action. The runtime automatically relaxes an over-specific zero-result query into ranked toolkit candidates.
3. Inspect the returned candidates and their input schemas. If the list is truncated and no candidate fits, retry with a shorter action or object keyword rather than guessing a tool slug.
4. Call `composio_execute` only for the explicit action the user requested.
5. Verify the returned identifier, status, or content before reporting success.

## Rules

- Do not call a connected app merely because one is available.
- Prefer read-only discovery before writes when the target is ambiguous.
- Never claim an account is connected when the tool reports that authorization is missing. Direct the user to the Skills screen to connect it.
- Do not place OAuth tokens, provider secrets, or Cheatcode backend credentials in project files, browser code, logs, or chat.
- Do not generate app-side integration routes that depend on Cheatcode's private Composio runtime.
- For sending, deleting, publishing, inviting, purchasing, or permission changes, confirm the target and scope from the user's request before executing.

## Verification

- A read action returns the requested object or a clear not-found result.
- A write action returns a provider-side identifier or confirmed final state.
- The summary names what changed and where without exposing internal tool payloads.
