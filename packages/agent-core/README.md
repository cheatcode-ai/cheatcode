# @cheatcode/agent-core

Mastra agents, tool registry, and workflow entrypoints.

## Public exports

- `mastra`
- `createCodeRequestContext`
- runtime credential and model contracts consumed by `agent-worker`

The tool and agent registries are statically constrained by the lightweight
capability catalog in `@cheatcode/types`. A runtime capability cannot be added
or removed without updating the public `/v1/tools` or `/v1/agents` contract.
Sandbox-status and artifact-stream routing derive from the catalog's exact
runtime traits, so a tool's registry, discovery, and stream behavior move together.
Sandbox and artifact capabilities cross tool-domain boundaries only through
`@cheatcode/sandbox-contracts`; concrete code-tool executors remain in
`@cheatcode/tools-code`.

Tools execute autonomously inside the active request context. Sandbox operations
remain project-root confined, browser actions remain origin-bound, connected-app
actions remain scoped to the user's active account, and secret-bearing input is
validated before execution. Deterministic prepare/execute boundaries keep dynamic
ports and Git destinations stable between resolution and execution.
Browser-only runs use the account sandbox without materializing a persistent project;
workspace-backed file, shell, document, chart, or artifact work resolves the thread's
project lazily when durable project storage is actually needed.

## Code Checks

```bash
pnpm --filter @cheatcode/agent-core typecheck
```

## Env

Provider keys are supplied through BYOK runtime context, not module scope.
`resolveRequestedLlmTransport` returns an `LlmTransportSelection`: its provider and bare
model ID are SDK transport inputs, never the durable product model attribution.
Google model selections use `google/<Gemini model id>`, for example
`google/gemini-2.5-flash`. OpenRouter model selections use
`openrouter/<OpenRouter model id>`, for example `openrouter/openrouter/auto`.

Mastra storage is intentionally execution-only and in-memory. AgentRun Durable
Objects and Postgres own durable run and transcript state. Workflows that receive
the secret-bearing request context must disable snapshot persistence and delete
their Mastra run after completion; adding persistent Mastra storage requires a
redesign that reacquires credentials instead of serializing them.

Nested research workflows bind the calling tool's abort signal idempotently to
the Mastra workflow run, forward each workflow step signal through every nested
`agent.generate`, and remove abort listeners before deleting the ephemeral run.
Each concurrent research pass gets an isolated evidence collector populated only
from parsed Exa result IDs/URLs and Firecrawl result URLs. Claim citations and the
final synthesis are schema-validated against that evidence; prose URL scraping
is not an accepted provenance boundary.

Composio REST tool discovery and execution responses are byte-bounded before
parsing, then projected into bounded, valid JSON before entering model context.
Toolkit names use the shared open-slug contract from
`@cheatcode/types/integrations` across API, context, and tool boundaries.
Callers must honor the returned truncation
flag and narrow tool discovery with `search` when a schema does not fit.
