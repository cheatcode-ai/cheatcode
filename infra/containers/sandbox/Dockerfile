FROM node:22-bookworm-slim

# Daytona injects its own daemon (host-mounted, PID 1) and overrides ENTRYPOINT,
# so we do NOT bake a sandbox daemon. Long-running services (Xvfb/x11vnc/websockify)
# are started post-create via a toolbox session (scripts/start-vnc.sh), not here.
# Sandboxes are created with user "node" to match /workspace + template ownership.

RUN apt-get update && apt-get install -y --no-install-recommends \
  file python3 python3-pip python3-venv git curl ca-certificates wget gnupg netcat-openbsd \
  procps xvfb x11vnc websockify novnc \
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

RUN npx create-next-app@16.2.6 /home/node/cheatcode-next-template --yes --ts --tailwind --eslint --app --src-dir --use-pnpm --skip-install --disable-git \
  && rm -rf /home/node/cheatcode-next-template/.next /home/node/cheatcode-next-template/node_modules

RUN npx --yes create-expo-app@latest /home/node/cheatcode-expo-template --template default --no-install \
  && rm -rf /home/node/cheatcode-expo-template/.expo /home/node/cheatcode-expo-template/node_modules

EXPOSE 5173 8000 6080 8081

ENTRYPOINT ["/entrypoint.sh"]
