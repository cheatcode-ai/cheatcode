# @cheatcode/api-client

Typed client helpers for Cheatcode's Hono gateway.

## Public exports

- `normalizeGatewayBaseUrl(baseUrl)` trims and normalizes the configured gateway origin.
- `gatewayRequestUrl(baseUrl, path)` joins a gateway origin with an absolute API path.
- `createGatewayClient(baseUrl, options)` from `@cheatcode/api-client/gateway` creates the Hono RPC client typed from `apps/gateway-worker`.

## Code Checks

```bash
pnpm --filter @cheatcode/api-client typecheck
```

## Env vars consumed

None directly. Callers pass the already-validated gateway base URL from `@cheatcode/env`.
