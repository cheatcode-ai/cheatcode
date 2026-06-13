# @cheatcode/tools-code

Code execution tools backed by the per-project Blaxel sandbox.
Tool-facing file and cwd inputs are constrained to `/workspace`. `runCode`
executes directly through Blaxel process execution with `python3 -c` or
`node --input-type=module -e`; it does not write temporary runtime files.

## Public exports

- `runCode`
- file tools: `readFile`, `writeFile`, `listFiles`, `searchFiles`, `deleteFile`
- shell tools: `shellExec`, `shellStartProcess`, `shellKillProcess`, `shellTerminal`
- preview tools: `startDevServer`
- git tools: `gitStatus`, `gitClone`, `gitCommit`, `gitPush`
- sandbox lifecycle tools: `sandboxCreate`, `sandboxDestroy`, `createSnapshot`, `restoreSnapshot`
- `codeTools`

## Code Checks

```bash
pnpm --filter @cheatcode/tools-code typecheck
```

## Env

None directly. Tools use the request-scoped sandbox from Mastra runtime context.
