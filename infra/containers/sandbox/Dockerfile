FROM node:22.22.2-bookworm-slim@sha256:9f6d5975c7dca860947d3915877f85607946403fc55349f39b4bc3688448bb6e

ARG CODE_SERVER_VERSION=4.128.0
ARG CODE_SERVER_SHA256=79ba26bf186e5268a22b7c17b30a5f288a16c37791f0b86c27859e8fef103188
ARG DEBIAN_SNAPSHOT=20260713T000000Z

# Daytona injects its own daemon (host-mounted, PID 1) and overrides ENTRYPOINT,
# so we do NOT bake a sandbox daemon. Headed Chromium uses Xvfb, which the
# browser tool starts on demand through the baked launcher.
# Sandboxes are created with user "node" to match /workspace + template ownership.

RUN set -eux; \
  sed -i \
    -e "s|URIs: http://deb.debian.org/debian$|URIs: http://snapshot.debian.org/archive/debian/${DEBIAN_SNAPSHOT}|" \
    -e "s|URIs: http://deb.debian.org/debian-security$|URIs: http://snapshot.debian.org/archive/debian-security/${DEBIAN_SNAPSHOT}|" \
    /etc/apt/sources.list.d/debian.sources; \
  rm -rf /var/lib/apt/lists/*; \
  apt-get -o Acquire::ForceIPv4=true -o Acquire::Retries=5 -o Acquire::Check-Valid-Until=false -o Acquire::http::No-Cache=true -o Acquire::http::Pipeline-Depth=0 update; \
  apt-get -o Acquire::ForceIPv4=true -o Acquire::Retries=5 -o Acquire::http::Pipeline-Depth=0 install -y --no-install-recommends ca-certificates; \
  sed -i 's|URIs: http://snapshot.debian.org|URIs: https://snapshot.debian.org|g' /etc/apt/sources.list.d/debian.sources; \
  rm -rf /var/lib/apt/lists/*; \
  apt-get -o Acquire::ForceIPv4=true -o Acquire::Retries=5 -o Acquire::Check-Valid-Until=false -o Acquire::https::No-Cache=true update; \
  apt-get -o Acquire::ForceIPv4=true -o Acquire::Retries=5 -o Acquire::http::Pipeline-Depth=0 install -y --no-install-recommends \
  file python3 python3-pip python3-venv git curl wget gnupg netcat-openbsd sudo \
  procps xvfb x11vnc novnc websockify \
  pandoc poppler-utils qpdf tesseract-ocr \
  libreoffice-calc libreoffice-impress libreoffice-writer \
  libnss3 libatk-bridge2.0-0 libdrm2 libxkbcommon0 libgbm1 libasound2 \
  fonts-liberation libappindicator3-1 libnspr4 libxcomposite1 libxdamage1 \
  libxrandr2 xdg-utils x11-utils; \
  rm -rf /var/lib/apt/lists/*

COPY package-manager/package.json package-manager/package-lock.json /opt/cheatcode-package-manager/
COPY doc-runtime/package.json doc-runtime/package-lock.json /opt/cheatcode-doc-runtime/
COPY skill-runtime/package.json skill-runtime/package-lock.json skill-runtime/tsconfig.json /opt/cheatcode-skill-runtime/
COPY skill-runtime/bin/ /opt/cheatcode-skill-runtime/bin/
COPY skill-runtime/src/ /opt/cheatcode-skill-runtime/src/
WORKDIR /opt/cheatcode-package-manager
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund \
  && rm -rf /usr/local/lib/node_modules/npm \
  && ln -sf /opt/cheatcode-package-manager/node_modules/.bin/npm /usr/local/bin/npm \
  && ln -sf /opt/cheatcode-package-manager/node_modules/.bin/npx /usr/local/bin/npx \
  && ln -sf /opt/cheatcode-package-manager/node_modules/.bin/pnpm /usr/local/bin/pnpm \
  && ln -sf /opt/cheatcode-package-manager/node_modules/.bin/pnpx /usr/local/bin/pnpx
WORKDIR /opt/cheatcode-doc-runtime
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund \
  && npm cache clean --force
WORKDIR /opt/cheatcode-skill-runtime
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund \
  && chmod a+rx /opt/cheatcode-skill-runtime/bin/*.mjs \
  && chmod a+rx /opt/cheatcode-skill-runtime/node_modules/agent-browser/bin/agent-browser-* \
  && ln -sf /opt/cheatcode-skill-runtime/bin/cheatcode-skills.mjs /usr/local/bin/cheatcode-skills \
  && ln -sf /opt/cheatcode-skill-runtime/bin/cheatcode-browser.mjs /usr/local/bin/cheatcode-browser \
  && ln -sf /opt/cheatcode-skill-runtime/node_modules/.bin/agent-browser /usr/local/bin/agent-browser \
  && npm cache clean --force

RUN curl -fsSL \
    "https://github.com/coder/code-server/releases/download/v${CODE_SERVER_VERSION}/code-server-${CODE_SERVER_VERSION}-linux-amd64.tar.gz" \
    -o /tmp/code-server.tar.gz \
  && echo "${CODE_SERVER_SHA256}  /tmp/code-server.tar.gz" | sha256sum --check --strict \
  && tar -xzf /tmp/code-server.tar.gz -C /opt \
  && ln -sf "/opt/code-server-${CODE_SERVER_VERSION}-linux-amd64/bin/code-server" /usr/local/bin/code-server \
  && rm -f /tmp/code-server.tar.gz

COPY requirements.txt /tmp/requirements.txt
RUN pip3 install --break-system-packages --disable-pip-version-check --no-cache-dir \
    --retries 10 --timeout 60 --only-binary=:all: --require-hashes -r /tmp/requirements.txt \
  && rm -f /tmp/requirements.txt

ENV DISPLAY=:99
ENV PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers
ENV CHROME_PATH=/usr/local/bin/cheatcode-chromium
ENV NODE_PATH=/opt/cheatcode-doc-runtime/node_modules:/opt/cheatcode-skill-runtime/node_modules
COPY browser-driver /opt/cheatcode-browser-driver
WORKDIR /opt/cheatcode-browser-driver
RUN npm ci --omit=dev --no-audit --no-fund \
  && node_modules/.bin/playwright-core install --no-shell chromium \
  && rm -rf /opt/pw-browsers/ffmpeg-* \
  && ln -sf "$(find /opt/pw-browsers -path '*/chrome-linux*/chrome' -print -quit)" /usr/local/bin/cheatcode-chromium \
  && chmod -R a+rX /opt/cheatcode-browser-driver /opt/pw-browsers \
  && npm cache clean --force
