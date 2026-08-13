# @cheatcode/agent-core

Mastra agents, tool registry, and workflow entrypoints.

## Public exports

- `createCodeRequestContext`
- `generateGeneralAgentStep` and `executeGeneralAgentTool` for Cloudflare
  Workflow-owned, step-granular agent execution
- `GeneralAgentFinishReasonSchema`, the validated model-turn completion contract
- runtime credential and model contracts consumed by `agent-worker`

The tool and agent registries are statically constrained by the lightweight
capability catalog in `@cheatcode/types`. A runtime capability cannot be added
or removed without updating that shared contract. Sandbox-status and
artifact-stream routing derive from the catalog's exact runtime traits.
Artifact presentation is explicit: finished user files are Deliverables, while
browser screenshots are durable tool evidence rendered inside the browser
action that captured them. Transient screenshot bytes are inspected against the
tool call's visual acceptance criterion with the request-scoped browser credential;
only the bounded textual assessment enters durable Workflow state.
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
Published media is rendered automatically in the chat artifact card and is available in Files;
the agent does not treat the media's sandbox path as a browser URL or tell the user that the
published result cannot be previewed.
Files produced through the general file or shell surfaces cross into durable user output only
through `deliverable_publish`. The tool reads one project-confined finished file, derives its
bounded artifact type from an explicit supported extension, and publishes it through the same
R2-backed artifact runtime as native document, chart, research, and media generators.

Tools execute autonomously inside the active request context. Sandbox operations
remain project-root confined, browser actions remain origin-bound, connected-app
actions remain scoped to the user's active account, and secret-bearing input is
validated before execution. Deterministic prepare/execute boundaries keep dynamic
ports and Git destinations stable between resolution and execution.
Explicit composer intent is authoritative before message keyword classification on general-project
runs. A selected skill or connected app arrives as validated request context, prompts the agent to
load or use that exact capability, and never mutates the user's message into internal command syntax.
Each explicit non-app intent also selects a model-facing capability profile and a matching skill
catalog. Document, slide, data, research, and media runs retain the bounded file and supporting
artifact tools appropriate to their outcome while excluding browser, dev-server, git, and
background-process capabilities. The selected surface is therefore an execution boundary, not only
prompt guidance; a document about a website cannot drift into building or previewing that website.
The managed browser follows
the same boundary: observation reads Stagehand's native accessibility snapshot without model
inference and returns page-bound element refs. Execution accepts only a single-use ref from the
latest state tree plus a bounded method/value, resolves its server-held XPath, and atomically binds
the returned post-action tree as the next actionable state. The sandbox driver derives the exact
URL and allowed origin from that same server-held observation inside the serialized action request;
the Worker cannot supply or inspect that security binding in a separate request. A click or fill
therefore cannot invoke a hidden model decision, expose a selector, reuse a stale ref, or cross the
active origin.
Every first-party browser tool advertises its strict JSON schema to providers that support strict
tool calling, while the same Zod contract remains the provider-independent runtime boundary.
The model-facing action schema is the same method-specific union used by the driver: every action
has method and ref, value-taking actions add value, and dragAndDrop adds targetRef. Operational
timeout policy cannot become a substitute for the action itself. A tool-validation or driver failure is verification
failure, not evidence that generated application state is broken; app-builder agents preserve the
framework event model and correct the browser call instead of injecting page scripts.
The managed
preview tool owns Computer-visible dev servers, remaps a requested port to the
project’s allocated port when necessary, injects the supported framework binding when the model
omits it, and is distinct from generic background process tools so idle recovery always has a
canonical process record. Identical healthy starts are idempotent, and the sandbox-local launcher
restores missing dependencies before readiness. Web app-builder preparation
opts into matching-process reuse to avoid taking down a healthy preview on every follow-up; Expo
retains replacement semantics for its ephemeral signed launch environment while the shared
native-disk source feed provides hot reload without a post-edit restart.
Browser-only runs use the account sandbox without materializing a persistent project;
workspace-backed file, shell, document, chart, or artifact work resolves the thread's
project lazily when durable project storage is actually needed. Code tools expose `/workspace`
as a virtual project root and remap path references inside argv, shell payloads, and inline code
to the canonical project folder. Projectless calculations and environment probes run from `/tmp`,
so a weaker model cannot accidentally leave durable files outside a project. The bounded Daytona
REST adapter maps request-scoped command environment variables to the provider's `envs` wire field;
generated code can therefore cross the process boundary without entering argv or persistent files.
Focused edits to existing UTF-8 files use the request-scoped Morph FastApply runtime and a
sandbox-side checksum-guarded write. The agent sends only the existing file, sparse edit, and
instruction to Morph; the deployment key remains in Cloudflare Secrets Store, and the Mastra tool
abort signal is forwarded through the Morph request. Focused and multi-section edits to an existing
text file use FastApply; new files, binary files, and intentional whole-file rewrites continue to
use the deterministic file writer.
App-builder runs receive an existing framework workspace and managed preview before model
execution. Managed template runs do not advertise the dev-server tool, and their shell and file
boundaries reject alternate server launches, redundant dependency reinstalls, and replacement or
bypass of the root framework. A model therefore cannot replace the canonical Next.js or Expo root
with another scaffold, package manifest, Vite entrypoint, or nested project; ordinary source edits,
explicit dependency changes, and build commands remain available.
Imported repositories keep their own dev-server and framework-file capabilities because their stack
is intentionally user-owned rather than image-owned.

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

