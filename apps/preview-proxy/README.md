# @cheatcode/preview-proxy

Custom Cloudflare Worker that sits in front of every Daytona sandbox preview. It
serves the configured wildcard preview apex, authenticates the viewer
with a short-lived Cheatcode access token, resolves the real Daytona preview
origin, and transparently proxies HTTP **and** WebSocket traffic (Vite HMR +
framework development sockets) with the Daytona preview headers injected.

The browser only talks to the configured preview apex; the Daytona origin
and its per-sandbox token never leave the edge.

## Host contract

```
{sandboxId}--{port}.{PREVIEW_HOSTNAME}
```

- `--` (double-dash) separates the sandbox id from the port so that sandbox ids
  containing single `-` characters (UUIDs) stay unambiguous.
- The subdomain must be a single DNS label; malformed hosts are rejected `400`.

## Access-token contract (`__Host-cc_pt` / `__cc_pt`)

Capabilities use the versioned protocol implemented once in `@cheatcode/auth`:

```
ccp1.<base64url-strict-json-payload>.<base64url-hmac-sha256-signature>
```

The signed payload contains `v`, `kind`, `aud`, `sid`, `port`, `iat`, `exp`, and
a cryptographically random nonce. `aud` is the exact preview hostname (including
the local development port when present). Strict decoding rejects unknown fields,
unsupported versions, oversized tokens/payloads, malformed values, future-issued
tokens outside the fixed clock tolerance, and lifetimes above the protocol limit.
Legacy five-part tokens are invalid.

Minting (done by `agent-worker`, not here) and the proxy share
`PREVIEW_TOKEN_SECRET`. Verification uses a timing-safe signature comparison and
additionally requires:

1. The signature matches.
2. `iat` and `exp` describe a currently valid, kind-bounded lifetime.
3. The token's audience, sandbox id, and port match the requested preview host
   (prevents replaying a token from one sandbox against another).
4. Query credentials have kind `handoff`; cookies have kind `session`. The kinds
   are deliberately non-interchangeable.

Any failure returns `401` (no redirect). A `handoff` capability is accepted only
from `__cc_pt`, expires after at most 60 seconds, and is accepted only on GET/HEAD
navigation/session-exchange requests. A `session` capability is accepted only
from the `__Host-cc_pt` cookie and expires after at most 10 minutes.

### Cookie hand-off

On a valid **query** token (`__cc_pt`), the proxy mints a distinct session token
and sets:

```
__Host-cc_pt=<session-token>; HttpOnly; Secure; SameSite=None; Partitioned; Path=/; Max-Age=<session TTL>
```

then redirects GET/HEAD requests once to the clean preview URL. The follow-up
request uses the cookie, so `__cc_pt` never reaches user code or remains in the
iframe address. URL credentials are accepted for exchange for only 60 seconds;
the 10-minute result is confined to an HttpOnly cookie. Handoff-bearing
non-navigation requests are rejected rather than forwarded. `SameSite=None`
allows the dedicated preview-site iframe to authenticate when embedded by the
Vercel app, while `Partitioned` scopes the cookie to that top-level app site.
Every subsequent same-origin request (assets and HMR/WebSocket) reuses the
`__Host-cc_pt` cookie within the partition. The `__Host-` prefix makes supporting
browsers reject any attempt to attach a `Domain` attribute or narrow the path.

The client renews an active preview session through the reserved endpoint:

```
GET /.well-known/cheatcode-preview-session?__cc_pt=<fresh-token>
```

The endpoint verifies the token, updates the host-only cookie, and returns `204`;
it never starts or forwards a request to sandbox code. A hidden iframe performs
this exchange so the visible app/editor and its HMR/WebSocket connections stay
mounted.

## Origin resolution

```
GET {DAYTONA_API_URL}/sandbox/{sandboxId}/ports/{port}/preview-url
Authorization: Bearer {DAYTONA_API_KEY}
-> { "url": "<daytona preview origin>", "token": "<per-sandbox preview token>" }
```

`{ url, token }` is cached in-memory per `(sandboxId, port)` for ~60s. The
Daytona preview token rotates on sandbox restart, so an origin `401`/`403`
invalidates the cache. Safe HTTP methods and bodyless WebSocket handshakes are
retried **once** with a fresh resolution; unsafe HTTP methods are never replayed.
Lookup transport failures, non-success statuses, malformed JSON, and invalid
response shapes are normalized to retriable `502 upstream_sandbox_failed`. The
pure Daytona preview response and hostname-allowlist boundary is shared with the
sandbox client through `@cheatcode/types/daytona-preview`; this Worker does not
depend on the code-execution tool package.

## Proxy behaviour

- Forwards method, body (streamed), and headers to `{originUrl}{path+search}`.
- On the dedicated code-server port only, buffers at most 4 MiB of workbench
  HTML and injects the shared parent-frame bridge. The bridge accepts messages
  only from `https://trycheatcode.com` and posts state only to that exact origin;
  arbitrary generated-app HTML remains streamed and unmodified.
- Injects:
  - `x-daytona-preview-token: <daytona token>`
  - `X-Daytona-Skip-Preview-Warning: true`
  - `X-Forwarded-Host: <original preview host>`
- Does **not** send `X-Daytona-Skip-Last-Activity-Update` — real viewer traffic
  must keep the sandbox alive.
- Strips hop-by-hop headers (`connection`, `keep-alive`, `transfer-encoding`,
  `upgrade`, `te`, `trailer`, proxy-auth, and `host`).
