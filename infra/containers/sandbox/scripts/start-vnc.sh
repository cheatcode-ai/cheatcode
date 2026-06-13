#!/bin/sh
set -eu

if [ -z "${VNC_PASSWORD:-}" ]; then
  echo "VNC_PASSWORD is required" >&2
  exit 1
fi

/opt/cheatcode/start-browser.sh

pkill -f "x11vnc.*:99" >/dev/null 2>&1 || true
pkill -f "websockify.*6080" >/dev/null 2>&1 || true

x11vnc -display :99 -forever -shared -passwd "${VNC_PASSWORD}" -rfbport 5900 \
  -bg -o /tmp/cheatcode-x11vnc.log

websockify --web=/usr/share/novnc/ 6080 localhost:5900 \
  >/tmp/cheatcode-websockify.log 2>&1 &
