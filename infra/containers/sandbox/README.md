# Cheatcode sandbox image (Daytona)

The project sandbox image for the Daytona backend. Daytona injects its own daemon
(host-mounted, PID 1) and overrides the image `ENTRYPOINT`, so this image does **not**
bake a sandbox daemon. Headed Chromium's Xvfb display and code-server are started on
demand after sandbox creation via toolbox sessions running scripts under `scripts/`,
not by the entrypoint.

Sandboxes are created with `user: "node"` (see `ProjectSandbox.createSandbox`) so the
runtime user matches `/workspace` + the baked Next/Expo templates under `/home/node`.

## Build and publish

The normal path is the protected **Build Sandbox Snapshot** GitHub workflow. Dispatch
it from `main` and enter `BUILD_SNAPSHOT`. It publishes an immutable candidate named
`cheatcode-sandbox-viewer-bundle-<12-character-commit-sha>-<workflow-run-id>` and
refuses any pre-existing or surviving candidate name. If Daytona returns its exact
transient 30-second processing timeout, the workflow may remove only the unused failed
candidate created by that same publish attempt before retrying the run-scoped name.
Candidate ID, creation time, OCI digest, region, resources, error shape, and
`lastUsedAt` are revalidated immediately before deletion. Active, previously used,
pre-existing, or ambiguous snapshots fail closed and are never deleted or replaced.

Promotion is a separate reviewed source change: update the agent-worker
`DAYTONA_SANDBOX_SNAPSHOT` var to the candidate name, then use the protected database
migration/backend release path. Keeping publication and promotion separate preserves
the currently running snapshot as an immediate rollback target. After promotion, each
user's first workspace operation waits for active work to drain, deletes only the stale
canonical container, and recreates it on the same isolated persistent-volume subpath.
Project files and user-installed skills therefore survive runtime promotion. Ambiguous
ownership, snapshot labels, duplicate identities, or storage mounts fail closed.

The protected production release preflight independently installs the same
checksum-pinned Daytona CLI and scans every paginated snapshot-list page. It accepts
the configured name only when exactly one active snapshot has the reviewed region and
2-vCPU/4-GiB/10-GiB resources, provider identifiers and image reference have canonical
shapes, validation was not skipped, and no provider error is present. The source
commit encoded in the immutable name must be an ancestor of the exact release, with no
later change anywhere under this sandbox image directory.
The same preflight requires the configured shared workspace volume to exist exactly once in the
snapshot's organization and to be ready without a provider error. Daytona's current FUSE/object-
store volume contract exposes no fixed region or capacity field; target region is enforced by the
snapshot and every canonical sandbox, while storage scales through the provider object store. The
preflight also scans the complete sandbox inventory and rejects duplicate live canonical label
identities, proving recovery does not depend on a replacement retaining the historical physical
sandbox name.

### Local build check

Docker can validate the AMD64 image locally without publishing it:

```sh
docker build --platform=linux/amd64 \
  --build-context default_skills=skills \
  -t cheatcode-sandbox:<immutable-tag> \
  infra/containers/sandbox
```

Do not authenticate a laptop to Daytona or publish a snapshot manually. Dispatch
the protected **Build Sandbox Snapshot** workflow from `main` with
`BUILD_SNAPSHOT`, review its emitted immutable name, and commit that name to the
agent-worker `DAYTONA_SANDBOX_SNAPSHOT` var. The authoritative current default is committed in
[`apps/agent-worker/wrangler.jsonc`](../../../apps/agent-worker/wrangler.jsonc).

> Use an **immutable tag**, not `:latest` (rejected) and not a digest (digest pinning is
> currently broken for Daytona pushed-image references). The Dockerfile base image is
> still pinned by OCI digest. Snapshot names are immutable in Daytona; publish each
> image update under a new snapshot name and move `DAYTONA_SANDBOX_SNAPSHOT` forward.
> Resources are **baked into the snapshot**; rebuild/re-push to change them (or build
> per-tier snapshots).

