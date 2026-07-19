---
name: manage-skills
description: Inspect and manage globally enabled Cheatcode tools and integrations.
category: Builder & Apps
tags: skills, integrations, accounts, composio
compatibility: Requires the preinstalled cheatcode-skills runtime and a run-scoped Cheatcode session.
---

# Manage Skills

Use this skill when you need to inspect which Cheatcode tools are available, already enabled, connected, or request that a tool be connected or disabled globally.

This skill manages Cheatcode tools globally across projects, including:
- always-on built-in tools
- integration-backed tools such as Airtable, Cal, Gmail, GitHub, Google Calendar, Google Docs, Linear, and Notion
- globally enabled saved custom tools

If the user is asking Cheatcode to perform an action on demand, prefer using an already enabled and already connected skill directly. Use this skill only when you need to inspect availability, request account connection, or change global state.

## Workflow

1. When the user asks what is already connected or currently usable, prefer `cheatcode-skills manage-skills/manage/list --enabled`.
2. When the user asks what can be connected or enabled next, prefer `cheatcode-skills manage-skills/manage/list --available`.
3. Use plain `cheatcode-skills manage-skills/manage/list` only when the user wants the full global state, including both enabled and not-yet-enabled tools.
4. To request that the user connect an account for an integration-backed tool, run `cheatcode-skills manage-skills/manage/connect --skill <slug>`.
5. When the user asks which connected accounts are available for an integration, or wants to inspect account ids before switching, run `cheatcode-skills manage-skills/manage/list-accounts`.
6. When the user wants Cheatcode to use a different already-connected account, run `cheatcode-skills manage-skills/manage/switch --account-id <connected-account-id>`.
7. When the user wants to add another account for an integration that is already connected, still run `cheatcode-skills manage-skills/manage/connect --skill <slug>` so Cheatcode can present a fresh Connect flow.
8. Integration-backed skills become enabled automatically once connected.
9. To disable a tool, run `cheatcode-skills manage-skills/manage/disable --skill <slug>`.
10. After a connect request, do not ask the user for approval in plain text. Cheatcode will present any required Connect UI automatically for integration-backed tools.
11. If the user needs multiple integrations connected, queue all required `connect` requests in the same turn so all chips can appear together.
12. After queuing all required UI actions, send one short instruction asking the user to complete the shown chips, then wait for their next message before continuing.
13. If only one integration action is needed, present that one and wait as usual.
14. If the tool returns a confirmation payload instead of a UI action, do not try to apply it manually or invent your own flow. Cheatcode will handle that confirmation path deterministically.
15. If no suitable skill appears in the managed skill list and the user wants Cheatcode to perform the capability on demand rather than build it into the project, prefer switching to the `cheatcode` skill to create a reusable custom skill instead of stopping at availability inspection.

## Rules

- Treat these changes as global across projects.
- Do not claim a tool is enabled or disabled until the relevant UI or confirmation flow completes.
- Do not claim an integration account is connected until the connection flow completes.
- If the response says the tool is already enabled or already disabled, report that directly and stop.
- Prefer `--enabled` when the user is asking what is already connected or currently active.
- Prefer `--available` when the user is asking what they could connect or enable next.
- Prefer the exact slug returned from `cheatcode-skills manage-skills/manage/list`.
- Use `cheatcode-skills manage-skills/manage/list-accounts` before switching when the user needs help identifying which connected account id to use.
- Use `cheatcode-skills manage-skills/manage/switch --account-id <id>` when the user asks to change which connected account Cheatcode should use for future calls.
- If the user wants to add another account for an integration that already has a connected account, still use `cheatcode-skills manage-skills/manage/connect --skill <slug>`. Reserve `switch` for choosing among accounts that are already connected.
- Do not tell the user to reply with "Approve" or "Deny". Cheatcode handles any required UI or confirmation flow.
- If a suitable skill is already enabled, do not enable it again just because the user asked for the underlying action.
- If the user is asking to use an integration right now and that skill is not connected, use `cheatcode-skills manage-skills/manage/connect --skill <slug>`.
- Integration-backed skills are auto-enabled when connected; do not present a separate enable step for integrations.
- When multiple integrations are required, batch all needed `connect` requests in the same turn so the user receives all chips at once.
- After batching, respond with a simple instruction to complete the chips (do not narrate a one-by-one chain).
- If no suitable skill is listed and the request is clearly on-demand and reusable, usually proceed directly to `cheatcode` custom skill creation instead of proposing only a one-off script or asking the user to choose between those two paths, unless essential scope or auth details are still missing.
- Do not use this skill to author or persist custom tool source files. Use `cheatcode` for custom tool creation and persistence, and use `manage-skills` only for global availability, enablement, and account connection state.
