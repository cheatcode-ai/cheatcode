# @cheatcode/db

Drizzle schema, queries, and Hyperdrive-aware Postgres client for Cheatcode V2.

## Public exports

- `createDb`
- `withUserContext`
- `resolveInternalUserId`
- `ensureSandboxProject`
- `saveSandboxProjectBackup`
- billing entitlement helpers, including `cancel_at_period_end` subscription
  state for Polar cancellation/reactivation
- usage helpers for daily cost-cap enforcement from `v2_usage_events` and
  daily rollup rows for Analytics Engine emission
- daily activation cohort helpers for `retention_d7`, `retention_d28`, and
  `first_week_mau`
- lifecycle helpers for RLS-safe BYOK revalidation, invalid-key disablement, and
  Clerk deletion workflows
- `schema/*`

## Code Checks

```bash
pnpm --filter @cheatcode/db typecheck
```

## Migrations

```bash
pnpm --filter @cheatcode/db db:generate
pnpm tsx scripts/migrate.ts --dry-run
pnpm tsx scripts/migrate.ts --apply
```

`packages/db/src/schema/drizzle.ts` is the Drizzle migration-generation barrel.
It intentionally omits `auditLog`, because `v2_audit_log` is partitioned and owned
by `infra/supabase/migrations/pre/0003_audit_log_partitioned.sql`.

## Env

- Workers pass `env.HYPERDRIVE.connectionString`.
- Migration scripts use `SUPABASE_MIGRATION_URL` through `.env.migrate`, never Worker env.
