# @cheatcode/ui

Shared UI primitives for the Vercel-hosted Next.js app.

## Public exports

- `cn`: class name composition helper
- `icons.ts`: constrained Lucide icon barrel used by product screens
- `Response`: Streamdown-powered AI response renderer with lazy math and Mermaid plugins

The web app keeps app-local `@/components/ui/*` and `@/lib/ui/*` facades where they provide product-specific composition; shared primitives are exported from this package.

## Code Checks

```bash
pnpm --filter @cheatcode/ui typecheck
```

## Env

None.
