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

`open` canonicalizes sandbox loopback navigation to `127.0.0.1`. Before an
`act`, the Worker reads the exact active-page URL; only the active project's
durably allocated preview port is eligible for autonomous interaction. Every act
is bound to that URL and origin, checked again inside the driver, and confined by
a context-wide exact-origin CDP request interceptor and connection guard for the
duration of the action. The guard covers current and newly attached pages, frames,
popups, workers, service workers, redirects, WebSockets, WebTransport, and peer
connections. A page change before execution, an origin change during execution,
or an isolation setup failure fails closed. The driver explicitly enables
flattened CDP auto-attach with new targets paused; page/frame policies are queued
before resume, while auxiliary and unknown network targets are closed. Target
isolation is idempotent, interception work drains to quiescence, and any guarded
action/setup/cleanup failure discards the browser instance so a paused or partially
guarded target cannot leak into a later action.

The package depends on the provider-neutral sandbox and artifact ports from
`@cheatcode/sandbox-contracts`; it does not depend on another tool domain.

## Public exports

- `executeBrowserOpen`
- `executeBrowserAct`
- `executeBrowserObserve`
- `executeBrowserExtract`
- `executeBrowserScreenshot`
- `inspectBrowserPage`
- the matching Mastra input/output schemas
- `BrowserProvider` and `BrowserRuntimeContext`

## Code Checks

```bash
pnpm --filter @cheatcode/tools-browser typecheck
```

## Env

None directly. Provider keys are delivered request-scoped through the driver's
bounded one-shot bootstrap input, removed from process environment variables
before Chromium starts, and never logged by the Worker.
