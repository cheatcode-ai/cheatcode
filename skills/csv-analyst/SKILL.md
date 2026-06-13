---
name: csv-analyst
description: Analyzes CSV or spreadsheet data with statistics, charts, joins, and clear findings. Use when the user uploads CSV/XLSX data or asks for data analysis, cohort analysis, charts, or spreadsheet insight. Do NOT trigger for document-only research.
category: Data & Media
tags: data, csv, analysis, charts
license: MIT
compatibility: Requires sandbox Python and data tools.
---

# CSV Analyst

Analyze tabular data reproducibly. Profile first, then answer the user's business question with code-backed findings, charts, caveats, and exportable artifacts.

## Quick Start

1. Locate the file with `fs_list` or ask for it if missing.
2. Use `data_analyze_csv` or focused Python via `runCode` to profile the file.
3. Inspect row count, columns, missingness, inferred types, and suspicious values.
4. Write focused, reproducible analysis code in `/workspace/analysis/`.
5. Generate charts only when they answer the question.

## Analysis Workflow

| Task | Default method |
|---|---|
| Basic profile | row count, column count, missingness, examples |
| Type cleanup | parse dates, numerics, booleans; preserve raw columns when risky |
| Trend analysis | group by date periods, include sample sizes |
| Cohorts | define cohort date explicitly, include retention denominators |
| Outliers | show detection rule and top examples |
| Joins | validate key uniqueness before joining |

## Rules

- Never infer units silently. Ask if the unit changes the answer.
- Keep generated code reproducible and saved in the sandbox.
- Prefer simple charts: bar, line, scatter, heatmap. Avoid decorative charts.
- Report data quality issues before conclusions.
- When data is too small or biased, say so clearly.

## QA

- Re-run the final analysis code after edits.
- Check chart labels, units, legends, and date sorting.
- Include the exact file paths for generated artifacts.
- Verify totals against the original row count after filters.

## Deliverables

- Findings with caveats
- Reproducible analysis code
- Charts or tables under `/workspace/analysis/`

## References

- `reference.md` - profiling checklist, chart selection, and common CSV failure modes.