ENV PATH="/opt/cheatcode-browser-driver/node_modules/.bin:/opt/cheatcode-skill-runtime/node_modules/.bin:${PATH}"

RUN mkdir -p /workspace && chown -R node:node /workspace
WORKDIR /workspace
USER node

ARG MUTY_PPT_VIEWER_VERSION=1.0.5
ARG MUTY_PPT_VIEWER_SHA256=e269f37434f28f0d64ded8c16e94c434209c0eed31a5f9b420e186d3065aeeaa
ARG PDF_VIEWER_VERSION=1.2.2
ARG PDF_VIEWER_SHA256=5697cd022caf93fa0fdb8c5b9c3624951394d8126ed09184ad4fdbcad62dadce
ARG OFFICE_VIEWER_VERSION=4.1.0
ARG OFFICE_VIEWER_SHA256=53beae018dd2751e7d268c79318debde2402db3888819ccd250f726b9ae7f291
ARG EXCEL_VIEWER_VERSION=4.2.58
ARG EXCEL_VIEWER_SHA256=c5dd520f68f60d2ccafdf1239ff8391b8b15bfb34ad054694b94e4d375abc862
ARG PARQUET_VIEWER_VERSION=3.1.0
ARG PARQUET_VIEWER_SHA256=5beaf9288ce0d89ed067e25a96c91243b10c888a245c2d1c969cc99e9835dd52
ARG RAINBOW_CSV_VERSION=3.24.1
ARG RAINBOW_CSV_SHA256=0ecb7da3fb2a54517cd41fce8e858d6276ea8523bed6fbfd64d5ed281bd7514a
ARG SQLITE_VIEWER_VERSION=26.2.5
ARG SQLITE_VIEWER_SHA256=9dce1d1cab2f2b3878433e2dfc23b78ec49fc452f9571eeff8c398d204aae5f5
ARG JUPYTER_VERSION=2025.9.1
ARG JUPYTER_SHA256=110660656944c4ab0ff687db488c2e8c59c67ec121dcf09bcaa54b6edd9ce71f
ARG JUPYTER_KEYMAP_VERSION=1.1.2
ARG JUPYTER_KEYMAP_SHA256=3d2998929bb43156f3b428116aee290543c437875df616ec755692219b4afa17
ARG JUPYTER_RENDERERS_VERSION=1.3.0
ARG JUPYTER_RENDERERS_SHA256=d09f6c517a8090a932bb4e2c31bcb2de34ddb2a71133477f6c47f28f36eb76ae
ARG JUPYTER_SLIDESHOW_VERSION=0.1.6
ARG JUPYTER_SLIDESHOW_SHA256=5b8dee0d569b7e0990bb4847c34748cdc0102078779351ed415d9d71cfa3e945
ARG JUPYTER_CELL_TAGS_VERSION=0.1.9
ARG JUPYTER_CELL_TAGS_SHA256=7cd43af55cf562a001dc475e92d9f3fd4b7173011adca0c02da22fbf891c274b
ARG DRAWIO_VERSION=1.6.6
ARG DRAWIO_SHA256=48f7129d2ecb9d12f981d889215b0568dede71cad41d28fdb906084199659b43
ARG MARKDOWN_MERMAID_VERSION=1.32.1
ARG MARKDOWN_MERMAID_SHA256=91c99eee8b7299e41efa708e20bd01a6fa13206cc4e627b43253e75c0343f442

