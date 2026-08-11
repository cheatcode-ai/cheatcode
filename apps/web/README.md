# @cheatcode/web

Next.js 16 app shell with Clerk auth and AI SDK chat streaming. Production runs on Vercel.
The Settings Billing panel consumes gateway billing state directly and exposes
checkout, portal, cancel-at-period-end, and reactivation controls.

Persisted assistant runs may cross message pages, but each API row stays bounded. The history
query actively follows cursors until every segment through the final marker is loaded, then
losslessly reconstructs structured fragments and merges the run under its stable run ID. A
partial or corrupt transcript is never rendered as a duplicate assistant message.
While a thread has an authoritative active run, its lightweight thread record is refreshed every
two seconds in the visible tab. The event stream remains the primary delivery path; this status
refresh only reconciles a silently lost connection or a browser restored after the backend became
terminal. When the run pointer clears, the client stops any stale stream, refreshes the persisted
transcript and sidebar state, and replaces the transient chat state with that durable result.

Deliverable parts contain durable output identity and presentation metadata, never an expiring
URL. A download click calls the authenticated gateway mint endpoint, validates its bounded response,
and follows the resulting short-lived capability directly to the streaming response. Image
deliverables lazily exchange that same capability for a bounded in-memory blob when they approach
the viewport, render an inline thumbnail, and reuse the blob in an accessible full-size viewer.
No image capability or object URL is persisted. Opening an image in Files switches to the project
workspace and asks the trusted code-server bridge to reveal the exact generated asset; an already
visible Files panel selects a newly generated image without waking a closed sandbox.

Browser screenshots are not Deliverables. A screenshot stream part carries the durable output
identity plus its originating tool-call ID; the chat loads it only when the corresponding browser
activity is expanded and offers an accessible full-size viewer inside that activity.

Composer uploads always land in a writable project. If none is selected, choosing the first
valid file creates and selects a general project named from that file. Files upload sequentially
as raw bounded requests, show per-batch progress and actionable failures, and become durable
`uploads/` files in that project instead of being pasted into message text. The composer inserts
a compact `/uploads/...` reference after each successful save. `/` is exclusively the
persistent project-file browser and merges durable uploads with generated Deliverables. A selected
Deliverable inserts its stable `/deliverables/<output-id>/<filename>` project reference;
`@` is exclusively the user-skill picker. The file browser reads durable project-file metadata and
does not create or wake Daytona merely because the user opens it.
Computer preview wakeups run only while Browser is selected; opening Files never revives an
unrelated dev server or changes the selected surface. Browser wakeups rotate the preview session
and reload the visible iframe once after an actual sandbox/process recovery. Silent capability
rotation keeps the live iframe mounted so application state is preserved during ordinary use.
Every user-requested preview navigation—reload, path entry, Back, or opening the
preview externally—first acquires a fresh one-minute handoff from the authenticated
wake boundary. The action proceeds only after renewal, so the client never reuses
the expired handoff embedded in an older preview URL. Concurrent renewal requests
share one in-flight wake operation.
Fresh app-builder projects keep the animated Cheatcode mark visible while the internal starter
scaffold boots and the model generates the requested app. The persisted `app-preview-status`
stream part reveals the iframe only when generated content is ready, and an iframe-load guard keeps
the same mark in place until the final document has loaded. Preview wake and capability minting stay
paused during fresh scaffold generation; readiness acquires a new one-minute handoff immediately
before the iframe mounts and exchanges it for the renewable ten-minute host cookie. Existing project
edits remain visible and continue hot-reloading normally.
When the agent completes a browser-open action, the Browser panel requests one authenticated reload
so the user sees the same freshly verified build. The preview owner first renews the short-lived
handoff capability and only then remounts the entry document; an old capability is never reused.
Read-only extraction, screenshots, and browser interactions still open the panel without repeatedly
resetting the user's live preview state.

## Public exports

Framework app only.

Web-owned UI primitives, the icon barrel file, confirm dialog, and AI response
renderer live in `src/components/ui/`.

## Code Checks

```bash
pnpm --filter @cheatcode/web typecheck
```

Product QA is direct `agent-browser --auto-connect --session cheatcode-debug`
interaction against the running app plus console/network/log review. Do not add
or run browser-flow scripts for web acceptance testing.

## Composer and Computer semantics

The composer keeps three independent product concepts separate:

