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
the currently running snapshot as an immediate rollback target.

### Manual fallback

Requires the Daytona CLI (`daytona`) authenticated to the org, and Docker.

```sh
# Build for the Daytona runner (AMD64 is required).
docker build --platform=linux/amd64 -t cheatcode-sandbox:<immutable-tag> \
  infra/containers/sandbox

# Push the local image straight into Daytona's registry (no external registry needed)
# and register it as a snapshot with baked resources (≤ Tier-2 caps: 4 vCPU / 8 GiB / 10 GiB).
daytona snapshot push cheatcode-sandbox:<immutable-tag> \
  --name cheatcode-sandbox-viewer-bundle-<commit-sha>-<unique-run-id> \
  --cpu 2 --memory 4 --disk 10 --region us
```

Then set the agent-worker `DAYTONA_SANDBOX_SNAPSHOT` var to the new snapshot name.
The authoritative current default is committed in
[`apps/agent-worker/wrangler.jsonc`](../../../apps/agent-worker/wrangler.jsonc).

> Use an **immutable tag**, not `:latest` (rejected) and not a digest (digest pinning is
> currently broken for Daytona pushed-image references). The Dockerfile base image is
> still pinned by OCI digest. Snapshot names are immutable in Daytona; publish each
> image update under a new snapshot name and move `DAYTONA_SANDBOX_SNAPSHOT` forward.
> Resources are **baked into the snapshot**; rebuild/re-push to change them (or build
> per-tier snapshots).

When updating code-server, an Open VSX extension, or the Daytona CLI, update its exact
version and SHA-256 together. The remote build fails closed when downloaded bytes do
not match the reviewed checksum. `create-next-app` and the Expo template tarball are
also version-pinned so a rebuild cannot silently switch template generations. The Node
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
pnpm locks under `app-templates/`. Their locked packages are prefetched into the image
so normal project creation can install offline. Expo uses an exact
`expo-template-default` tarball with a reviewed SHA-256 rather than the mutable
`default` alias. These locks prevent a snapshot rebuild from resolving a different
dependency tree while the application source stays unchanged.

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
affected, so `npm audit` reports 19 low transitive paths. Keep that exception
visible and reassess it with each Stagehand/AI SDK release; do not apply npm's
suggested breaking Stagehand downgrade. Static checks fail on moderate-or-higher
findings across every sandbox lock without hiding this low-severity report.

Snapshot publication builds and scans the exact local AMD64 image before pushing it
to Daytona. Trivy fails on every fixable medium-or-higher vulnerability and every
high-or-critical embedded secret; Debian findings without an available package fix
remain visible in the full report but cannot block a rebuild indefinitely.

Trivy's current fixable image report has two path-specific metadata mismatches, not
executable vulnerable packages. It treats VS Code's built-in extension manifest
at `lib/vscode/extensions/npm/package.json` as the npm CLI because the extension is
also named `npm`, and its pnpm advisory data omits the patched 10.x range. The upstream
pnpm advisory `GHSA-gj8w-mvpf-x27x` explicitly fixes the 10.x line in 10.34.2, so the
pinned 10.34.5 is not affected. `.trivyignore.yaml` suppresses only the exact package
URLs and image paths for these false positives, records the rationale, and expires the
exceptions on October 15, 2026. Re-verify those paths after every code-server or pnpm
upgrade; never replace these entries with a broad vulnerability-ID ignore.

The browser driver is a privileged trust boundary inside the otherwise
user-programmable sandbox. Project commands run as `node`; only the immutable
launcher may be started through the narrow sudo rule, and that launcher drops to
the separate `cheatcode-browser` Unix user. The Agent Worker sends the
request-scoped model key and driver bearer token once over the Daytona session's
stdin. They are never command arguments, environment variables, workspace files,
or persisted process metadata. The driver runs from its mode-0700 home with core
dumps disabled, deletes provider-key environment names defensively, expires
after 55 minutes, and requires both the bearer token and run ID. Worker calls
reach it through a short-lived Daytona-signed port URL; arbitrary workspace code
does not receive that URL or either credential. Preserve this boundary when
changing the driver launch path.

Regenerate JavaScript locks from their owning directories with the repository's
pinned package-manager versions:

```sh
cd infra/containers/sandbox/package-manager
npm install --package-lock-only --ignore-scripts --no-audit --no-fund

cd ../app-generators
npm install --package-lock-only --ignore-scripts --no-audit --no-fund

cd ../doc-runtime
npm install --package-lock-only --ignore-scripts --no-audit --no-fund

cd ../extension-overrides/parquet-viewer
npm install --package-lock-only --ignore-scripts --no-audit --no-fund

cd ../app-templates/next
pnpm install --lockfile-only --ignore-scripts --ignore-workspace

cd ../expo
pnpm install --lockfile-only --ignore-scripts --ignore-workspace
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
