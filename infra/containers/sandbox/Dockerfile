FROM node:22-bookworm-slim

ARG CODE_SERVER_VERSION=4.108.2

# Daytona injects its own daemon (host-mounted, PID 1) and overrides ENTRYPOINT,
# so we do NOT bake a sandbox daemon. Long-running services (Xvfb/x11vnc/websockify)
# are started post-create via a toolbox session (scripts/start-vnc.sh), not here.
# Sandboxes are created with user "node" to match /workspace + template ownership.

RUN awk 'BEGIN { RS=""; ORS="\n\n" } $0 !~ /debian-security/ { print }' /etc/apt/sources.list.d/debian.sources > /tmp/debian.sources \
  && mv /tmp/debian.sources /etc/apt/sources.list.d/debian.sources \
  && apt-get -o Acquire::ForceIPv4=true -o Acquire::Retries=5 -o Acquire::http::Pipeline-Depth=0 update \
  && apt-get -o Acquire::ForceIPv4=true -o Acquire::Retries=5 -o Acquire::http::Pipeline-Depth=0 install -y --no-install-recommends ca-certificates \
  && sed -i 's|http://deb.debian.org|https://deb.debian.org|g' /etc/apt/sources.list.d/debian.sources \
  && apt-get -o Acquire::ForceIPv4=true -o Acquire::Retries=5 -o Acquire::http::Pipeline-Depth=0 update \
  && apt-get -o Acquire::ForceIPv4=true -o Acquire::Retries=5 -o Acquire::http::Pipeline-Depth=0 install -y --no-install-recommends \
  file python3 python3-pip python3-venv git curl wget gnupg netcat-openbsd \
  procps xvfb x11vnc websockify novnc \
  libreoffice-calc libreoffice-impress libreoffice-writer \
  libnss3 libatk-bridge2.0-0 libdrm2 libxkbcommon0 libgbm1 libasound2 \
  fonts-liberation libappindicator3-1 libnspr4 libxcomposite1 libxdamage1 \
  libxrandr2 xdg-utils x11-utils \
  && rm -rf /var/lib/apt/lists/*

RUN npm install -g pnpm@10.33.2 \
  && mkdir -p /opt/cheatcode-doc-runtime \
  && cd /opt/cheatcode-doc-runtime \
  && npm init -y \
  && npm install --omit=dev \
    pptxgenjs@3.12.0 \
    docx@9.5.1 \
    exceljs@4.4.0 \
    react@19.2.6 \
    react-dom@19.2.6 \
    recharts@3.2.1 \
    arquero@8.0.3 \
    @react-pdf/renderer@4.3.1

RUN curl -fsSL \
    "https://github.com/coder/code-server/releases/download/v${CODE_SERVER_VERSION}/code-server-${CODE_SERVER_VERSION}-linux-amd64.tar.gz" \
    -o /tmp/code-server.tar.gz \
  && tar -xzf /tmp/code-server.tar.gz -C /opt \
  && ln -sf "/opt/code-server-${CODE_SERVER_VERSION}-linux-amd64/bin/code-server" /usr/local/bin/code-server \
  && rm -f /tmp/code-server.tar.gz

COPY requirements.txt /tmp/requirements.txt
RUN pip3 install --break-system-packages -r /tmp/requirements.txt

ENV DISPLAY=:99
ENV PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers
ENV CHROME_PATH=/usr/local/bin/cheatcode-chromium
COPY browser-driver /opt/cheatcode-browser-driver
RUN cd /opt/cheatcode-browser-driver \
  && npm ci --omit=dev \
  && node_modules/.bin/playwright install chromium \
  && ln -sf "$(find /opt/pw-browsers -path '*/chrome-linux*/chrome' -print -quit)" /usr/local/bin/cheatcode-chromium \
  && chmod -R a+rX /opt/cheatcode-browser-driver /opt/pw-browsers
ENV PATH="/opt/cheatcode-browser-driver/node_modules/.bin:${PATH}"

COPY scripts/ /opt/cheatcode/
RUN chmod -R a+rx /opt/cheatcode

COPY entrypoint.sh /entrypoint.sh
RUN chmod a+rx /entrypoint.sh

RUN mkdir -p /workspace && chown -R node:node /workspace
WORKDIR /workspace
USER node

