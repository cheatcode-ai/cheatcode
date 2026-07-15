# @cheatcode/agent-core

Mastra agents, tool registry, and workflow entrypoints.

## Public exports

- `mastra`
- `createCodeRequestContext`
- runtime credential/model and approval broker contracts consumed by `agent-worker`

The tool and agent registries are statically constrained by the lightweight
capability catalog in `@cheatcode/types`. A runtime capability cannot be added
or removed without updating the public `/v1/tools` or `/v1/agents` contract.
Sandbox and artifact capabilities cross tool-domain boundaries only through
`@cheatcode/sandbox-contracts`; concrete code-tool executors remain in
`@cheatcode/tools-code`.

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

Composio REST tool discovery and execution responses are byte-bounded before
parsing, then projected into bounded, valid JSON before entering model context.
Toolkit names use the shared open-slug contract from
`@cheatcode/types/integrations` across API, context, and tool boundaries.
Callers must honor the returned truncation
flag and narrow tool discovery with `search` when a schema does not fit.
