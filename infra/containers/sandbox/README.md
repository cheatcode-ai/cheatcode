# Cheatcode sandbox image (Daytona)

The project sandbox image for the Daytona backend. Daytona injects its own daemon
(host-mounted, PID 1) and overrides the image `ENTRYPOINT`, so this image does **not**
bake a sandbox daemon. Long-running services (Xvfb `:99` → x11vnc → websockify `6080`,
and code-server on `13340`) are started **after** sandbox creation via toolbox
sessions running scripts under `scripts/`, not by the entrypoint.

Sandboxes are created with `user: "node"` (see `ProjectSandbox.createSandbox`) so the
runtime user matches `/workspace` + the baked Next/Expo templates under `/home/node`.

## Build & publish (one-time / on image change)

Requires the Daytona CLI (`daytona`) authenticated to the org, and Docker.

```sh
# Build for the Daytona runner (AMD64 is required).
docker build --platform=linux/amd64 -t cheatcode-sandbox:<immutable-tag> \
  infra/containers/sandbox

# Push the local image straight into Daytona's registry (no external registry needed)
# and register it as a snapshot with baked resources (≤ Tier-2 caps: 4 vCPU / 8 GiB / 10 GiB).
daytona snapshot push cheatcode-sandbox:<immutable-tag> \
  --name cheatcode-sandbox-viewer-bundle-<yyyymmdd> \
  --cpu 2 --memory 4 --disk 10
```

Then set the agent-worker `DAYTONA_SANDBOX_SNAPSHOT` var to the new snapshot name.
The current default is `cheatcode-sandbox-viewer-bundle-20260703-1125z`.

> Use an **immutable tag**, not `:latest` (rejected) and not a digest (digest pinning is
> currently broken in Daytona). Snapshot names are immutable in Daytona; publish each
> image update under a new snapshot name and move `DAYTONA_SANDBOX_SNAPSHOT` forward.
> Resources are **baked into the snapshot**; rebuild/re-push to change them (or build
> per-tier snapshots).

The image bakes code-server plus document and data viewers used by the Cheatcode
computer Files surface. The product embeds this as a controlled file/document
viewer and must never route the Browser tab or an empty computer state to the
generic code-server Welcome UI. Generated deliverables can also be rendered
through the product file-preview API: PPTX/DOCX/XLSX and other Office files are
converted with LibreOffice, PDFs and images render inline, and code/data files
use the Files surface.
