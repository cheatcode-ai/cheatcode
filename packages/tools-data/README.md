# @cheatcode/tools-data

Deterministic data tools for Cheatcode agents.

## Exports

- `executeAnalyzeCsv` profiles CSV text with Arquero parsing.
- `executeDataScrapeToCsv` converts extracted records or markdown tables to CSV.
- `executeDataChart` renders an accessible deterministic SVG and returns optional R2 artifact metadata plus equivalent Recharts component source.

## Runtime

`data_chart` renders SVG directly in the Worker, avoiding browser-only chart-library SSR behavior. It uses the request-scoped artifact sink when an uploaded output is requested.
The runtime and artifact sink conform to the neutral ports in
`@cheatcode/sandbox-contracts`, keeping this domain independent of code tools.
Tabular inputs bound bytes, rows, columns, cell size, and generated CSV size to
avoid parser amplification in the Worker. Chart component source includes only
the selected x/y fields rather than copying unrelated provider data.

## Code Checks

```bash
pnpm --filter @cheatcode/tools-data typecheck
```
