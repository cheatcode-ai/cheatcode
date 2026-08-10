# @cheatcode/env

Zod-validated environment helpers. Runtime parsing lives here; Next's framework config may
read raw `process.env` values only to pass them into the pure `./web-config` validators.

## Public exports

- `./web`: Next.js client/server env
- `./web-config`: pure Vercel target and public web build validators used by both
  `next.config.ts` and `./web`
- `./worker`: Cloudflare Worker binding schemas and Secrets Store resolution helpers
- `./preview-proxy`: the strict preview-proxy schema
- `./migrate`: administrative database identity pins

## Code Checks

```bash
pnpm --filter @cheatcode/env typecheck
```

## Env

See root `.env.example` for the local application contract. `pnpm dev:setup`
assembles project-agnostic URLs for a dedicated Supabase project's public
session pooler on port 5432, using the three least-privilege runtime roles.
Direct endpoints and transaction pooling are rejected for runtime connections.
Administrative migration values live separately in git-ignored `.env.migrate`
(template: `.env.migrate.example`) or protected automation environment
variables and are never loaded by the app or copied into a Worker.

Gateway, release-SHA, deployment-target, and Clerk publishable-key validation
has one canonical implementation in `./web-config`. The framework config
reads the raw build environment and delegates every parse and invariant to that module;
missing public build values fail instead of receiving compatibility defaults.
The canonical production app origin is exported from the shared config layer.
Production preview hostname, preview app origin, and Clerk authorized parties
derive from it; local development supplies explicit loopback overrides.
Because Next runs from `apps/web`, its config uses Next's official `@next/env`
loader to read the repository-root `.env.local`, then immediately removes every
loaded value outside the explicit web allowlist. Local builds therefore keep one
credential file without exposing Worker-only secrets to the Next process.

Remote Vercel build targets and deployments accept only the exact gateway origin
`https://gateway.trycheatcode.com`; credentials, paths, queries, fragments, and
non-HTTPS remote origins are rejected. Loopback HTTP is allowed only outside
remote Vercel targets so local development and optimized local QA can reach Wrangler.
`VERCEL_TARGET_ENV` selects the remote build-time validation branch for prebuilt
artifacts. `VERCEL_URL` remains optional during that build and becomes mandatory
only when the actual `VERCEL_ENV` is `production` or `preview` at runtime.
`PREVIEW_HOSTNAME` is an explicit local override normalized to a multi-label DNS
hostname (or `localhost:8787` in development); production derives the canonical
hostname and rejects a port-bearing or different value. Moving previews to a different registrable site requires an atomic
DNS/Worker/web-release change; there is no browser environment override or legacy
hostname fallback.

Worker schemas structurally validate Cloudflare service, KV, Durable Object, R2,
Analytics Engine, Workflow, and Secrets Store bindings before request handling starts.
The agent schema also requires one immutable Daytona snapshot name and one environment-scoped
workspace volume name; local development and production use different volumes, and neither has a
fallback.
Database-backed Workers require exactly one role-specific tenant-context binding:
`DATABASE_CONTEXT_SIGNING_SECRET_GATEWAY`,
`DATABASE_CONTEXT_SIGNING_SECRET_AGENT`, or
`DATABASE_CONTEXT_SIGNING_SECRET_WEBHOOKS`. Local values live only in root
`.env.local`; production values live only in the matching Cloudflare Secrets Store
entry and matching Supabase Vault secret. The three values are distinct and at least
32 bytes; there is no shared or compatibility binding.

The root setup wizard and `scripts/dev.ts` share one scalar local-environment
contract for required keys, forbidden cloud credentials, development value
pins, secret distinctness, and Supabase pooler topology. `pnpm dev:setup --check`
uses that same surface without mutating files or database state.
`MORPH_API_KEY` is a required Worker-only input in that shared contract: the wizard
collects it masked, generated local Wrangler config exposes it only to agent-worker,
and production resolves the matching `morph-api-key` Secrets Store binding.

Destructive Worker-to-Worker calls use named Cloudflare RPC entrypoints with
static authenticated caller/capability properties. The gateway receives only
the resource-deletion entrypoint and webhooks receives only the agent-lifecycle
entrypoint, so these boundaries require no application-managed secret.
