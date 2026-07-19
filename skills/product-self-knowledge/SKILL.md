---
name: product-self-knowledge
description: "Stop and consult this skill whenever a response would include specific facts about Cheatcode: capabilities, supported models, pricing, sandbox behavior, browser use, skills, connected apps, BYOK, or feature availability. Verify here instead of relying on model memory."
category: Builder & Apps
tags: cheatcode, product, pricing, models, capabilities
compatibility: Cheatcode V2 product facts; update this file whenever the product catalog changes.
---

# Cheatcode Product Knowledge

Use these facts when answering questions about Cheatcode. Accuracy is more important than filling gaps. If a requested detail is not covered here, inspect the live product source or say that it is not documented.

## What Cheatcode Is

Cheatcode is a general-purpose AI agent with a persistent cloud computer. It can build and edit software, work with files, create documents and media, perform research, automate a browser, analyze data, and use connected third-party services.

The full web experience is at `https://trycheatcode.com`. It includes chat, project files, a browser surface, live app previews, a browser-based code editor, and a console. Cheatcode does not currently offer SMS, iMessage, Telegram, recurring automations, managed app deployment, or project-level instructions. Do not claim that those features exist.

## Computer and Projects

- Every account has a private Daytona-backed Linux computer.
- Projects are persistent folders on that computer.
- A project is created only when work needs files or a workspace; ordinary conversation and browser-only work remain projectless.
- The agent can read and write files, run terminal commands, execute Python and JavaScript, install packages, run development servers, and produce downloadable artifacts.
- The Files and Browser surfaces expose the active project state. Browser takeover can hand a live sandbox-browser session to the user and resume automation afterward.
- Sandbox stop, archive, wake, lease, and snapshot behavior are internal lifecycle controls, not product settings.
- Cheatcode does not deploy projects. Do not offer deployment or repository-sync actions that are not exposed by the current product.

## Skills

Skills are executable instruction packages. A package can contain `SKILL.md`, TypeScript or Python scripts, schemas, references, assets, and package metadata.

- Built-in skills are snapshot-bundled under the system skill root.
- User-authored skills are stored under `.cheatcode/skills/<slug>` and restored into every project sandbox for that user.
- Skill Creator authors the complete package, validates it, persists it, and makes it available to later runs.
- Connected-app skills execute through the user's authenticated Composio accounts.
- Do not describe a prompt-only document as a complete skill when its required runtime or dependencies are missing.

## Models and BYOK

The visible model catalog is:

| Model | Provider | Notes |
|---|---|---|
| Auto | Cheatcode routing | Resolves to the actual model selected for the run |
| Claude Sonnet 4.6 | Anthropic | Default app and sandbox model |
| Claude Opus 4.8 | Anthropic | Highest-capability Anthropic option |
| GPT-5.4 Thinking | OpenAI | Reasoning-focused option |
| GPT-5.4 Mini | OpenAI | Fast utility option |
| DeepSeek V4 | DeepSeek | Included platform route |

Cheatcode accepts provider-prefixed OpenRouter and Google model IDs even though those providers are not shown as separate catalog rows. BYOK keys are configured in Models and are decrypted only for the active request. Supported provider key families are Anthropic, OpenAI, Google, OpenRouter, DeepSeek, Exa, and Firecrawl. BYOK key counts are not limited by subscription-plan slots.

## Plans

Cheatcode meters sandbox hours, maximum projects, and connected-app calls. It does not use a token-credit balance.

| Plan | Monthly price | Projects | Sandbox hours | Connected-app calls |
|---|---:|---:|---:|---:|
| Free | $0 | 3 | 5 | 1,000 |
| Pro | $25 | 25 | 60 | 20,000 |
| Premium | $50 | 50 | 140 | 50,000 |
| Ultra | $99 | 100 | 320 | 100,000 |
| Max | $200 | Unlimited | 800 | Unlimited |

Do not invent token allowances, deployment quotas, BYOK provider-slot limits, research-plan fan-out limits, or generated-output expiry. Generated outputs persist until project or account deletion; download links themselves are short-lived and can be refreshed.

## Connected Apps

Connected third-party actions run through authenticated Composio accounts. The Skills screen is the source of truth for the current integration catalog and account state. Never claim an account is connected until the API reports it. If an action requires a missing account, direct the user to the native Connect flow.

## Browser Use

Cheatcode's browser runs inside the user's sandbox and supports navigation, observation, extraction, actions, screenshots, and live takeover. Browser-only tasks should open the Browser surface by default and should not create a project unless files are required.

## Product-Answer Rules

1. Prefer the live catalog and runtime state over assumptions.
2. Do not describe excluded or unimplemented reference-product features as Cheatcode features.
3. Distinguish user-facing product limits from undisclosed safety invariants.
4. If a fact conflicts with the source code, the source code is authoritative and this skill must be updated.
