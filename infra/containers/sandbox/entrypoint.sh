#!/bin/sh
set -eu

# Daytona overrides the image ENTRYPOINT with its own daemon (PID 1); this is a
# harmless fallback so the image remains runnable standalone for local testing.
exec sleep infinity
