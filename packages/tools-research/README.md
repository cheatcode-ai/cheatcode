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

Provider calls use Workers-native `fetch` with whole-request timeouts and
stream-bounded JSON reads. Exa and Firecrawl documents are normalized to strict
output schemas; unknown provider fields, embedded screenshot data, and oversized
content are omitted or rejected before a result enters the model context.
Firecrawl extraction polling has both a total wall-time boundary and a finite
attempt count.

## Code Checks

```bash
pnpm --filter @cheatcode/tools-research typecheck
pnpm --filter @cheatcode/tools-research lint
```
