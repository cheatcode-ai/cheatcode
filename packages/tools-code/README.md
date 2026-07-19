# @cheatcode/tools-code

Deterministic code-execution primitives backed by the user's Daytona sandbox.
Tool-facing file and cwd inputs are constrained to `/workspace`. `executeRunCode`
uses Daytona process execution with `python3 -c` or
`node --input-type=module -e`; it does not write temporary runtime files.
Mastra tool registration and top-level tool descriptions live in
`@cheatcode/agent-core`; field-level descriptions stay with the canonical input
schemas in this package so validation and the LLM contract cannot drift.
Daytona JSON, error, file, and accumulated-log responses are streamed through
endpoint-specific byte boundaries before buffering in a Worker isolate.
Sandbox control-plane responses retain and validate identity-critical name, label,
snapshot, target, runtime-user, and volume-mount fields so lifecycle code cannot accidentally trust a
different or stale resource after projecting the provider payload.
Sandbox discovery exhausts Daytona's current `{ items, nextCursor }` response instead of trusting
the first page, and file listings require the canonical RFC 3339 `modifiedAt` field rather than
accepting the deprecated `modTime` representation or fabricating timestamps.
The same REST-only client resolves/creates shared Daytona volumes, validates their current
provider shape and readiness, supplies `volumeId`/`mountPath`/`subpath` only at sandbox creation,
and replaces complete sandbox label sets during release-scoped promotion. Snapshot replacement
does not use the Daytona SDK or assume an in-place snapshot mutation API.
When a run supplies `/workspace/<project>`, every file, shell, code-execution,
Git, and dev-server path is confined lexically to that project root; a bare
`/workspace` is remapped to it and sibling-project paths are rejected.
Every long-running process start also requires a stable caller-selected process ID. Repeating that
ID replaces the same managed slot instead of growing orphan session metadata.
Dev-server startup has an explicit prepare/execute boundary: dynamic project-port
allocation and Expo command normalization happen during preparation, then the
resolved command, cwd, environment key names, port, and process policy can be
displayed and hash-bound before that exact prepared plan executes.
Git push uses the same boundary: preparation resolves exactly one credential-free
HTTPS push URL, a normalized local branch, its immutable commit OID, and the
destination ref. Execution uses that exact URL and OID-to-ref refspec, so changes
to `.git/config` or the local branch after preparation cannot redirect the push.
Preparation rejects `insteadOf` and `pushInsteadOf` configuration, and execution
rechecks that invariant immediately before push, preventing the prepared URL from
being redirected through repository, global, system, or included Git config.
Git commit is prepared as an exact `add` plus `commit` sequence. Hooks and
filesystem monitors are disabled for that sequence.

## Public exports

- `executeRunCode`
- file executors: `executeReadFile`, `executeWriteFile`, `executeListFiles`,
  `executeSearchFiles`, `executeDeleteFile`
- shell executors: `executeShellExec`, `executeShellStartProcess`,
  `executeShellKillProcess`, `executeShellTerminal`
- preview executors: `prepareStartDevServer`, `executePreparedStartDevServer`,
  and `executeStartDevServer`
- git executors: `executeGitStatus`, `executeGitClone`, `prepareGitCommit`,
  `executePreparedGitCommit`, `prepareGitPush`, and `executePreparedGitPush`
- input/output schemas consumed by Mastra tool definitions
- canonical `WorkspacePathSchema` and `WorkspaceFilePathSchema` trust-boundary
  validators plus `resolveProjectWorkspacePath`
- `DaytonaClient` and the Daytona response types consumed by `agent-worker`;
  neutral sandbox and artifact ports live in `@cheatcode/sandbox-contracts`, while
  shared Daytona preview URL validation lives in
  `@cheatcode/types/daytona-preview`

## Code Checks

```bash
pnpm --filter @cheatcode/tools-code typecheck
```

## Env

None directly. Tools use the request-scoped sandbox from Mastra runtime context.
