FROM node:22.22.2-bookworm-slim@sha256:9f6d5975c7dca860947d3915877f85607946403fc55349f39b4bc3688448bb6e

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
ENV NEXT_TELEMETRY_DISABLED=1

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates \
  && rm -rf /var/lib/apt/lists/* \
  && corepack enable \
  && corepack prepare pnpm@11.8.0 --activate

WORKDIR /workspace

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/agent-worker/package.json apps/agent-worker/package.json
COPY apps/gateway-worker/package.json apps/gateway-worker/package.json
COPY apps/preview-proxy/package.json apps/preview-proxy/package.json
COPY apps/web/package.json apps/web/package.json
COPY apps/webhooks-worker/package.json apps/webhooks-worker/package.json
COPY packages/agent-core/package.json packages/agent-core/package.json
COPY packages/auth/package.json packages/auth/package.json
COPY packages/billing/package.json packages/billing/package.json
COPY packages/byok/package.json packages/byok/package.json
COPY packages/composio/package.json packages/composio/package.json
COPY packages/db/package.json packages/db/package.json
COPY packages/durable-storage/package.json packages/durable-storage/package.json
COPY packages/env/package.json packages/env/package.json
COPY packages/observability/package.json packages/observability/package.json
COPY packages/preview-bridge/package.json packages/preview-bridge/package.json
COPY packages/sandbox-contracts/package.json packages/sandbox-contracts/package.json
COPY packages/skills/package.json packages/skills/package.json
COPY packages/tools-browser/package.json packages/tools-browser/package.json
COPY packages/tools-code/package.json packages/tools-code/package.json
COPY packages/tools-data/package.json packages/tools-data/package.json
COPY packages/tools-docs/package.json packages/tools-docs/package.json
COPY packages/tools-media/package.json packages/tools-media/package.json
COPY packages/tools-research/package.json packages/tools-research/package.json
COPY packages/tsconfig/package.json packages/tsconfig/package.json
COPY packages/types/package.json packages/types/package.json
COPY packages/ui/package.json packages/ui/package.json

RUN --mount=type=cache,id=cheatcode-pnpm-store,target=/pnpm/store \
  pnpm install --frozen-lockfile --ignore-scripts \
  && pnpm rebuild esbuild workerd

# The build context intentionally excludes .git. Pnpm 11 otherwise launches a
# second install before commands when its dependency-state settings differ from
# this image's intentional --ignore-scripts install, which would run the
# host-only Lefthook prepare hook. Report drift without mutating the image.
ENV pnpm_config_verify_deps_before_run=warn
ENV npm_config_ignore_scripts=true

COPY . .
