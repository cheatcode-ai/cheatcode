#!/bin/sh
set -eu

export CHROME_PATH=/usr/local/bin/cheatcode-chromium
export DISPLAY=:99
export HOME=/home/cheatcode-browser
export PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers

umask 077
ulimit -c 0
cd "$HOME"

exec /usr/local/bin/node /opt/cheatcode-browser-driver/server.js
