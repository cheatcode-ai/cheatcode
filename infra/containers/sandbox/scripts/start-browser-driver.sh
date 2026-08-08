#!/usr/bin/env bash
set -euo pipefail

export CHROME_PATH=/usr/local/bin/cheatcode-chromium
export DISPLAY=:99
export HOME=/home/cheatcode-browser
export PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers

umask 077
ulimit -c 0
cd "$HOME"

# Daytona sessions use a PTY. Disable terminal echo before the one-time
# credential bootstrap is sent so it can never enter the session log buffer.
if [ -t 0 ]; then
  stty -echo
fi

exec /usr/local/bin/node /opt/cheatcode-browser-driver/server.js
