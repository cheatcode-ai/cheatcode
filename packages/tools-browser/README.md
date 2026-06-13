# @cheatcode/tools-browser

Stagehand-backed browser automation tools that run inside the per-project Blaxel sandbox.
The product path starts a persistent local-only driver process at
`127.0.0.1:9323` inside the sandbox, so `open`, `act`, `observe`, `extract`,
and `screenshot` share the same Stagehand page state. That port is never
exposed as a preview; takeover still uses the separate authenticated VNC flow.
The driver health check includes the configured model and a non-secret BYOK
fingerprint prefix so the Worker restarts the process when a user changes keys
without logging or returning plaintext credentials.

## Public exports

- `executeBrowserActions`
- `executeBrowserOpen`
- `executeBrowserAct`
- `executeBrowserObserve`
- `executeBrowserExtract`
- `executeBrowserScreenshot`

## Code Checks

```bash
pnpm --filter @cheatcode/tools-browser typecheck
```

## Env

None directly. Provider keys are passed request-scoped into the in-sandbox
driver process env and are never logged by the Worker.
