#!/bin/sh
set -eu

PORT_VALUE="${PORT:-3000}"
sed -i "s/__PORT__/${PORT_VALUE}/g" /etc/nginx/http.d/default.conf

node /app/server.cjs &
API_PID=$!

trap 'kill "$API_PID" 2>/dev/null || true' INT TERM EXIT

nginx -g 'daemon off;'
