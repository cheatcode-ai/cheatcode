# @cheatcode/durable-storage

Exact SQLite schema validation shared by the Cloudflare Durable Objects. It
canonicalizes `sqlite_schema` and rejects any object whose persisted schema
differs from the current application contract.

The package does not own application tables or data migrations. Each Durable
Object initializes its exact current schema once and validates existing storage
before use. Validation inspects every non-internal `sqlite_schema` object.
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
- `setCurrentSqliteStorageVersion`
- `ExpectedSqliteObject`

## Code checks

```bash
pnpm --filter @cheatcode/durable-storage lint
pnpm --filter @cheatcode/durable-storage typecheck
pnpm --filter @cheatcode/durable-storage build
```

## Env

None.
