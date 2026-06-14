# @cheatcode/preview-proxy

Custom Cloudflare Worker that sits in front of every Daytona sandbox preview. It
serves the wildcard host `*.preview.trycheatcode.com`, authenticates the viewer
with a short-lived Cheatcode access token, resolves the real Daytona preview
origin, and transparently proxies HTTP **and** WebSocket traffic (Vite HMR +
noVNC websockify) with the Daytona preview headers injected.

This replaces the previous flow where the browser embedded the Blaxel/Daytona
preview URL (with a `bl_preview_token` / `?token=` query string) directly. Now
the browser only ever talks to `*.preview.trycheatcode.com`; the Daytona origin
and its per-sandbox token never leave the edge.

## Host contract

```
{sandboxId}--{port}.preview.trycheatcode.com
```

- `--` (double-dash) separates the sandbox id from the port so that sandbox ids
  containing single `-` characters (UUIDs) stay unambiguous.
- The subdomain must be a single DNS label; malformed hosts are rejected `400`.

## Access-token contract (`cc_pt` / `__cc_pt`)

The token is a dot-delimited string:

```
{sandboxId}.{port}.{exp}.{mode}.{sig}
```

| Field       | Meaning                                                              |
| ----------- | ------------------------------------------------------------------- |
| `sandboxId` | Daytona sandbox id (dot-free DNS label).                            |
| `port`      | Target sandbox port.                                                |
| `exp`       | Expiry, epoch **milliseconds**.                                     |
| `mode`      | `app` (normal preview) or `takeover` (noVNC interactive takeover).  |
| `sig`       | `hmacSha256Base64("{sandboxId}.{port}.{exp}.{mode}", PREVIEW_TOKEN_SECRET)` |

`sig` is **standard** base64 (from `@cheatcode/auth`'s `hmacSha256Base64`). The
base64 alphabet contains no `.`, so the token always splits into exactly five
segments.

Minting (done by `agent-worker`, not here) and the proxy share
`PREVIEW_TOKEN_SECRET`. Verification here uses `timingSafeEqual` (constant time)
and additionally requires:

1. The signature matches.
2. `exp` is in the future.
3. The token's `sandboxId` + `port` match the requested host subdomain
   (prevents replaying a token from one sandbox against another).

Any failure returns `401` (no redirect). Tokens are read from the `__cc_pt`
query param **or** the `cc_pt` cookie.

> When placing the token in `__cc_pt`, the minter must `encodeURIComponent` it —
> standard base64 can contain `+` `/` `=`, and a raw `+` in a query string would
> be decoded to a space by `URLSearchParams`.

### Cookie hand-off

On a valid **query** token (`__cc_pt`), the proxy sets:

```
cc_pt=<token>; HttpOnly; Secure; SameSite=None; Path=/; Max-Age=<until exp>
```

then strips `__cc_pt` from the URL forwarded to the origin so the token never
leaks. `SameSite=None; Secure` is required because the preview renders inside a
cross-site iframe (`web.trycheatcode.com` -> `*.preview.trycheatcode.com`). The
first navigation carries `__cc_pt`; every subsequent same-origin request (assets,
HMR/WebSocket, noVNC) reuses the `cc_pt` cookie.

## Origin resolution

```
GET {DAYTONA_API_URL}/sandbox/{sandboxId}/ports/{port}/preview-url
Authorization: Bearer {DAYTONA_API_KEY}
-> { "url": "<daytona preview origin>", "token": "<per-sandbox preview token>" }
```

`{ url, token }` is cached in-memory per `(sandboxId, port)` for ~60s. The
Daytona preview token rotates on sandbox restart, so a `401`/`403` from the
origin invalidates the cache and re-fetches **once** before failing `502`.

## Proxy behaviour

- Forwards method, body (streamed), and headers to `{originUrl}{path+search}`.
- Injects:
  - `x-daytona-preview-token: <daytona token>`
  - `X-Daytona-Skip-Preview-Warning: true`
  - `X-Forwarded-Host: <original preview host>`
- Does **not** send `X-Daytona-Skip-Last-Activity-Update` — real viewer traffic
  must keep the sandbox alive.
- Strips hop-by-hop headers (`connection`, `keep-alive`, `transfer-encoding`,
  `upgrade`, `te`, `trailer`, proxy-auth, and `host`).
- WebSocket upgrades (`Upgrade: websocket`) are detected and passed through using
  the Cloudflare WS-proxy pattern: the upgrade request is reconstructed against
  the origin URL (preserving the `Sec-WebSocket-*` handshake), fetched, and the
  resulting `response.webSocket` is returned via `new Response(null, { status:
  101, webSocket })`.
- Origin `Set-Cookie` headers are preserved individually via `getSetCookie()`.

## Env / secrets

| Binding               | Type            | Source                                  |
| --------------------- | --------------- | --------------------------------------- |
| `DAYTONA_API_URL`     | var             | `wrangler.jsonc` (`https://app.daytona.io/api`) |
| `DAYTONA_API_KEY`     | Secrets Store   | `daytona-api-key`                       |
| `PREVIEW_TOKEN_SECRET`| Secrets Store   | `preview-token-secret`                  |

Secrets bind from store `ba25994718db4707ab99a498e22eb5a6` (shared with
`agent-worker`). Local dev: copy `.dev.vars.example` to `.dev.vars`. Secrets are
resolved request-scoped via `resolveWorkerSecret`; the token and API key are
never logged.

Optional Analytics Engine bindings `ERROR_EVENTS` and `PERFORMANCE_METRICS` feed
the shared `@cheatcode/observability` emitters.

## DNS / route setup

- Route: `*.preview.trycheatcode.com/*` on zone `trycheatcode.com`.
- DNS: a **proxied** wildcard record `*.preview` -> the zone (orange-cloud) so
  Cloudflare terminates TLS and runs this Worker for every sub-subdomain.
- TLS: the wildcard `*.preview.trycheatcode.com` is one label deep beyond
  `trycheatcode.com`; Cloudflare Universal SSL covers a single wildcard level, so
  no extra certificate is required. (If preview hosts ever gain another label,
  Advanced Certificate Manager / a custom cert would be needed.)

## Code checks

```bash
pnpm --filter @cheatcode/preview-proxy typecheck
pnpm --filter @cheatcode/preview-proxy lint
```