When updating code-server, an Open VSX extension, or the Daytona CLI, update its exact
version and SHA-256 together. The remote build fails closed when downloaded bytes do
not match the reviewed checksum. `create-next-app` is lock-pinned, while the Expo
scaffold is a reviewed, minimal source tree committed beside its exact package lock so
a rebuild cannot silently switch template generations or copy demo assets into a user's
durable workspace. The Node
base image uses an OCI digest and apt resolves both the main and security repositories
from the reviewed `DEBIAN_SNAPSHOT`; update those pins deliberately to take security
patches.

The package manager, source generators, document/data runtime, and the Parquet
Viewer runtime overlay have their own checked-in npm locks under `package-manager/`,
`app-generators/`, `doc-runtime/`, and `extension-overrides/parquet-viewer/`.
They are installed with `npm ci`; no `npx` or mutable generator resolution runs during
the image build. Document-runtime versions are owned by its reviewed manifest and lock;
they are intentionally absent from the Worker workspace catalog. Its `uuid` override
keeps ExcelJS on the patched UUID implementation while preserving the public CommonJS
`v4` API that ExcelJS consumes. The Next and Expo scaffolds likewise use reviewed manifests and
pnpm locks under `app-templates/`. Their locked packages are installed into immutable
sandbox-local runtimes in the image. Project creation copies only source and config to
the persistent Daytona volume; dependency trees and generated compiler caches stay on
the sandbox's local filesystem, avoiding slow, partial writes to object-store FUSE.
Exact scaffold projects link their disposable native-disk mirror to the matching immutable
runtime dependency tree, avoiding both package copies and installs during startup. That tree is
root-owned and read-only. Read-only validation and project-script commands keep its link intact and
disable pnpm's pre-run auto-install, while the helper detaches the link before a package mutation or
non-template restore; additional dependencies then
use a project-scoped local modules directory and can be restored from the reviewed package store
after a sandbox replacement. The minimal Expo scaffold intentionally contains no
generated images: only manifests and the starter route cross the persistent object-store
boundary. Its dependency tree remains the exact reviewed runtime installed on native
sandbox disk. These locks prevent a snapshot rebuild from resolving a different dependency
tree while the application source stays unchanged.

The root-owned `/opt/cheatcode/project-source-sync.py` helper is the single runtime
boundary between persistent project source and the native-disk project mirror. It is
baked and syntax-checked with the immutable image so Workers invoke a short, bounded
command instead of transporting executable source through sandbox command arguments.
It uses content hashes and atomic replacement on native disk. Writes back to Daytona's
object-store FUSE use direct overwrite plus checksum verification because that mount does
not implement replacement renames or portable chmod semantics.
The adjacent root-owned `/opt/cheatcode/configure-expo-runtime.mjs` helper preserves the
reviewed Expo template's source aliases while pinning its TypeScript base configuration to the
immutable runtime. Snapshot smoke testing runs that same helper, compiles the
real Expo Router bundle, and renders the template in headless Chromium; a listening Metro port
without an executable app is not considered healthy.
The image also declares Expo's non-interactive headless mode. Sandboxed preview servers do not
need local-device discovery or a standalone React Native DevTools shell, so those background
network and binary-install side effects are disabled for every generated mobile project.
Direct pnpm invocations execute inside one `flock`-guarded transaction; process death
releases that lock automatically, and successful source changes commit only after a
three-way conflict check against the durable tree. Long-lived previews invoke the same helper as
direct argv: it synchronizes source, restores dependencies under the project lock, supervises the
native-disk app and sync-loop children, and forwards termination signals. Transient read contention
from the durable FUSE source is retried during a bounded grace period without interrupting the app.
If source access does not recover or the synchronizer otherwise exits, the managed preview exits as
one failed process unit so its existing bounded restart policy cannot leave a healthy port backed by
stale source. Exact scaffold manifests activate the immutable runtime dependency tree, while a
dependency-state digest skips unchanged project-local reinstalls. Projects without a durable
lockfile install without creating one as a preview side effect. Dependency restoration temporarily
merges the image's reviewed build
policy into the sandbox-local workspace, currently permitting `esbuild` so Vite can install its
platform binary while pnpm's default-deny lifecycle policy remains intact for every other package.
The original workspace manifest is restored byte-for-byte before the app starts, and the managed
preview disables pnpm's redundant pre-script auto-install because the helper has already restored
and digested that exact dependency state under the project lock. The Worker therefore does
not transport an executable shell wrapper or make trusted bootstrap commands indistinguishable from
model-supplied shell input.

