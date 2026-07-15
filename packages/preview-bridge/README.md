# @cheatcode/preview-bridge

Shared code-server parent-frame integration used by both the production preview
proxy and the local agent-worker preview path. The proxy supplies an exact,
trusted application origin and injects the bridge only into bounded,
signature-checked code-server workbench HTML.

## Public exports

- `CODE_SERVER_PORT`
- `MAX_CODE_SERVER_HTML_BYTES`
- `isCodeServerWorkbenchHtml`
- `injectCodeServerParentBridge`

## Code Checks

```bash
pnpm --filter @cheatcode/preview-bridge typecheck
pnpm --filter @cheatcode/preview-bridge lint
```

## Env

None. Callers provide the already validated parent application origin.
