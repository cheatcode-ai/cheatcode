# @cheatcode/ui

Shared UI primitives for the Cloudflare-hosted Next.js app.

## Public exports

- `cn`: class name composition helper
- `icons.ts`: constrained Lucide icon barrel used by V1-parity screens
- `Response`: Streamdown-powered AI response renderer with lazy math and Mermaid plugins

The web app keeps its existing `@/components/ui/*` and `@/lib/ui/*` import paths for V1 visual parity, but those local files re-export from this package.

## Code Checks

```bash
pnpm --filter @cheatcode/ui typecheck
```

## Env

None.
