#!/bin/sh
set -eu

/usr/local/bin/sandbox-api &

while ! nc -z 127.0.0.1 8080; do
  sleep 0.1
done

exec sleep infinity