COPY --chown=node:node extension-overrides/parquet-viewer/ /tmp/parquet-viewer-runtime-overlay/

RUN set -eux; \
  cd /tmp/parquet-viewer-runtime-overlay; \
  npm ci --omit=dev --ignore-scripts --no-audit --no-fund; \
  cd /workspace; \
  mkdir -p /home/node/.local/share/code-server/extensions /home/node/.local/share/code-server/user-data; \
  install_openvsx() { \
    namespace="$1"; \
    name="$2"; \
    version="$3"; \
    checksum="$4"; \
    vsix="/tmp/${namespace}.${name}-${version}.vsix"; \
    curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 \
      "https://open-vsx.org/api/${namespace}/${name}/${version}/file/${namespace}.${name}-${version}.vsix" -o "$vsix"; \
    echo "${checksum}  ${vsix}" | sha256sum --check --strict; \
    code-server \
      --extensions-dir /home/node/.local/share/code-server/extensions \
      --install-extension "$vsix"; \
    rm -f "$vsix"; \
  }; \
  install_openvsx mutyai muty-pptviewer "${MUTY_PPT_VIEWER_VERSION}" "${MUTY_PPT_VIEWER_SHA256}"; \
  install_openvsx tomoki1207 pdf "${PDF_VIEWER_VERSION}" "${PDF_VIEWER_SHA256}"; \
  install_openvsx cweijan vscode-office "${OFFICE_VIEWER_VERSION}" "${OFFICE_VIEWER_SHA256}"; \
  install_openvsx GrapeCity gc-excelviewer "${EXCEL_VIEWER_VERSION}" "${EXCEL_VIEWER_SHA256}"; \
  install_openvsx dvirtz parquet-viewer "${PARQUET_VIEWER_VERSION}" "${PARQUET_VIEWER_SHA256}"; \
  install_openvsx mechatroner rainbow-csv "${RAINBOW_CSV_VERSION}" "${RAINBOW_CSV_SHA256}"; \
  install_openvsx qwtel sqlite-viewer "${SQLITE_VIEWER_VERSION}" "${SQLITE_VIEWER_SHA256}"; \
  install_openvsx ms-toolsai jupyter "${JUPYTER_VERSION}" "${JUPYTER_SHA256}"; \
  install_openvsx ms-toolsai jupyter-keymap "${JUPYTER_KEYMAP_VERSION}" "${JUPYTER_KEYMAP_SHA256}"; \
  install_openvsx ms-toolsai jupyter-renderers "${JUPYTER_RENDERERS_VERSION}" "${JUPYTER_RENDERERS_SHA256}"; \
  install_openvsx ms-toolsai vscode-jupyter-slideshow "${JUPYTER_SLIDESHOW_VERSION}" "${JUPYTER_SLIDESHOW_SHA256}"; \
  install_openvsx ms-toolsai vscode-jupyter-cell-tags "${JUPYTER_CELL_TAGS_VERSION}" "${JUPYTER_CELL_TAGS_SHA256}"; \
  install_openvsx hediet vscode-drawio "${DRAWIO_VERSION}" "${DRAWIO_SHA256}"; \
  install_openvsx bierner markdown-mermaid "${MARKDOWN_MERMAID_VERSION}" "${MARKDOWN_MERMAID_SHA256}"; \
  parquet_extension_dir="/home/node/.local/share/code-server/extensions/dvirtz.parquet-viewer-${PARQUET_VIEWER_VERSION}"; \
  rm -rf "${parquet_extension_dir}/node_modules/thrift" "${parquet_extension_dir}/node_modules/ws"; \
  cp -a /tmp/parquet-viewer-runtime-overlay/node_modules/. "${parquet_extension_dir}/node_modules/"; \
  cd "${parquet_extension_dir}"; \
  test "$(node -p 'require("thrift/package.json").version')" = "0.23.0"; \
  test "$(node -p 'require("ws/package.json").version')" = "5.2.5"; \
  node -e 'const parquets=require("@dvirtz/parquets");const thrift=require("thrift");if(typeof parquets!=="object"||thrift.Thrift?.Type?.STOP!==0)throw new Error("Parquet runtime overlay failed")'; \
  rm -rf /tmp/parquet-viewer-runtime-overlay; \
  cd /workspace; \
  code-server \
    --extensions-dir /home/node/.local/share/code-server/extensions \
    --list-extensions | sort

