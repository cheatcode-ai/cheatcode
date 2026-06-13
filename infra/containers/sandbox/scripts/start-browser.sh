#!/bin/sh
set -eu

export DISPLAY="${DISPLAY:-:99}"

if pgrep -f "Xvfb ${DISPLAY}" >/dev/null 2>&1; then
  exit 0
fi

Xvfb "${DISPLAY}" -screen 0 1280x720x24 -ac -nolisten tcp >/tmp/cheatcode-xvfb.log 2>&1 &

for _ in 1 2 3 4 5 6 7 8 9 10; do
  if xdpyinfo -display "${DISPLAY}" >/dev/null 2>&1; then
    exit 0
  fi
  sleep 0.2
done

echo "Xvfb did not become ready on ${DISPLAY}" >&2
exit 1
