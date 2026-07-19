# @cheatcode/durable-storage

Exact SQLite schema attestation shared by the Cloudflare Durable Objects. It
canonicalizes `sqlite_schema`, binds a reconciliation request to the closed
release and concrete object identity, and emits validated evidence only after
the owning object has reconciled or verified its current schema.

The package does not own an application's tables or data migrations. Each
Durable Object declares and rebuilds its own exact current schema so dormant
objects cannot retain stale tables, indexes, views, triggers, columns, or
constraints. Attestation inspects every non-internal `sqlite_schema` object.
Its SQL tokenizer ignores comments and whitespace, folds unquoted ASCII
identifier/keyword case, and ignores `IF NOT EXISTS` on `CREATE` statements.
String literals and quoted identifiers remain byte-for-byte significant so
canonicalization cannot hide changed values or identifier semantics.

Schema versions live in the exact application-owned
`__cheatcode_storage_metadata` table because Durable Object SQL does not
support `PRAGMA user_version`. Attestation excludes only Workerd's exact
`_cf_KV` and `_cf_METADATA` tables and Miniflare's local-only
`__miniflare_do_name` discovery table.

## Public exports

- `assertExactSqliteSchema`
- `assertSqliteRowCountPreserved`
- `reconcileExactSqliteStorage`
- `setCurrentSqliteStorageVersion`
- `assertStorageReconciliationRequest`
- `storageSchemaEvidence`
- `ExpectedSqliteObject`
- `SqliteSchemaMismatchError`
- `SqliteSchemaObjectType`

## Code checks

```bash
pnpm --filter @cheatcode/durable-storage lint
pnpm --filter @cheatcode/durable-storage typecheck
pnpm --filter @cheatcode/durable-storage build
```

## Env

None. Callers supply their release gate and release SHA bindings.