A dependency mutation advances a generation while holding the package lock. The long-lived preview
supervisor waits for that transaction to release the lock, then replaces only its app child while
retaining the source synchronizer and original signed environment. Metro and other module resolvers
therefore cannot keep serving the dependency graph they cached before an install. The protected
snapshot smoke exercises both contracts: `pnpm exec tsc` must preserve the immutable runtime and
running Metro process, while an offline install must create a project-local dependency tree, restart
Metro, and compile the application bundle again.

Open VSX currently publishes Parquet Viewer 3.1.0 with vulnerable Thrift and WebSocket
runtimes. The image keeps the extension feature but replaces those two runtime packages
with the exact, lockfile-pinned versions in `extension-overrides/parquet-viewer/` and
fails the build if the resulting Parquet reader cannot load. Remove this overlay only
after a pinned extension release ships equivalent or newer patched dependencies.

The browser driver pins `playwright-core` both to satisfy Stagehand's optional
compatibility peer and to install a matching Chromium artifact. Stagehand 3 runs
against that explicit Chromium path through CDP rather than launching an
unversioned system browser. The image omits Playwright's unused headless-shell
and FFmpeg artifacts because the product launches headed Chromium directly.
Stagehand currently resolves `@ai-sdk/provider-utils` 3.0.29. That release contains
the bounded JSON-response reader that Vercel shipped in 3.0.28. GitHub's current
`GHSA-866g-f22w-33x8` range nevertheless marks every 3.x version through 3.0.97
affected, so `npm audit` reports the resulting low-severity transitive paths. The
driver injects a bounded, provider-scoped fetch implementation into Stagehand's
AI SDK client and restricts it to the exact selected Anthropic, Google, or OpenAI
API hostname, containing both that resource-consumption surface and the related
download-URL SSRF advisory. The driver owns Chromium's lifecycle explicitly and
uses the native transport only for its validated loopback CDP connection;
Chromium navigation does not use the provider transport. Keep the exception
visible and reassess it with each Stagehand/AI SDK release; do not apply npm's
suggested breaking Stagehand downgrade. Static checks fail on
moderate-or-higher findings across every sandbox lock without hiding this
low-severity report.

Browser interaction uses Stagehand's native accessibility snapshot followed by deterministic act.
The driver returns hyphenated page refs while retaining their XPath map server-side, then accepts
one bounded method/value against a single-use ref from the latest active-page state. Successful acts
atomically replace the consumed ref map with the fresh post-action tree and its server-held map, so
multi-step verification chains without another observation inference.
Stagehand observation inference, natural-language actions, and self-healing are disabled; browser
behavior is independent of the selected model's structured-output quirks. Navigation clears the
observation, and origin interception remains active for deterministic execution.

Snapshot publication builds and scans the exact local AMD64 image before pushing it
to Daytona. Trivy fails on every fixable medium-or-higher vulnerability and every
high-or-critical embedded secret; Debian findings without an available package fix
remain visible in the full report but cannot block a rebuild indefinitely.

Trivy's current fixable image report has one path-specific metadata mismatch, not an
executable vulnerable package. It treats VS Code's built-in extension manifest at
`lib/vscode/extensions/npm/package.json` as the npm CLI because the extension is also
named `npm`. `.trivyignore.yaml` suppresses only that exact package URL and image path,
records the rationale, and expires the exception on October 15, 2026. Re-verify the
path after every code-server upgrade; never replace the entry with a broad
vulnerability-ID ignore.

