# CSV Analyst Reference

## Profiling Checklist

- Row count and column count.
- Column names, inferred types, and examples.
- Missing count and missing percent per column.
- Duplicate rows and likely key columns.
- Date range for date-like fields.
- Numeric min, max, mean, median when useful.
- Top categorical values and cardinality.

## Chart Selection

| Question | Chart |
|---|---|
| Trend over time | Line chart |
| Ranking | Bar chart sorted descending |
| Distribution | Histogram or box plot |
| Relationship | Scatter plot |
| Composition | Stacked bar when categories are limited |
| Cohort retention | Heatmap |

## Common Failure Modes

- Treating strings like numbers because commas or currency symbols were not cleaned.
- Comparing percentages with different denominators.
- Hiding small sample sizes.
- Joining on non-unique keys.
- Inferring causality from correlation.

Always save the final analysis script so another run can reproduce the answer.
