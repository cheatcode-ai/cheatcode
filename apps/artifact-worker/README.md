# Artifact Worker

Lightweight private Cloudflare Worker for signed generated-output delivery.
The public URL remains on the gateway; this Worker is reachable only through
the gateway Service Binding.

Authenticated minting verifies tenant ownership and object existence. Signed
downloads re-check tenant ownership, stream R2 bodies without buffering, honor
conditional and single-range requests through the R2 binding, and return ETag,
stored HTTP metadata, Content-Length, Accept-Ranges, and Content-Range headers.
All user outputs remain `private, no-store` and never enter a shared cache.

The Worker uses the existing `app_agent` Hyperdrive role because generated
outputs are agent-owned records. It never writes output metadata or bytes.

## Checks

```bash
pnpm --filter @cheatcode/artifact-worker lint
pnpm --filter @cheatcode/artifact-worker typecheck
pnpm --filter @cheatcode/artifact-worker build
```
