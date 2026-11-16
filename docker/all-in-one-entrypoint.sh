#!/bin/sh
set -e

API_PORT="${API_PORT:-3013}"
CLIENT_PORT="${CLIENT_PORT:-3012}"

SERVER_PID=""
CLIENT_PID=""

term_handler() {
  if [ -n "$SERVER_PID" ]; then
    kill -TERM "$SERVER_PID" 2>/dev/null || true
  fi
  if [ -n "$CLIENT_PID" ]; then
    kill -TERM "$CLIENT_PID" 2>/dev/null || true
  fi
  wait 2>/dev/null || true
  exit "${1:-143}"
}

trap "term_handler 143" TERM INT

cd /app/server
export PORT="$API_PORT"
node index.js &
SERVER_PID=$!

cd /app/client
export PORT="$CLIENT_PORT"
export NODE_ENV="${NODE_ENV:-production}"
npm run start &
CLIENT_PID=$!

while kill -0 "$SERVER_PID" 2>/dev/null && kill -0 "$CLIENT_PID" 2>/dev/null; do
  sleep 1
done

if kill -0 "$SERVER_PID" 2>/dev/null; then
  wait "$CLIENT_PID" 2>/dev/null || true
else
  wait "$SERVER_PID" 2>/dev/null || true
fi

term_handler 1