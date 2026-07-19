#!/bin/sh
set -eu

export DISPLAY="${DISPLAY:-:99}"
: "${TAKEOVER_PASSWORD:?TAKEOVER_PASSWORD is required}"
: "${TAKEOVER_PORT:?TAKEOVER_PORT is required}"

/opt/cheatcode/start-browser.sh

password_file="/tmp/cheatcode-vnc-password-${TAKEOVER_PORT}"
x11vnc_pid=""
websockify_pid=""

cleanup() {
  if [ -n "${websockify_pid}" ]; then
    kill "${websockify_pid}" >/dev/null 2>&1 || true
  fi
  if [ -n "${x11vnc_pid}" ]; then
    kill "${x11vnc_pid}" >/dev/null 2>&1 || true
  fi
  rm -f "${password_file}"
}

trap cleanup EXIT INT TERM
umask 077
x11vnc -storepasswd "${TAKEOVER_PASSWORD}" "${password_file}" >/dev/null

# A sandbox has one headed browser display. Replacing an abandoned VNC bridge is safe and keeps
# the raw RFB port private; only the signed Daytona websockify port is exposed to the browser.
pkill -u "$(id -u)" -f "x11vnc.*-rfbport 5900" >/dev/null 2>&1 || true
x11vnc \
  -display "${DISPLAY}" \
  -localhost \
  -rfbport 5900 \
  -rfbauth "${password_file}" \
  -forever \
  -shared \
  -noxdamage \
  >/tmp/cheatcode-x11vnc.log 2>&1 &
x11vnc_pid=$!

for _ in 1 2 3 4 5 6 7 8 9 10; do
  if nc -z 127.0.0.1 5900 >/dev/null 2>&1; then
    break
  fi
  sleep 0.2
done

if ! nc -z 127.0.0.1 5900 >/dev/null 2>&1; then
  echo "x11vnc did not become ready" >&2
  exit 1
fi

websockify --web=/usr/share/novnc "${TAKEOVER_PORT}" 127.0.0.1:5900 \
  >/tmp/cheatcode-websockify.log 2>&1 &
websockify_pid=$!
wait "${websockify_pid}"
