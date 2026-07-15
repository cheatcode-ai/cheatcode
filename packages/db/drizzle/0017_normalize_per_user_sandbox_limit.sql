UPDATE "v2_entitlements"
SET "max_concurrent_sandboxes" = 1,
    "updated_at" = now()
WHERE "max_concurrent_sandboxes" <> 1;