The production agent loop does not rely on that in-memory store for ownership.
`agent-worker` asks the model for one turn without executing tools, checkpoints the
turn in Cloudflare Workflow, and then reconstructs each selected tool in a separate
Workflow step. Provider keys and tool credentials are reacquired inside each step
and never enter Workflow state.
The catalog uses the current AI SDK provider generation. Anthropic's adapter sends the known
128K Sonnet/Opus output maximum, DeepSeek V4 Pro receives its advertised 384K maximum explicitly
instead of the API's smaller omitted-value default, and OpenAI/OpenRouter intentionally omit an
artificial common ceiling so the selected provider model owns its maximum. A model-only turn that
still ends with `length` is continued semantically rather than treated as successful completion.

Nested research workflows bind the calling tool's abort signal idempotently to
the Mastra workflow run, forward the synthesis step signal through its nested
`agent.generate`, and remove abort listeners before deleting the ephemeral run.
Each concurrent research pass performs one bounded Exa discovery call and an optional
Firecrawl extraction of its primary result. Provider-owned IDs, URLs, excerpts, and
the durable claim map are assembled deterministically instead of asking a model to
reproduce citation identifiers. The sole tool-free model call writes only the canonical
Markdown report from those byte-bounded evidence packs. Before publication, the workflow
rejects truncated generations, emoji presentation characters that the document font contract
cannot preserve, and invalid heading or citation structure. The synthesis prompt requires the
same plain-text contract, so a nonconforming model response is retried before publication. It
then deterministically replaces the model-authored Sources tail with one canonical list
derived from the validated inline citations, avoiding a second probabilistic generation
for presentation-only list differences while preserving the evidence boundary. It has an
operational timeout and one in-memory retry for transient provider or invalid Markdown
failures; request cancellation always wins and no secret-bearing state is snapshotted.
Prose URL scraping is not an accepted provenance boundary.
Top-level deep-research and fan-out tools resolve their project workspace before
making provider calls, so plan or project-capacity failures cannot consume a research run.
Successful tools render the validated report's
canonical GitHub-flavored Markdown directly into a PDF artifact. The chat response
and PDF therefore preserve the same headings, prose, lists, tables, links, citations,
and ordering; only print-safe pagination and document chrome differ. Headings and inline
code disable automatic word hyphenation, while each heading reserves space for following
content. Lists may paginate between rows instead of being moved wholesale to a mostly empty
page; every multi-line row remains indivisible so consecutive Markdown items cannot overlap.
The compact, readable report typography keeps ordinary source sections with the report body
when they fit. The PDF is stored both in the live project files and the durable
generated-output store. Sandbox renderers write binary output to a bounded staging
file and delimit only its small metadata object with an internal stdout marker. The
host validates that path, reads the bytes through the sandbox file boundary, uploads
the durable artifact, and removes both staging files. Document generators stage
their bounded structured input in a hidden, project-local temporary file instead of
embedding it in the sandbox command line, then delete that input after rendering;
this keeps large reports within the sandbox process contract without retaining
source payloads. After the durable upload commits, the generator materializes the exact same bytes
at the canonical read-only `deliverables/<output-id>/<filename>` project path and returns that path
to the agent. Structured output counts and bounded layouts are authoritative for routine generation,
so the agent does not rediscover, convert, or screenshot the same file before finishing.

Composio REST tool discovery and execution responses are byte-bounded before
parsing, then projected into bounded, valid JSON before entering model context.
Toolkit names use the shared open-slug contract from
`@cheatcode/types/integrations` across API, context, and tool boundaries.
Callers must honor the returned truncation
flag and narrow tool discovery with `search` when a schema does not fit.