- Strips every browser cookie before requests reach sandbox code, including the
  edge-only `__Host-cc_pt` credential and any parent-site cookie sent because the
  preview apex shares Cheatcode's registrable domain. Cookies issued by the
  generated app are rewritten with the reserved host-only `__cc_app_` prefix at
  the edge and unwrapped only on the sandbox hop, preserving server-side app
  sessions without exposing Cheatcode cookies. Sandbox cookies cannot overwrite
  `__Host-cc_pt`, and their `Domain` attributes are removed. `Authorization` is
  preserved because it belongs to the generated app request.
- Rejects browser requests that rely on the session cookie when `Origin` or
  Fetch Metadata identifies a different preview origin. Cookie-authenticated
  iframe navigations additionally require a referrer from the exact preview
  origin or `https://trycheatcode.com`; this blocks sibling-preview navigation
  attacks before sandbox code handles a state-changing GET. The Vercel iframes
  use `referrerpolicy="origin"`, so the query-to-cookie redirect retains that
  trusted signal without disclosing an app path or query. This check runs before
  the WebSocket `Origin` is translated for Daytona/code-server. Query handoffs
  are never a fallback bearer for cross-origin subresource traffic.
- Rewrites redirects back onto the authenticated preview host when an origin
  returns an absolute Daytona URL and removes any proxy-token query parameter;
  intentional external redirects are preserved.
- Marks authenticated HTML `private, no-store`, makes other responses private
  while preserving browser-cache directives, and varies responses by the
  cookie/origin/Fetch-Metadata inputs used at the boundary.
- Adds `frame-ancestors 'self' https://trycheatcode.com`,
  `Origin-Agent-Cluster: ?1`, and `X-Robots-Tag: noindex, nofollow` to non-WS
  responses. OAC prevents `document.domain` relaxation when the browser honors
  it, but it is a browser hint rather than a complete security boundary.
- Only GET/HEAD requests are retried after an origin 401/403. Unsafe methods
  invalidate the cached Daytona credential but return the original response,
  preventing request-body reuse and duplicate generated-app side effects.
- WebSocket upgrades (`Upgrade: websocket`) are detected and passed through using
  the Cloudflare WS-proxy pattern: the upgrade request is reconstructed against
  the origin URL (preserving the `Sec-WebSocket-*` handshake), fetched, and the
  resulting `response.webSocket` is returned via `new Response(null, { status:
  101, webSocket })`. A failed 401/403 bodyless handshake invalidates the cached
  Daytona credential and is attempted once with a freshly resolved origin.
- Origin `Set-Cookie` headers are preserved individually via `getSetCookie()`.

## Preview-origin isolation

Production uses one host per sandbox and port beneath the owned
`trycheatcode.com` apex. Distinct hosts preserve the browser same-origin storage
boundary between previews without requiring another registrable domain. Because
these hosts remain same-site with the Vercel app, the proxy strips every
non-namespaced browser cookie before the upstream request, removes upstream
`Domain` attributes, uses a host-only partitioned session cookie, rejects sibling
preview origins, and sends `Origin-Agent-Cluster: ?1`. The gateway authenticates
API calls with bearer tokens rather than ambient cookies. DNS, the wildcard
Worker route, `PREVIEW_HOSTNAME`, and `NEXT_PUBLIC_PREVIEW_HOSTNAME` must still be
released together.

## Env / secrets

| Binding               | Type            | Source                                  |
| --------------------- | --------------- | --------------------------------------- |
| `CHEATCODE_ENVIRONMENT` | var           | `wrangler.jsonc` (`production`)         |
| `CHEATCODE_RELEASE_SHA` | release var   | guarded deploy command                  |
| `CF_VERSION_METADATA` | version metadata | Cloudflare runtime                    |
| `DAYTONA_API_URL`     | var             | `wrangler.jsonc` (`https://app.daytona.io/api`) |
| `DAYTONA_PREVIEW_HOST_SUFFIXES` | var | allowlisted Daytona preview apexes |
| `DAYTONA_API_KEY`     | Secrets Store   | `daytona-api-key`                       |
| `PREVIEW_HOSTNAME`    | var             | preview apex shared with agent-worker   |
| `PREVIEW_TOKEN_SECRET`| Secrets Store   | `preview-token-secret`                  |

Secrets bind from store `ba25994718db4707ab99a498e22eb5a6` (shared with
`agent-worker`). Local dev: copy `.dev.vars.example` to `.dev.vars`. Secrets are
resolved request-scoped via `resolveWorkerSecret`; the token and API key are
never logged.

Optional Analytics Engine bindings `ERROR_EVENTS` and `PERFORMANCE_METRICS` feed
the shared `@cheatcode/observability` emitters.

## DNS / route setup

- Route: `*.${PREVIEW_HOSTNAME}/*` on the preview domain's Cloudflare zone.
- DNS: a **proxied** wildcard record `*` -> the zone (orange-cloud) so
  Cloudflare terminates TLS and runs this Worker for every sub-subdomain.
- TLS: the wildcard is one label deep beyond the configured apex; Cloudflare
  Universal SSL covers a single wildcard level, so
  no extra certificate is required. (If preview hosts ever gain another label,
  Advanced Certificate Manager / a custom cert would be needed.)

## Code checks

```bash
pnpm --filter @cheatcode/preview-proxy typecheck
pnpm --filter @cheatcode/preview-proxy lint
```
