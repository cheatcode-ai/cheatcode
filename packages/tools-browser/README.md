# @cheatcode/tools-browser

Stagehand-backed browser automation tools that run inside the user's Daytona sandbox.
The product path starts a persistent local-only driver process at
`127.0.0.1` on a run-scoped dynamically allocated port inside the sandbox, so
`open`, `act`, `observe`, `extract`, and `screenshot` share the same Stagehand
page state. The driver listens only inside the sandbox and is never exposed as
a user-facing preview.
The driver health check includes the configured model and a non-secret BYOK
fingerprint prefix so the Worker restarts the process when a user changes keys
without logging or returning plaintext credentials. The driver captures its
request-scoped model configuration and clears provider-key environment variables
before Chromium is launched, so browser child processes do not inherit BYOK values.
Driver responses are byte-bounded and strictly projected before entering model
context. Structured observations and extractions are capped, while screenshots
are uploaded to the run artifact store and returned as metadata instead of
inline base64.

The package depends on the provider-neutral sandbox and artifact ports from
`@cheatcode/sandbox-contracts`; it does not depend on another tool domain.

## Public exports

- `executeBrowserOpen`
- `executeBrowserAct`
- `executeBrowserObserve`
- `executeBrowserExtract`
- `executeBrowserScreenshot`
- the matching Mastra input/output schemas
- `BrowserProvider` and `BrowserRuntimeContext`

## Code Checks

```bash
pnpm --filter @cheatcode/tools-browser typecheck
```

## Env

None directly. Provider keys are passed request-scoped into the in-sandbox
driver process env and are never logged by the Worker.
