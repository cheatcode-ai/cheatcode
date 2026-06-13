# @cheatcode/tools-data

Deterministic data tools for Cheatcode agents.

## Exports

- `executeAnalyzeCsv` profiles CSV text with Arquero parsing.
- `executeDataScrapeToCsv` converts extracted records or markdown tables to CSV.
- `executeDataChart` renders a Recharts chart in the Blaxel sandbox runtime and returns static SVG plus optional R2 artifact metadata.

## Runtime

`data_chart` needs the project sandbox because Recharts SSR runs inside `/opt/cheatcode-doc-runtime` in the Blaxel image. The sandbox image installs the pinned React, React DOM, Recharts, and Arquero versions from `plan.md` Section 4.

## Code Checks

```bash
pnpm --filter @cheatcode/tools-data typecheck
```
