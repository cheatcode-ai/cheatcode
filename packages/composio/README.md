# @cheatcode/composio

Bounded REST client for the documented Composio v3.1 API surface used by
Cheatcode. It replaces the generic SDK so provider-controlled response bodies
are capped before JSON parsing and Workers do not bundle unused SDK features.

## Public exports

- `ComposioClient`
- `ComposioApiError`
- `isComposioNotFoundError`
- response and request types used by gateway, lifecycle, and agent tools

All requests use `x-api-key`, a caller-selected deadline, bounded request JSON,
endpoint-specific response ceilings, and fail-closed redirect handling. Unknown
response fields are stripped.

The client intentionally exposes only the v3.1 routes Cheatcode owns:

- list/create auth configs
- list/link/delete connected accounts (delete revokes upstream credentials)
- list toolkits and tools
- execute a version-selected tool

There is no generic request escape hatch.

## Code Checks

```bash
pnpm --filter @cheatcode/composio typecheck
pnpm --filter @cheatcode/composio lint
```

## Env

None directly. Callers resolve and pass `COMPOSIO_API_KEY` request-scoped.