# The bundled catalog is the single source of truth for both the agent prompt and
# the inspectable sandbox copy. It intentionally contains no user-app deploy skill.
COPY --from=default_skills --chown=node:node / /home/node/.cheatcode/default-skills/
COPY --chown=node:node skill-runtime/tsconfig.json /home/node/.cheatcode/tsconfig.json

# Template dependency churn must not invalidate the larger browser and editor layers.
COPY --chown=node:node app-templates/ /home/node/.cheatcode-template-manifests/
COPY --chown=node:node app-generators/ /home/node/.cheatcode-app-generators/

# The generators provide source files only. Reviewed manifests and lockfiles are
# copied over them, then fetched into the node user's pnpm store so project creation
# can install the exact dependency graph offline. The Expo template artifact itself
# is pinned: create-expo-app's mutable "default" alias is intentionally not used.
ARG EXPO_TEMPLATE_VERSION=57.0.6
ARG EXPO_TEMPLATE_SHA256=4c2a276f05db27f4a4dfaa326123e72be33d7ad6878fdd46b8df7eb3376def3b

RUN set -eux; \
  cd /home/node/.cheatcode-app-generators; \
  npm ci --omit=dev --ignore-scripts --no-audit --no-fund; \
  ./node_modules/.bin/create-next-app /home/node/cheatcode-next-template \
    --yes --ts --tailwind --biome --app --src-dir --use-pnpm --skip-install --disable-git; \
  cp /home/node/.cheatcode-template-manifests/next/package.json /home/node/cheatcode-next-template/package.json; \
  cp /home/node/.cheatcode-template-manifests/next/pnpm-lock.yaml /home/node/cheatcode-next-template/pnpm-lock.yaml; \
  cp /home/node/.cheatcode-template-manifests/next/pnpm-workspace.yaml /home/node/cheatcode-next-template/pnpm-workspace.yaml; \
  rm -rf \
    /home/node/cheatcode-next-template/.next \
    /home/node/cheatcode-next-template/node_modules \
    /home/node/cheatcode-next-template/AGENTS.md \
    /home/node/cheatcode-next-template/CLAUDE.md; \
  cd /home/node/cheatcode-next-template; \
  pnpm fetch --frozen-lockfile; \
  cd /workspace; \
  curl -fsSL \
    "https://registry.npmjs.org/expo-template-default/-/expo-template-default-${EXPO_TEMPLATE_VERSION}.tgz" \
    -o /tmp/expo-template-default.tgz; \
  echo "${EXPO_TEMPLATE_SHA256}  /tmp/expo-template-default.tgz" | sha256sum --check --strict; \
  mkdir -p /home/node/.cheatcode-expo-template-source; \
  tar -xzf /tmp/expo-template-default.tgz \
    --strip-components=1 -C /home/node/.cheatcode-expo-template-source; \
  mv /home/node/.cheatcode-expo-template-source /home/node/cheatcode-expo-template; \
  mv /home/node/cheatcode-expo-template/gitignore /home/node/cheatcode-expo-template/.gitignore; \
  mv /home/node/cheatcode-expo-template/_vscode /home/node/cheatcode-expo-template/.vscode; \
  cp /home/node/.cheatcode-template-manifests/expo/package.json /home/node/cheatcode-expo-template/package.json; \
  cp /home/node/.cheatcode-template-manifests/expo/pnpm-lock.yaml /home/node/cheatcode-expo-template/pnpm-lock.yaml; \
  cp /home/node/.cheatcode-template-manifests/expo/pnpm-workspace.yaml /home/node/cheatcode-expo-template/pnpm-workspace.yaml; \
  cd /home/node/cheatcode-expo-template; \
  node -e 'const fs=require("node:fs");const j=JSON.parse(fs.readFileSync("app.json","utf8"));j.expo??={};j.expo.name="cheatcode-expo-template";j.expo.slug="cheatcode-expo-template";j.expo.web={...(j.expo.web??{}),bundler:"metro",output:"single"};fs.writeFileSync("app.json",JSON.stringify(j,null,2)+"\n")'; \
  rm -rf .git .expo node_modules package-lock.json AGENTS.md CLAUDE.md .claude; \
  pnpm fetch --frozen-lockfile; \
  cd /workspace; \
  rm -rf \
    /tmp/expo-template-default.tgz \
    /home/node/.cache \
    /home/node/.npm \
    /home/node/.cheatcode-app-generators \
    /home/node/.cheatcode-template-manifests

# Keep operational scripts after the expensive immutable template layers so a
# launcher-only change does not force extension and package-store rebuilds.
USER root
COPY scripts/ /opt/cheatcode/
COPY entrypoint.sh /entrypoint.sh
RUN chmod -R a+rx /opt/cheatcode \
  && chmod a+rx /entrypoint.sh \
  && useradd --create-home --home-dir /home/cheatcode-browser \
    --shell /usr/sbin/nologin cheatcode-browser \
  && chmod 0700 /home/cheatcode-browser \
  && ln -s /opt/cheatcode/start-browser-driver.sh /usr/local/bin/cheatcode-browser-driver \
  && printf '%s\n' \
    'node ALL=(cheatcode-browser) NOPASSWD: /usr/local/bin/cheatcode-browser-driver' \
    > /etc/sudoers.d/cheatcode-browser-driver \
  && chmod 0440 /etc/sudoers.d/cheatcode-browser-driver \
  && visudo --check

USER node
EXPOSE 5173 8000 8081 13340

ENTRYPOINT ["/entrypoint.sh"]