The browser driver is a privileged trust boundary inside the otherwise
user-programmable sandbox. Project commands run as `node`; only the immutable
launcher may be started through the narrow sudo rule, and that launcher drops to
the separate `cheatcode-browser` Unix user. The Agent Worker sends the
request-scoped model key and driver bearer token once over the Daytona session's
stdin after terminal echo is disabled. They are never command arguments,
environment variables, workspace files, session logs, or persisted process
metadata. The driver runs from its mode-0700 home with core
dumps disabled, deletes provider-key environment names defensively, expires
after 55 minutes, and requires both the bearer token and run ID. Worker calls
reach it through a short-lived Daytona-signed port URL; arbitrary workspace code
does not receive that URL or either credential. Preserve this boundary when
changing the driver launch path.

## Skills and workspace metadata

The repository's top-level `skills/` directory is the only source for curated
default skills. The snapshot build mounts it as the `default_skills` BuildKit
context and copies the same reviewed files to
`/home/node/.cheatcode/default-skills/`, making the active playbooks inspectable
without maintaining a second copy. Default skills are immutable snapshot data.
User-authored metadata remains canonical in Postgres, while its versioned package
is canonical in R2 and mirrored completely to
`/workspace/.cheatcode/skills/<slug>/` for editing. The package may contain bounded
source, schemas, references, templates, and common binary assets; dependency
folders, virtual environments, caches, locks, and build output remain sandbox-local.

Cheatcode does not deploy or synchronize generated user apps. The curated
catalog therefore has no deploy skill, deploy runtime, or app-side Composio
bridge. Connected-app skills invoke the existing request-scoped Composio tools
for explicit user actions only.

Regenerate JavaScript locks from their owning directories with the repository's
pinned package-manager versions:

```sh
cd infra/containers/sandbox/package-manager
npm install --package-lock-only --ignore-scripts --no-audit --no-fund

cd ../browser-driver
npm install --package-lock-only --ignore-scripts --no-audit --no-fund

cd ../runtime-security-overrides
npm install --package-lock-only --ignore-scripts --no-audit --no-fund

cd ../app-generators
npm install --package-lock-only --ignore-scripts --no-audit --no-fund

cd ../doc-runtime
npm install --package-lock-only --ignore-scripts --no-audit --no-fund

cd ../extension-overrides/parquet-viewer
npm install --package-lock-only --ignore-scripts --no-audit --no-fund

cd ../app-templates/next
pnpm install --lockfile-only --ignore-scripts

cd ../expo
pnpm install --lockfile-only --ignore-scripts
```

Static checks audit the root graph plus all sandbox npm locks and both independent
template locks. Run the template audits from the repository root with
`pnpm --dir <template-directory> --ignore-workspace audit`; omitting
`--ignore-workspace` audits the root workspace instead of the selected template.

The Next scaffold follows the web workspace's exact Next, React, React DOM, Tailwind,
Biome, and TypeScript pins. The Expo scaffold instead follows its exact Expo SDK 57
compatibility matrix; do not force the web workspace's React patch into that manifest
without first upgrading and validating the Expo SDK as a unit. Their local overrides
keep Next's PostCSS and Expo's transitive Xcode UUID implementation on patched
versions; Xcode's CommonJS `v4()` call remains compatible with the pinned UUID 11
release.

Python top-level dependencies live in `requirements.in`; `requirements.txt` is the
Python 3.11 / Linux AMD64 lock and includes hashes for every resolved dependency.
Regenerate it from this directory with the exact command recorded in its header. The
image installs with `--require-hashes` and `--only-binary=:all:`. Audit the resolved
lock before publishing an image:

```sh
uvx --from pip-audit==2.10.1 pip-audit -r requirements.txt --disable-pip
```

The image bakes code-server plus document and data viewers used by the Cheatcode
computer Files surface. The product embeds this as a controlled file/document
viewer and must never route the Browser tab or an empty computer state to the
generic code-server Welcome UI. Generated deliverables can also be rendered
through the product file-preview API: PPTX/DOCX/XLSX and other Office files are
converted with LibreOffice, PDFs and images render inline, and code/data files
use the Files surface.