- `ComposerWorkIntentId` describes what the user wants to accomplish. Web app,
  mobile app, slides, research, data, documents, and media are discoverable
  composer choices. These choices guide prompt context; they are not all project
  modes. The generic Slides choice activates the general PPTX workflow, never the
  fundraising-specific pitch-deck skill. Explicit PPTX and pitch-deck skill deep
  links both select the Slides intent while preserving the skill the user chose.
- `AppBuildTarget` is only the runtime topology for generated applications:
  `web` or `mobile`. It maps to `app-builder` or `app-builder-mobile`; every
  non-app work intent remains a `general` project and can still create typed
  Deliverables.
- `ComputerTab` is only the visible workspace view: `browser` or `files`.
  Artifact kind and MIME type decide how an output renders. A generated artifact selects Files,
  while an actual browser action selects Browser; the latest real activity wins when a transcript
  is restored. Neither work intent nor app target guesses the Computer tab, and the selected tab is
  not persisted across unrelated chats.

Signed-out launch handoff validates and restores `buildTarget`, model, and
public GitHub repository state before chat creation. The opaque prompt and
constrained run intent use the same one-shot handoff path. No `surface` query
parameter or persisted `app` tab alias is supported.

## Env

- `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`
- `NEXT_PUBLIC_GATEWAY_URL`
- `CLERK_SECRET_KEY`
- `VERCEL_GIT_COMMIT_SHA` (system-provided build identity, projected into public health metadata)
- `VERCEL_ENV` (actual Vercel runtime environment)
- `VERCEL_TARGET_ENV` (Vercel build/deployment target)
- `VERCEL_URL` (actual immutable deployment hostname)

Every `NEXT_PUBLIC_*` value is browser-visible deployment configuration, never
a credential or Secrets Store value.
The web build derives the preview apex from its validated deployment identity:
`localhost` locally and `trycheatcode.com` for Vercel builds.
Local development requires Clerk `pk_test_`/`sk_test_` keys. Every Vercel
deployment requires the production `pk_live_`/`sk_live_` keys; development keys
exist only in root `.env.local` on the laptop. Middleware also restricts Clerk session-token authorized parties to the exact
loopback, Vercel deployment, or production request origin for that environment. Preview
deployments are matched to their exact system-provided `VERCEL_URL`; no wildcard Vercel
origin is trusted.
The prebuilt production build explicitly sets `VERCEL_TARGET_ENV=production`,
which selects the live Clerk, canonical gateway, preview-hostname, and exact-SHA
validation branch before a deployment URL exists. Only an actual Vercel
`production` or `preview` runtime requires `VERCEL_URL`; Vercel supplies
`VERCEL_ENV` and `VERCEL_URL` after the prebuilt artifact is deployed.
`next.config.ts` and the runtime env accessor share the pure validators exported
by `@cheatcode/env/web-config`; public routing values remain explicit, while
release identity derives from `VERCEL_GIT_COMMIT_SHA` or `development` locally.
The config loads the repository-root `.env.local` through `@next/env` for local
builds and strips all loaded Worker-only values before Next evaluates the app;
no second env file under `apps/web` is used.
The production CSP admits the exact validated `NEXT_PUBLIC_GATEWAY_URL`; a real Vercel
Production build pins that value to `https://gateway.trycheatcode.com`, while optimized
local QA can use its loopback Wrangler origin.
Production additionally admits only Vercel's exact immutable deployment origin.
Google and other social authentication uses Clerk's full-page redirect flow. The callback therefore
finishes through one authoritative navigation instead of a popup attempting to replace the anonymous
client tree after its server identity has changed. Production can keep `Cross-Origin-Opener-Policy`
at `same-origin`; no authentication flow depends on a cross-origin opener relationship.
The identity-scoped query boundary derives its key from Clerk's client `useAuth()` state inside the
mounted `ClerkProvider`. It must not suspend the entire application on a server `auth()` promise:
the authenticated route gate already owns the Clerk loading state, and the query boundary remounts
cleanly when that resolved user or organization identity changes.

## Deploy

Vercel's Git integration deploys `apps/web` from the repository using the
checked-in build command. Production public environment values select the live
Clerk instance and canonical gateway; deployment identity selects the owned
preview apex. Verify the deployed revision in the Vercel dashboard after the
build finishes; worker liveness is `gateway.trycheatcode.com/health/live`.
