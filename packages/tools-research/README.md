# @cheatcode/tools-research

Research tool adapters for Cheatcode agents.

## Exports

- `executeExaSearch`
- `executeFirecrawlScrape`
- `executeFirecrawlSearch`
- `executeFirecrawlExtract`
- Zod input/output schemas for each tool

## Runtime

Tools receive provider keys through `ResearchRuntimeContext`. Workers must source
keys through `packages/byok`; this package never reads environment variables and
never logs provider keys.

## Code Checks

```bash
pnpm --filter @cheatcode/tools-research typecheck
pnpm --filter @cheatcode/tools-research lint
```
