# @cheatcode/agent-core

Mastra agents, tool registry, and workflow entrypoints.

## Public exports

- `mastra`
- `createCodeRequestContext`
- runtime credential and model contracts consumed by `agent-worker`

The tool and agent registries are statically constrained by the lightweight
capability catalog in `@cheatcode/types`. A runtime capability cannot be added
or removed without updating that shared contract. Sandbox-status and
artifact-stream routing derive from the catalog's exact runtime traits, so a
tool's registry and stream behavior move together.
Sandbox and artifact capabilities cross tool-domain boundaries only through
`@cheatcode/sandbox-contracts`; concrete code-tool executors remain in
`src/tools/code` and are available to deployables through the
`@cheatcode/agent-core/tools/code` subpath.

Single-consumer data, document, and media implementations live under
`src/tools/`. Data tools profile and normalize bounded tabular inputs and render
deterministic SVG/Recharts output. Document tools generate sandbox-side PPTX,
DOCX, XLSX, and PDF source against `/opt/cheatcode-doc-runtime`. Media and Google-backed
browser tools resolve the user's Google AI BYOK key lazily when invoked. All three receive
sandbox and R2 artifact capabilities through request-scoped contracts; they do
not read environment variables, persist credentials, or log keys.

Tools execute autonomously inside the active request context. Sandbox operations
remain project-root confined, browser actions remain origin-bound, connected-app
actions remain scoped to the user's active account, and secret-bearing input is
validated before execution. Deterministic prepare/execute boundaries keep dynamic
ports and Git destinations stable between resolution and execution. The managed
preview tool owns Computer-visible dev servers, remaps a requested port to the
project's allocated port when necessary, and is distinct from generic background
process tools so idle recovery always has a canonical process record.
Browser-only runs use the account sandbox without materializing a persistent project;
workspace-backed file, shell, document, chart, or artifact work resolves the thread's
project lazily when durable project storage is actually needed. Code tools expose `/workspace`
as a virtual project root and remap path references inside argv, shell payloads, and inline code
to the canonical project folder. Projectless calculations and environment probes run from `/tmp`,
so a weaker model cannot accidentally leave durable files outside a project.

## Code Checks

```bash
pnpm --filter @cheatcode/agent-core typecheck
```

## Env

Provider keys are supplied through BYOK runtime context, not module scope.
`resolveRequestedLlmTransport` returns an `LlmTransportSelection`: its provider and bare
model ID are SDK transport inputs, never the durable product model attribution.
OpenRouter model selections use `openrouter/<OpenRouter model id>`, for example
`openrouter/openrouter/auto`. Google AI keys are tool credentials for image/video
generation and browser automation; `google/<model id>` is not an agent-model route.

Mastra storage is intentionally execution-only and in-memory. AgentRun Durable
Objects and Postgres own durable run and transcript state. Workflows that receive
the secret-bearing request context must disable snapshot persistence and delete
their Mastra run after completion; adding persistent Mastra storage requires a
redesign that reacquires credentials instead of serializing them.

Nested research workflows bind the calling tool's abort signal idempotently to
the Mastra workflow run, forward each workflow step signal through every nested
`agent.generate`, and remove abort listeners before deleting the ephemeral run.
Each concurrent research pass gets an isolated evidence collector populated only
from one bounded Exa discovery call and an optional Firecrawl extraction of its
primary result. A single tool-free model pass structures each provider evidence
pack, and workflow steps do not retry failed model output inside the same Worker
invocation. Claim citations and the final synthesis are schema-validated against
that evidence; prose URL scraping is not an accepted provenance boundary.
Successful top-level deep-research and fan-out tools deterministically package
that validated report, its claim-to-source map, and its source list as a PDF
artifact. The project workspace is resolved only after remote research succeeds;
the PDF is then stored both in the live project files and the durable
generated-output store.

Composio REST tool discovery and execution responses are byte-bounded before
parsing, then projected into bounded, valid JSON before entering model context.
Toolkit names use the shared open-slug contract from
`@cheatcode/types/integrations` across API, context, and tool boundaries.
Callers must honor the returned truncation
flag and narrow tool discovery with `search` when a schema does not fit.
