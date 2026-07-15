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
snapshot, target, and runtime-user fields so lifecycle code cannot accidentally trust a
different or stale resource after projecting the provider payload.
When a run supplies `/workspace/<project>`, every file, shell, code-execution,
Git, and dev-server path is confined lexically to that project root; a bare
`/workspace` is remapped to it and sibling-project paths are rejected.

## Public exports

- `executeRunCode`
- file executors: `executeReadFile`, `executeWriteFile`, `executeListFiles`,
  `executeSearchFiles`, `executeDeleteFile`
- shell executors: `executeShellExec`, `executeShellStartProcess`,
  `executeShellKillProcess`, `executeShellTerminal`
- preview executor: `executeStartDevServer`
- git executors: `executeGitStatus`, `executeGitClone`, `executeGitCommit`,
  `executeGitPush`
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