ARG MUTY_PPT_VIEWER_VERSION=1.0.5
ARG PDF_VIEWER_VERSION=1.2.2
ARG OFFICE_VIEWER_VERSION=4.1.0
ARG EXCEL_VIEWER_VERSION=4.2.58
ARG PARQUET_VIEWER_VERSION=3.1.0
ARG RAINBOW_CSV_VERSION=3.24.1
ARG SQLITE_VIEWER_VERSION=26.2.5
ARG JUPYTER_VERSION=2025.9.1
ARG JUPYTER_KEYMAP_VERSION=1.1.2
ARG JUPYTER_RENDERERS_VERSION=1.3.0
ARG JUPYTER_SLIDESHOW_VERSION=0.1.6
ARG JUPYTER_CELL_TAGS_VERSION=0.1.9
ARG DRAWIO_VERSION=1.6.6
ARG MARKDOWN_MERMAID_VERSION=1.32.1

RUN set -eux; \
  mkdir -p /home/node/.local/share/code-server/extensions /home/node/.local/share/code-server/user-data; \
  install_openvsx() { \
    namespace="$1"; \
    name="$2"; \
    version="$3"; \
    vsix="/tmp/${namespace}.${name}-${version}.vsix"; \
    curl -fsSL "https://open-vsx.org/api/${namespace}/${name}/${version}/file/${namespace}.${name}-${version}.vsix" -o "$vsix"; \
    code-server \
      --extensions-dir /home/node/.local/share/code-server/extensions \
      --install-extension "$vsix"; \
    rm -f "$vsix"; \
  }; \
  install_openvsx mutyai muty-pptviewer "${MUTY_PPT_VIEWER_VERSION}"; \
  install_openvsx tomoki1207 pdf "${PDF_VIEWER_VERSION}"; \
  install_openvsx cweijan vscode-office "${OFFICE_VIEWER_VERSION}"; \
  install_openvsx GrapeCity gc-excelviewer "${EXCEL_VIEWER_VERSION}"; \
  install_openvsx dvirtz parquet-viewer "${PARQUET_VIEWER_VERSION}"; \
  install_openvsx mechatroner rainbow-csv "${RAINBOW_CSV_VERSION}"; \
  install_openvsx qwtel sqlite-viewer "${SQLITE_VIEWER_VERSION}"; \
  install_openvsx ms-toolsai jupyter "${JUPYTER_VERSION}"; \
  install_openvsx ms-toolsai jupyter-keymap "${JUPYTER_KEYMAP_VERSION}"; \
  install_openvsx ms-toolsai jupyter-renderers "${JUPYTER_RENDERERS_VERSION}"; \
  install_openvsx ms-toolsai vscode-jupyter-slideshow "${JUPYTER_SLIDESHOW_VERSION}"; \
  install_openvsx ms-toolsai vscode-jupyter-cell-tags "${JUPYTER_CELL_TAGS_VERSION}"; \
  install_openvsx hediet vscode-drawio "${DRAWIO_VERSION}"; \
  install_openvsx bierner markdown-mermaid "${MARKDOWN_MERMAID_VERSION}"; \
  code-server \
    --extensions-dir /home/node/.local/share/code-server/extensions \
    --list-extensions | sort

RUN npx create-next-app@16.2.6 /home/node/cheatcode-next-template --yes --ts --tailwind --eslint --app --src-dir --use-pnpm --skip-install --disable-git \
  && rm -rf /home/node/cheatcode-next-template/.next /home/node/cheatcode-next-template/node_modules

# Bake the Expo template WITH web support (react-dom + react-native-web ship in the
# default template, but @expo/metro-runtime does not) so `expo start --web` renders the
# app as a web page in the Computer-panel iframe. `expo install` picks SDK-matched
# versions; web.bundler=metro selects the Metro web bundler for Expo Router.
# Install (not --no-install) so `expo` exists for `expo install` to resolve SDK-matched web-dep
# versions; those land in package.json, then node_modules is dropped (runtime pnpm-installs it).
RUN npx --yes create-expo-app@latest /home/node/cheatcode-expo-template --template default \
  && cd /home/node/cheatcode-expo-template \
  && CI=1 EXPO_NO_TELEMETRY=1 npx --yes expo install react-dom react-native-web @expo/metro-runtime \
  && node -e 'const fs=require("fs");try{const j=JSON.parse(fs.readFileSync("app.json","utf8"));j.expo=j.expo||{};j.expo.web={...(j.expo.web||{}),bundler:"metro",output:"single"};fs.writeFileSync("app.json",JSON.stringify(j,null,2));}catch(e){}' \
  && rm -rf /home/node/cheatcode-expo-template/.expo /home/node/cheatcode-expo-template/node_modules

EXPOSE 5173 8000 6080 8081 13340

ENTRYPOINT ["/entrypoint.sh"]
